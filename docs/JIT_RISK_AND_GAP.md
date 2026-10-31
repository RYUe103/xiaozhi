# JIT 风险与缺口清单（Phase 0）

| 优先级 | 缺口/风险 | 代码证据 | 影响 | 建议阶段 |
|---|---|---|---|---|
| P0 | 章节读取不完整 | `DocumentContextService.js:631-638` PDF section 只筛 `record.chunkId===section.chunkId` | 章节问答漏正文，证据交付不足 | Phase 1 |
| P0 | 跨块/跨页表格不完整 | `extractTables` 逐 record 识别，`read_table` 绑定单 chunk | 表格被截断或伪完整 | Phase 1 |
| P0 | 续读不是安全 continuation token | `sliceContent:524-536` 只接受整数 offset | 旧引用、目标和版本不绑定 | Phase 1 |
| P0 | 每次工具调用无重新鉴权/版本校验 | 工具闭包使用请求级 Map；`parserVersion` 未进入 document/reference ID | 文档撤权/重解析时旧引用风险 | Phase 1/3 |
| P1 | 中文自然问句召回弱 | `getQueryTerms:508-518` 连续中文整句；基线自然/同义 R@5=0 | 常见用户问法无法命中 | Phase 2 |
| P1 | 高频目录/主题词干扰排序 | 字符串出现次数+原序排序 | 真条款可能被重复目录压过 | Phase 2 |
| P1 | 工具职责过于集中 | 单一 action enum 暴露7种行为 | 模型参数选择负担、错误调用增加 | Phase 3 |
| P1 | 结构化错误不统一 | 工具直接返回 status/message/content | Agent 难以统一处理未就绪、无权限、续读失败 | Phase 1/3 |
| P1 | 解析失败可见性需核对 | ParseJob 有 failed/error，但文件查询按 ready artifact | 若注入路径失败需保证不伪造成功 | Phase 5 |
| P2 | MinerU mock 不做真实 OCR | `sandbox/mineru-mock-server.js:20-84` | 扫描/版面/表格真实质量未验证 | Phase 5 |
| P2 | 原生 RAG 与 JIT 边界容易混淆 | `fileSearch.js` -> RAG `/query`，JIT 不走该接口 | 误把知识库或 file_search 结果当上传 JIT | Phase 0/3 |
| P2 | 版本生命周期未闭环 | ParseJob 有 parserVersion，引用/DocumentContext 无 version_id | 重解析后稳定 ID 语义不完整 | Phase 1 |
| P2 | 页面渲染未作为 Agent 工具 | 后端有 render artifact 函数，无 `document_render_page` 注册 | OCR/表格异常无法由 Agent 请求视觉核验 | Phase 4 |
| P2 | 全链路 Agent 测试不足 | 当前回归覆盖服务/策略/文件处理，未覆盖真实模型 ToolNode 调用 | 工具描述、动态注册、消息持久化可能有集成差异 | Phase 5 |

## 安全判断

当前聊天入口的 `requireJwtAuth`、Agent 权限和 `validateConvoAccess` 保护请求；文件数据库查询传入 `userId/conversationId`。工具参数禁止路径，DocumentContextService 的 document_id 由服务生成。仍需在新架构中把每次工具读取的 resolver/ACL/版本校验做成显式步骤，不能把请求级 Map 当长期授权凭证。

## 未确认项

- 未调用真实上传/聊天链路，本轮没有验证某个具体用户文件的 ParseJob 状态、产物数量或工具调用日志。
- 未读取任何用户文档内容或 Mongo 用户数据；未验证远端/内网 MinerU。
- 当前 pgvector 维度聚合没有观察到向量行，未确认历史/其他范围是否曾写入；未验证 embedding 服务实际调用与维度。

## 必须在实施前纳入验收的补充缺口

- 原始文件删除/撤权后派生产物是否级联不可读：源码只对传入 Libre IDs 标记删除；请求 Map 内可能继续保留正文。风险待真实撤权探针核实，不等同已经证明可越权。
- 请求级注册和正文注入耦合：只有成功读取并选出非空正文后才创建 documents Map（`BaseClient.js:2395-2447`）；这妨碍 list_documents 显示未就绪文件，也使“只注入清单”需要调整装载顺序。
- 稳定 ID 不等于内容版本：PDF source chunk key/occurrence、Word paragraph index 能保持一些插入场景的标识稳定，但改写同一位置可能保留 ID；需要 version_id 与内容/解析快照关联。
- TOC 当前只有平面 headings，没有 parent_section_id/max_depth/分页；Word 中文序号启发式可能误认普通短段为标题。
- PDF 产物允许 HTML table_body，但 DocumentContextService 只识别 Markdown 管道表；不存在的表格不能从“产物里有表格字符串”推断为 JIT 可结构化读取。
- 旧图形识别/页面渲染后端可能写入派生缓存和 access timestamp；“只读 JIT”应明确不改原文件/解析产物/知识库，允许的治理/缓存元数据副作用须单列，不应把整个请求承诺为零写入。
- `list/info` 当前只反映已装载 records，页数取最大已知 pageEnd；未知页信息时0不是可靠的原文总页数。

## 测试覆盖核实

| 证据 | 已覆盖 | 尚未覆盖 |
|---|---|---|
| 282 合成基线 | 198 检索、24 无答案、52 结构/引用、8 预算用例 | 真实 PDF OCR、完整 Agent、真实 API Token、撤权/版本变化 |
| DocumentContextService.spec | 16 个服务测试（PDF10、Word6），稳定ID、页/表格/相邻、损坏输入、多文档 | PDF 章节跨块、HTML/合并/跨页表格、模型工具使用 |
| sansuoToolPolicy.spec | Schema 动态注册、模式/策略，直接 invoke callback | 真实 native ToolNode event 与模型联合链路 |
| ToolService.spec | 请求级 reader 加载与其他工具/资源策略 | 真实会话数据库 ACL/删除变化 |
| Files/Code/process.spec | mock MinerU、Mammoth 真DOCX buffer、结构坐标、持久失败、门控、页面渲染调用 | 远端 MinerU OCR/实际存储故障 |
| BaseClient.test | 持久正文恢复、晚部PDF块、指定页、首中尾、工具策略/失败门控 | 真实模型 query rewrite、真实消息跨轮持久成功率 |

上轮压力样本只在 PDF 100/500/2000 字符预算下正文证据召回0，20000时100%；不能写成所有长PDF/所有配置均为0。关键词重复干扰项是培训目录主题词，不是对真实目录页分布的统计。

只读审计没有触发真实上传、重解析、索引重建、删除/撤权、页面渲染或模型执行；这保证用户数据不被改动，同时也保留这些端到端验证缺口。
