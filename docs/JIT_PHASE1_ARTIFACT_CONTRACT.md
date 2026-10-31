审计/实施日期：2026-10-31。
实际源码目录：/Users/yooyoung/Documents/Codex/2026-05-12/files-mentioned-by-the-user-v58/LibreChat-main。
本阶段按 Phase 1A → 1B → 1C 完成最小侵入实施。未修改 MinerU、FITZ、VL 外部协议、ToolNode 对外 schema、数据库 schema，未迁移旧文件，未进入 Phase 2。

# JIT Phase 1 统一产物契约

## Record

字段：id、documentId、pageStart、pageEnd、kind、text、engine、sourceArtifact、sourceRecordId、sectionId、tableId、blockId、metadata。

kind：
- extracted_text：MinerU 已返回正文，或 FITZ 原生文字层。
- visual_summary：VL 页摘要。
- ocr_text：只有未来有明确 OCR 全文证据时才能使用。

engine：mineru、fitz、vl、legacy、unknown。历史 reader=vision 不能单独证明 VL 或 OCR。

## Page coverage

每页字段：page、hasExtractedText、hasVisualPage、hasVisualSummary、textStatus、visualStatus、engines、warnings。

textStatus：available、empty、unavailable、unknown。
visualStatus：available、pending、failed、unavailable、unknown。

pageCount 来自可信 manifest 或 visualIndex；没有可信页码时不推断。覆盖数量不等于正文完整性。

## ID 与版本

documentId 继续沿用现有 userId + fileId 稳定计算。Adapter 新 record ID 使用 documentId、源记录 ID、kind、engine、页范围和文本指纹。visualIndex 读取要求版本匹配；根文件、用户、会话由现有数据库查询和新增校验共同约束。旧产物按读时转换，不改写原文件。

## 错误边界

Adapter 不把缺摘要、无文字层、缺页图和版本不符合并成 not_found。调用方可根据 warnings 区分 visual_summary_unavailable、page_text_unavailable、visual_index_version_mismatch、visual_index_source_mismatch 等状态。旧 Service 对外返回格式保持兼容。
