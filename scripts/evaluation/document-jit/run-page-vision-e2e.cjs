'use strict';
// Isolated API/database only. The manifest contains questions, not answer keys.
const fs = require('fs');
const crypto = require('crypto');
const { createRequire } = require('module');
const root = process.env.SANSUO_JIT_REPO_ROOT || '/tmp/sansuo-pdf-audit-20261101';
const req = createRequire(root + '/api/package.json');
req('module-alias')({ base: root + '/api' });
const mongoose = req('mongoose');
const jwt = req('jsonwebtoken');
req('@librechat/data-schemas').createModels(mongoose);
const db = req(root + '/api/models');
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const question = manifest.questions.find((q) => q.id === process.argv[4]);
if (!question) throw new Error('QUESTION_NOT_FOUND');
const document = manifest.documents.find((d) => d.key === question.document_key);
const pdf = fs.readFileSync(process.argv[3]);
const digest = crypto.createHash('sha256').update(pdf).digest('hex');
if (digest !== document.sha256) throw new Error('PDF_HASH_MISMATCH');
const base = process.env.SANSUO_TEST_BASE || 'http://127.0.0.1:3181';
const browserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let identity, token;
const request = (route, init = {}) => fetch(base + route, { ...init,
  headers: { Authorization: 'Bearer ' + token, 'User-Agent': browserAgent, ...init.headers },
  signal: init.signal || AbortSignal.timeout(180000) });
