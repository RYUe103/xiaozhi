// Offline counterfactual over frozen real channel traces; never model/Agent accuracy.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { reciprocalRankFusion, weightedReciprocalRankFusion, protectDiverseCandidates } = require('../../../api/server/services/DocumentRetrieval');
const root = path.resolve(__dirname, '../../..');
const diagnostics = require(root + '/evidence/agent-tools-refactor-20261102/retrieval-failure-diagnostic.json');
const rows = [];
const inputs = [];
for (const diagnostic of diagnostics) {
  const file = `${root}/evidence/agent-tools-refactor-20261102/multiturn/${diagnostic.run}/turn_07.json`;
  const bytes = fs.readFileSync(file);
  inputs.push({ file: path.relative(root, file), sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
  const events = JSON.parse(bytes).trace_events;
  const sets = {};
  for (const name of ['keyword', 'bm25', 'vector']) {
    const traces = events.filter(e => e.stage.toLowerCase() === name);
    const variants = traces.map((e, q) => e.hits.map(h => ({ record: { id: h.id, pageStart: h.page }, score: h.score, source: name + ':q' + q })));
    sets[name] = (variants.length === 1 ? variants[0] : reciprocalRankFusion(variants).slice(0, 30)).map(h => ({ ...h, source: name }));
  }
  for (const limit of [20, 40, 60]) {
    const legacy = reciprocalRankFusion(Object.values(sets)).slice(0, limit);
    rows.push({ run: diagnostic.run, mode: 'legacy', limit, protected: false, count: legacy.length, target_position: legacy.findIndex(h => h.record.id === diagnostic.runtime_chunk) + 1 || null });
    for (const weight of [1, .75, .5]) for (const protectedPool of [false, true]) {
      const channels = [{ name: 'bm25', weight, results: sets.bm25 }, { name: 'vector', weight: 1, results: sets.vector }];
      const fused = weightedReciprocalRankFusion(channels);
      const pool = protectedPool ? protectDiverseCandidates(fused, [...channels, { name: 'keyword', maxProtected: 4, results: sets.keyword }], { limit }) : fused.slice(0, limit);
      rows.push({ run: diagnostic.run, mode: 'weighted', bm25_weight: weight, vector_weight: 1, limit, protected: protectedPool, count: pool.length, target_position: pool.findIndex(h => h.record.id === diagnostic.runtime_chunk) + 1 || null });
    }
  }
}
const result = { kind: 'offline_real_trace_replay', warning: 'Each channel was logged at depth 30. Pool 40/60 is a union of those channels, NOT true per-channel Recall@40/60. One annotated missing fact, no Agent or final answer claim.', inputs, rows };
const output = process.argv[2];
if (output) fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
for (const row of rows.filter(r => r.mode === 'legacy' || (r.bm25_weight === .75 && r.protected))) console.log(JSON.stringify(row));
