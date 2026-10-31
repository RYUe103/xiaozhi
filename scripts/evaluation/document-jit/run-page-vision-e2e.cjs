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
const base = 'http://127.0.0.1:3181';
const browserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let identity, token;
const request = (route, init = {}) => fetch(base + route, { ...init,
  headers: { Authorization: 'Bearer ' + token, 'User-Agent': browserAgent, ...init.headers },
  signal: init.signal || AbortSignal.timeout(180000) });
async function main() {
  await mongoose.connect('mongodb://mongodb:27017/LibreChatPdfAudit20261101');
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
  const start = Date.now();
  const response = await request('/api/agents/chat/SanSuoMain', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: 'SanSuoMain', endpointType: 'custom', model: 'qwen3.6-plus', spec: 'sansuo-main',
      sansuoMode: 'deep', ephemeralAgent: { execute_code: true }, conversationId, parentMessageId: '00000000-0000-0000-0000-000000000000',
      text: question.question + '\n\n请依据所附文档回答并引用 PDF 物理页码；无法确认请明确说明。', files: [file],
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
  for (let i = 0; i < 800 && active; i++) {
    await delay(1500);
    const status = await (await request('/api/agents/chat/status/' + conversationId)).json();
    active = Boolean(status.active);
    if (i % 40 === 0) console.log(JSON.stringify({ phase: 'waiting', elapsed_ms: Date.now() - start, active }));
  }
  controller.abort();
  await stream;
  const messages = await db.getMessages({ user: identity, conversationId });
  const assistant = messages.filter((m) => !m.isCreatedByUser).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).at(-1);
  const result = { id: question.id, pdf_sha256: digest, elapsed_ms: Date.now() - start, active,
    answer: (assistant?.content || []).filter((c) => c.type === 'text').map((c) => typeof c.text === 'string' ? c.text : c.text?.value || '').join('\n') || assistant?.text || '',
    tool_calls: (assistant?.content || []).filter((c) => c.type === 'tool_call').map((c) => c.tool_call),
    references: messages.flatMap((m) => m.metadata?.sansuoDocumentReferences || []) };
  fs.writeFileSync(process.argv[5], JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ phase: 'finished', elapsed_ms: result.elapsed_ms, active, answer_chars: result.answer.length,
    tool_count: result.tool_calls.length, reference_count: result.references.length, result_path: process.argv[5] }));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
