/** Model-facing projection; the full Repository result stays available to references and telemetry. */
function compactDocumentResult(result) {
  if (!result || typeof result !== 'object') return result;
  if (['read_full', 'scan_document'].includes(result.action) && !result.error) {
    // The ordered tuples map each content segment to immutable source offsets.
    // Field names occur once; hundreds of short MinerU blocks otherwise spend
    // more context on repeated JSON keys than on original text.
    const { hits, ...body } = result;
    return { ...body, source_span_fields: ['chunk_id', 'page_start', 'page_end', 'source_offset', 'source_length', 'table_ids'],
      source_spans: (hits || []).map(h => [h.chunk_id, h.page_start, h.page_end, h.source_offset, h.source_length, h.table_ids]),
      content_separator: '\n\n', source_span_semantics: 'Content segments follow source_spans order, separated by content_separator. Offsets/lengths address original chunk text in UTF-16 code units; read(chunk_id) retrieves the parent.' };
  }
  if (result.action === 'find_exact' && !result.error) {
    // Matches already contain original text, provenance and bounded context.
    // Avoid sending the same evidence again in content and hits.
    const { content, hits, ...exact } = result;
    return exact;
  }
  if (result.documents)
    return { ...result, documents: result.documents.map(({ page_coverage, ...doc }) => doc) };
  const { retrieval, reference, page_coverage, table, ...body } = result;
  if (result.action === 'info' || result.error) return result;
  if (!result.content) return result;
  // Expanded rows repeat merged-cell values; preserve spans to retain entity grouping.
  if (table?.rows) {
    const { cells, ...data } = table;
    const merged = (cells || []).filter((cell) => cell.rowspan > 1 || cell.colspan > 1);
    if (merged.length) {
      data.merged_cells = merged;
      data.merge_semantics =
        'row/column are zero-based source coordinates. Repeated values in expanded rows covered by one rowspan belong to the SAME entity; aggregate its associated values across the entire span before comparing counts or totals.';
    }
    delete body.content;
    return {
      ...body,
      table: data,
      evidence_format: 'table_rows',
      page_coverage,
      ...(reference ? { reference } : {}),
    };
  }
  return {
    ...body,
    ...(reference ? { reference } : {}),
    ...(page_coverage ? { page_coverage } : {}),
    ...(table ? { table } : {}),
    ...(retrieval?.warnings?.length ? { retrieval_warnings: retrieval.warnings } : {}),
  };
}
module.exports = { compactDocumentResult };
