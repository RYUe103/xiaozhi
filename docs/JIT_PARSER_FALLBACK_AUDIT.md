审计日期：2026-10-31。阶段：Phase 0.5，只读审计，完成后等待审阅。
真实源码根目录：/Users/yooyoung/Documents/Codex/2026-05-12/files-mentioned-by-the-user-v58/LibreChat-main。
证据分级：源码已确认＝追踪到执行调用；运行已确认＝本轮只读配置、哈希或探针；单测已通过＝依赖替身回归；未端到端验收＝真实服务和完整聊天流程未执行。本轮不改业务代码、数据库、运行配置，不新增依赖，不调用真实 VL。

# PDF 多解析引擎与降级审计

## 结论

FITZ + VL 是真实实现，但分属两个阶段。上传预解析优先 MinerU；异常时 FITZ 渲染整份 PDF 并提取原生文字层，保存页图、pages/chunks/manifest。聊天装载阶段再对页图分批调用真实 VL，摘要写入 Mongo metadata.visualIndex 并注入聊天。

当前没有形成“MinerU 或 VL 统一产物 → DocumentContextService”的完整闭环。FITZ 文字层 chunks 可复用 JIT；VL 摘要不回写 chunks。纯扫描页文字层为空，因此不能直接注册完整 JIT 正文文档。源码证据：api/app/clients/BaseClient.js 的 selectSanSuoPreparsedTextRecords、buildSanSuoPreparsedFileTextContext、persistSanSuoPdfVisualIndex；api/server/services/DocumentContextService.js 的 buildPdfDocument。

## MinerU 主解析

调用链：api/server/services/Files/process.js:972 上传入队 → api/server/services/Files/Code/process.js:1786 enqueueSanSuoDocumentPreparse → :1659 runSanSuoDocumentParseJob → :1037 preparseSanSuoPdfOnUpload → axios multipart /pdf_parse → :889 buildSanSuoMineruArtifacts → code-api 存储与 hidden record → finishSanSuoFileParseJob。

请求字段为 return_content_list=true、return_images=true、pdf_file；上传给 MinerU 的文件名被转成稳定 ASCII 名。Markdown 从 md_content、markdown、md 取值；content_list 支持数组或 JSON 字符串，文本字段支持 text/content/md/markdown/table_body/html/captions/image_caption/footnotes，页码支持 page/page_no/page_number/page_idx+1。Markdown 或 content_list 非空才可继续；非法对象/数组、全部为空分别是 invalid_mineru_response、empty_mineru_content。

产物为 _mineru.md、_mineru_chunks.jsonl、_mineru_content_list.json、_mineru_result.json、_profile.json、_smart_manifest.json，图片仅接受 base64。chunks 每段4500字符、重叠350；content_list 文本少于 Markdown 50%时改用 Markdown 重分块，未知页码不编造。这不是视觉降级。主路径只要 Markdown 或 chunks 任一保存成功就 ready；两者都没保存时直接返回 failed，不会进入异常 catch 的 FITZ fallback。

超时取解析参数和 SANSUO_MINERU_TIMEOUT_MS 的较小值；默认解析180000ms，本机 MinerU timeout 120000ms。axios 单次请求没有本地重试；ParseJob claim 默认最多3次，activeDocumentParses 和数据库 lease 做去重。请求携带 req._sansuoDocumentParseSignal，取消也可能进入 fallback；FITZ 子进程未接入该 signal。

## FITZ + VL 真实链路

上传 catch（process.js:1204）→ buildSanSuoPdfVisionFallbackArtifacts（:160）→ renderSanSuoPdfPages（:117）→ execFileAsync Python render_pages.py → api/server/services/Files/Pdf/render_pages.py:9 的 fitz.open、load_page、get_pixmap、save、get_text('text')。

