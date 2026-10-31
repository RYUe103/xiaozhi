'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const root = path.resolve(__dirname, '../../..');
const sourcePath = path.join(root, 'api/server/services/DocumentContextService.js');
const source = require(sourcePath);
const corpus = require('./corpus.cjs');
const { score, mean, percentile, deliveredRanking } = require('./metrics.cjs');
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sourceHash = hash(sourcePath);
const out = path.resolve(process.argv[2] || path.join(root, 'evidence/jit-baseline-20261031'));
const cases = [];
const controls = [];
const negatives = [];
const budgetCases = [];

function build(spec, format) {
  const records = [];
  const factPositions = [];
  function add(text, extra = {}) {
    records.push(format === 'pdf'
      ? { chunk_id: `${spec.id}-${records.length}`, page_start: records.length + 1, page_end: records.length + 1, text }
      : { type: 'text', paragraph_index: records.length + 1, text, ...extra });
  }
  spec.facts.forEach((fact, i) => {
    if (i % 4 === 0) add(format === 'pdf' ? `# ${spec.sections[i / 4]}` : spec.sections[i / 4], { heading_level: 1 });
    factPositions.push(records.length);
    add(`${fact[0]}：${fact[1]}`);
  });
  if (format === 'pdf') {
    add(`| ${spec.table[0].join(' | ')} |\n| --- | --- |\n${spec.table.slice(1).map((r) => `| ${r.join(' | ')} |`).join('\n')}`);
  } else {
    spec.table.forEach((row, r) => row.forEach((text, c) => add(text, { table_index: 1, row_index: r + 1, cell_index: c + 1 })));
  }
  // Topic repetition is intentionally irrelevant to the first fact's answer.
  add(`${Array(8).fill(spec.facts[0][0]).join('、')}：这些条目仅列入培训签到目录，本段不规定执行标准。`);
  const args = { userId: 'synthetic-eval', fileId: `${spec.id}-${format}`, filename: `${spec.title}.${format === 'pdf' ? 'pdf' : 'docx'}`, records: format === 'pdf' ? records : Buffer.from(records.map((r) => JSON.stringify(r)).join('\n')) };
  const doc = format === 'pdf' ? source.buildPdfDocument(args) : source.buildWordDocument(args);
  const factory = format === 'pdf' ? source.createDocumentContextService : source.createWordDocumentContextService;
  return { spec, format, doc, factory, factPositions, service: factory({ documents: new Map([[doc.documentId, doc]]) }) };
}

function addSearch(item, category, query, goldIndices) {
  const { doc, service, spec, format, factPositions } = item;
  const expected = goldIndices.map((i) => ({ id: doc.records[factPositions[i]].chunkId, fragment: spec.facts[i][1] }));
  const args = { action: 'search', document_id: doc.documentId, query, limit: 6, max_chars: 20000 };
  const result = service.execute(args);
  const ranked = (result.hits || []).map((hit) => hit.chunk_id);
  const visible = deliveredRanking(result, expected);
  cases.push({ id: `${format}-${spec.id}-${category}-${goldIndices.join('-')}`, format, document: spec.id, category, query, args, expected,
    actual_ids: ranked, visible_ids: visible, candidate: score(ranked, expected.map((x) => x.id)),
    delivered: score(visible, expected.map((x) => x.id)), result,
    full_text: doc.records.map((r) => r.text).join('\n\n') });
}
function check(id, result, pass, detail = {}) {
  controls.push({ id, pass: Boolean(pass), status: result.status, ...detail, result });
}

