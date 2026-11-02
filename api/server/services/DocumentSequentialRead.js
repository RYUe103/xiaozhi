const { compactDocumentResult } = require('./DocumentToolResult');
const error = (code, extra = {}) => ({ status: 'unavailable', ok: false, error: { code },
  next_action: 'scan_document', ...extra });
const knownPage = r => Number.isInteger(r.pageStart) && r.pageStart > 0;
function ranges(numbers) {
  const out = [];
  for (const n of [...new Set(numbers)].sort((a, b) => a - b)) {
    if (out.length && out.at(-1)[1] + 1 === n) out.at(-1)[1] = n;
    else out.push([n, n]);
  }
  return out;
}
/** Only proven source intervals are deduplicated. Equal text on unrelated pages
 * is never evidence of overlap. The original records remain immutable. */
function plan(document) {
  const records = [...document.records];
  const orderKnown = records.every(knownPage);
  if (orderKnown) records.sort((a, b) => a.pageStart - b.pageStart || a.index - b.index);
  const ends = new Map();
  let total = 0, removed = 0;
  const spans = records.map(record => {
    const start = record.source_text_offset;
    const key = record.source_text_id;
    let skip = 0;
    if (key && Number.isSafeInteger(start) && start >= 0) {
      const previous = ends.get(key);
      if (previous && start <= previous.end && start >= previous.start &&
          previous.text.slice(start - previous.start, start - previous.start + Math.min(previous.end - start, record.text.length)) === record.text.slice(0, Math.min(previous.end - start, record.text.length))) {
        skip = Math.min(previous.end - start, record.text.length);
      }
      if (!previous || start + record.text.length > previous.end) ends.set(key, { start, end: start + record.text.length, text: record.text });
    }
    const span = { record, skip, start: total, end: total + record.text.length - skip };
    total = span.end; removed += skip;
    return span;
  });
  return { spans, total, removed, orderKnown };
}
function readSequential(repository, document, args) {
  const action = args.action;
  if (['pages', 'page', 'query', 'chunk_id', 'section_id', 'table_id', 'include_visual_summary'].some(k => args[k] != null)) return error('SEQUENTIAL_SCOPE_INVALID');
  const max = args.max_chars ?? 100000;
  if (!Number.isInteger(max) || max < 100 || max > 100000) return error('READ_BUDGET_EXCEEDED');
  const budget = repository.contextBudget;
  if (!budget?.snapshot().available) return error('MODEL_CONTEXT_BUDGET_UNAVAILABLE');
  const p = plan(document), offset = args.offset || 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > p.total) return error('CONTINUATION_INVALID');
  const remaining = Math.min(max, repository.budget.maxContentChars - repository.usage.contentChars);
  if (action === 'read_full' && p.total + Math.max(0, p.spans.length - 1) * 2 > remaining) return error('FULL_READ_REQUIRES_SCAN', { total_source_chars: p.total, max_chars: remaining, context_budget: budget.snapshot() });
  const missing = document.pageCoverage.filter(x => !x.hasExtractedText).map(x => x.page);
  const suspect = document.pageCoverage.filter(x => x.textQuality === 'suspect').map(x => x.page);
  const unknown = document.pageCoverage.filter(x => x.textQuality === 'unknown').map(x => x.page);
  const sourceIncomplete = missing.length > 0 || suspect.length > 0 || unknown.length > 0 || !p.orderKnown || document.pageCountSource !== 'manifest' || document.warnings.length > 0;
  function result(end) {
    // Never split a surrogate pair at a batch boundary.
    const boundary = p.spans.find(s => s.start < end && s.end > end);
    if (boundary) {
      const local = boundary.skip + end - boundary.start;
      if (/[\uD800-\uDBFF]/.test(boundary.record.text[local - 1] || '') && /[\uDC00-\uDFFF]/.test(boundary.record.text[local] || '')) end--;
    }
    const active = p.spans.filter(s => s.start < end && s.end > offset);
    const hits = active.map(s => ({ chunk_id: s.record.chunkId, source_chunk_id: s.record.sourceChunkId,
      page_start: s.record.pageStart, page_end: s.record.pageEnd, block_id: s.record.block_id,
      source_offset: s.skip + Math.max(0, offset - s.start), source_length: Math.min(end, s.end) - Math.max(offset, s.start),
      table_ids: document.tables.filter(t => t.chunkIds?.includes(s.record.chunkId) || t.chunkId === s.record.chunkId).map(t => t.tableId) }));
    const completed = p.spans.filter(s => s.end <= end);
    const pending = p.spans.filter(s => s.end > end);
    const pages = document.pageCoverage.filter(page => page.hasExtractedText &&
      completed.some(s => s.record.pageStart != null && page.page >= s.record.pageStart && page.page <= s.record.pageEnd) &&
      !pending.some(s => s.record.pageStart != null && page.page >= s.record.pageStart && page.page <= s.record.pageEnd)).map(x => x.page);
    const complete = end === p.total;
    return { status: complete && !sourceIncomplete ? 'ok' : 'partial', ok: true, action, document_id: document.documentId,
      filename: document.filename, version: document.version, source_sha256: document.sourceHash,
      content: hits.map((h, i) => active[i].record.text.slice(h.source_offset, h.source_offset + h.source_length)).join('\n\n'),
      hits, offset_unit: 'utf16_code_units', ordering: p.orderKnown ? 'physical_page_then_source_order' : 'parser_order_pages_unknown',
      total_source_chars: p.total, deduplicated_chars: p.removed, delivered_source_range: [offset, end],
      completed_source_range: [0, end], unread_source_range: [end, p.total],
      parsed_text_complete: complete, document_verified: false, truncated: !complete,
      coverage: { completed_chunks: completed.length, total_chunks: p.spans.length, parsed_text_read_pages: ranges(pages),
        unread_text_pages: ranges(pending.flatMap(s => knownPage(s.record) ? [s.record.pageStart, s.record.pageEnd] : [])),
        missing_text_pages: ranges(missing), suspect_text_pages: ranges(suspect), unknown_quality_pages: ranges(unknown),
        images_checked_by_this_action: [], page_count: document.pageCount, page_count_source: document.pageCountSource },
      warnings: [...document.warnings, ...(!p.orderKnown ? ['PAGE_ORDER_UNKNOWN'] : []),
        ...(sourceIncomplete ? ['PARSED_TEXT_INCOMPLETE_OR_UNVERIFIED', 'CANNOT_PROVE_DOCUMENT_WIDE_ABSENCE'] : []), 'PAGE_IMAGES_NOT_CHECKED'],
      continuation_token: complete ? null : repository.sign({ document: document.documentId, version: document.version,
        selection: { action: 'scan_document', max_chars: max }, offset: end }),
      context_budget: budget.snapshot(),
      reference: hits.length ? { document_id: document.documentId, chunk_id: hits[0].chunk_id,
        page_start: hits[0].page_start, page_end: hits[0].page_end, source_hash: document.sourceHash,
        version: document.version, user_id: repository.userId, conversation_id: repository.conversationId } : undefined };
  }
  if (!p.total) return error('PAGE_TEXT_UNAVAILABLE', { coverage: { missing_text_pages: ranges(missing) } });
  let output = result(Math.min(p.total, offset + remaining));
  const serialize = value => JSON.stringify(repository.compactSequentialOutput === false ? value : compactDocumentResult(value));
  const fits = value => value.content.length <= remaining && serialize(value).length <= budget.maxChars && budget.fits(serialize(value));
  if (!fits(output)) {
    if (action === 'read_full') return error('MODEL_CONTEXT_BUDGET_EXCEEDED', { context_budget: budget.snapshot(), total_source_chars: p.total });
    let lo = 0, hi = Math.min(p.total - offset, remaining);
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits(result(offset + mid))) lo = mid; else hi = mid - 1;
    }
    if (lo < 1) return error('MODEL_CONTEXT_BUDGET_EXCEEDED', { context_budget: budget.snapshot(), continuation_token: args._continuation_token || null });
    output = result(offset + lo);
  }
  if (output.delivered_source_range[1] <= offset) return error('MODEL_CONTEXT_BUDGET_EXCEEDED');
  // Reserve synchronously before other parallel tools can spend this budget.
  budget.consume(serialize(output));
  return output;
}
module.exports = { readSequential, plan, ranges };