FITZ 只做真实页面渲染和文字层提取，无 OCR、find_tables、公式结构、bbox。默认180dpi，限制96至240。整份 fallback 不传 pages，因此全页渲染；ensureSanSuoPdfPageArtifacts（process.js:281）支持指定页复核，但不是自动找出失败页的局部降级。Python 子进程有解析超时和 maxBuffer，无内部重试；单页异常使脚本失败。所有 pages 参数都无效时脚本会意外回退全页渲染。

fallback 产物：每页 _visual_page_0001.png、_visual_pages.jsonl、_visual_chunks.jsonl、_visual_manifest.json。visual_chunks 只写 FITZ 有文字层的页，reader=vision 这一字段容易误解，内容实际不是 VL OCR。上传 ready 要求 manifest 成功且全部页图保存；不要求 VL 已执行，也不要求 pages/chunks 保存。

聊天侧 api/app/clients/BaseClient.js:3343 buildSanSuoPreparsedPdfVisualContext 在有 visual manifest 后，调用 :2659 describePdfPageBatchWithVision，向 QWEN_BASE_URL/chat/completions 发送页图 base64、物理页号和 JSON 提示，默认 qwen3-vl-plus，最多20页一批。parseSanSuoPdfVisualBatch 要求每个输入页有非空 summary；每批成功写 :3254 persistSanSuoPdfVisualIndex。首次可能对全份缺摘要页建索引，即使用户只问第23页。摘要并非逐字 OCR、结构化表格或 LaTex 公式。VL fetch 无 AbortSignal、显式 timeout 或重试。缺配置时 helper 返回字符串，调用方访问 result.pages 会进入失败日志。

MinerU 成功但用户问页码、表格或版式时，shouldReviewPdfOriginalPage 触发原页 FITZ + describeImageWithVision，这是复核，不是自动替换主产物。

## 触发条件

已实现：连接不可达、ECONNABORTED 超时、HTTP 错误、非法响应、空正文、MinerU 未配置或优先开关关闭，在 fallback 开关开启且源 buffer 可用时进入整份 FITZ。聊天正文未解析或无 visual manifest 时另有补建入口，且该入口不检查上传 fallback 开关。

未实现：成功但乱码、非空占位、扫描页漏检、正文覆盖不足、表格/图片/公式不完整、按失败页自动降级和主备结果合并。content_list 稀疏只改 Markdown 分块，不触发 FITZ。文本产物全部存储失败是普通 failed return，也不触发 catch fallback。源文件下载失败无法 fallback。

## 错误、质量、幂等

有 parser、route、profile、manifest 和日志 reason，但 manifest fallback_reason 是 generic，JIT normalize 会丢 reader/engine 等字段。renderer 只有 ready，无页面 failed/ocr_empty 状态；VL metadata.complete 只表示摘要页覆盖。没有乱码、置信度、缺页、表格 cell、公式准确率阈值。ParseJob 只有 ready/failed，VL 批失败只记录日志并继续，可能出现视觉上下文 success 而没有完整摘要。页图分母按现存文件恢复，不严格校验 manifest 总页数。ParseJob 唯一键为 userId、libreFileId、parserVersion；VL 索引按用户、会话、根文件生成，但不绑定源内容 hash，且并发整数组覆盖有风险。

## 本机核对

证据见 evidence/jit-phase05-20261031/runtime-audit.json、regression.log、fitz-renderer-probe.json。运行镜像为 sansuo/librechat-current-local:20261031；MinerU 目标为本机 host bridge :5060，health service=sansuo-mineru-mock。默认 MinerU first/fallback 均开启；Python=/opt/sansuo-pdf-venv/bin/python，PyMuPDF 1.26.5；QWEN 配置只核对布尔存在，模型 qwen3-vl-plus。四个关键源码文件宿主/容器 hash 一致。3 个 Jest 套件 212/212 通过，但 MinerU、存储、DB、VL 使用替身。真实 renderer 探针确认电子页 text_chars=25、图片页 text_chars=0、页图非空；不代表 OCR 或 VL 通过。未执行真实 MinerU 质量、真实 VL、完整聊天或内网验收。