const buildStart = performance.now();
const items = ['pdf', 'word'].flatMap((format) => corpus.map((spec) => build(spec, format)));
const buildMs = performance.now() - buildStart;
for (const item of items) {
  const { spec, format, doc, service, factory, factPositions } = item;
  spec.facts.forEach((fact, i) => {
    for (const [category, index] of [['exact', 2], ['natural', 3], ['synonym', 4], ['spaced', 5]]) addSearch(item, category, fact[index], [i]);
  });
  addSearch(item, 'multi_evidence', `${spec.facts[0][2]} ${spec.facts[1][2]}`, [0, 1]);
  for (const query of ['月球基地建设预算', '量子卫星发射日期', `${spec.facts[0][2]} 负责人手机号码`, `${spec.facts[1][2]} 厂家保修电话号码`]) {
    const result = service.execute({ action: 'search', document_id: doc.documentId, query });
    negatives.push({ format, document: spec.id, query, expected: 'not_found', pass: result.status === 'not_found', result });
  }
  for (let section = 0; section < 2; section++) {
    const expected = spec.facts.slice(section * 4, section * 4 + 4).map((f) => f[1]);
    const result = service.execute({ action: 'read', document_id: doc.documentId, section_id: doc.headings[section].sectionId });
    check(`${format}-${spec.id}-section-${section}`, result, expected.every((s) => result.content?.includes(s)), { kind: 'section', expected_fragments: expected });
  }
  const position = factPositions[1];
  const locator = format === 'pdf' ? { pages: [position + 1] } : { paragraph_start: position + 1, paragraph_end: position + 1 };
  const located = service.execute({ action: 'read', document_id: doc.documentId, ...locator });
  check(`${format}-${spec.id}-locator`, located, located.hits?.length === 1 && located.hits[0].chunk_id === doc.records[position].chunkId && located.content.includes(spec.facts[1][1]), { kind: format === 'pdf' ? 'page' : 'paragraph' });
  const table = service.execute({ action: 'read_table', document_id: doc.documentId, table_id: doc.tables[0]?.tableId });
  const provenanceCorrect = format === 'pdf' ? table.provenance?.page_start === 11 && table.provenance?.page_end === 11 : table.provenance?.paragraph_start === 11 && table.provenance?.paragraph_end === 16;
  check(`${format}-${spec.id}-table`, table, provenanceCorrect && spec.table.flat().every((cell) => table.content?.includes(cell)), { kind: 'table' });
  const seed = service.execute({ action: 'search', document_id: doc.documentId, query: spec.facts[1][2] });
  const next = factory({ documents: new Map([[doc.documentId, doc]]), previousReference: seed.reference });
  const adjacent = next.execute({ action: 'read_adjacent', document_id: doc.documentId });
  check(`${format}-${spec.id}-followup`, adjacent, [0, 1, 2].every((i) => adjacent.content?.includes(spec.facts[i][1])), { kind: 'followup' });
  const tableSearch = service.execute({ action: 'search', document_id: doc.documentId, query: spec.table[1][0] });
  const tableNext = factory({ documents: new Map([[doc.documentId, doc]]), previousReference: tableSearch.reference }).execute({ action: 'read_table', document_id: doc.documentId });
  check(`${format}-${spec.id}-table-followup`, tableNext, spec.table.flat().every((cell) => tableNext.content?.includes(cell)), { kind: 'table_followup' });
  const full = service.execute({ action: 'read', document_id: doc.documentId, ...locator });
  let offset = 0, combined = '', count = 0;
  do {
    const page = service.execute({ action: 'read', document_id: doc.documentId, ...locator, offset, max_chars: 100 });
    combined += page.content || ''; offset = page.next_offset; count++;
  } while (offset !== null && count < 100);
  check(`${format}-${spec.id}-pagination`, full, combined === full.content, { kind: 'pagination', calls: count });
}

