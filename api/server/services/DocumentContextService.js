const crypto = require('crypto');

// Phase 1A compatibility exports: the adapter is read-only and does not alter legacy service behavior.
const documentArtifactAdapter = require('./DocumentArtifactAdapter');

const MAX_READ_CHARS = 20000;

function stableId(prefix, ...parts) {
  const digest = crypto
    .createHash('sha256')
    .update(parts.map((part) => String(part ?? '')).join('\u001f'))
    .digest('hex')
    .slice(0, 20);
  return `${prefix}_${digest}`;
}

function getDocumentId(userId, fileId) {
  if (!userId || !fileId) throw new Error('Document identity requires userId and fileId');
  return stableId('doc', userId, fileId);
}

function normalizePdfChunk(value = {}, index = 0, documentId = '') {
  const text = String(value.text || value.content || value.md || '').trim();
  if (!text) return null;
  const rawPage =
    value.pageStart ??
    value.page_start ??
    value.page ??
    (value.page_idx != null && Number.isFinite(Number(value.page_idx))
      ? Number(value.page_idx) + 1
      : null);
  const pageStart = rawPage != null && Number.isFinite(Number(rawPage)) ? Number(rawPage) : null;
  const rawEnd = value.pageEnd ?? value.page_end ?? value.page ?? pageStart;
  const pageEnd = rawEnd != null && Number.isFinite(Number(rawEnd)) ? Number(rawEnd) : pageStart;
  const sourceChunkId = String(
    value.sourceChunkId ||
      value.chunk_id ||
      value.chunkId ||
      stableId('source', pageStart, pageEnd, text),
  );
  return {
    index,
    chunkId: stableId('chunk', documentId, sourceChunkId, index),
    sourceChunkId,
    pageStart,
    pageEnd,
    text,
  };
}

function parsePdfChunks(buffer, documentId) {
  const records = [];
  for (const line of Buffer.from(buffer || '')
    .toString('utf8')
    .split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const record = normalizePdfChunk(JSON.parse(line), records.length, documentId);
      if (record) records.push(record);
    } catch {
      // One malformed persisted line must not hide the remaining valid chunks.
    }
  }
  return records;
}

