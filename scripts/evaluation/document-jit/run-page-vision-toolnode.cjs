'use strict';
// This exercises the registered tool and real ToolNode against a provided page image;
// it deliberately does not claim upload, automatic retrieval, or authorization coverage.
const fs = require('fs');
const { createRequire } = require('module');
const root = process.env.SANSUO_JIT_REPO_ROOT || '/tmp/sansuo-pdf-audit-20261101';
const req = createRequire(root + '/api/package.json');
const { ToolNode } = req('@librechat/agents');
const { AIMessage } = req('@langchain/core/messages');
const { registerSanSuoPdfReadTool } = req(root + '/api/server/services/Endpoints/agents/sansuoToolPolicy');
const { DocumentPageVisionService } = req(root + '/api/server/services/DocumentPageVisionService');
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const question = manifest.questions.find((q) => q.id === process.argv[4]);
const document = manifest.documents.find((d) => d.key === question.document_key);
const doc = { documentId: 'fixture-document', fileId: 'fixture', sourceHash: document.sha256, pageCount: 91 };
const repository = { userId: 'fixture', conversationId: 'fixture', documents: new Map([[doc.documentId, doc]]), checkAuthorization: async () => null };
const service = new DocumentPageVisionService({ repository, baseURL: process.env.QWEN_BASE_URL, apiKey: process.env.QWEN_API_KEY,
  model: process.env.SANSUO_VISION_MODEL || 'qwen3-vl-plus', getPage: async () => ({ id: 'fixture-page-image', bytes: fs.readFileSync(process.argv[3]) }) });
const request = { _sansuoPdfReadSources: repository.documents, _sansuoDocumentRepository: repository };
const agent = { tools: [], toolDefinitions: [], toolRegistry: new Map() };
registerSanSuoPdfReadTool(request, agent, (input) => service.inspect(input));
const node = new ToolNode({ tools: agent.tools, handleToolErrors: true });
const message = new AIMessage({ content: '', tool_calls: [{ id: 'inspect-fixture', name: 'read_parsed_pdf',
  args: { action: 'inspect_page', document_id: doc.documentId, page: Number(process.argv[5]), query: question.question, mode: 'text' }, type: 'tool_call' }] });
node.invoke({ messages: [message] }, { configurable: {} }).then((result) => {
  const messages = result.messages || result;
  const content = messages.at(-1)?.content;
  fs.writeFileSync(process.argv[6], JSON.stringify({ question_id: question.id, page: Number(process.argv[5]), content }, null, 2), { flag: 'wx' });
  let parsed; try { parsed = JSON.parse(content); } catch { parsed = {}; }
  console.log(JSON.stringify({ status: parsed.status || 'unknown', source: parsed.source?.type, page: parsed.page,
    elapsed_ms: parsed.telemetry?.elapsed_ms, usage: parsed.telemetry?.usage, output_chars: String(content || '').length }));
}).catch((error) => { console.error(error.message); process.exitCode = 1; });
