审计/实施日期：2026-10-31。
实际源码目录：/Users/yooyoung/Documents/Codex/2026-05-12/files-mentioned-by-the-user-v58/LibreChat-main。
本阶段按 Phase 1A → 1B → 1C 完成最小侵入实施。未修改 MinerU、FITZ、VL 外部协议、ToolNode 对外 schema、数据库 schema，未迁移旧文件，未进入 Phase 2。

# JIT Phase 2 就绪评估

当前可以为后续检索设计提供稳定字段：documentId、fileId、pageStart/pageEnd、record id、kind、engine、sourceArtifact、sourceRecordId、文本和页面覆盖状态。

进入 Keyword/BM25/Vector/RRF 前仍需补齐：

- 真实样本和标注相关页/块。
- source content hash、parser version、model version 的失效策略。
- visual_summary 与 extracted_text 分开索引或分通道召回。
- 复杂表格、公式、扫描页 OCR 的真实质量边界。
- 页面缺失、VL partial、并发索引更新的状态治理。
- 真实 MinerU/VL 服务和内网端到端证据。

建议下一阶段先做小规模、可重复的 keyword/BM25 评测基线。visual_summary 进入独立视觉摘要通道，不与正文 OCR 或结构化表格混合。Vector、RRF 和大规模历史索引暂不在本阶段实施。

Phase 2 未启动。
