/** Model-facing projection; the full Repository result stays available to references and telemetry. */
function compactDocumentResult(result) {
  if (!result || typeof result !== 'object') return result;
  if (result.documents) return { ...result, documents: result.documents.map(({ page_coverage, ...doc }) => doc) };
  const { retrieval, reference, page_coverage, table, ...body } = result;
  if (result.action === 'info' || result.error) return result;
  if (!result.content) return result;
  // rows are a lossless single representation. cells and Markdown repeat the same cell values.
  if (table?.rows) {
    const { cells, ...data } = table;
    delete body.content;
    return { ...body, table: data, evidence_format: 'table_rows', page_coverage,
      reference: reference && { document_id: reference.document_id, page_start: reference.page_start, page_end: reference.page_end } };
  }
  return { ...body, ...(table ? { table } : {}), ...(retrieval?.warnings?.length ? { retrieval_warnings: retrieval.warnings } : {}) };
}
module.exports = { compactDocumentResult };