async function main() {
  const mongo = process.env.SANSUO_TEST_MONGO || 'mongodb://mongodb:27017/LibreChatPdfAudit20261101';
  if (!/\/LibreChat(?:PdfAudit|MineruVision)\w*$/.test(mongo)) throw Error('ISOLATED_DB_REQUIRED');
  await mongoose.connect(mongo);
  const user = await db.createUser({ name: 'Isolated PDF vision test', email: 'pdf-audit-' + crypto.randomUUID() + '@example.invalid',
    provider: 'local', role: 'USER', emailVerified: true }, undefined, true, true);
  identity = String(user._id);
  token = jwt.sign({ id: identity }, process.env.JWT_SECRET, { expiresIn: '4h' });
  const conversationId = crypto.randomUUID();
  const form = new FormData();
  form.append('file', new Blob([pdf], { type: 'application/pdf' }), document.filename);
  for (const [key, value] of Object.entries({ endpoint: 'SanSuoMain', endpointType: 'custom', file_id: crypto.randomUUID(),
    conversationId, message_file: 'true', tool_resource: 'execute_code' })) form.append(key, value);
  const uploadAt = Date.now();
  const uploaded = await request('/api/files', { method: 'POST', body: form });
  if (!uploaded.ok) throw new Error('UPLOAD_HTTP_' + uploaded.status + ':' + (await uploaded.text()).slice(0, 200));
  const uploadText = await uploaded.text();
  let payload;
  try { payload = JSON.parse(uploadText); } catch { throw new Error('UPLOAD_NON_JSON_' + uploaded.status + ':' + uploadText.slice(0, 500)); }
  const file = payload.file || payload;
  if (!file.file_id) throw new Error('UPLOAD_NO_FILE_ID');
  console.log(JSON.stringify({ phase: 'uploaded', elapsed_ms: Date.now() - uploadAt, pdf_sha256: digest }));
  async function ask(text, parentMessageId) {
  const start = Date.now();
  const response = await request('/api/agents/chat/SanSuoMain', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: 'SanSuoMain', endpointType: 'custom', model: 'qwen3.6-plus', spec: 'sansuo-main',
      sansuoMode: 'deep', ephemeralAgent: { execute_code: true }, conversationId, parentMessageId,
      text, files: [file],
      messageId: crypto.randomUUID(), clientRequestId: crypto.randomUUID(), isContinued: false, isRegenerate: false }) });
  if (!response.ok) throw new Error('CHAT_HTTP_' + response.status + ':' + (await response.text()).slice(0, 200));
  const started = await response.json();
  if (!started.streamId) throw new Error('NO_STREAM_ID');
  const controller = new AbortController();
  const stream = fetch(base + '/api/agents/chat/stream/' + started.streamId,
    { headers: { Authorization: 'Bearer ' + token, 'User-Agent': browserAgent }, signal: controller.signal }).then(async (r) => {
    for await (const ignored of r.body) { /* drain the stream */ }
  }).catch(() => {});
  let active = true;
  for (let i = 0; i < 800 && active && Date.now() - start < 1200000; i++) {
    await delay(1500);
    const status = await (await request('/api/agents/chat/status/' + conversationId)).json();
    active = Boolean(status.active);
    if (i % 40 === 0) console.log(JSON.stringify({ phase: 'waiting', elapsed_ms: Date.now() - start, active }));
  }
  controller.abort();
  await stream;
  if (active) throw new Error("AGENT_RUN_TIMEOUT");
  return { elapsed_ms: Date.now() - start, active };
  }
  const first = await ask(question.question + '\n\n请依据所附文档回答并引用 PDF 物理页码；无法确认请明确说明。', '00000000-0000-0000-0000-000000000000');
  const messages = await db.getMessages({ user: identity, conversationId });
  const assistant = messages.filter((m) => !m.isCreatedByUser).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).at(-1);
  const sourceUserMessage = messages.find(m => m.isCreatedByUser);
  const result = { message_error: Boolean(assistant?.error), error_parts: (assistant?.content || []).filter(c => c.type === 'error'), scope_hash: sourceUserMessage?.metadata?.sansuoJit?.scope_hash || null, conversation_id: conversationId, id: question.id, pdf_sha256: digest, elapsed_ms: first.elapsed_ms, active: first.active, upload_ms: Date.now() - uploadAt - first.elapsed_ms,
    answer: (assistant?.content || []).filter((c) => c.type === 'text').map((c) => typeof c.text === 'string' ? c.text : c.text?.value || '').join('\n') || assistant?.text || '',
    tool_calls: (assistant?.content || []).filter((c) => c.type === 'tool_call').map((c) => c.tool_call),
    message_metadata: assistant?.metadata || {},
    references: messages.flatMap((m) => m.metadata?.sansuoDocumentReferences || []) };
  fs.writeFileSync(process.argv[5], JSON.stringify(result, null, 2), { flag: 'wx' });
  if (process.env.SANSUO_TEST_FOLLOWUP === 'true' && assistant?.messageId) {
    const second = await ask('请沿用刚才保存的页面引用，调用文档读取工具读取该页原文，再核对刚才答案涉及的数字并列出来源物理页码。不要重新搜索整份文档。', assistant.messageId);
    const updated = await db.getMessages({ user: identity, conversationId });
    const last = updated.filter(m => !m.isCreatedByUser).sort((a,b) => new Date(a.createdAt)-new Date(b.createdAt)).at(-1);
    const followup = { ...second, answer: last?.text || '', content: last?.content, references: updated.flatMap(m=>m.metadata?.sansuoDocumentReferences || []) };
    fs.writeFileSync(process.argv[5]+'.followup.json',JSON.stringify(followup,null,2),{flag:'wx'});
  }

  if (process.env.SANSUO_TEST_WARM_REPEAT === 'true' && assistant?.messageId) {
    const warm = await ask(question.question + '\n\n请依据所附文档回答并引用 PDF 物理页码；无法确认请明确说明。', assistant.messageId);
    const updated = await db.getMessages({ user: identity, conversationId });
    const last = updated.filter(m => !m.isCreatedByUser).sort((a,b) => new Date(a.createdAt)-new Date(b.createdAt)).at(-1);
    fs.writeFileSync(process.argv[5]+'.warm.json', JSON.stringify({ ...warm, answer: last?.text || '', content: last?.content, metadata: last?.metadata, error: last?.error }, null, 2), { flag: 'wx' });
  }
  if (!result.answer || result.message_error || /文件解析失败|文件解析超时/.test(result.answer)) process.exitCode = 2;
  console.log(JSON.stringify({ phase: 'finished', elapsed_ms: result.elapsed_ms, active: result.active, answer_chars: result.answer.length,
    tool_count: result.tool_calls.length, reference_count: result.references.length, result_path: process.argv[5] }));
}
main().catch((error) => {
  const code = /^[A-Z][A-Z0-9_]+/.exec(error.message)?.[0] || 'E2E_UNEXPECTED_FAILURE';
  console.error(code);
  const failurePath = process.argv[5] + '.failure.json';
  if (!fs.existsSync(failurePath)) fs.writeFileSync(failurePath, JSON.stringify({ status: 'failed', id: question.id, pdf_sha256: digest, error: code }, null, 2), { flag: 'wx' });
  process.exitCode = 1;
}).finally(async () => { await mongoose.disconnect(); process.exit(process.exitCode || 0); });
