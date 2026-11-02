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
/** Reconstruct only against an existing immutable parent block. Adjacency or
 * equal page numbers alone never authorizes concatenating unrelated chunks. */
function crossChunkSources(records, blocks = []) {
  const grouped = new Map();
  for (const record of records) if (record.block_id) {
    if (!grouped.has(record.block_id)) grouped.set(record.block_id, []);
    grouped.get(record.block_id).push(record);
  }
  const result = [];
  for (const block of blocks) {
    const group = grouped.get(block.block_id);
    if (!group || group.length < 2 || typeof block.text !== 'string') continue;
    let cursor = 0, valid = true;
    const segments = [];
    for (const record of group) {
      const start = block.text.indexOf(record.text, cursor);
      if (start < 0 || block.text.slice(cursor, start).trim()) { valid = false; break; }
      segments.push({ record, start, end: start + record.text.length });
      cursor = start + record.text.length;
    }
    if (!valid || block.text.slice(cursor).trim()) continue;
    result.push({ ...group[0], text: block.text, _sourceSegments: segments, _parentBlock: block.block_id,
      pageEnd: group.at(-1).pageEnd });
  }
  return result;
}
function exactSearch(records, args = {}, blocks = []) {
  const mode = args.match_mode ?? 'literal';
  if (!['literal', 'nfkc'].includes(mode)) throw Error('MATCH_MODE_INVALID');
  if (typeof args.query !== 'string' || !args.query.length || args.query.length > 1000) throw Error('QUERY_INVALID');
  const needle = mode === 'nfkc' ? args.query.normalize('NFKC') : args.query;
  if (!needle.length) throw Error('QUERY_INVALID');
  const limit = args.limit ?? 10, context = args.context_chars ?? 500, offset = args.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 12 || !Number.isInteger(context) || context < 0 || context > 2000 || !Number.isSafeInteger(offset) || offset < 0) throw Error('EXACT_PARAMETERS_INVALID');
  if (args.pages && (!Array.isArray(args.pages) || args.pages.length > 30 || args.pages.some(p => !Number.isInteger(p) || p < 1))) throw Error('PAGES_INVALID');
  const maxChars = args.max_chars ?? 20000;
  if (!Number.isInteger(maxChars) || maxChars < 100 || maxChars > 20000) throw Error('EXACT_PARAMETERS_INVALID');
  const matches = [];
  let deliveredChars = 0, outputTruncated = false;
  let total = 0;
  // Bound adversarial repetition while retaining a truthful lower bound.
  const countLimit = 10000;
  let countTruncated = false;
  const crossSources = crossChunkSources(records, blocks);
  scan: for (const record of [...records, ...crossSources]) {
    if (args.chunk_id && ![record.chunkId, record.id, ...(record._sourceSegments || []).flatMap(s => [s.record.chunkId, s.record.id])].includes(args.chunk_id)) continue;
    if (args.pages && !args.pages.some(p => record.pageStart != null && p >= record.pageStart && p <= (record.pageEnd ?? record.pageStart))) continue;
    const source = String(record.text || ''), mapped = searchable(source, mode);
    let at = mapped.text.indexOf(needle);
    while (at !== -1) {
      const range = mapped.original(at, at + needle.length);
      const segments = range && record._sourceSegments?.filter(s => s.start < range[1] && s.end > range[0]);
      if (range && (!segments || (segments.length > 1 && (!args.chunk_id || segments.some(s => [s.record.chunkId, s.record.id].includes(args.chunk_id))) && (!args.pages || segments.some(s => args.pages.some(p => p >= s.record.pageStart && p <= (s.record.pageEnd ?? s.record.pageStart)))))) && (mode === 'literal' || source.slice(...range).normalize('NFKC') === needle)) {
        if (total >= offset && matches.length < limit && !outputTruncated) {
          const [start, end] = range;
          const before = source.slice(Math.max(0, start - context), start), after = source.slice(end, end + context);
          if (deliveredChars + before.length + end - start + after.length > maxChars && matches.length) {
            outputTruncated = true;
          } else {
          const available = Math.max(0, maxChars - deliveredChars - (end - start));
          if (end - start > maxChars) throw Error('EXACT_MATCH_EXCEEDS_OUTPUT_BUDGET');
          const beforeBudget = Math.min(before.length, Math.floor(available / 2));
          const beforeText = before.slice(before.length - beforeBudget);
          const afterText = after.slice(0, available - beforeText.length);
          deliveredChars += beforeText.length + end - start + afterText.length;
          const provenance = segments ? { chunk_ids: segments.map(s => s.record.chunkId || s.record.id), block_id: record._parentBlock, source_block_offset: start,
            source_segments: segments.map(s => ({ chunk_id: s.record.chunkId || s.record.id, source_offset: Math.max(start, s.start) - s.start, source_length: Math.min(end, s.end) - Math.max(start, s.start), page_start: s.record.pageStart, page_end: s.record.pageEnd })) } : {};
          matches.push({ chunk_id: segments?.[0]?.record.chunkId || record.chunkId || record.id, page_start: segments?.[0]?.record.pageStart ?? record.pageStart ?? null, page_end: segments?.at(-1)?.record.pageEnd ?? record.pageEnd ?? record.pageStart ?? null,
            match_text: source.slice(start, end), context_before: beforeText, context_after: afterText,
            source_offset: segments ? null : start, source_length: end - start, offset_unit: 'utf16_code_units',
            ...provenance, next_action: { action: segments ? 'read_adjacent' : 'read', chunk_id: segments?.[0]?.record.chunkId || record.chunkId || record.id } });
          }
        }
        total++;
        if (total >= Math.max(countLimit, offset + limit + 1)) { countTruncated = true; break scan; }
      }
      at = mapped.text.indexOf(needle, at + 1);
    }
  }
  return { matches, match_count: total, match_count_exact: !countTruncated, scan_truncated: countTruncated, returned_count: matches.length, truncated: total > offset + matches.length || countTruncated || outputTruncated, next_offset: total > offset + matches.length ? offset + matches.length : null,
    match_mode: mode, search_scope: 'parsed_original_chunks', cross_chunk_search: 'verified_parent_blocks_only', cross_chunk_sources: crossSources.length };
}
module.exports = { exactSearch, searchable, crossChunkSources };
