'use strict';
// Real persisted public fixture + native ToolNode. No model call; not Agent E2E.
const fs = require('fs'), crypto = require('crypto'), { createRequire } = require('module');
const root = process.env.SANSUO_JIT_REPO_ROOT, req = createRequire(root + '/api/package.json');
req('module-alias')({ base: root + '/api' });
const mongoose = req('mongoose'); req('@librechat/data-schemas').createModels(mongoose);
const db = req(root + '/api/models');
const { SessionDocumentResources } = req(root + '/api/server/services/SessionDocumentResources');
const { DocumentArtifactRepository } = req(root + '/api/server/services/DocumentArtifactRepository');
const { DocumentReadBudget } = req(root + '/api/server/services/DocumentReadBudget');
const { registerSanSuoPdfReadTool } = req(root + '/api/server/services/Endpoints/agents/sansuoToolPolicy');
const { ToolNode } = req(root + '/node_modules/@librechat/agents/dist/cjs/tools/ToolNode.cjs');
const { createTokenCounter } = req('@librechat/api');
const { HumanMessage, AIMessage } = req('@langchain/core/messages');
if (!process.env.SANSUO_TEST_MONGO?.endsWith('/LibreChatMineruVisionPhase5candidate20261101')) throw Error('ISOLATION');
const input = JSON.parse(fs.readFileSync(process.argv[2]));
const report = { scope: 'real persisted public PDF, native registered ToolNode; no Qwen invocation; not Agent E2E', checks: [], calls: [] };
let downloads = 0, repository, directory, document;
const check = (name, ok, extra = {}) => report.checks.push({ name, ok: Boolean(ok), ...extra });
const count = createTokenCounter('cl100k_base');
function ledger() { const b = new DocumentReadBudget({ maxContextTokens: 120000, count: text => count(new HumanMessage(text)) }); b.observe([new HumanMessage('public fixture tool acceptance')]); return b; }
(async () => {
 await mongoose.connect(process.env.SANSUO_TEST_MONGO);
 const msg = await mongoose.connection.collection('messages').findOne({ conversationId: input.conversation_id, isCreatedByUser: true, 'files.0': { $exists: true } });
 if (!msg) throw Error('NO_FIXTURE');
 const userId = String(msg.user), conversationId = msg.conversationId;
 const load = async entry => {
  repository = new DocumentArtifactRepository({ userId, conversationId, contextBudget: ledger(), quality: { queryProcessing: false, rerank: false } });
  await repository.load({ roots: [entry.root], artifacts: entry.artifacts, download: async a => {
   downloads++;
   const r = await fetch(process.env.LIBRECHAT_CODE_BASEURL + '/download/' + a.sandboxSessionId + '/' + a.sandboxFileId + '?kind=user&id=' + userId,
     { headers: { 'X-API-Key': process.env.LIBRECHAT_CODE_API_KEY, 'User-Id': userId }, signal: AbortSignal.timeout(30000) });
   if (!r.ok) throw Error('DOWNLOAD_' + r.status); return Buffer.from(await r.arrayBuffer());
  } });
  document = [...repository.documents.values()][0];
  return { execute: args => repository.executeAsync(args) };
 };
 const make = extras => new SessionDocumentResources({ userId, conversationId, mode: 'deep', db, load, ...extras });
 directory = make(); await directory.discover();
 const doc = directory.list('pdf')[0]; if (!doc) throw Error('NO_DOCUMENT');
 check('metadata_only_discovery', downloads === 0);
 const agent = {};
 registerSanSuoPdfReadTool({ _sansuoPdfReadSources: new Map([[doc.document_id, doc]]) }, agent, args => directory.execute('pdf', args));
 const tool = new ToolNode({ tools: agent.tools, toolRegistry: agent.toolRegistry, maxContextTokens: 120000 });
 async function invoke(args, freshBudget = false) {
  if (repository && freshBudget) repository.contextBudget = ledger();
  const start = Date.now();
  const result = await tool.invoke({ messages: [new AIMessage({ content: '', tool_calls: [{ name: 'read_parsed_pdf', id: crypto.randomUUID(), args: { document_id: doc.document_id, ...args } }] })] }, { configurable: { user_id: userId, thread_id: conversationId } });
  const messages = result.messages || result;
  const raw = messages.at(-1).content;
  const parsed = JSON.parse(raw);
  report.calls.push({ action: args.action, elapsed_ms: Date.now() - start, model_chars: raw.length, content_chars: parsed.content?.length || 0,
    error: parsed.error?.code, status: parsed.status, source_range: parsed.delivered_source_range, context_budget: parsed.context_budget });
  return parsed;
 }
 const full = await invoke({ action: 'read_full', max_chars: 100000 });
 check('native_toolnode_full_original', full.parsed_text_complete && full.content === document.records.map(r => r.text).join('\n\n'));
 check('projection_traceability', full.source_spans?.length === document.records.length && full.source_spans.every((span, i) => span[0] === document.records[i].chunkId && span[4] === document.records[i].text.length));
 check('model_json_not_truncated', Boolean(full.coverage && full.source_spans && full.context_budget));
 check('full_not_ocr_certification', full.document_verified === false && full.coverage.images_checked_by_this_action.length === 0);
 report.document = { sha256: document.sourceHash, pages: document.pageCount, records: document.records.length, source_chars: document.records.reduce((n,r) => n + r.text.length, 0) };
 const initialDownloads = downloads;
 const reconstructed = new Map(document.records.map(r => [r.chunkId, '']));
 let token, previousEnd = 0, continuous = true, scans = 0, firstToken;
 do {
  const result = await invoke({ action: 'scan_document', max_chars: 5000, ...(token ? { continuation_token: token } : {}) }, true);
  if (result.error) throw Error('SCAN_' + result.error.code);
  continuous &&= result.delivered_source_range[0] === previousEnd;
  previousEnd = result.delivered_source_range[1];
  for (const span of result.source_spans) {
   const r = document.records.find(r => r.chunkId === span[0]);
   reconstructed.set(span[0], reconstructed.get(span[0]) + r.text.slice(span[3], span[3] + span[4]));
  }
  token = result.continuation_token; firstToken ||= token; scans++;
  // Fresh request budgets simulate new turns, not model compaction or Agent execution.
  repository.usage = { calls: 0, contentChars: 0 };
 } while (token && scans < 50);
 check('scan_complete_without_skips_or_duplicates', !token && continuous && document.records.every(r => reconstructed.get(r.chunkId) === r.text), { batches: scans });
 check('loaded_assets_reused', downloads === initialDownloads, { downloads });
 repository.contextBudget.used = repository.contextBudget.limit;
 check('depleted_context_stops', (await invoke({ action: 'scan_document', continuation_token: firstToken })).error?.code === 'MODEL_CONTEXT_BUDGET_EXCEEDED');
 check('forged_document_denied', (await directory.execute('pdf', { action: 'read_full', document_id: 'forged' })).error?.code === 'DOCUMENT_ACCESS_DENIED');
 const foreign = make({ userId: '000000000000000000000001' }); await foreign.discover(); check('foreign_user', foreign.list('pdf').length === 0);
 const other = make({ conversationId: crypto.randomUUID() }); await other.discover(); check('foreign_conversation', other.list('pdf').length === 0);
 const files = mongoose.connection.collection('files'), artifacts = mongoose.connection.collection('sansuofiles');
 const original = await files.findOne({ file_id: doc.file_id });
 const asset = await artifacts.findOne({ conversationId, 'metadata.rootSourceLibreFileId': doc.file_id, displayFilename: /_mineru_chunks\.jsonl$/ });
 const read = () => directory.execute('pdf', { action: 'scan_document', document_id: doc.document_id, continuation_token: firstToken });
 try {
  await files.updateOne({ _id: original._id }, { $set: { 'metadata.sha256': 'stage2-isolated-changed' } });
  check('source_version_changed', (await read()).error?.code === 'DOCUMENT_VERSION_MISMATCH');
  await files.replaceOne({ _id: original._id }, original);
  await files.updateOne({ _id: original._id }, { $set: { user: new mongoose.Types.ObjectId('000000000000000000000001') } });
  check('owner_revoked', (await read()).error?.code === 'DOCUMENT_ACCESS_DENIED');
  await files.replaceOne({ _id: original._id }, original);
  await artifacts.updateOne({ _id: asset._id }, { $set: { 'metadata.parserVersion': 'stage2-isolated-changed' } });
  check('parser_changed', (await read()).error?.code === 'DOCUMENT_VERSION_MISMATCH');
 } finally { await files.replaceOne({ _id: original._id }, original); await artifacts.replaceOne({ _id: asset._id }, asset); }
 repository.contextBudget = ledger(); check('restored_fixture', Boolean((await read()).content));
 report.model_calls = 0;
})().catch(e => { report.error = e.message; }).finally(async () => {
 fs.writeFileSync(process.argv[3], JSON.stringify(report, null, 2), { flag: 'wx' });
 console.log(JSON.stringify({ error: report.error, checks: report.checks, calls: report.calls.length }));
 await mongoose.disconnect(); process.exit(report.error || report.checks.some(c => !c.ok) ? 1 : 0);
});
