/** Select rows with source indexes, retaining a complete repeated key/value block when present. */
function focusTable(table, query) {
  const atoms = String(query || '').normalize('NFKC').toLowerCase().match(/[a-z0-9]+(?:[-_/][a-z0-9]+)+/g) || [];
  if (!atoms.length) return table;
  const matched = table.rows.flatMap((row, index) => row.some(cell => atoms.some(atom => String(cell).normalize('NFKC').toLowerCase().includes(atom))) ? [index] : []);
  if (!matched.length) return table;
  const keep = new Set();
  for (const index of matched) {
    keep.add(index);
    const row = table.rows[index], column = row.findIndex(cell => String(cell).trim());
    // A repeated row key marks a product/card block. No inferred values or merged cells.
    const repeatedKey = column >= 0 && table.rows.some((r, i) => i !== index && String(r[column]).trim() === String(row[column]).trim());
    if (!repeatedKey || table.cells?.some(cell => cell.row === 0 && cell.header)) keep.add(0);
    const next = column < 0 ? -1 : table.rows.findIndex((r, i) => i > index && String(r[column]).trim() === String(row[column]).trim());
    if (next > index && next - index <= 40) for (let i = index; i < next; i++) keep.add(i);
    else if (column >= 0 && table.rows.some((r, i) => i < index && String(r[column]).trim() === String(row[column]).trim())) {
      for (let i = index; i < Math.min(table.rows.length, index + 40); i++) keep.add(i);
    }
  }
  const indexes = [...keep].sort((a, b) => a - b);
  if (indexes.length === table.rows.length) return table;
  const rows = indexes.map(i => table.rows[i]);
  const escape = v => String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
  const content = rows.map(r => '| ' + r.map(escape).join(' | ') + ' |').join('\n');
  return { ...table, rows, cells: [], content, selectedRowIndexes: indexes, totalRows: table.rows.length,
    rowProvenance: indexes.map(i => table.rowProvenance?.[i] || { page_start: table.pageStart, page_end: table.pageEnd, source_row_index: i }),
    complete: false, sourceComplete: table.complete, selection: 'query_matched_rows', warnings: [...table.warnings, 'TABLE_ROWS_FILTERED_USE_ORIGINAL_ROW_INDEX'] };
}
module.exports = { focusTable };
