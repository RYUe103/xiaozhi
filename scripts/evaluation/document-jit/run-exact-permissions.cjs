'use strict';
// Real isolated Mongo/storage, tool-level acceptance. No model calls.
const fs = require('fs'), { createRequire } = require('module');
const root = process.env.SANSUO_JIT_REPO_ROOT, req = createRequire(root + '/api/package.json');
req('module-alias')({ base: root + '/api' });
const mongoose = req('mongoose'); req('@librechat/data-schemas').createModels(mongoose);
const db = req(root + '/api/models');
const { SessionDocumentResources } = req(root + '/api/server/services/SessionDocumentResources');
const { DocumentArtifactRepository } = req(root + '/api/server/services/DocumentArtifactRepository');
if (!process.env.SANSUO_TEST_MONGO?.endsWith('/LibreChatMineruVisionPhase5candidate20261101')) throw Error('ISOLATION');
const sample = JSON.parse(fs.readFileSync(process.argv[2])); const report = { scope: 'real isolated Mongo/storage find_exact permission checks; tool-level, not Agent', checks: [] };
(async () => {
 await mongoose.connect(process.env.SANSUO_TEST_MONGO);
 const msg = await mongoose.connection.collection('messages').findOne({ conversationId: sample.conversation_id, isCreatedByUser: true, 'files.0': { $exists: true } });
 if (!msg) throw Error('NO_FIXTURE');
 const userId = String(msg.user), conversationId = msg.conversationId;
 let downloads = 0;
 const load = async entry => {
  const repo = new DocumentArtifactRepository({ userId, conversationId, quality: { queryProcessing: false, rerank: false } });
  await repo.load({ roots: [entry.root], artifacts: entry.artifacts, download: async a => {
   downloads++;
   const r = await fetch(process.env.LIBRECHAT_CODE_BASEURL + '/download/' + a.sandboxSessionId + '/' + a.sandboxFileId + '?kind=user&id=' + userId,
    { headers: { 'X-API-Key': process.env.LIBRECHAT_CODE_API_KEY, 'User-Id': userId }, signal: AbortSignal.timeout(30000) });
   if (!r.ok) throw Error('DOWNLOAD_' + r.status); return Buffer.from(await r.arrayBuffer());
  } }); return { execute: args => repo.executeAsync(args) };
 };
 const make = extras => new SessionDocumentResources({ userId, conversationId, mode: 'deep', db, load, ...extras });
 const s = make(); await s.discover(); const doc = s.list('pdf')[0]; if (!doc) throw Error('NO_DOCUMENT');
 report.checks.push({ name: 'metadata_only_discovery', ok: downloads === 0 });
 const read = args => s.execute('pdf', { action: 'find_exact', document_id: doc.document_id, query: '政协', pages: [1], limit: 1, ...args });
 report.checks.push({ name: 'actual_persisted_read', ok: !!(await read()).content });
 const before = downloads; await read(); report.checks.push({ name: 'request_content_load_reused', ok: downloads === before });
 report.checks.push({ name: 'forged_document', ok: (await read({ document_id: 'foreign' })).error?.code === 'DOCUMENT_ACCESS_DENIED' });
 const foreign = make({ userId: '000000000000000000000001' }); await foreign.discover();
 report.checks.push({ name: 'foreign_user', ok: !foreign.list('pdf').length });
 const other = make({ conversationId: '00000000-0000-0000-0000-000000000001' }); await other.discover();
 report.checks.push({ name: 'foreign_conversation', ok: !other.list('pdf').length });
 const files = mongoose.connection.collection('files'), artifacts = mongoose.connection.collection('sansuofiles');
 const original = await files.findOne({ file_id: doc.file_id });
 const asset = await artifacts.findOne({ conversationId, 'metadata.rootSourceLibreFileId': doc.file_id, displayFilename: /_mineru_chunks\.jsonl$/ });
 try {
  await files.updateOne({ _id: original._id }, { $set: { 'metadata.sha256': 'changed-test-only' } });
  report.checks.push({ name: 'source_changed', ok: (await read()).error?.code === 'DOCUMENT_VERSION_MISMATCH' });
  await files.replaceOne({ _id: original._id }, original);
  await files.updateOne({ _id: original._id }, { $set: { user: new mongoose.Types.ObjectId('000000000000000000000001') } });
  report.checks.push({ name: 'owner_revoked', ok: (await read()).error?.code === 'DOCUMENT_ACCESS_DENIED' });
  await files.replaceOne({ _id: original._id }, original);
  await artifacts.updateOne({ _id: asset._id }, { $set: { 'metadata.parserVersion': 'changed-test-only' } });
  report.checks.push({ name: 'parser_changed', ok: (await read()).error?.code === 'DOCUMENT_VERSION_MISMATCH' });
 } finally {
  await files.replaceOne({ _id: original._id }, original);
  await artifacts.replaceOne({ _id: asset._id }, asset);
 }
 report.checks.push({ name: 'restored_after_mutation', ok: !!(await read()).content });
 report.downloads = downloads;
})().catch(e => { report.error = e.message; }).finally(async () => {
 fs.writeFileSync(process.argv[3], JSON.stringify(report, null, 2), { flag: 'wx' });
 console.log(JSON.stringify(report)); await mongoose.disconnect(); process.exit(report.error || report.checks.some(c => !c.ok) ? 1 : 0);
});
