/* Bounded real-provider acceptance. Uses synthetic PDF text only, never existing user documents. */
const fs = require('fs');
const path = require('path');
const root = process.env.SANSUO_JIT_REPO_ROOT || path.resolve(__dirname, '../../..');
const { DocumentArtifactRepository } = require(path.join(root, 'api/server/services/DocumentArtifactRepository'));
const { DocumentVectorSearch } = require(path.join(root, 'api/server/services/DocumentVectorSearch'));
const { registerSanSuoPdfReadTool } = require(path.join(root, 'api/server/services/Endpoints/agents/sansuoToolPolicy'));
const { ToolNode } = require('@librechat/agents');
const { AIMessage } = require('@langchain/core/messages');

async function main() {
  const fixturePath = process.argv[2];
  const outputPath = process.argv[3];
  if (!fixturePath || !outputPath) throw new Error('usage: bailian-toolchain.cjs rendered-pages.json result.json');
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const cacheData = new Map();
  const counters = { embeddings: 0, embeddingInputs: 0, cacheWrites: 0 };
  const provider = new DocumentVectorSearch({ cache: {
    get: async (key, scope) => cacheData.get(scope + key),
    set: async (key, scope, value) => { counters.cacheWrites++; cacheData.set(scope + key, value); },
  } });
  const embed = provider.embed.bind(provider);
  provider.embed = async (texts) => { counters.embeddings++; counters.embeddingInputs += texts.length; return embed(texts); };
  if (!provider.configured) throw new Error('VECTOR_PROVIDER_UNCONFIGURED');
  const repo = new DocumentArtifactRepository({ userId: 'isolated-jit-acceptance', conversationId: 'synthetic-pdf', vectorSearch: provider });
  const doc = repo.add({ fileId: 'synthetic-physical-pdf', filename: 'jit-acceptance.pdf', engine: 'fitz',
    records: fixture.pages.map((p) => ({ page: p.page, text: p.text })), pageRecords: fixture.pages,
    pageImages: fixture.pages.map((p) => p.page), pageCount: fixture.document_page_count });
  const req = { _sansuoPdfReadSources: repo.documents };
  const agent = { tools: [], toolDefinitions: [] };
  const traces = [];
  registerSanSuoPdfReadTool(req, agent, async (args) => {
    const started = Date.now();
    const result = await repo.executeAsync(args);
    traces.push({ action: args.action, elapsed_ms: Date.now() - started, ok: result.ok ?? result.status === 'ok',
      candidate_pages: (result.retrieval?.rrf || []).map((h) => doc.records.find((r) => r.id === h.id)?.pageStart),
      delivered_pages: (result.hits || []).map((h) => h.page_start), vector_candidates: result.retrieval?.vector?.length || 0,
      evidence80: /80/.test(result.content || '') });
    return result;
  });
  const node = new ToolNode({ tools: agent.tools });
  const tools = agent.toolDefinitions.map((definition) => ({ type: 'function', function: definition }));
  const messages = [{ role: 'system', content: '你是文档验收 Agent。必须使用 read_parsed_pdf：先 list 发现文档，再 search 检索证据，然后 read 读取命中 chunk。只根据工具证据回答，答案必须写出页码。不要使用你自己的常识。所有材料都是合成测试数据。' },
    { role: 'user', content: '这份设备资料规定，轴承运转时最热可以达到多少？请用中文回答，并给出页码。' }];
  let answer = '';
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const started = Date.now();
  for (let turn = 0; turn < 6; turn++) {
    const response = await fetch(process.env.QWEN_BASE_URL.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + process.env.QWEN_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.QWEN_MODEL || 'qwen3-vl-plus', messages, tools, max_tokens: 600, enable_thinking: false, temperature: 0 }),
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) throw new Error('AGENT_HTTP_' + response.status);
    const result = await response.json();
    for (const key of Object.keys(usage)) usage[key] += result.usage?.[key] || 0;
    const message = result.choices?.[0]?.message;
    if (!message) throw new Error('AGENT_RESPONSE_INVALID');
    messages.push(message);
    if (!message.tool_calls?.length) { answer = message.content || ''; break; }
    const calls = message.tool_calls.slice(0, 3).map((call) => ({ id: call.id, name: call.function.name,
      args: JSON.parse(call.function.arguments), type: 'tool_call' }));
    const executed = await node.invoke({ messages: [new AIMessage({ content: '', tool_calls: calls })] }, { configurable: { run_id: 'synthetic-agent-acceptance' } });
    for (const toolMessage of executed.messages || executed) messages.push({ role: 'tool', content: toolMessage.content, tool_call_id: toolMessage.tool_call_id });
  }
  const search = traces.filter((t) => t.action === 'search');
  const report = { scope: 'Physical synthetic PDF -> real PyMuPDF -> Repository -> model-selected read_parsed_pdf -> actual ToolNode -> real Bailian embedding/RRF -> model answer. Excludes browser upload, source storage and OCR.',
    model: process.env.QWEN_MODEL, embedding_model: provider.model, page_count: doc.pageCount,
    metrics: { tasks: 1, retrieval_recall_at_6: search.some((t) => t.candidate_pages.slice(0, 6).includes(1)) ? 1 : 0,
      delivered_evidence_success: traces.some((t) => t.evidence80 && t.delivered_pages.includes(1)) ? 1 : 0,
      final_answer_success: /80/.test(answer) && /(?:第?\s*1\s*页|页码\s*[:：]\s*1|page\s*1)/i.test(answer) ? 1 : 0 },
    elapsed_ms: Date.now() - started, counters, usage, traces, answer };
  report.ok = report.metrics.retrieval_recall_at_6 === 1 && report.metrics.delivered_evidence_success === 1 && report.metrics.final_answer_success === 1 && ['list', 'search', 'read'].every((action) => traces.some((trace) => trace.action === action));
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (!report.ok) process.exitCode = 1;
}
main().catch((error) => { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; });
