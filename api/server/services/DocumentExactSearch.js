/** Original-text only. Offsets are JavaScript UTF-16 code units, never UTF-8 bytes.
 * Normalized matches must span complete graphemes and normalize back to the
 * entire needle: matching half a compatibility expansion is intentionally rejected. */
const graphemes = new Intl.Segmenter('und', { granularity: 'grapheme' });
function searchable(source, mode) {
  if (mode === 'literal') return { text: source, original: (start, end) => [start, end] };
  let text = '';
  const starts = new Map(), ends = new Map();
  for (const part of graphemes.segment(source)) {
    starts.set(text.length, part.index);
    text += part.segment.normalize('NFKC');
    ends.set(text.length, part.index + part.segment.length);
  }
  return { text, original: (start, end) => starts.has(start) && ends.has(end) ? [starts.get(start), ends.get(end)] : null };
}
function exactSearch(records, args = {}) {
  const mode = args.match_mode ?? 'literal';
  if (!['literal', 'nfkc'].includes(mode)) throw Error('MATCH_MODE_INVALID');
  if (typeof args.query !== 'string' || !args.query.length || args.query.length > 1000) throw Error('QUERY_INVALID');
  const needle = mode === 'nfkc' ? args.query.normalize('NFKC') : args.query;
  if (!needle.length) throw Error('QUERY_INVALID');
  const limit = args.limit ?? 10, context = args.context_chars ?? 500, offset = args.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 12 || !Number.isInteger(context) || context < 0 || context > 2000 || !Number.isSafeInteger(offset) || offset < 0) throw Error('EXACT_PARAMETERS_INVALID');
  if (args.pages && (!Array.isArray(args.pages) || args.pages.length > 30 || args.pages.some(p => !Number.isInteger(p) || p < 1))) throw Error('PAGES_INVALID');
  const matches = [];
  let total = 0;
  // Bound adversarial repetition while retaining a truthful lower bound.
  const countLimit = 10000;
  let countTruncated = false;
  scan: for (const record of records) {
    if (args.chunk_id && ![record.chunkId, record.id].includes(args.chunk_id)) continue;
    if (args.pages && !args.pages.some(p => record.pageStart != null && p >= record.pageStart && p <= (record.pageEnd ?? record.pageStart))) continue;
    const source = String(record.text || ''), mapped = searchable(source, mode);
    let at = mapped.text.indexOf(needle);
    while (at !== -1) {
      const range = mapped.original(at, at + needle.length);
      if (range && (mode === 'literal' || source.slice(...range).normalize('NFKC') === needle)) {
        if (total >= offset && matches.length < limit) {
          const [start, end] = range;
          matches.push({ chunk_id: record.chunkId || record.id, page_start: record.pageStart ?? null, page_end: record.pageEnd ?? record.pageStart ?? null,
            match_text: source.slice(start, end), context_before: source.slice(Math.max(0, start - context), start), context_after: source.slice(end, end + context),
            source_offset: start, source_length: end - start, offset_unit: 'utf16_code_units',
            next_action: { action: 'read', chunk_id: record.chunkId || record.id } });
        }
        total++;
        if (total >= Math.max(countLimit, offset + limit + 1)) { countTruncated = true; break scan; }
      }
      at = mapped.text.indexOf(needle, at + 1);
    }
  }
  return { matches, match_count: total, match_count_exact: !countTruncated, scan_truncated: countTruncated, returned_count: matches.length, truncated: total > offset + matches.length || countTruncated, next_offset: total > offset + matches.length ? offset + matches.length : null,
    match_mode: mode, search_scope: 'parsed_original_chunks', cross_chunk_search: false };
}
module.exports = { exactSearch, searchable };
