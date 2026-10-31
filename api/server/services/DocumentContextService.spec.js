const {
  getDocumentId,
  parsePdfChunks,
  buildPdfDocument,
  createDocumentContextService,
  parseWordBlocks,
  buildWordDocument,
  createWordDocumentContextService,
} = require('./DocumentContextService');

function buildService() {
  const userId = 'user-1';
  const fileId = 'pdf-1';
  const documentId = getDocumentId(userId, fileId);
  const records = parsePdfChunks(
    Buffer.from(
      [
        JSON.stringify({
          chunk_id: 'original-1',
          page_start: 1,
          page_end: 1,
          text: '# 第一章 总则\n本标准规定检验周期。',
        }),
        '{bad json',
        JSON.stringify({
          chunk_id: 'original-2',
          page_start: 19,
          page_end: 19,
          text: '## 检验表\n| 项目 | 周期 |\n| --- | --- |\n| 外观 | 三个月 |\n| 绝缘 | 六个月 |',
        }),
        JSON.stringify({
          chunk_id: 'original-3',
          page_start: 20,
          page_end: 20,
          text: '补充说明：异常时立即复检。',
        }),
      ].join('\n'),
    ),
    documentId,
  );
  const document = buildPdfDocument({ userId, fileId, filename: '标准.pdf', records });
  return {
    document,
    service: createDocumentContextService({
      documents: new Map([[document.documentId, document]]),
    }),
  };
}

describe('DocumentContextService PDF adapter', () => {
  it('creates stable opaque document and record identities', () => {
    const first = buildService().document;
    const second = buildService().document;
    expect(first.documentId).toBe(second.documentId);
    expect(first.documentId).toMatch(/^doc_[a-f0-9]{20}$/);
    expect(first.records.map((record) => record.chunkId)).toEqual(
      second.records.map((record) => record.chunkId),
    );
    expect(first.records).toHaveLength(3);
    const otherOwner = buildPdfDocument({
      userId: 'user-2',
      fileId: 'pdf-1',
      records: [{ chunk_id: 'original-1', page_start: 1, text: '正文' }],
    });
    expect(otherOwner.documentId).not.toBe(first.documentId);
  });

  it('keeps explicit chunk identities stable when unrelated records are inserted', () => {
    const base = buildPdfDocument({
      userId: 'user-1',
      fileId: 'pdf-stable',
      records: [{ chunk_id: 'target', page_start: 2, text: '目标正文' }],
    });
    const shifted = buildPdfDocument({
      userId: 'user-1',
      fileId: 'pdf-stable',
      records: [
        { chunk_id: 'new', page_start: 1, text: '新增正文' },
        { chunk_id: 'target', page_start: 2, text: '目标正文' },
      ],
    });
    expect(shifted.records[1].chunkId).toBe(base.records[0].chunkId);
  });

  it('lists info and a heading-based toc', () => {
    const { document, service } = buildService();
    expect(service.execute({ action: 'list' }).documents).toEqual([
      expect.objectContaining({
        document_id: document.documentId,
        page_count: 20,
        chunk_count: 3,
        table_count: 1,
        status: 'ready',
      }),
    ]);
    const toc = service.execute({ action: 'toc', document_id: document.documentId });
    expect(toc.sections).toEqual([
      expect.objectContaining({ level: 1, title: '第一章 总则', pageStart: 1 }),
      expect.objectContaining({ level: 2, title: '检验表', pageStart: 19 }),
    ]);
  });

  it('searches content and returns stable provenance and table ids', () => {
    const { document, service } = buildService();
    const result = service.execute({
      action: 'search',
      document_id: document.documentId,
      query: '三个月',
    });
    expect(result.status).toBe('ok');
    expect(result.content).toContain('三个月');
    expect(result.hits[0]).toMatchObject({ page_start: 19, source_chunk_id: 'original-2' });
    expect(result.reference.table_id).toMatch(/^table_/);
  });

  it('reads exact pages, tables, and adjacent chunks without storage paths', () => {
    const { document, service } = buildService();
    const page = service.execute({
      action: 'read',
      document_id: document.documentId,
      pages: [19],
    });
    const table = service.execute({
      action: 'read_table',
      document_id: document.documentId,
      table_id: page.reference.table_id,
    });
    expect(table.content).toContain('| 外观 | 三个月 |');
    expect(JSON.stringify(table)).not.toContain('/mnt/data');

    const adjacent = service.execute({
      action: 'read_adjacent',
      document_id: document.documentId,
      chunk_id: page.reference.chunk_id,
      adjacent_count: 1,
    });
    expect(adjacent.content).toContain('异常时立即复检');
  });

  it('continues from the previous table reference and applies the output limit', () => {
    const { document } = buildService();
    const tableId = document.tables[0].tableId;
    const service = createDocumentContextService({
      documents: new Map([[document.documentId, document]]),
      previousReference: { document_id: document.documentId, table_id: tableId },
    });
    const result = service.execute({
      action: 'read_table',
      document_id: document.documentId,
      max_chars: 100,
    });
    expect(result.status).toBe('ok');
    expect(result.content.length).toBeLessThanOrEqual(100);
  });

  it('does not reuse a previous reference from another document', () => {
    const { document } = buildService();
    const other = buildPdfDocument({
      userId: 'user-1',
      fileId: 'pdf-2',
      records: [{ chunk_id: 'other', page_start: 1, text: '另一份正文' }],
    });
    const service = createDocumentContextService({
      documents: new Map([
        [document.documentId, document],
        [other.documentId, other],
      ]),
      previousReference: {
        document_id: document.documentId,
        chunk_id: document.records[0].chunkId,
        table_id: document.tables[0].tableId,
      },
    });
    expect(
      service.execute({ action: 'read_adjacent', document_id: other.documentId }),
    ).toMatchObject({ status: 'not_found' });
    expect(service.execute({ action: 'read_table', document_id: other.documentId })).toMatchObject({
      status: 'not_found',
    });
  });

  it('reports empty or fully damaged persisted artifacts as unavailable', () => {
    const document = buildPdfDocument({
      userId: 'user-1',
      fileId: 'damaged',
      records: parsePdfChunks(Buffer.from('{broken json\n'), getDocumentId('user-1', 'damaged')),
    });
    const service = createDocumentContextService({
      documents: new Map([[document.documentId, document]]),
    });
    expect(service.execute({ action: 'info', document_id: document.documentId })).toMatchObject({
      status: 'unavailable',
      message: '解析产物为空。',
    });
  });

  it('only recognizes well-formed markdown tables', () => {
    const document = buildPdfDocument({
      userId: 'user-1',
      fileId: 'table-validation',
      records: [
        {
          chunk_id: 'mixed',
          page_start: 1,
          text: [
            '伪表头 | 第二列',
            '--- | 不是分隔符',
            '值 | 值',
            '',
            'A | B',
            '--- | :---:',
            '1 | 2',
          ].join('\n'),
        },
      ],
    });
    expect(document.tables).toHaveLength(1);
    expect(document.tables[0].content).toContain('A | B');
  });

  it('requires document_id when multiple PDFs are active', () => {
    const { document } = buildService();
    const other = buildPdfDocument({
      userId: 'user-1',
      fileId: 'pdf-2',
      filename: '另一份.pdf',
      records: [{ chunk_id: 'a', page_start: 1, text: '另一份正文' }],
    });
    const service = createDocumentContextService({
      documents: new Map([
        [document.documentId, document],
        [other.documentId, other],
      ]),
    });
    expect(service.execute({ action: 'search', query: '正文' })).toMatchObject({
      status: 'document_id_required',
    });
  });
});

