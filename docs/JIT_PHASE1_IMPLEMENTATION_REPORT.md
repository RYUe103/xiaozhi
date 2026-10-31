审计/实施日期：2026-10-31。
实际源码目录：/Users/yooyoung/Documents/Codex/2026-05-12/files-mentioned-by-the-user-v58/LibreChat-main。
本阶段按 Phase 1A → 1B → 1C 完成最小侵入实施。未修改 MinerU、FITZ、VL 外部协议、ToolNode 对外 schema、数据库 schema，未迁移旧文件，未进入 Phase 2。

# JIT Phase 1 实施报告

## 修改文件

- api/server/services/DocumentArtifactAdapter.js：新增只读统一适配器。
- api/server/services/DocumentArtifactAdapter.spec.js：新增 7 项适配和安全边界测试。
- api/server/services/DocumentContextService.js：导出 Adapter；PDF section read 改按标题顺序和层级边界读取，无法确定边界时返回 warning。
- api/app/clients/BaseClient.js：visualIndex 读取前增加版本、根文件、会话和用户绑定校验。
- evidence/jit-phase1a-20261031：保存修改前快照、测试输出和 hash 证据。

## 新增能力

Adapter 将 MinerU、FITZ、VL 统一为 document record：

- extracted_text：MinerU chunks 或 FITZ get_text 文字层。
- visual_summary：VL metadata.visualIndex summary。
- ocr_text：保留为显式类型，但本阶段不把 FITZ 或 VL summary 归入 OCR。
- 每条记录含稳定 id、documentId、页范围、engine、sourceArtifact、sourceRecordId、metadata。
- 旧 chunk_id 可保留为 sourceRecordId；新 ID 使用稳定 SHA256 组成，不依赖数组索引。
- 无页码时保持 null，不补造页码。

页面覆盖模型同时报告 hasExtractedText、hasVisualPage、hasVisualSummary、textStatus、visualStatus、engines、warnings。纯扫描页可正确表示为文字层 empty、页图 available、VL summary pending/available。

## 读取和兼容

旧 _mineru_*、_visual_* 文件内容不被改写，也没有全量迁移。现有 DocumentContextService 和 ToolNode 接口保持不变。visualIndex 只有在 schema version 与当前根文件匹配时才进入当前聊天的视觉索引读取；查询本身仍由现有 userId + conversationId + rootSourceLibreFileId 范围完成。

PDF section read 现在按照当前标题块、下一个同级或更高层标题的记录边界读取，末尾章节返回 section_end_is_document_end warning。已有页、chunk、table、adjacent 接口保留。

## 未解决

VL summary 仍是视觉摘要，不是 OCR 全文；尚未写入普通 PDF chunks 或结构化 tables。复杂表格、公式、bbox、逐页质量检测、自动失败页降级和 source content hash 失效治理仍待后续阶段。现有 visualIndex 若缺少会话或用户字段会被标记 scope unknown，但不会因缺失字段自动伪造可信绑定。

本阶段未修改生产配置，不启动真实 VL 推理，不做历史文件迁移。
