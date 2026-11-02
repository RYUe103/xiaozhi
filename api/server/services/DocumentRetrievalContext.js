const crypto = require('crypto');
const VERSION = 'source-heading-context-v1';
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Deterministic source headings only; never mutate records or claim context is evidence.
 * If a chunk contains multiple internal headings, its own text already carries them;
 * do not assign one later heading to the preceding text. */
function buildRetrievalContext(document) {
 const headings = new Map();
 for (const h of document.headings || []) {
  if (!headings.has(h.chunkId)) headings.set(h.chunkId, []);
  headings.get(h.chunkId).push(h);
 }
 let stack = [];
 const records = document.records.map(record => {
  const local = headings.get(record.chunkId) || [];
  const leading = local.filter(h => h.textOffset === 0);
  for (const h of leading) {
   stack = stack.filter(p => p.level < h.level);
   stack.push(h);
  }
  const selected = stack.filter(h => h.chunkId !== record.chunkId).slice(-3);
  const prefix = selected.map(h => h.title).join(' > ').slice(0, 600);
  const context = { text: prefix, method: 'source_headings', version: VERSION, source_chunk_ids: selected.map(h => h.chunkId) };
  context.key = digest([VERSION, document.sourceHash, document.bindingVersion, record.parser_version, record.text, context.text, context.source_chunk_ids]);
  const result = { ...record, retrievalContext: context, indexText: prefix ? prefix + '\n' + record.text : record.text };
  // Update context for following chunks, never retroactively for this chunk.
  for (const h of local.filter(h => h.textOffset !== 0)) {
   stack = stack.filter(p => p.level < h.level); stack.push(h);
  }
  return result;
 });
 return { records, version: VERSION, status: 'complete', key: digest(records.map(r => r.retrievalContext.key)) };
}
module.exports = { buildRetrievalContext, VERSION };
