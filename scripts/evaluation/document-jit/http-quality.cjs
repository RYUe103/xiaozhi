/* Real HTTP public-PDF upload/chat acceptance with isolated evaluation users. No existing account/session used. */
const { createRequire } = require('module');
const root = process.env.SANSUO_JIT_REPO_ROOT || '/app';
const appRequire = createRequire(root + '/api/package.json');
appRequire('module-alias')({ base: root + '/api' });
const fs = require('fs');
const crypto = require('crypto');
const mongoose = appRequire('mongoose');
const jwt = appRequire('jsonwebtoken');
appRequire('@librechat/data-schemas').createModels(mongoose);
const db = appRequire(root + '/api/models');
const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const base = process.env.JIT_ACCEPTANCE_BASE || 'http://127.0.0.1:3080';
const report = { scope: 'Real authenticated HTTP PDF upload, persisted parse artifacts, BaseClient Agent chat and follow-up. Public CiteVQA protocol PDF through real upload/storage/BaseClient; isolated evaluation accounts. Local MinerU mock is rejected and actual FITZ fallback is used; not real MinerU OCR acceptance.', checks: [], chats: [] };
let token;
async function request(route, init = {}, auth = token) {
  return fetch(base + route, { ...init, headers: { Authorization: 'Bearer ' + auth, 'User-Agent': userAgent, ...init.headers }, signal: AbortSignal.timeout(180000) });
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function chat(conversationId, parentMessageId, text, files = []) {
  const started = Date.now();
  const response = await request('/api/agents/chat/SanSuoMain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    endpoint: 'SanSuoMain', endpointType: 'custom', model: 'qwen3.6-plus', spec: 'sansuo-main', sansuoMode: 'deep',
    ephemeralAgent: { execute_code: true }, conversationId, parentMessageId, text, files,
    messageId: crypto.randomUUID(), clientRequestId: crypto.randomUUID(), isContinued: false, isRegenerate: false,
  }) });
  if (!response.ok) throw Error('CHAT_START_HTTP_' + response.status + ':' + (await response.text()).slice(0, 400));
  const start = await response.json();
  if (!start.streamId) throw Error('CHAT_NO_STREAM:' + JSON.stringify(start));
  const streamController = new AbortController();
  let events = 0;
  const consume = fetch(base + '/api/agents/chat/stream/' + start.streamId, { headers: { Authorization: 'Bearer ' + token }, signal: streamController.signal }).then(async res => {
    if (!res.ok) throw Error('STREAM_HTTP_' + res.status);
    for await (const chunk of res.body) events += (Buffer.from(chunk).toString().match(/data:/g) || []).length;
  }).catch(error => { if (error.name !== 'AbortError') report.checks.push({ name: 'stream_error', error: error.message }); });
  let status;
  try {
    for (let i = 0; i < 120; i++) {
      await sleep(1500);
      const res = await request('/api/agents/chat/status/' + conversationId);
      status = await res.json();
      if (!status.active) break;
    }
  } finally { streamController.abort(); await consume; }
  const res = await request('/api/messages?conversationId=' + conversationId + '&sortDirection=asc&pageSize=40');
  const result = await res.json();
  const messages = result.messages || [];
  const assistant = messages.filter(m => !m.isCreatedByUser).at(-1);
  const content = assistant?.content || [];
  const answer = content.filter(c => c.type === 'text').map(c => c.text).join('\n') || assistant?.text || '';
  const toolCalls = content.filter(c => c.type === 'tool_call').map(c => ({ name: c.tool_call?.name, args: c.tool_call?.args, output: c.tool_call?.output }));
  const entry = { elapsed_ms: Date.now() - started, status: status?.status, stream_events: events, message_count: messages.length, message_id: assistant?.messageId, answer, tool_calls: toolCalls };
  report.chats.push(entry);
  if (status?.active) throw Error('CHAT_ACCEPTANCE_TIMEOUT');
  return entry;
}
async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  if (process.env.JIT_ACCEPTANCE_RESUME_REPORT) {
    const prior = JSON.parse(fs.readFileSync(process.env.JIT_ACCEPTANCE_RESUME_REPORT, 'utf8'));
    token = jwt.sign({ id: prior.identities.user_id }, process.env.JWT_SECRET, { expiresIn: '30m' });
    report.identities = prior.identities;
    const convo = prior.identities.conversation_id;
    const previous = (await (await request('/api/messages?conversationId=' + convo + '&sortDirection=asc&pageSize=40')).json()).messages.filter(m=>!m.isCreatedByUser).at(-1);
    if (process.env.JIT_ACCEPTANCE_TRACE_ONLY === 'true') {
      const result = await chat(convo, previous.messageId, '请实际调用execute_code，用Python Decimal核验19.95乘以7再加3.10，输出计算结果。不要重新读取PDF。');
      report.checks.push({ name: 'production_code_execution_trace_check', ok: result.tool_calls.some(t => t.name === 'execute_code') && /142\.75/.test(result.answer) });
      report.ok = report.checks.every(c => c.ok);
      return;
    }
    const result = await chat(convo, previous.messageId, '本轮是读取能力验收。请实际使用 read_parsed_pdf：先 list 发现文档，再 toc 找到第二页的 table_id，最后 read_table 读取表格。请给出 Pressure 和 Interval 的数值、单位、页码。不要执行代码。');
    report.checks.push({ name: 'production_read_parsed_pdf_invoked', ok: result.tool_calls.some(t=>t.name==='read_parsed_pdf') });
    report.checks.push({ name: 'production_table_values', ok: /1\.6/.test(result.answer) && /MPa/i.test(result.answer) && /3|三/.test(result.answer) });
    const persisted = await db.getMessages({ user: prior.identities.user_id, conversationId: convo });
    const references = persisted.flatMap(m=>m.metadata?.sansuoDocumentReferences || []);
    report.checks.push({ name: 'persisted_versioned_scoped_reference', ok: references.some(r=>r.version && r.source_hash && r.user_id===prior.identities.user_id && r.conversation_id===convo) });
    report.references = references;
    report.ok = report.checks.every(c=>c.ok);
    return;
  }
  const runId = crypto.randomUUID();
  const user = await db.createUser({ name: 'JIT isolated HTTP acceptance', email: 'jit-' + runId + '@example.invalid', provider: 'local', role: 'USER', emailVerified: true }, undefined, true, true);
  const foreign = await db.createUser({ name: 'JIT isolated foreign acceptance', email: 'jit-foreign-' + runId + '@example.invalid', provider: 'local', role: 'USER', emailVerified: true }, undefined, true, true);
  token = jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET, { expiresIn: '30m' });
  const foreignToken = jwt.sign({ id: String(foreign._id) }, process.env.JWT_SECRET, { expiresIn: '30m' });
  const conversationId = crypto.randomUUID();
  report.identities = { run_id: runId, user_id: String(user._id), foreign_user_id: String(foreign._id), conversation_id: conversationId };
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(process.argv[2])], { type: 'application/pdf' }), 'citevqa-public-protocol.pdf');
  for (const [key, value] of Object.entries({ endpoint: 'SanSuoMain', endpointType: 'custom', file_id: crypto.randomUUID(), conversationId, message_file: 'true', tool_resource: 'execute_code' })) form.append(key, value);
  const upload = await request('/api/files', { method: 'POST', body: form });
  if (!upload.ok) throw Error('UPLOAD_HTTP_' + upload.status + ':' + (await upload.text()).slice(0, 500));
  const uploadText = await upload.text();
  if (!uploadText.trim().startsWith('{')) throw Error('UPLOAD_RESPONSE_' + upload.status + ':' + uploadText.slice(0, 600));
  const uploaded = JSON.parse(uploadText);
  const file = uploaded.file || uploaded;
  report.upload = { status: upload.status, file_id: file.file_id, filename: file.filename, bytes: file.bytes, response_keys: Object.keys(uploaded) };
  if (!file.file_id) throw Error('UPLOAD_FILE_ID_MISSING');
  const first = await chat(conversationId, '00000000-0000-0000-0000-000000000000', '请完整提取标注为“（四）”的部分中，关于甲方担任该金融投资工具账务处理负责方身份的段落原文。请引用页码；证据不足时实际调用read_parsed_pdf。不要生成文件。', [file]);
  report.checks.push({ name: 'public_protocol_core_answer', ok: /甲方为本理财产品的会计责任人/.test(first.answer) && /(?:第?\s*9\s*页|页码.{0,5}9)/.test(first.answer) });
  const second = await chat(conversationId, first.message_id, '请实际调用read_parsed_pdf，先list，再用read读取第20页。找出我部发送传真的传真号这一句完整原文，并说明是否填写了具体号码。');
  report.checks.push({ name: 'production_tool_followup', ok: /我部发送传真的传真号/.test(second.answer) && second.tool_calls.some(t=>t.name==='read_parsed_pdf') });
  const third = await chat(conversationId, second.message_id, '这是独立的计算核验场景，不需要重新读取PDF。请实际调用execute_code，用Python Decimal计算：金额8.35、2.70、13.49，数量分别17、23、9，求和后打93折，再加13%税，四舍五入到分。给出税前优惠后金额与最终金额。不生成文件。');
  report.checks.push({ name: 'production_execute_code_calculation', ok: third.tool_calls.some(t=>t.name==='execute_code') && /302\.68/.test(third.answer) && /342\.03/.test(third.answer) });
  const foreignMessages = await request('/api/messages?conversationId=' + conversationId, {}, foreignToken);
  const foreignBody = await foreignMessages.json();
  report.checks.push({ name: 'foreign_user_message_isolation', ok: foreignMessages.status === 403 || !foreignBody.messages?.length, status: foreignMessages.status });
  const artifacts = await db.getSanSuoFiles({ userId: String(user._id), conversationId });
  report.artifacts = artifacts.map(a => ({ filename: a.displayFilename, status: a.status, role: a.metadata?.role, source_hash_present: Boolean(a.metadata?.sourceHash) }));
  const roots = await db.getFiles({ user: String(user._id), file_id: file.file_id }, {}, {});
  report.checks.push({ name: 'persisted_source_sha256', ok: /^[a-f0-9]{64}$/.test(roots[0]?.metadata?.sha256 || '') });
  report.ok = report.checks.every(c => c.ok === true);
}
main().catch(error => { report.ok = false; report.error = error.message; }).finally(async () => {
  fs.writeFileSync(process.argv[3], JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, error: report.error, checks: report.checks, chats: report.chats.map(c => ({ elapsed_ms: c.elapsed_ms, status: c.status, tools: c.tool_calls.map(t=>t.name) })) }));
  await mongoose.disconnect(); process.exit(report.ok ? 0 : 1);
});
