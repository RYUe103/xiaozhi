const crypto = require('crypto');
const { parseDocument } = require('htmlparser2');

const tableId = (parts) => 'table_' + crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 20);
const pageOf = (value) => value.pageStart ?? value.page_start ?? value.page ?? (value.page_idx != null ? Number(value.page_idx) + 1 : null);
const textOf = (cell) => String(cell && typeof cell === 'object' ? cell.text ?? cell.content ?? '' : cell ?? '');
const normalize = (value) => String(value).normalize('NFKC').replace(/\s+/g, ' ').trim();
const sameRow = (a, b) => a?.length === b?.length && a.every((cell, index) => normalize(cell) === normalize(b[index]));

// An escaped pipe belongs to its cell; backslash escapes are retained in the source record.
function pipeCells(line) {
  return String(line).trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
}
function isSeparator(line, width) {
  const cells = pipeCells(line);
  return cells.length === width && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}
function renderRows(rows) {
  if (!rows.length) return '';
  const escape = (value) => String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
  const lines = rows.map((row) => '| ' + row.map(escape).join(' | ') + ' |');
  lines.splice(1, 0, '| ' + rows[0].map(() => '---').join(' | ') + ' |');
  return lines.join('\n');
}
function nodeText(node) {
  if (node.type === 'text') return node.data;
  if (['script', 'style'].includes(node.name)) return '';
  if (node.name === 'br') return '\n';
  return (node.children || []).map(nodeText).join('');
}
function descendants(node, name, stopName) {
  const found = [];
  for (const child of node.children || []) {
    if (child.name === name) found.push(child);
    else if (child.name !== stopName) found.push(...descendants(child, name, stopName));
  }
  return found;
}

/** Parses data only. No scripts, network requests or browser rendering are involved. */
function parseHtmlTables(html) {
  if (typeof html !== 'string' || html.length > 2000000) return [];
  const dom = parseDocument(html, { decodeEntities: true });
  return descendants(dom, 'table').slice(0, 500).map((element) => {
    const rows = [];
    const cells = [];
    const warnings = [];
    const sourceRows = descendants(element, 'tr', 'table');
    if (sourceRows.length > 50000) return { rows: [], cells: [], warnings: ['TABLE_BUDGET_EXCEEDED'], readable: false };
    for (const [r, row] of sourceRows.entries()) {
      rows[r] ||= [];
      let column = 0;
      for (const cell of (row.children || []).filter((child) => ['td', 'th'].includes(child.name))) {
        while (rows[r][column] !== undefined) column++;
        const rowspan = Math.max(1, Number(cell.attribs?.rowspan) || 1);
        const colspan = Math.max(1, Number(cell.attribs?.colspan) || 1);
        if (!Number.isInteger(rowspan) || !Number.isInteger(colspan) || rowspan > 1000 || colspan > 256 || column + colspan > 256 || r + rowspan > 50000) {
          warnings.push('TABLE_SPAN_INVALID'); continue;
        }
        const value = nodeText(cell).trim();
        cells.push({ row: r, column, rowspan, colspan, text: value, header: cell.name === 'th' });
        for (let rr = r; rr < r + rowspan; rr++) {
          rows[rr] ||= [];
          for (let cc = column; cc < column + colspan; cc++) {
            if (rows[rr][cc] !== undefined) warnings.push('TABLE_SPAN_OVERLAP');
            rows[rr][cc] = value;
          }
        }
        column += colspan;
      }
    }
    const width = Math.max(0, ...rows.map((row) => row.length));
    if (rows.some((row) => row.length !== width || Array.from({ length: width }, (_, i) => row[i]).some((cell) => cell === undefined))) warnings.push('TABLE_STRUCTURE_INCOMPLETE');
    if (rows.length > sourceRows.length) warnings.push('TABLE_SPAN_OUTSIDE_ROWS');
    const open = (html.match(/<table(?:\s|>)/gi) || []).length;
    const closed = (html.match(/<\/table\s*>/gi) || []).length;
    if (open !== closed) warnings.push('TABLE_FRAGMENT_INCOMPLETE');
    return { rows, cells, columns: width, readable: width > 0 && !warnings.length, warnings: [...new Set(warnings)] };
  });
}