describe('DocumentContextService Word adapter', () => {
  function buildWordService() {
    const userId = 'user-1';
    const fileId = 'word-1';
    const documentId = getDocumentId(userId, fileId);
    const records = parseWordBlocks(
      Buffer.from(
        [
          JSON.stringify({
            type: 'text',
            paragraph_index: 1,
            style_name: 'Heading 1',
            heading_level: 1,
            text: '第一章 总则',
          }),
          '{bad json',
          JSON.stringify({ type: 'text', paragraph_index: 2, text: '本办法规定检验周期。' }),
          JSON.stringify({
            type: 'text',
            paragraph_index: 3,
            table_index: 1,
            row_index: 1,
            cell_index: 1,
            text: '项目',
          }),
          JSON.stringify({
            type: 'text',
            paragraph_index: 4,
            table_index: 1,
            row_index: 1,
            cell_index: 2,
            text: '周期',
          }),
          JSON.stringify({
            type: 'text',
            paragraph_index: 5,
            table_index: 1,
            row_index: 2,
            cell_index: 1,
            text: '绝缘',
          }),
          JSON.stringify({
            type: 'text',
            paragraph_index: 6,
            table_index: 1,
            row_index: 2,
            cell_index: 2,
            text: '六个月',
          }),
          JSON.stringify({ type: 'image', paragraph_index: 7, image_index: 1 }),
          JSON.stringify({ type: 'text', paragraph_index: 8, text: '异常时立即复检。' }),
        ].join('\n'),
      ),
      documentId,
    );
    const document = buildWordDocument({ userId, fileId, filename: '办法.docx', records });
    return {
      document,
      service: createWordDocumentContextService({
        documents: new Map([[document.documentId, document]]),
      }),
    };
  }

  it('builds stable headings, paragraphs, and structured tables', () => {
    const first = buildWordService().document;
    const second = buildWordService().document;
    expect(first.records.map((record) => record.chunkId)).toEqual(
      second.records.map((record) => record.chunkId),
    );
    expect(first.headings).toEqual([
      expect.objectContaining({ level: 1, title: '第一章 总则', paragraphIndex: 1 }),
    ]);
    expect(first.tables).toEqual([
      expect.objectContaining({ rows: 2, columns: 2, paragraphStart: 3, paragraphEnd: 6 }),
    ]);
    expect(first.tables[0].content).toContain('| 绝缘 | 六个月 |');
  });

  it('lists, searches, reads sections, tables, and adjacent paragraphs', () => {
    const { document, service } = buildWordService();
    expect(service.execute({ action: 'list' }).documents[0]).toMatchObject({
      document_id: document.documentId,
      paragraph_count: 7,
      table_count: 1,
      section_count: 1,
    });
    expect(
      service.execute({ action: 'toc', document_id: document.documentId }).sections,
    ).toHaveLength(1);
    const search = service.execute({
      action: 'search',
      document_id: document.documentId,
      query: '六个月',
    });
    expect(search.content).toContain('六个月');
    const table = service.execute({
      action: 'read_table',
      document_id: document.documentId,
      table_id: search.reference.table_id,
    });
    expect(table.content).toContain('| 绝缘 | 六个月 |');
    const adjacent = service.execute({
      action: 'read_adjacent',
      document_id: document.documentId,
      chunk_id: document.records.at(-1).chunkId,
    });
    expect(adjacent.content).toContain('异常时立即复检');
    const section = service.execute({
      action: 'read',
      document_id: document.documentId,
      section_id: document.headings[0].sectionId,
    });
    expect(section.content).toContain('本办法规定检验周期');
  });

  it('keeps legacy blocks readable without inventing table structure', () => {
    const document = buildWordDocument({
      userId: 'user-1',
      fileId: 'legacy-word',
      records: parseWordBlocks(
        Buffer.from(
          [
            JSON.stringify({ type: 'text', paragraph_index: 1, text: '一、范围' }),
            JSON.stringify({ type: 'text', paragraph_index: 2, text: '旧格式正文' }),
          ].join('\n'),
        ),
        getDocumentId('user-1', 'legacy-word'),
      ),
    });
    const service = createWordDocumentContextService({
      documents: new Map([[document.documentId, document]]),
    });
    expect(document.headings).toHaveLength(1);
    expect(document.tables).toHaveLength(0);
    expect(
      service.execute({ action: 'read_table', document_id: document.documentId }),
    ).toMatchObject({
      status: 'not_found',
      message: '现有解析产物没有可定位的表格结构。',
    });
  });

  it('ignores null and non-positive optional table coordinates', () => {
    const records = parseWordBlocks(
      Buffer.from(
        [
          JSON.stringify({
            type: 'text',
            paragraph_index: 1,
            table_index: null,
            row_index: 0,
            cell_index: -1,
            text: '普通正文',
          }),
        ].join('\n'),
      ),
      getDocumentId('user-1', 'word-null-table'),
    );
    expect(records[0]).toMatchObject({
      paragraphIndex: 1,
      tableIndex: null,
      rowIndex: null,
      cellIndex: null,
    });
    expect(
      buildWordDocument({ userId: 'user-1', fileId: 'word-null-table', records }).tables,
    ).toHaveLength(0);
  });

  it('isolates owners, multiple documents, and previous references', () => {
    const { document } = buildWordService();
    const other = buildWordDocument({
      userId: 'user-1',
      fileId: 'word-2',
      records: [{ paragraphIndex: 1, segmentIndex: 1, segmentCount: 1, text: '另一份正文' }],
    });
    const otherOwner = buildWordDocument({
      userId: 'user-2',
      fileId: 'word-1',
      records: [{ paragraphIndex: 1, segmentIndex: 1, segmentCount: 1, text: '正文' }],
    });
    expect(otherOwner.documentId).not.toBe(document.documentId);
    const service = createWordDocumentContextService({
      documents: new Map([
        [document.documentId, document],
        [other.documentId, other],
      ]),
      previousReference: {
        document_id: document.documentId,
        chunk_id: document.records[0].chunkId,
      },
    });
    expect(service.execute({ action: 'search', query: '正文' })).toMatchObject({
      status: 'document_id_required',
    });
    expect(
      service.execute({ action: 'read_adjacent', document_id: other.documentId }),
    ).toMatchObject({ status: 'not_found' });
  });

  it('reports fully damaged Word artifacts as unavailable', () => {
    const document = buildWordDocument({
      userId: 'user-1',
      fileId: 'damaged-word',
      records: Buffer.from('{broken json\n'),
    });
    const service = createWordDocumentContextService({
      documents: new Map([[document.documentId, document]]),
    });
    expect(service.execute({ action: 'info', document_id: document.documentId })).toMatchObject({
      status: 'unavailable',
    });
  });
});
