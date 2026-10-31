# JIT Phase 2 目标驱动架构计划：Keyword + BM25 + Vector + RRF

日期：2026-10-31。Phase 2 尚未实施。本计划建立在 Phase 1 复核发现“统一读取事实层尚未完成”的前提上。

## 阶段门槛

Phase 2 不应直接把当前视觉上下文或旧 chunks 建索引。先完成 Phase 1 补齐：

- Agent 工具能从统一 Repository 返回正文、视觉摘要、页面覆盖和来源。
- continuation token 已签名并绑定权限、版本和文档。
- 章节、表格、页码读取有真实端到端证据。
- visual_summary 与 extracted_text 分通道。
- 真实/隔离 MinerU、FITZ、VL 样本完成最小质量验收。

## 统一索引文档

索引单元应来自统一读取层的 DocumentRecord，而不是直接扫描 Mongo 或 code-api 文件：

- document_id、file_id、root_file_id、user_id、conversation_id。
- record_id、source_record_id、page_start、page_end。
- content_kind：extracted_text、ocr_text、visual_summary。
- parser_engine、source_artifact、parser_version、index_version、model_version。
- text、keywords、section_id、table_id、quality、coverage 状态。
- source_content_hash；无 hash 的历史记录标为 unknown，不能假定可复用。

## 检索通道

1. Keyword：先做标准化、中文分词/字符 n-gram、页码和标题字段匹配，保留精确数字和专有名词。
2. BM25：只对 extracted_text/ocr_text 主通道建立正文索引；visual_summary 建独立视觉通道，避免摘要覆盖正文排序。
3. Vector：只在真实 embedding 模型和维度、生命周期、权限过滤确认后建立；按 document_id、conversation_id、user_id 做强过滤。
4. RRF：对 Keyword、BM25、Vector 和可选视觉摘要通道做受控融合，保留各路 rank、score、source 和解释，不把融合结果伪装成单一解析置信度。

## 查询流程

用户问题 → 文档/会话授权过滤 → 查询解析（页码、章节、表格、数字、关键词）→ Keyword/BM25 并行 → Vector（若已配置）→ RRF → 返回候选记录及来源 → Repository 按 record_id/页码读取证据 → Agent 工具生成答案。

检索只负责找候选；正文、表格和视觉摘要必须回到 Repository 读取，避免索引内容成为未经授权的最终证据。

## 数据与迁移

- 新增逻辑索引集合/表前先做 explain、TTL、权限复合索引和 source hash 设计。
- 历史产物采用按需索引或隔离重建；不全量重解析。
- 先建立小规模 shadow index，和当前关键词读取结果并行评测，再逐步启用。
- 迁移必须可暂停、可重试、可审计；不删除旧产物。

## 评测

必须建立带标准答案的真实任务集，至少覆盖：文档发现、精确数字、指定页、章节后部、跨 chunk 表格、扫描页视觉摘要、混合页、跨会话权限、预算和 continuation。

指标分开统计：

- 检索：Recall@K、Precision@K、MRR、nDCG。
- 证据交付：页码正确率、record 命中率、source binding 正确率、续读成功率。
- 解析：文字/数字准确率、表格结构准确率、视觉摘要覆盖率。
- 系统：延迟、token、VL 调用次数、失败和 partial 比例。

不能用合成适配器 282 项基线替代真实 Agent 任务验收。

## 实施顺序

Phase 2A：统一 Repository、record/page/table envelope、安全 continuation token和真实 read_parsed_pdf 端到端。
Phase 2B：Keyword + BM25 shadow index、权限过滤、增量更新、评测。
Phase 2C：Vector 接入和维度/模型版本治理。
Phase 2D：RRF 融合、解释字段、预算控制和回退策略。

当前停在重新审视阶段，不启动 Phase 2A 代码，等待用户确认或新的实施指令。