function structuredTables(contentList, documentId) {
  if (!Array.isArray(contentList)) return [];
  const pieces = [];
  for (const [index, item] of contentList.entries()) {
    if (!item || typeof item !== 'object') continue;
    const explicitRows = item.rows || item.cells;
    const parsed = Array.isArray(explicitRows) && explicitRows.length && explicitRows.every(Array.isArray)
      ? [{ rows: explicitRows.map((row) => row.map(textOf)), cells: [], warnings: [] }]
      : parseHtmlTables(item.table_body || item.html || (item.type === 'table' ? item.text : '') || '');
    for (const [part, value] of parsed.entries()) {
      const columns = value.columns || value.rows[0]?.length || 0;
      if (value.rows.some((row) => row.length !== columns)) value.warnings.push('TABLE_STRUCTURE_INCOMPLETE');
      const sourceTableId = item.table_id ?? item.tableId ?? null;
      pieces.push({ ...value, columns, tableId: tableId([documentId, sourceTableId, index, part]), sourceTableId,
        pageStart: pageOf(item), pageEnd: item.pageEnd ?? item.page_end ?? pageOf(item),
        structure: 'structured_table', engine: item.engine === 'fitz' ? 'fitz' : 'mineru', chunkIds: [], sourceIndexes: [index], blockIds: item.block_id ? [item.block_id] : [],
        complete: item.complete !== false && !value.warnings.length, readable: columns > 0 && !value.warnings.length });
    }
  }
  // A parser-provided table identity is necessary to join independent structured pieces.
  const groups = new Map();
  for (const piece of pieces) {
    const previous = piece.sourceTableId != null ? groups.get(String(piece.sourceTableId)) : null;
    const contiguous = previous?.pageEnd != null && piece.pageStart != null && piece.pageStart >= previous.pageEnd && piece.pageStart <= previous.pageEnd + 1;
    if (previous && contiguous && previous.columns === piece.columns && previous.readable && piece.readable) {
      const skip = sameRow(previous.rows[0], piece.rows[0]) ? 1 : 0;
      const rowOffset = previous.rows.length - skip;
      previous.rows.push(...piece.rows.slice(skip));
      previous.cells.push(...piece.cells.filter((cell) => cell.row >= skip).map((cell) => ({ ...cell, row: cell.row + rowOffset })));
      previous.pageEnd = piece.pageEnd;
      previous.sourceIndexes.push(...piece.sourceIndexes);
      previous.blockIds.push(...piece.blockIds);
      previous.complete = previous.complete && piece.complete;
    } else {
      if (previous) { previous.warnings.push('TABLE_CONTINUATION_UNRESOLVED'); piece.warnings.push('TABLE_CONTINUATION_UNRESOLVED'); previous.complete = false; piece.complete = false; }
      if (piece.sourceTableId != null) groups.set(String(piece.sourceTableId), piece);
      piece.isRoot = true;
    }
  }
  return pieces.filter((piece) => piece.isRoot).map((piece) => ({ ...piece, content: renderRows(piece.rows) }));
}

function markdownTables(document) {
  const result = [];
  const records = document.records;
  let current = null;
  const flush = () => { if (current) { current.content = renderRows(current.rows); result.push(current); current = null; } };
  for (const [recordIndex, record] of records.entries()) {
    const lines = record.text.split(/\r?\n/);
    const firstNonempty = lines.findIndex((line) => line.trim());
    const priorRecord = records[recordIndex - 1];
    const adjacentPage = priorRecord && (record.pageStart === priorRecord.pageEnd || record.pageStart === priorRecord.pageEnd + 1);
    if (current && (!current.endsAtRecordBoundary || !adjacentPage || !lines[firstNonempty]?.includes('|'))) flush();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const cells = line.includes('|') ? pipeCells(line) : [];
      const headerStart = cells.length >= 2 && isSeparator(lines[i + 1] || '', cells.length);
      if (headerStart) {
        if (current && i === firstNonempty && current.columns === cells.length && sameRow(current.rows[0], cells)) {
          current.warnings.push('TABLE_CONTINUATION_INFERRED'); i++; continue;
        }
        flush();
        const legacy = document.tables.find((table) => table.chunkId === record.chunkId && table.content.startsWith(line));
        current = { tableId: legacy?.tableId || tableId([document.documentId, record.chunkId, i]),
          chunkId: record.chunkId, chunkIds: [record.chunkId], structure: 'markdown_pipe', engine: record.engine || 'unknown',
          pageStart: record.pageStart, pageEnd: record.pageEnd, columns: cells.length, rows: [cells],
          rowProvenance: [{ chunk_id: record.chunkId, page_start: record.pageStart, page_end: record.pageEnd }],
          warnings: ['TABLE_FRAGMENT_COMPLETENESS_UNKNOWN'], readable: true, complete: false };
        i++;
      } else if (current && cells.length) {
        if (cells.length !== current.columns) {
          current.warnings.push('TABLE_STRUCTURE_INCOMPLETE'); current.readable = false;
        }
        if (!current.chunkIds.includes(record.chunkId)) {
          current.chunkIds.push(record.chunkId); current.warnings.push('TABLE_CONTINUATION_INFERRED');
        }
        current.rows.push(cells);
        current.rowProvenance.push({ chunk_id: record.chunkId, page_start: record.pageStart, page_end: record.pageEnd });
        current.pageEnd = record.pageEnd;
      } else if (current && (line.trim() || i < lines.length - 1)) flush();
    }
    if (current) current.endsAtRecordBoundary = true;
  }
  flush();
  return result.map((table) => ({ ...table, warnings: [...new Set(table.warnings)] }));
}

