const {
  CONTENT_KINDS,
  PARSER_ENGINES,
  TEXT_STATUSES,
  VISUAL_STATUSES,
  adaptMineruChunks,
  adaptFitzPages,
  adaptVisualIndex,
  buildPageCoverage,
  createDocumentArtifactAdapter,
  validateVisualIndexRecord,
} = require('./DocumentArtifactAdapter');

describe('DocumentArtifactAdapter', () => {
  test('normalizes MinerU chunks without changing stable source identity', () => {
    const input = [{ chunk_id: 'm-1', page_start: 2, page_end: 2, text: '电子正文' }];
    const first = adaptMineruChunks(input, { documentId: 'doc-1' });
    const second = adaptMineruChunks(input, { documentId: 'doc-1' });
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      kind: CONTENT_KINDS.EXTRACTED_TEXT,
      engine: PARSER_ENGINES.MINERU,
      pageStart: 2,
      sourceRecordId: 'm-1',
      text: '电子正文',
    });
    expect(first[0].id).toBe(second[0].id);
  });

  test('classifies FITZ text layer as extracted text, never OCR', () => {
    const records = adaptFitzPages(
      [{ page: 1, text: '文字层', text_chars: 3, image_name: 'page_0001.png' }],
      { documentId: 'doc-1' },
    );
    expect(records[0]).toMatchObject({
      kind: CONTENT_KINDS.EXTRACTED_TEXT,
      engine: PARSER_ENGINES.FITZ,
      metadata: { textChars: 3, imageName: 'page_0001.png' },
    });
    expect(records[0].kind).not.toBe(CONTENT_KINDS.OCR_TEXT);
  });

  test('keeps pure scan page as visual page without fabricating text', () => {
    const records = adaptFitzPages(
      [{ page: 2, text: '', text_chars: 0, image_name: 'page_0002.png' }],
      { documentId: 'doc-1' },
    );
    expect(records).toEqual([]);
    const coverage = buildPageCoverage({
      pageCount: 2,
      pageRecords: [{ page: 2, image_name: 'page_0002.png' }],
    });
    expect(coverage[1]).toMatchObject({
      page: 2,
      hasExtractedText: false,
      hasVisualPage: true,
      textStatus: TEXT_STATUSES.EMPTY,
      visualStatus: VISUAL_STATUSES.PENDING,
    });
  });

  test('adapts complete and partial VL indexes as visual summaries', () => {
    const records = adaptVisualIndex(
      {
        version: 'pdf-visual-index-v1',
        model: 'qwen3-vl-plus',
        pageCount: 3,
        indexedPages: 2,
        complete: false,
        pages: [
          { page: 1, summary: '封面', keywords: ['目录'] },
          { page: 2, summary: '扫描正文', keywords: ['正文'] },
        ],
      },
      { documentId: 'doc-1' },
    );
    expect(records).toHaveLength(2);
    expect(records[1]).toMatchObject({
      kind: CONTENT_KINDS.VISUAL_SUMMARY,
      engine: PARSER_ENGINES.VL,
      pageStart: 2,
      metadata: { complete: false, visualIndexVersion: 'pdf-visual-index-v1' },
    });
    const coverage = buildPageCoverage({
      pageCount: 3,
      visualPages: records,
    });
    expect(coverage.map((item) => [item.page, item.hasVisualSummary])).toEqual([
      [1, true],
      [2, true],
      [3, false],
    ]);
  });

  test('builds mixed page coverage and exposes page records without paths', () => {
    const adapter = createDocumentArtifactAdapter({
      documentId: 'doc-1',
      fileId: 'file-1',
      filename: '混合.pdf',
      mineruChunks: [{ chunk_id: 'm-1', page_start: 1, text: '电子页' }],
      fitzPages: [
        { page: 1, text: '电子页', image_name: 'page_0001.png' },
        { page: 2, text: '', image_name: 'page_0002.png' },
        { page: 3, text: '第三页', image_name: 'page_0003.png' },
      ],
      visualIndex: {
        version: 'pdf-visual-index-v1',
        pageCount: 3,
        indexedPages: 1,
        complete: false,
        pages: [{ page: 2, summary: '扫描页摘要', keywords: ['扫描'] }],
      },
    });
    expect(adapter.getPage(2).coverage).toMatchObject({
      hasExtractedText: false,
      hasVisualPage: true,
      hasVisualSummary: true,
      visualStatus: VISUAL_STATUSES.AVAILABLE,
    });
    expect(adapter.listVisualPageSummaries()[0]).toMatchObject({
      page: 2,
      summary: '扫描页摘要',
      source: PARSER_ENGINES.VL,
    });
    expect(JSON.stringify(adapter)).not.toContain('/mnt/data');
  });

  test('does not invent a page for records without a trusted page', () => {
    const adapter = createDocumentArtifactAdapter({
      documentId: 'doc-1',
      mineruChunks: [{ chunk_id: 'unknown', text: '无页码正文' }],
    });
    expect(adapter.pageCoverage).toEqual([]);
    expect(adapter.textRecords[0].pageStart).toBeNull();
  });

  test('rejects a visual index bound to another source or schema version', () => {
    const result = validateVisualIndexRecord(
      {
        userId: 'user-1',
        conversationId: 'conversation-1',
        metadata: {
          rootSourceLibreFileId: 'root-other',
          visualIndex: { version: 'old-version', pages: [] },
        },
      },
      {
        expectedVersion: 'pdf-visual-index-v1',
        expectedRootFileId: 'root-current',
        expectedConversationId: 'conversation-1',
        expectedUserId: 'user-1',
      },
    );
    expect(result.valid).toBe(false);
    expect(result.warnings).toEqual(
      expect.arrayContaining(['visual_index_version_mismatch', 'visual_index_source_mismatch']),
    );
  });
});
