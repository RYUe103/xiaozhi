/* Existing authored gold; evaluates the new Repository, not the legacy Service. */
const { createRequire } = require('module');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const root = process.env.SANSUO_JIT_REPO_ROOT || path.resolve(__dirname, '../../..');
const req = createRequire(root + '/api/package.json');
const { DocumentArtifactRepository } = req(root + '/api/server/services/DocumentArtifactRepository');
const { DocumentVectorSearch, createMongoVectorCache } = req(root + '/api/server/services/DocumentVectorSearch');
const { DocumentLexicalIndex, createMongoLexicalCache } = req(root + '/api/server/services/DocumentRetrieval');
const corpus = require('./corpus.cjs');
const mongoose = req('mongoose');
const report = { scope: 'Authored synthetic parsed corpus, unchanged fact/query gold; real Repository + persisted lexical/Mongo vectors + Bailian, not upload/browser or OCR. Retrieval and delivered exact answer-bearing statement scored separately.', cases: [], performance: [] };
async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  for (const spec of corpus) {
    const records = []; const positions = [];
    for (const [i, fact] of spec.facts.entries()) {
      if (i % 4 === 0) records.push({ page: records.length + 1, text: '# ' + spec.sections[i / 4] });
      positions.push(records.length);
      records.push({ page: records.length + 1, text: fact[0] + '：' + fact[1] });
    }
    records.push({ page: records.length + 1, text: '| ' + spec.table[0].join(' | ') + ' |\n| --- | --- |\n' + spec.table.slice(1).map(row => '| ' + row.join(' | ') + ' |').join('\n') });
    records.push({ page: records.length + 1, text: Array(8).fill(spec.facts[0][0]).join('、') + '：这些条目仅列入培训签到目录，本段不规定执行标准。' });
    const vector = new DocumentVectorSearch({ cache: createMongoVectorCache(mongoose), maxEmbeddingCalls: 150 });
    const repo = new DocumentArtifactRepository({ userId: 'synthetic-repository-benchmark', conversationId: spec.id, vectorSearch: vector, lexicalCache: createMongoLexicalCache(mongoose), budget: { maxCalls: 160, maxContentChars: 3200000 } });
    const doc = repo.add({ fileId: spec.id, filename: spec.title + '.pdf', records, engine: 'mineru', sourceHash: 'synthetic-gold-v1' });
    for (const [i, fact] of spec.facts.entries()) for (const [category, query] of [['exact', fact[2]], ['natural', fact[3]], ['synonym', fact[4]], ['spaced', fact[5]]]) {
      const started = performance.now();
      const result = await repo.executeAsync({ action: 'search', query, limit: 6, max_chars: 20000 });
      const expected = doc.records[positions[i]];
      const ranking = result.retrieval?.rrf || [];
      const rank = ranking.findIndex(hit => hit.id === expected.id) + 1;
      report.cases.push({ document: spec.id, fact: i, category, query, rank, recall_at_6: rank > 0 ? 1 : 0, precision_at_6: rank > 0 ? 1 / ranking.length : 0, reciprocal_rank: rank > 0 ? 1 / rank : 0,
        evidence_delivered: result.content?.includes(fact[1]) ? 1 : 0, page_accurate: result.hits?.some(h => h.chunk_id === expected.chunkId && h.page_start === positions[i] + 1) ? 1 : 0,
        elapsed_ms: +(performance.now() - started).toFixed(2), vector_candidates: result.retrieval?.vector?.length || 0, warnings: result.retrieval?.warnings || result.error });
    }
    report.performance.push({ document: spec.id, cache: doc.lexicalIndex.cacheStats, embedding: vector.usage });
  }
  for (const count of [100, 1000, 10000]) {
    const records = Array.from({ length: count }, (_, i) => ({ id: String(i), kind: 'extracted_text', text: `设备型号 ZX-${i} 按 GB/T 12345-2024 第3.2条执行，轴承温度上限为80摄氏度。记录${i}` }));
    let t = performance.now(); const index = new DocumentLexicalIndex(records); const build = performance.now() - t;
    const durations = [];
    for (let j = 0; j < 20; j++) { t = performance.now(); index.search('ZX-800 轴承温度'); durations.push(performance.now() - t); }
    durations.sort((a,b)=>a-b);
    report.performance.push({ records: count, index_build_ms: +build.toFixed(2), query_p50_ms: +durations[10].toFixed(2), query_p95_ms: +durations[18].toFixed(2) });
  }
  report.metrics = {};
  for (const category of ['all', 'exact', 'natural', 'synonym', 'spaced']) {
    const cases = report.cases.filter(c => category === 'all' || c.category === category);
    report.metrics[category] = { cases: cases.length };
    for (const metric of ['recall_at_6', 'precision_at_6', 'reciprocal_rank', 'evidence_delivered', 'page_accurate', 'elapsed_ms']) report.metrics[category][metric] = +(cases.reduce((s,c)=>s+c[metric],0)/cases.length).toFixed(4);
  }
  report.ok = report.cases.every(c => c.vector_candidates > 0 && !c.warnings?.length);
}
main().catch(e => { report.ok=false; report.error=e.message; }).finally(async()=>{ fs.writeFileSync(process.argv[2], JSON.stringify(report,null,2)); console.log(JSON.stringify({ok:report.ok,error:report.error,metrics:report.metrics,performance:report.performance})); await mongoose.disconnect(); process.exit(report.ok?0:1); });