function buildDocumentTables(document, contentList) {
  const structured = structuredTables(contentList, document.documentId);
  const markdown = markdownTables(document);
  // Full HTML tables can also live in Markdown chunks. Split tags are joined only across adjacent pages.
  for (let index = 0; index < document.records.length; index++) {
    const record = document.records[index];
    if (!/<table(?:\s|>)/i.test(record.text)) continue;
    let html = record.text;
    const chunks = [record];
    while (!/<\/table\s*>/i.test(html) && index + 1 < document.records.length) {
      const next = document.records[index + 1];
      if (next.pageStart == null || chunks.at(-1).pageEnd == null || next.pageStart > chunks.at(-1).pageEnd + 1 || /^\s*#{1,6}\s/m.test(next.text)) break;
      chunks.push(next); html += '\n' + next.text; index++;
    }
    for (const parsed of parseHtmlTables(html)) structured.push({ ...parsed, tableId: tableId([document.documentId, record.chunkId, parsed.rows]),
      structure: 'structured_table', engine: record.engine, chunkId: record.chunkId, chunkIds: chunks.map((c) => c.chunkId),
      pageStart: record.pageStart, pageEnd: chunks.at(-1).pageEnd, complete: parsed.readable, content: renderRows(parsed.rows) });
  }
  const result = [];
  for (const table of structured) {
    const match = result.find((candidate) => candidate.pageStart === table.pageStart && candidate.pageEnd === table.pageEnd &&
      candidate.rows.length === table.rows.length && candidate.rows.every((row, index) => sameRow(row, table.rows[index])));
    if (match) {
      match.aliases ||= []; match.aliases.push(table.tableId);
      match.chunkIds.push(...(table.chunkIds || [])); match.chunkId ||= table.chunkId;
    } else result.push(table);
  }
  // Native geometry/content-list tables retain a page-context anchor even when
  // the parser did not put HTML or pipe syntax inside a text chunk.
  for (const table of result) {
    const anchors = document.records.filter((record) => record.engine === table.engine &&
      record.pageStart != null && table.pageStart != null && record.pageStart <= table.pageEnd && record.pageEnd >= table.pageStart);
    table.chunkIds = [...new Set([...(table.chunkIds || []), ...anchors.filter(record => !table.blockIds?.length || table.blockIds.includes(record.block_id)).map((record) => record.chunkId)])];
    table.chunkId ||= table.chunkIds[0];
  }
  for (const table of markdown) {
    const match = result.find((s) => s.structure === 'structured_table' && s.pageStart === table.pageStart && s.rows.length === table.rows.length && s.rows.every((row, i) => sameRow(row, table.rows[i])));
    if (match) { match.aliases ||= []; match.aliases.push(table.tableId); match.chunkIds.push(...table.chunkIds); match.chunkId ||= table.chunkId; }
    else result.push(table);
  }
  return result;
}

// Compatibility for callers that only need to annotate already extracted pipe tables.
function annotateMarkdownTables(document) { document.tables = markdownTables(document); }
module.exports = { structuredTables, annotateMarkdownTables, buildDocumentTables, parseHtmlTables, pipeCells };
