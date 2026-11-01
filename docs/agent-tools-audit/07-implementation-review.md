# 实施后代码复审（2026-11-02）

复审代码 SHA：27df227，前序实现 0198c13、a3d057b。未将业务部署到主3080或内网。仅隔离候选3185生效。历史基线1a99227可恢复，未改原始gold。

## 实际改动

|文件与函数（27df227行号）|原缺陷|最终实现|
|---|---|---|
|api/server/services/SessionDocumentResources.js:21/29/72|历史文件恢复和正文加载耦合，仅恢复最近附件|请求级目录，user+conversation元数据查询、根文件所有权、ready/代际筛选、稳定document_id；内容调用才加载；每次执行及异步加载后复核|
|api/app/clients/BaseClient.js:2208 prepareSanSuoDocumentTools|关键词决定恢复；eager下载、检索、视觉影响工具注册|解析等待后发现当前及历史文档；原生能力解析；主Agent及agentConfigs绑定；注入目录而非正文；request-local Promise缓存|
|BaseClient.js:1621 buildSanSuoPreparsedFileTextContext|Word reading_pack可发现但没有可执行文档|兼容blocks及旧reading_pack；旧包保留原文、段落位置未知，不猜物理页；PDF仍用Repository|
|BaseClient.js:1921 describeImageWithVision|Word视觉由用户关键词预触发|同一read_parsed_docx工具的list_images/inspect_image；显式image_id/query；4次预算、60秒超时、parent signal；保留raw output和partial|
|BaseClient.js:2384 persistSanSuoDocumentReferences|Word图片与read_adjacent提前返回，未保存引用|统一deliver路径；缓存命中也保存版本化引用；只恢复匹配文档的引用|
|Endpoints/agents/documentReadContracts.js:6/16/73|运行时Zod与手写模型Schema漂移|Zod派生模型参数；稳定名称及原action；契约不含私有req或正文|
|Endpoints/agents/sansuoToolPolicy.js:116|兼容层可能重新加入原生已禁用execute_code|使用原生有效capabilities，不得恢复禁用工具；保留自动选择|
|Endpoints/agents/initialize.js:448|原生加载后兼容过滤能力不一致|传入resolveAgentCapabilities结果|
|ToolService.js:1257/1276|执行时只用req读取器，Agent作用域不明确|同时检查有效tools能力、原生Registry和当前agent.id绑定，再返回request-local handler|

新模块不是第二个Registry，不存全局用户状态。不新建MCP、LLM Server或检索引擎。Parser、Repository、Vector、RRF、Reranker、FITZ和Qwen服务保留。

## 删除与保留

BaseClient有效链路已删除 hasSanSuoFollowupFileIntent、hasSanSuoArtifactContinuationSignal、hasSanSuoPdfContentQuestion、getSanSuoRequestedPdfPages、isSanSuoWholePdfRequest、shouldBuildDocxVisualContext、shouldReviewPdfOriginalPage、isVisualDocumentFollowup、shouldRefreshVisualWithVL、extractRequestedVisualIndex、extractRequestedFileOrder 及其自动读取路径。固定自我介绍不改。结构化action/pages、ID、MIME、版本/权限、Keyword/BM25检索均保留。

DocumentVisualPolicy.canDeferPdfVisualPreparation仍保留旧query正则作为兼容导出，但api业务源码已无调用方（测试除外）。不能把死代码误报为仍触发VL。没有宣称所有历史补丁镜像、外部消费者或数据库Agent配置均已审计。

实际顺序：initialize定义加载 → BaseClient目录发现/绑定 → Graph接收toolDefinitions构建schema-only ToolNode → 模型自主调用 → ON_TOOL_EXECUTE → ToolService请求执行器 → 再授权/版本复核 → 惰性Repository/Word/Vision → 结果及引用保存。

已安装原生agents依赖Graph.ts的schema-only/event执行路径已核对；不需要绕过ToolNode。旧错误并不能证明那一轮schema已暴露：模型可从历史记住工具名称。

## 数据与边界

- 目录最多128份文档，每请求最多64次读取；同一请求同一文档共享加载Promise；失败后可重试加载。未跨请求共享私有Repository。
- 当前新附件先核所有权，初始会话重绑沿用现有helper；不会搬移另一已绑定会话的资源。
- source hash、artifact signature和解析代际变更拒绝旧快照；Word缺失source hash的旧产物只能依靠现有artifact签名，不能证明未更新元数据的底层字节变化。
- 读取器复用现有有作用域的词法/向量/视觉缓存。目录发现不下载正文、不重新MinerU或生成embedding。
- 目录有可读产物不保证远端Code API当前在线；下载失败返回DOCUMENT_RESOURCE_UNAVAILABLE，不伪装成功。

## 尚未通过的质量门槛

联合8组228项：212通过16失败，原始日志及逐项失败保留。16项集中在旧BaseClient eager正文/VL、ready flag及未提供user/conversation的夹具；5项基线已失败，11项在取消自动预读后不再满足。尚未完成全部旧测试向新契约的等价迁移，不能据新增测试通过认定无回归。

Word图片/旧reading_pack/相邻引用新增模拟测试通过；Word普通上传及无附件追问有真实HTTP，但Word图片最新变更尚无真实VL验收。多PDF+Word新旧共存的目录单元验证已有，完整多文件Agent攻击/越权矩阵不足。无效续读、自然连接故障、内网配置没有全覆盖。

zod-to-json-schema复用现有lockfile安装依赖，未新增包；当前为间接依赖，干净安装布局仍需专门核验。未做全仓lint/build。当前不满足最终A–G全部验收。