function extractHeadings(records, documentId) {
  const headings = [];
  for (const record of records) {
    let textOffset = 0;
    for (const line of record.text.split(/\r?\n/)) {
      const lineOffset = record.text.indexOf(line, textOffset);
      textOffset = lineOffset + line.length + 1;
      const match = line.match(/^\s*(#{1,6})\s+(.+?)\s*$/);
      if (!match) continue;
      const title = match[2].replace(/\s+#+\s*$/, '').trim();
      headings.push({
        sectionId: stableId('section', documentId, record.chunkId, headings.length, title),
        level: match[1].length,
        title,
        pageStart: record.pageStart,
        pageEnd: record.pageEnd,
        chunkId: record.chunkId,
        textOffset: lineOffset,
      });
    }
  }
  return headings;
}

function getMarkdownTableCells(line) {
  const trimmed = String(line || '')
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function isMarkdownTableStart(header, separator) {
  if (!header.includes('|') || !separator.includes('|')) return false;
  const headerCells = getMarkdownTableCells(header);
  const separatorCells = getMarkdownTableCells(separator);
  return (
    headerCells.length >= 2 &&
    headerCells.length === separatorCells.length &&
    headerCells.some(Boolean) &&
    separatorCells.every((cell) => /^:?-{3,}:?$/.test(cell))
  );
}

function extractTables(records, documentId) {
  const tables = [];
  for (const record of records) {
    const lines = record.text.split(/\r?\n/);
    for (let index = 0; index < lines.length - 1; index += 1) {
      if (!isMarkdownTableStart(lines[index], lines[index + 1])) continue;
      const tableLines = [lines[index], lines[index + 1]];
      let cursor = index + 2;
      while (cursor < lines.length && lines[cursor].includes('|') && lines[cursor].trim()) {
        tableLines.push(lines[cursor]);
        cursor += 1;
      }
      const content = tableLines.join('\n');
      tables.push({
        tableId: stableId('table', documentId, record.chunkId, index, content),
        chunkId: record.chunkId,
        pageStart: record.pageStart,
        pageEnd: record.pageEnd,
        content,
      });
      index = cursor - 1;
    }
  }
  return tables;
}

function buildPdfDocument({ userId, fileId, filename, records, parserVersion, artifactId } = {}) {
  const documentId = getDocumentId(userId, fileId);
  const sourceOccurrences = new Map();
  const normalizedRecords = (records || [])
    .map((record, index) => normalizePdfChunk(record, index, documentId))
    .filter(Boolean);
  for (const [index, record] of normalizedRecords.entries()) {
    const occurrence = sourceOccurrences.get(record.sourceChunkId) || 0;
    sourceOccurrences.set(record.sourceChunkId, occurrence + 1);
    record.index = index;
    record.chunkId = stableId('chunk', documentId, record.sourceChunkId, occurrence);
  }
  return {
    documentId,
    fileId,
    filename: filename || 'document.pdf',
    format: 'pdf',
    parserVersion: parserVersion || null,
    artifactId: artifactId || null,
    records: normalizedRecords,
    headings: extractHeadings(normalizedRecords, documentId),
    tables: extractTables(normalizedRecords, documentId),
  };
}

function getWordHeadingLevel(value = {}) {
  const explicit = Number(value.heading_level ?? value.headingLevel);
  if (Number.isInteger(explicit) && explicit >= 1 && explicit <= 6) return explicit;
  const style = String(
    value.style_name || value.styleName || value.style_id || value.styleId || '',
  );
  const match = style.match(/(?:heading|标题)\s*([1-6])/i);
  return match ? Number(match[1]) : null;
}

function getPositiveInteger(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function parseWordBlocks(buffer, documentId) {
  const records = [];
  const segmentChars = 6000;
  for (const [lineIndex, line] of Buffer.from(buffer || '')
    .toString('utf8')
    .split(/\r?\n/)
    .entries()) {
    if (!line.trim()) continue;
    try {
      const block = JSON.parse(line);
      if (block?.type !== 'text' || !block.text) continue;
      const text = String(block.text).trim();
      if (!text) continue;
      const paragraphIndex = getPositiveInteger(block.paragraph_index) || lineIndex + 1;
      const segmentCount = Math.max(1, Math.ceil(text.length / segmentChars));
      for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
        records.push({
          index: records.length,
          paragraphIndex,
          paragraphId: stableId('paragraph', documentId, paragraphIndex),
          chunkId: stableId('chunk', documentId, paragraphIndex, segmentIndex),
          sourceChunkId: `paragraph-${paragraphIndex}-${segmentIndex + 1}`,
          segmentIndex: segmentIndex + 1,
          segmentCount,
          styleId: block.style_id || null,
          styleName: block.style_name || null,
          headingLevel: getWordHeadingLevel(block),
          tableIndex: getPositiveInteger(block.table_index),
          rowIndex: getPositiveInteger(block.row_index),
          cellIndex: getPositiveInteger(block.cell_index),
          text: text.slice(segmentIndex * segmentChars, (segmentIndex + 1) * segmentChars),
        });
      }
    } catch {
      // Preserve the remaining persisted blocks if one line is malformed.
    }
  }
  return records;
}

function inferWordHeadings(records, documentId) {
  const headings = [];
  const seenParagraphs = new Set();
  for (const record of records) {
    if (seenParagraphs.has(record.paragraphIndex)) continue;
    seenParagraphs.add(record.paragraphIndex);
    const markdown = record.text.match(/^\s*(#{1,6})\s+(.+?)\s*$/);
    const chinese =
      record.text.length <= 80 &&
      /^(?:第[一二三四五六七八九十百千万0-9]+[章节篇部]|[一二三四五六七八九十]+[、.]|\d+(?:\.\d+){0,5}[、.\s])/.test(
        record.text,
      );
    let level = record.headingLevel;
    if (!level && markdown) level = markdown[1].length;
    if (!level && chinese) level = 1;
    if (!level) continue;
    const title = (markdown ? markdown[2] : record.text).trim();
    headings.push({
      sectionId: stableId('section', documentId, record.paragraphId, level, title),
      level,
      title,
      paragraphIndex: record.paragraphIndex,
      paragraphId: record.paragraphId,
      chunkId: record.chunkId,
    });
  }
  return headings;
}

function extractWordTables(records, documentId) {
  const grouped = new Map();
  for (const record of records) {
    if (record.tableIndex == null || record.rowIndex == null || record.cellIndex == null) continue;
    if (!grouped.has(record.tableIndex)) grouped.set(record.tableIndex, new Map());
    const rows = grouped.get(record.tableIndex);
    if (!rows.has(record.rowIndex)) rows.set(record.rowIndex, new Map());
    const cells = rows.get(record.rowIndex);
    const existing = cells.get(record.cellIndex) || [];
    existing.push(record.text);
    cells.set(record.cellIndex, existing);
  }
  return [...grouped.entries()].map(([tableIndex, rows]) => {
    const rowValues = [...rows.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, cells]) =>
        [...cells.entries()]
          .sort(([left], [right]) => left - right)
          .map(([, values]) => values.join(' ')),
      );
    const width = Math.max(0, ...rowValues.map((row) => row.length));
    const normalizedRows = rowValues.map((row) => [
      ...row,
      ...Array.from({ length: width - row.length }, () => ''),
    ]);
    const content = normalizedRows.length
      ? [
          `| ${normalizedRows[0].join(' | ')} |`,
          `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
          ...normalizedRows.slice(1).map((row) => `| ${row.join(' | ')} |`),
        ].join('\n')
      : '';
    return {
      tableId: stableId('table', documentId, tableIndex, content),
      tableIndex,
      paragraphStart: Math.min(
        ...records
          .filter((record) => record.tableIndex === tableIndex)
          .map((record) => record.paragraphIndex),
      ),
      paragraphEnd: Math.max(
        ...records
          .filter((record) => record.tableIndex === tableIndex)
          .map((record) => record.paragraphIndex),
      ),
      rows: normalizedRows.length,
      columns: width,
      content,
    };
  });
}

function buildWordDocument({ userId, fileId, filename, records, parserVersion, artifactId } = {}) {
  const documentId = getDocumentId(userId, fileId);
  const normalizedRecords = Buffer.isBuffer(records)
    ? parseWordBlocks(records, documentId)
    : (records || []).map((record, index) => ({
        ...record,
        index,
        paragraphId: record.paragraphId || stableId('paragraph', documentId, record.paragraphIndex),
        chunkId:
          record.chunkId ||
          stableId('chunk', documentId, record.paragraphIndex, (record.segmentIndex || 1) - 1),
      }));
  return {
    documentId,
    fileId,
    filename: filename || 'document.docx',
    format: 'docx',
    parserVersion: parserVersion || null,
    artifactId: artifactId || null,
    records: normalizedRecords,
    headings: inferWordHeadings(normalizedRecords, documentId),
    tables: extractWordTables(normalizedRecords, documentId),
  };
}

function createWordDocumentContextService({
  documents = new Map(),
  previousReference = null,
} = {}) {
  function listDocuments() {
    return Array.from(documents.values()).map((document) => ({
      document_id: document.documentId,
      file_id: document.fileId,
      filename: document.filename,
      format: document.format,
      paragraph_count: new Set(document.records.map((record) => record.paragraphIndex)).size,
      chunk_count: document.records.length,
      table_count: document.tables.length,
      section_count: document.headings.length,
      status: document.records.length ? 'ready' : 'empty',
    }));
  }

  function execute(args = {}) {
    const action = args.action || (args.query ? 'search' : 'read');
    if (action === 'list') return { status: 'ok', documents: listDocuments() };
    const values = Array.from(documents.values());
    let document = null;
    if (args.document_id) document = values.find((item) => item.documentId === args.document_id);
    else if (args.file_id) document = values.find((item) => item.fileId === args.file_id);
    else if (values.length === 1) document = values[0];
    if (!document) {
      const invalidLegacyFile = Boolean(args.file_id);
      const legacySelectionRequired = invalidLegacyFile || (!args.action && values.length > 1);
      let status = 'not_found';
      let message = '未找到可读取的 Word 文档。';
      if (legacySelectionRequired) {
        status = 'file_selection_required';
        message = '请使用本次聊天文件列表中的 file_id，不能读取其他文件。';
      } else if (values.length > 1) {
        status = 'document_id_required';
        message = '当前有多份 Word 文档，请指定 document_id。';
      }
      return {
        status,
        message,
        documents: listDocuments(),
        files: listDocuments().map(({ file_id, filename }) => ({ file_id, filename })),
      };
    }
    if (!document.records.length) {
      return { status: 'unavailable', document_id: document.documentId, message: '解析产物为空。' };
    }
    const base = {
      status: 'ok',
      document_id: document.documentId,
      file_id: document.fileId,
      filename: document.filename,
    };
    if (action === 'info')
      return {
        ...base,
        ...listDocuments().find((item) => item.document_id === document.documentId),
      };
    if (action === 'toc') return { ...base, sections: document.headings };
    const previous =
      previousReference?.document_id === document.documentId ? previousReference : null;
    if (action === 'read_table') {
      const table = document.tables.find(
        (item) => item.tableId === (args.table_id || previous?.table_id),
      );
      if (!table)
        return {
          ...base,
          status: 'not_found',
          message: document.tables.length
            ? '未找到指定表格。'
            : '现有解析产物没有可定位的表格结构。',
          tables: document.tables.map((item) => ({
            table_id: item.tableId,
            table_index: item.tableIndex,
            rows: item.rows,
            columns: item.columns,
          })),
        };
      return {
        ...base,
        table_id: table.tableId,
        ...sliceContent(table.content, args.offset, args.max_chars),
        provenance: {
          paragraph_start: table.paragraphStart,
          paragraph_end: table.paragraphEnd,
        },
      };
    }
    let selected = [];
    if (action === 'read_adjacent') {
      const chunkId = args.chunk_id || previous?.chunk_id;
      const center = document.records.findIndex((record) => record.chunkId === chunkId);
      if (center < 0)
        return { ...base, status: 'not_found', message: '未找到上一命中内容，请重新搜索。' };
      const radius = Math.min(3, Math.max(1, Number(args.adjacent_count) || 1));
      selected = document.records.slice(Math.max(0, center - radius), center + radius + 1);
    } else if (action === 'read') {
      const start = args.paragraph_start ?? args.paragraph_end;
      const end = args.paragraph_end ?? start;
      const chunkId = args.chunk_id || previous?.chunk_id;
      const sectionId = args.section_id || previous?.section_id;
      const section = document.headings.find((item) => item.sectionId === sectionId);
      selected = document.records.filter((record) => {
        if (chunkId && record.chunkId === chunkId) return true;
        if (section && record.paragraphIndex >= section.paragraphIndex) {
          const next = document.headings.find(
            (item) => item.paragraphIndex > section.paragraphIndex && item.level <= section.level,
          );
          return !next || record.paragraphIndex < next.paragraphIndex;
        }
        return start != null && record.paragraphIndex >= start && record.paragraphIndex <= end;
      });
      if (start == null && !chunkId && !section) selected = document.records;
    } else {
      const terms = getQueryTerms(args.query);
      selected = document.records
        .map((record) => ({
          record,
          score: terms.reduce(
            (score, term) =>
              score +
              (record.text.toLowerCase().split(term).length - 1) * Math.max(1, term.length - 1),
            0,
          ),
        }))
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score || left.record.index - right.record.index)
        .slice(0, Math.min(12, Math.max(1, Number(args.limit) || 6)))
        .map((item) => {
          const lowered = item.record.text.toLowerCase();
          const matchAt = terms.reduce((earliest, term) => {
            const index = lowered.indexOf(term);
            return index >= 0 && (earliest < 0 || index < earliest) ? index : earliest;
          }, -1);
          const excerptChars = Math.max(
            100,
            Math.min(6000, (Number(args.max_chars) || MAX_READ_CHARS) - 100),
          );
          const start = Math.max(0, matchAt - Math.floor(excerptChars / 4));
          return {
            ...item.record,
            text: item.record.text.slice(start, start + excerptChars),
          };
        });
    }
    if (!selected.length)
      return { ...base, status: 'not_found', message: '当前持久解析内容中没有命中。' };
    const combined = selected
      .map(
        (record) => `[paragraph=${record.paragraphIndex} chunk=${record.chunkId}]\n${record.text}`,
      )
      .join('\n\n');
    const tables = document.tables.filter((table) =>
      selected.some(
        (record) =>
          record.paragraphIndex >= table.paragraphStart &&
          record.paragraphIndex <= table.paragraphEnd,
      ),
    );
    const first = selected[0];
    return {
      ...base,
      action,
      scope: action === 'search' ? 'keyword_selection' : 'paragraph_range',
      ...sliceContent(combined, args.offset, args.max_chars),
      hits: selected.map((record) => ({
        chunk_id: record.chunkId,
        paragraph_id: record.paragraphId,
        paragraph_index: record.paragraphIndex,
      })),
      tables: tables.map((table) => ({ table_id: table.tableId, table_index: table.tableIndex })),
      reference: {
        document_id: document.documentId,
        chunk_id: first.chunkId,
        paragraph_id: first.paragraphId,
        paragraph_index: first.paragraphIndex,
        table_id: tables[0]?.tableId || null,
      },
      matched_paragraphs: new Set(selected.map((record) => record.paragraphIndex)).size,
      matched_segments: selected.length,
      total_paragraphs: new Set(document.records.map((record) => record.paragraphIndex)).size,
      total_segments: document.records.length,
      paragraph_start: first.paragraphIndex,
      paragraph_end: selected.at(-1).paragraphIndex,
    };
  }
  return { listDocuments, execute };
}

function getQueryTerms(query = '') {
  return Array.from(
    new Set(
      String(query)
        .toLowerCase()
        .match(/[a-z0-9][a-z0-9_.-]{1,}|[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]{2,}/g) || [],
    ),
  ).slice(0, 40);
}

function findDocument(documents, documentId) {
  const list = Array.from(documents?.values?.() || documents || []);
  if (documentId) return list.find((item) => item.documentId === documentId) || null;
  return list.length === 1 ? list[0] : null;
}

function sliceContent(content, offset = 0, maxChars = MAX_READ_CHARS) {
  const safeOffset = Math.max(0, Number(offset) || 0);
  const limit = Math.min(MAX_READ_CHARS, Math.max(100, Number(maxChars) || MAX_READ_CHARS));
  const text = String(content || '');
  const value = text.slice(safeOffset, safeOffset + limit);
  const nextOffset = safeOffset + value.length;
  return {
    content: value,
    offset: safeOffset,
    truncated: nextOffset < text.length,
    next_offset: nextOffset < text.length ? nextOffset : null,
  };
}

function recordProvenance(record) {
  return {
    chunk_id: record.chunkId,
    source_chunk_id: record.sourceChunkId,
    page_start: record.pageStart,
    page_end: record.pageEnd,
  };
}

function createDocumentContextService({ documents = new Map(), previousReference = null } = {}) {
  function listDocuments() {
    return Array.from(documents.values()).map((document) => ({
      document_id: document.documentId,
      filename: document.filename,
      format: document.format,
      page_count: Math.max(0, ...document.records.map((record) => record.pageEnd || 0)),
      chunk_count: document.records.length,
      table_count: document.tables.length,
      section_count: document.headings.length,
      status: document.records.length ? 'ready' : 'empty',
    }));
  }

  function execute(args = {}) {
    const action = args.action || 'search';
    if (action === 'list') return { status: 'ok', documents: listDocuments() };
    const document = findDocument(documents, args.document_id);
    if (!document) {
      return {
        status: documents.size > 1 ? 'document_id_required' : 'not_found',
        message:
          documents.size > 1 ? '当前有多份 PDF，请指定 document_id。' : '未找到可读取的 PDF。',
        documents: listDocuments(),
      };
    }
    if (!document.records.length) {
      return { status: 'unavailable', document_id: document.documentId, message: '解析产物为空。' };
    }
    const scopedPreviousReference =
      previousReference?.document_id === document.documentId ? previousReference : null;
    const base = { status: 'ok', document_id: document.documentId, filename: document.filename };
    if (action === 'info')
      return {
        ...base,
        ...listDocuments().find((item) => item.document_id === document.documentId),
      };
    if (action === 'toc') return { ...base, sections: document.headings };

    let selected = [];
    let sectionWarning = null;
    if (action === 'read_table') {
      const tableId = args.table_id || scopedPreviousReference?.table_id;
      const table = document.tables.find((item) => item.tableId === tableId);
      if (!table)
        return {
          ...base,
          status: 'not_found',
          message: '未找到指定表格。',
          tables: document.tables.map((item) => ({
            table_id: item.tableId,
            page_start: item.pageStart,
            page_end: item.pageEnd,
          })),
        };
      return {
        ...base,
        table_id: table.tableId,
        ...sliceContent(table.content, args.offset, args.max_chars),
        provenance: {
          chunk_id: table.chunkId,
          page_start: table.pageStart,
          page_end: table.pageEnd,
        },
      };
    }
    if (action === 'read_adjacent') {
      const chunkId = args.chunk_id || scopedPreviousReference?.chunk_id;
      const center = document.records.findIndex((record) => record.chunkId === chunkId);
      if (center < 0)
        return { ...base, status: 'not_found', message: '未找到上一命中内容，请重新搜索。' };
      const radius = Math.min(3, Math.max(1, Number(args.adjacent_count) || 1));
      selected = document.records.slice(Math.max(0, center - radius), center + radius + 1);
    } else if (action === 'read') {
      const pages = new Set(
        (args.pages || []).map(Number).filter((page) => Number.isInteger(page) && page > 0),
      );
      const chunkId = args.chunk_id || scopedPreviousReference?.chunk_id;
      const sectionId = args.section_id || scopedPreviousReference?.section_id;
      const section = document.headings.find((item) => item.sectionId === sectionId);
      let sectionBounds = null;
      if (section) {
        const sectionStart = document.records.findIndex((record) => record.chunkId === section.chunkId);
        const nextSection = document.headings
          .filter((item) => item.sectionId !== section.sectionId)
          .filter((item) => item.level <= section.level)
          .map((item) => ({ item, index: document.records.findIndex((record) => record.chunkId === item.chunkId) }))
          .filter((item) => item.index > sectionStart)
          .sort((left, right) => left.index - right.index)[0];
        if (sectionStart >= 0) {
          sectionBounds = {
            start: sectionStart,
            end: nextSection?.index >= 0 ? nextSection.index : document.records.length,
          };
          if (!nextSection) sectionWarning = 'section_end_is_document_end';
        } else {
          sectionWarning = 'section_boundary_unavailable';
        }
      }
      selected = document.records.filter((record, index) => {
        if (chunkId && record.chunkId === chunkId) return true;
        if (sectionBounds) return index >= sectionBounds.start && index < sectionBounds.end;
        if (!pages.size || record.pageStart == null) return false;
        const end = record.pageEnd ?? record.pageStart;
        return [...pages].some((page) => page >= record.pageStart && page <= end);
      });
    } else {
      const terms = getQueryTerms(args.query);
      selected = document.records
        .map((record) => ({
          record,
          score: terms.reduce(
            (score, term) =>
              score +
              (record.text.toLowerCase().split(term).length - 1) * Math.max(1, term.length - 1),
            0,
          ),
        }))
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score || left.record.index - right.record.index)
        .slice(0, Math.min(12, Math.max(1, Number(args.limit) || 6)))
        .map((item) => item.record);
    }
    if (!selected.length)
      return { ...base, status: 'not_found', message: '当前持久解析内容中没有命中。' };
    const combined = selected
      .map((record) => `[${record.chunkId} page=${record.pageStart ?? '?'}]\n${record.text}`)
      .join('\n\n');
    const sliced = sliceContent(combined, args.offset, args.max_chars);
    const first = selected[0];
    const tables = document.tables.filter((table) =>
      selected.some((record) => record.chunkId === table.chunkId),
    );
    return {
      ...base,
      action,
      ...sliced,
      hits: selected.map(recordProvenance),
      tables: tables.map((table) => ({
        table_id: table.tableId,
        chunk_id: table.chunkId,
        page_start: table.pageStart,
        page_end: table.pageEnd,
      })),
      reference: {
        document_id: document.documentId,
        chunk_id: first.chunkId,
        page_start: first.pageStart,
        page_end: first.pageEnd,
        table_id: tables[0]?.tableId || null,
      },
      ...(sectionWarning ? { warnings: [sectionWarning] } : {}),
    };
  }

  return { listDocuments, execute };
}

module.exports = {
  ...documentArtifactAdapter,
  MAX_READ_CHARS,
  getDocumentId,
  normalizePdfChunk,
  parsePdfChunks,
  buildPdfDocument,
  createDocumentContextService,
  parseWordBlocks,
  buildWordDocument,
  createWordDocumentContextService,
};
