const crypto = require('crypto');

const CONTENT_KINDS = Object.freeze({
  EXTRACTED_TEXT: 'extracted_text',
  OCR_TEXT: 'ocr_text',
  VISUAL_SUMMARY: 'visual_summary',
});

const PARSER_ENGINES = Object.freeze({
  MINERU: 'mineru',
  FITZ: 'fitz',
  VL: 'vl',
  LEGACY: 'legacy',
  UNKNOWN: 'unknown',
});

const TEXT_STATUSES = Object.freeze({
  AVAILABLE: 'available',
  EMPTY: 'empty',
  UNAVAILABLE: 'unavailable',
  UNKNOWN: 'unknown',
});

const VISUAL_STATUSES = Object.freeze({
  AVAILABLE: 'available',
  PENDING: 'pending',
  FAILED: 'failed',
  UNAVAILABLE: 'unavailable',
  UNKNOWN: 'unknown',
});

function stableArtifactId(prefix, ...parts) {
  const digest = crypto
    .createHash('sha256')
    .update(parts.map((part) => String(part ?? '')).join('\u001f'))
    .digest('hex')
    .slice(0, 24);
  return `${prefix}_${digest}`;
}

function positivePage(value) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : null;
}

function normalizePageRange(value = {}) {
  const rawStart =
    value.pageStart ??
    value.page_start ??
    value.page ??
    (value.page_idx != null ? Number(value.page_idx) + 1 : null);
  const pageStart = positivePage(rawStart);
  const rawEnd = value.pageEnd ?? value.page_end ?? value.page ?? pageStart;
  const pageEnd = positivePage(rawEnd) || pageStart;
  return { pageStart, pageEnd };
}

function inferEngine(value = {}, fallback = PARSER_ENGINES.UNKNOWN) {
  const explicit = String(value.engine || value.parser || value.parserEngine || '').toLowerCase();
  if (Object.values(PARSER_ENGINES).includes(explicit)) return explicit;
  if (value.reader === 'vision') return PARSER_ENGINES.FITZ;
  return fallback;
}

function normalizeRecord(value = {}, options = {}) {
  const text = String(value.text ?? value.content ?? value.md ?? value.summary ?? '').trim();
  const { pageStart, pageEnd } = normalizePageRange(value);
  const sourceRecordId = String(
    value.sourceRecordId ??
      value.source_record_id ??
      value.chunk_id ??
      value.chunkId ??
      stableArtifactId('source', options.documentId, pageStart, pageEnd, text),
  );
  const kind = Object.values(CONTENT_KINDS).includes(value.kind)
    ? value.kind
    : options.kind || CONTENT_KINDS.EXTRACTED_TEXT;
  const engine = inferEngine(value, options.engine);
  const id = String(
    value.id ||
      value.recordId ||
      stableArtifactId(
        'record',
        options.documentId,
        sourceRecordId,
        kind,
        engine,
        pageStart,
        pageEnd,
        text,
      ),
  );
  if (!text) return null;
  return {
    id,
    documentId: options.documentId || value.documentId || null,
    pageStart,
    pageEnd,
    kind,
    text,
    engine,
    sourceArtifact: value.sourceArtifact || value.source_artifact || options.sourceArtifact || null,
    sourceRecordId,
    sectionId: value.sectionId || value.section_id || null,
    tableId: value.tableId || value.table_id || null,
    blockId: value.blockId || value.block_id || null,
    metadata: { ...(options.metadata || {}), ...(value.metadata || {}) },
  };
}

function adaptMineruChunks(records = [], options = {}) {
  return records.map((record) =>
    normalizeRecord(record, {
      ...options,
      kind: CONTENT_KINDS.EXTRACTED_TEXT,
      engine: options.engine || PARSER_ENGINES.MINERU,
      sourceArtifact: options.sourceArtifact || 'mineru_chunks',
    }),
  ).filter(Boolean);
}

