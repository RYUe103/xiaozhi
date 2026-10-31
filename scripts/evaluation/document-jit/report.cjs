'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const input = path.resolve(process.argv[2] || path.join(root, 'evidence/jit-baseline-20261031/results.json'));
const output = path.resolve(process.argv[3] || path.join(root, 'docs/JIT_EVALUATION_BASELINE_20261031.md'));
const r = JSON.parse(fs.readFileSync(input, 'utf8'));
const pct = (n) => n === null ? '—' : `${(n * 100).toFixed(1)}%`;
const num = (n, places = 3) => n === null ? '—' : n.toFixed(places);
const labels = { exact: '精确关键词', natural: '完整自然问句', synonym: '同义表达问句', spaced: '空格分词关键词', multi_evidence: '多证据关键词' };
const lines = [
  '# JIT 检索基线评测（2026-10-31）', '',
  '结论：当前 PDF/Word JIT 适配器适合显式定位和关键词读取，不能直接当成中文语义检索使用。优先修复中文查询匹配、PDF 章节范围和预算截断下的证据完整性，再决定是否引入更复杂的检索方案。此次只增加评测工具、合成样本和报告，没有改业务算法或运行服务。', '',
  '## 范围与样本', '',
  `- ${r.cases.length} 个有答案检索用例、${r.negatives.length} 个无答案用例、${r.controls.length} 个结构/接口检查、${r.budgetCases.length} 个预算压力用例；合计 ${r.cases.length+r.negatives.length+r.controls.length+r.budgetCases.length} 个。`,
  '- 自建 3 份中文规程：设备巡检、采购质量、备份权限，各含 8 条事实、2 个章节、1 张表和重复主题词的无关段落。同一逻辑内容分别构造 PDF chunks 与 Word JSONL，共 6 份解析文档；这不是 6 份真实上传文件。',
  '- 相关记录及完整答案片段在 corpus.cjs 中独立标注；自然问句、同义问句、关键词查询分别列出。单证据 24 题/类型/格式；多证据 3 题/格式。PDF 表格按块、Word 表格按单元格构造，符合现有输入结构。',
  '- 直接调用真实 DocumentContextService；未经过 LLM 查询改写/工具选择、自动 BaseClient 上下文选择、MinerU、文件下载、网络和真实聊天。自然问句零召回不能据此推断产品聊天零正确率。',
  '- 小规模、单人标注、合成文本且包含刻意设计的压力条件，不代表业务文档分布；本轮用于定位能力边界和建立可复跑基线。', '',
  '## 检索指标', '',
  '以下是正文实际交付完整答案片段的指标，默认 limit=6、max_chars=20000；本组短文本下候选列表与实际交付分数一致。压力测试另外列出。', '',
  '| 格式 | 查询类型 | 题数 | R@1 | R@3 | R@5 | P@1 | P@3 | P@5 | MRR@6 |',
  '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...r.summary.map((s) => `| ${s.format} | ${labels[s.category]} | ${s.n} | ${pct(s.delivered['recall@1'])} | ${pct(s.delivered['recall@3'])} | ${pct(s.delivered['recall@5'])} | ${pct(s.delivered['precision@1'])} | ${pct(s.delivered['precision@3'])} | ${pct(s.delivered['precision@5'])} | ${num(s.delivered['mrr@6'])} |`), '',
  'R@K 为前 K 条中的相关证据数/全部相关证据数；P@K 分母固定为 K，返回不足 K 条仍按 K 算。因此只有 1 条标准答案时 P@5 的上限为 20%，不能把它误读为返回了 80% 垃圾内容。MRR@6 为前 6 条中首个相关证据排名倒数。多证据查询需同时覆盖两条事实；MRR 不能代替完整覆盖率。', '',
  '候选指标使用 hits；交付指标要求相关记录自己的正文段落包含完整标注答案，保留原排名，不因缺失证据提升后续记录排名。无答案题不纳入有答案 R/P/MRR 均值。', '',
  '## 定位、表格、追问与无答案', '',
  '| 检查 | 通过/总数 | 解释 |',
  '| --- | ---: | --- |',
];
for (const [kind, label, explanation] of [
  ['page', 'PDF 页码定位', '显式给定正确页码，核对记录 ID 和正文；不是模型页码理解准确率。'],
  ['paragraph', 'Word 段落定位', '显式段落坐标；Word 没有可靠分页信息。'],
  ['table', '完整单块/坐标表格读取', '核对全部表格单元内容及页码/段落 provenance。'],
  ['section', '章节完整读取', '每章节应包含后续四条事实，PDF 只读到标题块。'],
  ['followup', '相邻内容追问', '先真实搜索，再传 previousReference 读取前后块。'],
  ['table_followup', '表格追问', '从真实搜索返回的 table_id 继续读表。'],
  ['pagination', 'offset 连续读取', '分批拼接需与未截断输出完全一致。'],
  ['selection', '多文档选择', '明确指定文档可读；遗漏/未知 ID 不返回其他文档内容。'],
  ['reference_scope', '跨文档引用隔离', '上一文档引用不能充当另一文档相邻块。'],
  ['capability_boundary', '历史/跨块表格边界', '旧 Word 无坐标表格明确不可用符合预期；PDF 跨块表格完整性失败。'],
]) {
  const group = r.controls.filter((c) => c.kind === kind);
  lines.push(`| ${label} | ${group.filter((c)=>c.pass).length}/${group.length} | ${explanation} |`);
}
lines.push('', `无答案用例返回 not_found：${r.negatives.filter((c)=>c.pass).length}/${r.negatives.length}。完全无关的词没有命中；带主题关键词、但询问文档未提供的手机号码等信息时仍返回主题段落。这说明“关键词命中”不能作为“问题有答案”的判定；这里不等同于已观察到模型编造答案。`, '',
  '## 预算截断与实际证据', '',
  '3 个约 4,000 字符的长段落，每段答案靠近结尾；查询词在答案附近。候选 Recall@5 都为 100%。Word 会围绕命中位置摘录，PDF 则先拼接全文再截断。', '',
  '| 格式 | max_chars | 候选 R@5 | 正文交付 R@5 |',
  '| --- | ---: | ---: | ---: |',
  ...r.budgetCases.map((c)=>`| ${c.format} | ${c.max_chars} | ${pct(c.candidate['recall@5'])} | ${pct(c.delivered['recall@5'])} |`), '',
  '小预算测试没有自动追取 offset；它测量单次工具结果是否交付证据。正文 next_offset 可以继续读取，不能据此把单次缺失说成永久丢失。当前 hits 不受同一正文预算裁剪，后续统计与模型使用都需要注意这个差异。', '',
  '## 耗时与 Token', '',
  `本机 ${r.metadata.cpu}，${r.metadata.platform}，Node ${r.metadata.node}。6 份基础解析文档构建耗时 ${num(r.metadata.build_ms)} ms；tokenizer 加载 ${num(r.metadata.tokenizer_init_ms)} ms。`, '',
  `基础检索预热 5 次后，每题重复 30 次，共 ${r.latency_ms.samples} 次调用：P50=${num(r.latency_ms.p50, 6)} ms，P95=${num(r.latency_ms.p95, 6)} ms。小文档、含大量未命中查询，这个数字仅说明内存函数很轻，不能作为网页响应时延或模型首字延迟。`, '',
  '| 格式 | 记录数 | 文本字符 | 构造/序列化/解析 ms | 查询 P50 ms | 查询 P95 ms |',
  '| --- | ---: | ---: | ---: | ---: | ---: |',
  ...r.scale.map((s)=>`| ${s.format} | ${s.records} | ${s.text_chars} | ${num(s.serialize_parse_build_ms)} | ${num(s.query_p50_ms)} | ${num(s.query_p95_ms)} |`), '',
  '规模测试每条约 120 字符，10 次预热、100 次查询，按全文线性扫描；各规模只有一次构造计时。时延不包含磁盘、存储拉取、实际解析、并发和工具调度。', '',
  '以下仅统计已完整交付所需证据的题目，避免把空返回算成节省。计数采用项目已有 ai-tokenizer/o200k_base，是代理 Token，不是 Qwen 实际 API 用量。全文为解析正文拼接；工具结果为完整 JSON，不含外层消息/工具 schema。', '',
  '| 格式 | 查询类型 | 正文平均 Token | 全文平均 Token | 正文平均缩减 | 完整结果 JSON 平均 Token |',
  '| --- | --- | ---: | ---: | ---: | ---: |',
  ...r.summary.map((s)=>`| ${s.format} | ${labels[s.category]} | ${num(s.successful_mean_content_tokens, 1)} | ${num(s.successful_mean_full_text_tokens, 1)} | ${pct(s.successful_mean_content_token_reduction)} | ${num(s.successful_mean_tool_result_tokens, 1)} |`), '',
  '短文档中，文件标识、引用和元数据开销可能使完整工具结果比直接给全文还长。不能仅用正文缩减比例宣布实际 API Token 节省；需要真实长文档及完整对话链路复测。未测 TTFT、实际计费 Token、回答正确率、CPU 占用、生产内存、索引磁盘、解析到可查询时长。', '',
  '## 可复现失败案例与建议顺序', '',
  '1. “轴承温度达到多少时需要停机？”返回 not_found；“轴承 温度 停机”召回答案。getQueryTerms 把无空格中文整段保留，再做子串匹配；建议先评估中文切词/查询词提取，不直接假设 BM25 能解决无分词问题。',
  '2. “巡检周期”把反复列主题词的培训目录排在真实标准之前；词频与原始顺序决定排名。建议把高频无关段加入后续真实业务集，再比较 BM25 等排序方案。',
  '3. PDF read(section_id) 只读标题所属 chunk，后面的章节正文不返回；建议补齐到下一同级/上级标题的范围，并保留字数分页边界。',
  '4. PDF 长块预算不足时有 hits 无答案，跨块表格只读到部分结构；建议先补预算感知摘录/明确完整性信息和跨块表格测试。',
  '5. 下一阶段需要在匿名真实文档上做完整链路 A/B：现有自动上下文选择 vs JIT+关键词；包含模型改写、追问、真实回答和 Token/时延。通过这一阶段后再决定是否增加 BM25 或语义检索。', '',
  '本报告仅提出建议，没有实施上述算法改动。', '',
  '## 复跑与证据', '',
  '在真实源码根目录执行：', '',
  '```bash',
  'node --test scripts/evaluation/document-jit/metrics.test.cjs',
  'node scripts/evaluation/document-jit/run.cjs',
  'node scripts/evaluation/document-jit/report.cjs',
  'npx jest --config api/jest.config.js server/services/DocumentContextService.spec.js server/services/Endpoints/agents/sansuoToolPolicy.spec.js server/services/__tests__/ToolService.spec.js server/services/Files/Code/process.spec.js app/clients/specs/BaseClient.test.js --runInBand',
  '```', '',
  '- 首次运行基线：指标/交付证据校验 5 项通过；现有 5 个相关测试套件、272 项通过。详见 evidence/jit-baseline-20261031/validation.txt。',
  '- evidence/jit-baseline-20261031/results.json：每题参数、独立答案片段、实际 IDs、完整结果、失败项、规模测试、环境与摘要。cases.csv：逐题检索指标摘要。',
  `- 检索模块 SHA256：\`${r.metadata.module_sha256}\`；运行前后保持一致。`,
  `- 样本 SHA256：\`${r.metadata.corpus_sha256}\`。脚本及指标实现摘要另存于 results.json。`,
  '- 不自动提交、不重启服务、不读取真实用户文档、不改 JWT/MinerU/ToolNode/文件存储。', '',
);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, lines.join('\n'));
console.log(output);
