审计日期：2026-10-31。阶段：Phase 0.5，只读审计，完成后等待审阅。
真实源码根目录：/Users/yooyoung/Documents/Codex/2026-05-12/files-mentioned-by-the-user-v58/LibreChat-main。
证据分级：源码已确认＝追踪到执行调用；运行已确认＝本轮只读配置、哈希或探针；单测已通过＝依赖替身回归；未端到端验收＝真实服务和完整聊天流程未执行。本轮不改业务代码、数据库、运行配置，不新增依赖，不调用真实 VL。

# PDF 主解析与备用路线实际流程

流程：上传 → ParseJob claim → 下载源PDF → MinerU优先且URL有效？→ POST /pdf_parse → 响应合法且正文非空？→ 构造 Markdown/chunks → 保存正文产物 → ParseJob ready。连接、超时、HTTP、非法响应、空正文会进入“fallback开启且有源buffer？”判断；满足后真实 FITZ 全页渲染，保存页图、pages、chunks、manifest，manifest与全部页图成功才上传路径 ready。源下载失败、文本产物全保存失败的普通返回不会自动进入同一 fallback 分支。

ready 后聊天先读取 _mineru_chunks 或 _visual_chunks，正文非空才注册 buildPdfDocument；若有 visual manifest，则按最多20页调用真实 VL 建 Mongo visualIndex，再按问题选择摘要和原页复核。无 manifest 但有视觉意图时，按指定页渲染并单图 VL。ParseJob ready 不等于 VL 成功；门禁等待超时不是 VL 全链路超时。

调用链索引：
- 上传：api/server/services/Files/process.js:972 → Code/process.js:1786。
- 主解析：Code/process.js:1659、1037、889。
- FITZ：Code/process.js:1204、160、117 → Files/Pdf/render_pages.py:9。
- 持久化：Code/process.js:232。
- 正文 JIT：BaseClient.js:5891、2290 → DocumentContextService.js:130。
- 聊天补建：Code/process.js:380 → BaseClient.js:3343。
- VL：BaseClient.js:2659、2725、3254。
- 原页复核：Code/process.js:281 → BaseClient.js:2530。

三种时序：
1. 电子 PDF 主路径成功：MinerU → chunks/Markdown → JIT；视觉问题另做复核。
2. 主服务失败：MinerU 异常 → FITZ 全页 → ready → 聊天 VL 分批 → visualIndex；有文字层页可进 JIT，纯扫描页无正文 chunks。
3. 主服务非空但漏扫描页：代码没有文字密度或页覆盖检测，因此不会自动 fallback。

未实现的连线：MinerU逐页质量报告→失败页FITZ/VL→合并；VL summary→统一chunks/tables；VL全失败→统一ParseJob failed；manifest总页数→严格complete校验。
