审计日期：2026-10-31。阶段：Phase 0.5，只读审计，完成后等待审阅。
真实源码根目录：/Users/yooyoung/Documents/Codex/2026-05-12/files-mentioned-by-the-user-v58/LibreChat-main。
证据分级：源码已确认＝追踪到执行调用；运行已确认＝本轮只读配置、哈希或探针；单测已通过＝依赖替身回归；未端到端验收＝真实服务和完整聊天流程未执行。本轮不改业务代码、数据库、运行配置，不新增依赖，不调用真实 VL。

# PDF 解析产物与 DocumentContextService 兼容性

两条路线都复用 code-api storage 和 SanSuoFile 根文件关联；VL 索引直接在 Mongo metadata.visualIndex。能共同持久化，不代表有相同读取契约。

| 产物 | 当前字段 | JIT判断 |
|---|---|---|
| MinerU Markdown | _mineru.md | 可作为正文候选 |
| MinerU chunks | chunk_id、text、page_start/end、source | 可直接归一为 PDF records |
| FITZ chunks | 每个有文字层页一条，含 page_start/end、text、reader | 可读文字层；reader 等额外字段会丢失 |
| FITZ 扫描页 | 无文字 chunk，仅 PNG | 不能形成正常 JIT 正文 |
| VL visualIndex | version、model、pageCount、indexedPages、complete、pages[{page,summary,keywords}] | 当前不被 DocumentContextService 查询 |
| Tables | MinerU 可能有 table_body/html；FITZ 扁平文字；VL 只有摘要 | 只有 Markdown 管道表格被 extractTables 识别 |
| Images | MinerU base64 独立图；FITZ 全页图；VL 输入页图 | 可作视觉上下文，语义粒度不同 |
| Manifest/Profile | 主路线 smart_manifest/profile；fallback visual_manifest/pages | 没有统一 schema |
| 页码/定位 | 主路线可有页码；FITZ物理页；VL页号 | 能关联页，不能统一 bbox、表格单元格或公式位置 |

BaseClient.js:2255 只优先选 _mineru_chunks，否则 _visual_chunks，再选 _mineru.md 或 _mineru_content_list。正文非空才注册 buildPdfDocument。DocumentContextService.js:19 normalizePdfChunk 只接受 text/content/md 和页字段，:104 extractTables 只识别 Markdown pipe table。VL summary 没有 text/sourceChunkId/tableId/rows/cells，因此不能宣称全文 OCR 或结构化表格。

可直接复用：有效 MinerU chunks；有文字层的 FITZ chunks；页图可作视觉输入。不能直接复用：纯扫描页、VL visualIndex、复杂表格和公式。最小适配方向（未实施）：显式区分 text_layer/ocr_text/visual_summary，保留 engine/reason/page/status/quality/source hash/model version，并在通过真实质量验收后再接入统一 JIT。