function adaptFitzPages(pages = [], options = {}) {
  return pages.map((page) =>
    normalizeRecord(
      {
        ...page,
        text: page.text,
        sourceRecordId: page.sourceRecordId || `fitz-page-${page.page}`,
        metadata: {
          textChars: page.text_chars ?? page.textChars ?? null,
          imageName: page.image_name || page.imageName || null,
          status: page.status || null,
        },
      },
      {
        ...options,
        kind: CONTENT_KINDS.EXTRACTED_TEXT,
        engine: PARSER_ENGINES.FITZ,
        sourceArtifact: options.sourceArtifact || 'visual_pages',
      },
    ),
  ).filter(Boolean);
}

function validateVisualIndexRecord(record, {
  expectedVersion = null,
  expectedRootFileId = null,
  expectedConversationId = null,
  expectedUserId = null,
} = {}) {
  const visualIndex = record?.metadata?.visualIndex;
  const result = {
    valid: true,
    versionKnown: Boolean(visualIndex?.version),
    sourceBound: true,
    scopeBound: true,
    warnings: [],
  };
  if (!visualIndex || typeof visualIndex !== 'object') {
    return { ...result, valid: false, warnings: ['visual_index_missing'] };
  }
  if (expectedVersion && visualIndex.version !== expectedVersion) {
    result.valid = false;
    result.warnings.push('visual_index_version_mismatch');
  }
  const rootId = record?.metadata?.rootSourceLibreFileId;
  if (expectedRootFileId && rootId && String(rootId) !== String(expectedRootFileId)) {
    result.valid = false;
    result.sourceBound = false;
    result.warnings.push('visual_index_source_mismatch');
  } else if (expectedRootFileId && !rootId) {
    result.sourceBound = false;
    result.warnings.push('visual_index_source_unbound');
  }
  if (expectedConversationId && record?.conversationId && String(record.conversationId) !== String(expectedConversationId)) {
    result.valid = false;
    result.scopeBound = false;
    result.warnings.push('visual_index_conversation_mismatch');
  } else if (expectedConversationId && !record?.conversationId) {
    result.scopeBound = false;
    result.warnings.push('visual_index_conversation_unknown');
  }
  if (expectedUserId && record?.userId && String(record.userId) !== String(expectedUserId)) {
    result.valid = false;
    result.scopeBound = false;
    result.warnings.push('visual_index_user_mismatch');
  } else if (expectedUserId && !record?.userId) {
    result.scopeBound = false;
    result.warnings.push('visual_index_user_unknown');
  }
  return result;
}

function adaptVisualIndex(visualIndex = {}, options = {}) {
  const version = String(visualIndex.version || '').trim() || null;
  const pages = Array.isArray(visualIndex.pages) ? visualIndex.pages : [];
  return pages.map((page) =>
    normalizeRecord(
      {
        page: page.page,
        text: page.summary,
        sourceRecordId: `vl-page-${page.page}`,
        kind: CONTENT_KINDS.VISUAL_SUMMARY,
        engine: PARSER_ENGINES.VL,
        metadata: {
          keywords: Array.isArray(page.keywords) ? page.keywords.slice(0, 30) : [],
          visualIndexVersion: version,
          model: visualIndex.model || null,
          complete: visualIndex.complete === true,
          pageCount: positivePage(visualIndex.pageCount),
          indexedPages: positivePage(visualIndex.indexedPages),
        },
      },
      {
        ...options,
        kind: CONTENT_KINDS.VISUAL_SUMMARY,
        engine: PARSER_ENGINES.VL,
        sourceArtifact: options.sourceArtifact || 'visualIndex',
      },
    ),
  ).filter(Boolean);
}

