# JIT Phase 0 审计后的实施计划

本文件是审计结论，不是本阶段实施授权。按照任务书，Phase 0 完成后暂停，等待审阅。

## Phase 1：读取层与引用安全

1. 在现有 `DocumentContextService` 外增加 Resolver/Reader 适配层，保持 MinerU/Mammoth 产物格式和旧 ID 兼容。
2. 把章节读取改为真实标题到下一同级/上级标题范围；PDF 支持 page/chunk/range，Word 支持 paragraph/block。
3. 建立表格聚合器：跨 PDF chunk/page 识别连续表格；Word 保留单元格关系；无法可靠恢复则返回 warning/incomplete。
4. 用签名 continuation token 绑定 user、conversation、document、version、target、offset、过期时间；每次读取重新校验权限、存在性和 parser version。
5. 统一 `{ok,data,source,warnings,error}` 结果，同时保留旧工具历史 reference 的兼容读取。

## Phase 2：检索对照实验

1. 先保留当前关键词作为 A 基线，新增 QueryProcessor 的中文词项/术语/数字单位抽取。
2. 使用匿名真实文档评测 Keyword、BM25、Vector、Hybrid/RRF；不在评测前直接引入新依赖。
3. 若复用原生 pgvector，必须新增 JIT 范围和版本 metadata，确认上传/重解析/删除同步；不能直接复用 `file_search` 的 file_id 查询。
4. CandidateRanker 处理标题/目录/页眉重复、精确型号/标准号、相邻块去重。

## Phase 3：工具拆分与替换

对 Agent 暴露 `list_documents`, `document_info`, `document_toc`, `document_search`, `document_read`, `document_read_table`, `document_read_adjacent`。每个工具只做 Schema + trusted context + service 调用；旧聚合工具停止对外注册前，先完成历史引用兼容。

## Phase 4：页面视觉核验

复用已有 `ensureSanSuoPdfPageArtifacts` 和渲染脚本，新增 document_id/page_number resolver、范围校验、受控图片引用和失败错误，不暴露路径。

## Phase 5：端到端与性能

保留前轮 282 个合成基线；补真实匿名文档和 Agent ToolNode 链路，覆盖权限、版本变化、未就绪、OCR 异常、跨页表格、连续追问，分别记录候选召回、正文交付、引用、工具成功和模型回答 grounding。

## 变更前保护与回滚

- 业务代码现有 HEAD `8f2984c`，且工作区有大量既有修改；不得 reset/clean/提交。
- Phase 0 快照：`evidence/jit-phase0-20261031/tracked-code-before.json`、`git-status-before.txt`、`TASK-before-source.md`、`TASK-before-memory.md`。
- 实施前需另建日期备份并核对实际 Docker bind mounts；修改后运行服务回归并核对宿主/容器 hash。
- 回滚只恢复本阶段明确修改文件，不覆盖其他未提交改动、用户数据、Mongo、code-api storage 或 `.env`。

## 按现有入口的最小改造清单（待后续阶段授权）

| 阶段 | 优先修改入口 | 目的/验收 |
|---|---|---|
| 1 | DocumentContextService 及同目录读取/解析适配模块；BaseClient 的装载入口；SanSuoFile 只增所需版本映射 | 复用现有产物，在无正文预注入时也能装载文档清单；逐次 ACL，source deleted 拒绝；正文分页无遗漏/重复 |
| 1 | 文档引用/游标模块、相关 spec | 统一 doc/version/target；篡改、过期、换用户/会话/文档/目标/版本全部拒绝；恢复历史 reference 不作为授权 |
| 2 | 共享 QueryProcessor 与检索适配；RAG 后端受控 API（若采用） | 保留精确标识与旧关键词模式；四模式独立、RRF 可复现、中文改善；不混知识库 |
| 3 | sansuoToolPolicy.js、ToolService.js、BaseClient.js、handleTools 源码/实际 patch、测试 | 七个工具替换两个旧接口；执行经原生 ToolNode；旧消息 reference 兼容，新旧 Schema 不同时暴露 |
| 4 | 已有 render_pages.py/ensureSanSuoPdfPageArtifacts 与 resolver | 复用页渲染；越界页拒绝、失败返回明确错误、受控图片引用，不接受路径 |
| 5 | scripts/evaluation/document-jit、现有 service/策略/集成测试 | 固定样本/标准答案，新旧结果并列；加入完整 Agent 权限/续读/跨轮/Token/时延 |

Resolver 初版可以用现有 SanSuoFile/ParseJob 作为 Registry 来源，不必先建平行数据库。给现有 parsed artifact snapshot 计算版本摘要，可兼容历史数据；具体字段/索引方案在 Phase 1 设计验证后确定，不能仅用硬编码 parserVersion 充当内容版本。

Continuation token 的签名或 opaque server-state 是待 Phase 1 评估选择，不要求新 JWT 系统；必须绑定可信上下文和版本/目标、验证篡改/过期，并使用现有安全密钥管理方式或受控持久状态，不在源码硬编码密钥。

跨块表格只在结构证据充分时拼接，优先 content_list 原始表格结构/相邻页连续信息；无法恢复的历史产物明确 incomplete+warning，必要时 Phase 4 视觉核验，不默认重跑 MinerU。若验收要求“所有历史表格无重解析完全恢复”，需要说明信息缺失情况下无法保证。

## 检索选型门槛与待确认项

- BM25 索引应绑定 artifact version、文档/用户/会话范围，验证中文分词与离线部署；SQLite FTS5、现有搜索服务等都只作为候选，当前不拍板。
- 原生 RAG 外部镜像中的 API 目前没有 JIT chunk ingestion/version filter；复用需要受控扩展，不能只改前端或换工具名。没有真实 embedding 维度/可用性验证前不创建最终索引 schema。
- Phase 2 引入依赖前先列现有可复用能力和对照评测，不随意安装新依赖。本机验证不代替内网验证，离线包/模型/架构另验。
- 若没有 embedding 服务，vector/hybrid 必须明确 unavailable/degraded，不能把 keyword 结果冒称 vector 成功。

每阶段提交可审阅变更、对应测试、未验项和回滚步骤；按照用户任务书逐阶段确认后再继续。目前 Phase 0 完成后停止。
