'use strict';
// Tool-level real Qwen rerank over immutable historical candidates. No Agent claim.
const fs = require('fs'), crypto = require('crypto'), { createRequire } = require('module');
const root = process.env.SANSUO_JIT_REPO_ROOT, req = createRequire(root + '/api/package.json');
req('module-alias')({ base: root + '/api' });
const { DocumentArtifactRepository } = req(root + '/api/server/services/DocumentArtifactRepository');
const { DocumentEvidenceReranker } = req('/tmp/retrieval-upgrade-modules/DocumentEvidenceReranker.js');
const { DocumentEvidenceReranker: BaselineReranker } = req('/tmp/retrieval-upgrade-modules/BaselineReranker.js');
const { weightedReciprocalRankFusion, protectDiverseCandidates, reciprocalRankFusion } = req('/tmp/retrieval-upgrade-modules/DocumentRetrieval.js');
const input = JSON.parse(fs.readFileSync(process.argv[2]));
const rows = fs.readFileSync(process.argv[3], 'utf8').trim().split('\n').map(JSON.parse);
const repo = new DocumentArtifactRepository({ userId: 'evaluation', conversationId: 'frozen-replay' });
const doc = repo.add({ fileId: 'frozen', records: rows });
// Source identities reconstructed using the historical fixture binding.
const historical = new DocumentArtifactRepository({ userId: '6ae73548fbae1de9b1b18ae2', conversationId: input.conversation_id });
const fixture = JSON.parse(fs.readFileSync(process.argv[4]));
const hd = historical.add({ fileId: fixture.file_id, records: rows });
const byId = new Map(hd.records.map(r => [r.id, r]));
const sets = {};
for (const name of ['keyword', 'bm25', 'vector']) {
 const events = input.trace_events.filter(e => e.stage.toLowerCase() === name);
 const variants = events.map((e, q) => e.hits.map(h => {
  const record = byId.get(h.id); if (!record) throw Error('SOURCE_MAPPING_FAILED');
  return { record, score: h.score, source: name + ':q' + q };
 }));
 sets[name] = (variants.length === 1 ? variants[0] : reciprocalRankFusion(variants).slice(0, 30)).map(h => ({ ...h, source: name }));
}
const output = { kind: 'real_qwen_tool_level_frozen_trace_rerank', input_sha256: crypto.createHash('sha256').update(fs.readFileSync(process.argv[2])).digest('hex'), model: process.env.SANSUO_JIT_QUERY_MODEL || 'qwen3.6-plus', runs: [] };
(async () => {
 for (const [mode, limit] of [['legacy',20],['weighted',40],['weighted',60]]) {
  const channels = [{ name: 'bm25', weight: .75, results: sets.bm25 }, { name: 'vector', weight: 1, results: sets.vector }];
  const candidates = mode === 'legacy' ? reciprocalRankFusion(Object.values(sets)).slice(0,limit) : protectDiverseCandidates(weightedReciprocalRankFusion(channels), [...channels,{name:'keyword',maxProtected:4,results:sets.keyword}],{limit});
  const events = [], ranker = new (mode === 'legacy' ? BaselineReranker : DocumentEvidenceReranker)({ candidateLimit: limit });
  const start = Date.now(); const ranked = await ranker.rank(input.question,candidates,{emit:(stage,e)=>events.push({stage,...e})});
  output.runs.push({mode,limit,elapsed_ms:Date.now()-start,usage:ranker.usage, input_sources:candidates.map(h=>h.record.sourceChunkId), delivered_sources:ranked.slice(0,6).map(h=>h.record.sourceChunkId), events});
 }
})().catch(e=>{output.error=e.message;process.exitCode=1;}).finally(()=>{fs.writeFileSync(process.argv[5],JSON.stringify(output,null,2),{flag:'wx'});console.log(JSON.stringify({error:output.error,runs:output.runs.map(r=>({mode:r.mode,limit:r.limit,elapsed_ms:r.elapsed_ms,usage:r.usage,warnings:r.events.map(e=>e.warning).filter(Boolean)}))}));});