function collectPageNumbers({ pageCount, records = [], visualPages = [], pageRecords = [] } = {}) {
  const pages = new Set();
  const count = positivePage(pageCount);
  if (count) for (let page = 1; page <= count; page += 1) pages.add(page);
  for (const record of [...records, ...visualPages, ...pageRecords]) {
    const start = positivePage(record.pageStart ?? record.page);
    const end = positivePage(record.pageEnd ?? record.page) || start;
    if (!start) continue;
    for (let page = start; page <= end; page += 1) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}

function buildPageCoverage({
  pageCount,
  records = [],
  visualPages = [],
  pageRecords = [],
  manifest = null,
} = {}) {
  const textByPage = new Map();
  const visualByPage = new Map();
  for (const record of records) {
    const start = positivePage(record.pageStart ?? record.page);
    const end = positivePage(record.pageEnd ?? record.page) || start;
    if (!start) continue;
    for (let page = start; page <= end; page += 1) textByPage.set(page, true);
  }
  for (const record of [...visualPages, ...pageRecords]) {
    const page = positivePage(record.pageStart ?? record.page);
    if (page) visualByPage.set(page, true);
  }
  const pages = collectPageNumbers({ pageCount, records, visualPages, pageRecords });
  const declaredCount = positivePage(manifest?.page_count || manifest?.pageCount || pageCount);
  return pages.map((page) => {
    const hasExtractedText = textByPage.has(page);
    const hasVisualPage = visualByPage.has(page);
    const hasVisualSummary = visualPages.some(
      (record) => positivePage(record.pageStart ?? record.page) === page,
    );
    const warnings = [];
    if (!hasExtractedText) warnings.push('page_text_unavailable');
    if (!hasVisualPage && declaredCount && page <= declaredCount) warnings.push('page_image_unavailable');
    if (hasVisualPage && !hasVisualSummary) warnings.push('visual_summary_unavailable');
    return {
      page,
      hasExtractedText,
      hasVisualPage,
      hasVisualSummary,
      textStatus: hasExtractedText ? TEXT_STATUSES.AVAILABLE : TEXT_STATUSES.EMPTY,
      visualStatus: hasVisualSummary
        ? VISUAL_STATUSES.AVAILABLE
        : hasVisualPage
          ? VISUAL_STATUSES.PENDING
          : VISUAL_STATUSES.UNAVAILABLE,
      engines: [
        ...(hasExtractedText ? [...new Set(records.filter((r) => (r.pageStart ?? r.page) === page).map((r) => r.engine))] : []),
        ...(hasVisualSummary ? [PARSER_ENGINES.VL] : []),
      ],
      warnings,
    };
  });
}

function createDocumentArtifactAdapter({
  documentId,
  fileId,
  filename,
  parserVersion = null,
  mineruChunks = [],
  fitzPages = [],
  visualIndex = null,
  manifest = null,
} = {}) {
  const textRecords = [
    ...adaptMineruChunks(mineruChunks, { documentId, sourceArtifact: 'mineru_chunks' }),
    ...adaptFitzPages(fitzPages, { documentId, sourceArtifact: 'visual_pages' }),
  ];
  const visualRecords = visualIndex
    ? adaptVisualIndex(visualIndex, { documentId, sourceArtifact: 'visualIndex' })
    : [];
  const coverage = buildPageCoverage({
    pageCount: visualIndex?.pageCount || manifest?.page_count,
    records: textRecords,
    visualPages: visualRecords,
    pageRecords: fitzPages,
    manifest,
  });
  return {
    documentId,
    fileId,
    filename: filename || null,
    parserVersion,
    records: [...textRecords, ...visualRecords],
    textRecords,
    visualRecords,
    pageCoverage: coverage,
    getPage(page) {
      const number = positivePage(page);
      return {
        page: number,
        records: this.records.filter((record) => record.pageStart === number),
        coverage: this.pageCoverage.find((item) => item.page === number) || null,
      };
    },
    listVisualPageSummaries() {
      return this.visualRecords.map((record) => ({
        page: record.pageStart,
        summary: record.text,
        keywords: record.metadata.keywords || [],
        source: record.engine,
      }));
    },
  };
}

module.exports = {
  CONTENT_KINDS,
  PARSER_ENGINES,
  TEXT_STATUSES,
  VISUAL_STATUSES,
  stableArtifactId,
  normalizeRecord,
  adaptMineruChunks,
  adaptFitzPages,
  adaptVisualIndex,
  validateVisualIndexRecord,
  buildPageCoverage,
  createDocumentArtifactAdapter,
};