for (const format of ['pdf', 'word']) {
  const pair = items.filter((i) => i.format === format);
  const documents = new Map(pair.map((i) => [i.doc.documentId, i.doc]));
  const service = pair[0].factory({ documents });
  const omitted = service.execute({ action: 'search', query: '巡检周期' });
  check(`${format}-multidoc-omitted`, omitted, omitted.status === 'document_id_required', { kind: 'selection' });
  const wrong = service.execute({ action: 'search', document_id: 'unavailable-document', query: '巡检周期' });
  check(`${format}-multidoc-invalid`, wrong, wrong.status !== 'ok' && !wrong.content, { kind: 'selection' });
  const chosen = service.execute({ action: 'search', document_id: pair[0].doc.documentId, query: '巡检周期' });
  check(`${format}-multidoc-explicit`, chosen, chosen.document_id === pair[0].doc.documentId && chosen.content?.includes(pair[0].spec.facts[0][1]), { kind: 'selection' });
  const seed = pair[0].service.execute({ action: 'search', query: '轴承温度' });
  const isolated = pair[0].factory({ documents, previousReference: seed.reference }).execute({ action: 'read_adjacent', document_id: pair[1].doc.documentId });
  check(`${format}-cross-document-reference`, isolated, isolated.status === 'not_found' && !isolated.content, { kind: 'reference_scope' });
  // Same three long logical paragraphs, with the answer near the end of each.
  // Below Word's 6000-char segmentation boundary, to isolate excerpt/truncation.
  const longRecords = Array.from({ length: 3 }, (_, i) => ({ text: `${'背景说明。'.repeat(800)}预算验证：结论${i}为${i + 7}天。`, paragraph_index: i + 1, chunk_id: `long-${i}`, page_start: i + 1 }));
  const args = { userId: 'synthetic-eval', fileId: `long-${format}`, records: format === 'pdf' ? longRecords : Buffer.from(longRecords.map((r) => JSON.stringify({ ...r, type: 'text' })).join('\n')) };
  const doc = format === 'pdf' ? source.buildPdfDocument(args) : source.buildWordDocument(args);
  const svc = pair[0].factory({ documents: new Map([[doc.documentId, doc]]) });
  const expected = doc.records.map((r, i) => ({ id: r.chunkId, fragment: `结论${i}为${i + 7}天。` }));
  for (const max_chars of [100, 500, 2000, 20000]) {
    const result = svc.execute({ action: 'search', query: '预算验证', max_chars });
    const gold = expected.map((e) => e.id);
    budgetCases.push({ format, max_chars, expected, candidate: score((result.hits || []).map((h) => h.chunk_id), gold), delivered: score(deliveredRanking(result, expected), gold), result });
  }
}

// Capability boundaries, not included in normal table extraction accuracy.
const legacy = source.buildWordDocument({ userId: 'synthetic-eval', fileId: 'legacy', records: Buffer.from(JSON.stringify({ type: 'text', paragraph_index: 1, text: '| 名称 | 数量 |\n| --- | --- |\n| 电机 | 2 |' })) });
const legacyResult = source.createWordDocumentContextService({ documents: new Map([[legacy.documentId, legacy]]) }).execute({ action: 'read_table' });
check('word-legacy-table-unavailable', legacyResult, legacyResult.status === 'not_found', { kind: 'capability_boundary' });
const split = source.buildPdfDocument({ userId: 'synthetic-eval', fileId: 'split-table', records: [{ text: '| 名称 | 数量 |\n| --- | --- |', page_start: 1 }, { text: '| 电机 | 2 |', page_start: 2 }] });
const splitResult = source.createDocumentContextService({ documents: new Map([[split.documentId, split]]) }).execute({ action: 'read_table', table_id: split.tables[0]?.tableId });
check('pdf-cross-chunk-table-completeness', splitResult, splitResult.content?.includes('电机'), { kind: 'capability_boundary', expectation: '完整跨块表格' });

