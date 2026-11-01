/** Model-facing projection; the full Repository result stays available to references and telemetry. */
function compactDocumentResult(result) {
  if (!result || typeof result !== 'object') return result;
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
      reference: reference && {
        document_id: reference.document_id,
        page_start: reference.page_start,
        page_end: reference.page_end,
      },
    };
  }
  return {
    ...body,
    ...(table ? { table } : {}),
    ...(retrieval?.warnings?.length ? { retrieval_warnings: retrieval.warnings } : {}),
  };
}
module.exports = { compactDocumentResult };
