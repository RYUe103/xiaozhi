'use strict';
function score(ranked, gold, ks = [1, 3, 5]) {
  const relevant = new Set(gold);
  if (!relevant.size) throw new Error('No-answer cases require separate scoring');
  if (new Set(ranked).size !== ranked.length) throw new Error('Duplicate ranking ID');
  const result = {};
  for (const k of ks) {
    const found = ranked.slice(0, k).filter((id) => relevant.has(id)).length;
    result[`recall@${k}`] = found / relevant.size;
    result[`precision@${k}`] = found / k;
  }
  const first = ranked.findIndex((id) => relevant.has(id));
  result['mrr@6'] = first >= 0 && first < 6 ? 1 / (first + 1) : 0;
  return result;
}
function mean(values) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; }
function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}
// A candidate only counts as delivered if its answer-bearing fragment is present
// in that candidate's own output segment. Preserve original ranking positions.
function deliveredRanking(result, expected) {
  const content = result.content || '';
  const segments = new Map();
  const re = /\[(?:paragraph=\d+ chunk=)?(chunk_[a-f0-9]+)(?: page=[^\]]+)?\]\n/g;
  const headers = [...content.matchAll(re)];
  headers.forEach((m, i) => segments.set(m[1], content.slice(m.index + m[0].length, headers[i + 1]?.index ?? content.length)));
  return (result.hits || []).map((hit, i) => {
    const text = segments.get(hit.chunk_id) || '';
    const evidence = expected.find((item) => item.id === hit.chunk_id);
    return text.length && (!evidence || text.includes(evidence.fragment)) ? hit.chunk_id : `missing-${i}`;
  });
}
module.exports = { score, mean, percentile, deliveredRanking };