async function main() {
  const tokenStart = performance.now();
  const { Tokenizer } = require('ai-tokenizer');
  const encoding = await import('ai-tokenizer/encoding/o200k_base');
  const tokenizer = new Tokenizer(encoding);
  const tokenizerInitMs = performance.now() - tokenStart;
  const latency = [];
  for (const c of cases) {
    const service = items.find((i) => i.format === c.format && i.spec.id === c.document).service;
    for (let i = 0; i < 5; i++) service.execute(c.args);
    const timings = [];
    for (let i = 0; i < 30; i++) { const start = performance.now(); service.execute(c.args); timings.push(performance.now() - start); }
    c.query_latency_ms = { p50: percentile(timings, 0.5), p95: percentile(timings, 0.95) };
    latency.push(...timings);
    c.tokens = { full_text: tokenizer.count(c.full_text), content: tokenizer.count(c.result.content || ''), tool_result: tokenizer.count(JSON.stringify(c.result)) };
    c.full_evidence_delivered = c.delivered['recall@5'] === 1;
    delete c.full_text;
  }
  const scale = [];
  for (const format of ['pdf', 'word']) for (const size of [100, 1000, 10000]) {
    const raw = Array.from({ length: size }, (_, i) => ({ text: `运行记录${i}。${'常规巡检记录，设备状态正常。'.repeat(8)} ${i % 100 === 0 ? '轴承温度达到75摄氏度时应停机。' : ''}`, paragraph_index: i + 1, chunk_id: `scale-${i}`, page_start: i + 1 }));
    const start = performance.now();
    const args = { userId: 'synthetic-eval', fileId: `scale-${format}-${size}`, records: format === 'pdf' ? raw : Buffer.from(raw.map((r) => JSON.stringify({ ...r, type: 'text' })).join('\n')) };
    const doc = format === 'pdf' ? source.buildPdfDocument(args) : source.buildWordDocument(args);
    const parseBuildMs = performance.now() - start;
    const svc = (format === 'pdf' ? source.createDocumentContextService : source.createWordDocumentContextService)({ documents: new Map([[doc.documentId, doc]]) });
    for (let i = 0; i < 10; i++) svc.execute({ query: '轴承 温度' });
    const timings = [];
    for (let i = 0; i < 100; i++) { const tick = performance.now(); svc.execute({ query: '轴承 温度' }); timings.push(performance.now() - tick); }
    scale.push({ format, records: size, text_chars: doc.records.reduce((n,r) => n+r.text.length, 0), serialize_parse_build_ms: parseBuildMs, query_p50_ms: percentile(timings, 0.5), query_p95_ms: percentile(timings, 0.95) });
  }
  const summary = [];
  for (const format of ['pdf', 'word']) for (const category of ['exact', 'natural', 'synonym', 'spaced', 'multi_evidence']) {
    const group = cases.filter((c) => c.format === format && c.category === category);
    const aggregate = (key) => Object.fromEntries(Object.keys(group[0][key]).map((metric) => [metric, mean(group.map((c) => c[key][metric]))]));
    const successful = group.filter((c) => c.full_evidence_delivered);
    summary.push({ format, category, n: group.length, candidate: aggregate('candidate'), delivered: aggregate('delivered'), full_evidence_rate: successful.length / group.length, successful_mean_content_tokens: mean(successful.map((c) => c.tokens.content)), successful_mean_full_text_tokens: mean(successful.map((c) => c.tokens.full_text)), successful_mean_tool_result_tokens: mean(successful.map((c) => c.tokens.tool_result)), successful_mean_content_token_reduction: mean(successful.map((c) => 1 - c.tokens.content / c.tokens.full_text)) });
  }
  if (hash(sourcePath) !== sourceHash) throw new Error('Business source changed during benchmark');
  fs.mkdirSync(out, { recursive: true });
  const report = { metadata: { timestamp: new Date().toISOString(), scope: 'Synthetic parsed-content adapters only; no model, network, MinerU, automatic BaseClient selector or production end-to-end measurement', node: process.version, platform: `${os.platform()} ${os.arch()}`, cpu: os.cpus()[0]?.model, module_sha256: sourceHash, corpus_sha256: hash(path.join(__dirname, 'corpus.cjs')), runner_sha256: hash(__filename), metrics_sha256: hash(path.join(__dirname, 'metrics.cjs')), tokenizer: 'ai-tokenizer 1.0.6 / o200k_base proxy; not deployed Qwen billing', config: { limit: 6, max_chars: 20000, warmups: 5, repeats: 30 }, build_ms: buildMs, tokenizer_init_ms: tokenizerInitMs }, summary, latency_ms: { p50: percentile(latency, 0.5), p95: percentile(latency, 0.95), samples: latency.length }, scale, cases, negatives, controls, budgetCases };
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  const rows = [['id','format','category','query','expected_ids','actual_ids','candidate_recall5','delivered_recall5','mrr6','content_tokens','full_text_tokens','tool_result_tokens','latency_p50_ms','latency_p95_ms']];
  cases.forEach((c) => rows.push([c.id,c.format,c.category,c.query,c.expected.map((x)=>x.id).join('|'),c.actual_ids.join('|'),c.candidate['recall@5'],c.delivered['recall@5'],c.delivered['mrr@6'],c.tokens.content,c.tokens.full_text,c.tokens.tool_result,c.query_latency_ms.p50,c.query_latency_ms.p95]));
  fs.writeFileSync(path.join(out, 'cases.csv'), '\uFEFF'+rows.map((r)=>r.map((v)=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\n')+'\n');
  console.log(JSON.stringify({ output: out, summary, latency_ms: report.latency_ms, scale, controls: { n: controls.length, passed: controls.filter((c)=>c.pass).length, failed: controls.filter((c)=>!c.pass).map((c)=>c.id) }, negatives: { n: negatives.length, passed: negatives.filter((c)=>c.pass).length }, budgets: budgetCases.map((c)=>({format:c.format,max_chars:c.max_chars,candidate_recall5:c.candidate['recall@5'],delivered_recall5:c.delivered['recall@5']})) }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
