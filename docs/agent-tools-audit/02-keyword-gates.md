# 自然语言业务门控

> 以下保留实施前检查点，基于 1a99227；不代表最新状态。实施与实测结论见 07、08 和独立 evidence 目录。
以下行号基于 1a99227。全部仍是基线代码；局部删门控试验已撤回。

|函数/位置|调用路径|实际行为|决定|
|---|---|---|---|
|hasSanSuoFollowupFileIntent:1389|continuation helper|继续/再看/它等匹配|随恢复门控移除|
|hasSanSuoArtifactContinuationSignal:1399|sendMessage:4472|恢复最近附件/全文装配|换成授权会话目录发现|
|hasSanSuoPdfContentQuestion:1449|sendMessage:4473|同上|移除|
|getSanSuoRequestedPdfPages:1876|:2240/:3083/:3303|自然语言页码触发提前 read/视觉页选取|移除自动调用路径；保留结构化工具 pages 参数验证|
|isSanSuoWholePdfRequest:1892|:1757/:2241/:3089|总结/全文触发 overview 或分散选段|移除预路由；overview 能力由工具契约承担|
|shouldBuildDocxVisualContext:279|:2651/:2815|图片词触发 DOCX 图下载和 VL|替换为显式按需图像读取机制，不能仅删判断后无条件执行|
|shouldReviewPdfOriginalPage:296|:3224/:3598|原页/核对/表格等触发 fallback 视觉|撤出自动执行路径，保留 inspect_page|
|isVisualDocumentFollowup:306|:549/:578/:4432/:4551|历史视觉记录恢复与提示注入|目录/明确引用恢复替代，不把旧证据自动视为新答案|
|shouldRefreshVisualWithVL:312|:1263|重新看/逐字等触发真实 VL|移除自动执行|
|extractRequestedVisualIndex:647|:289/:317/:702/:2702/:4544|从自然语言选择图片|不能控制工具暴露或调用|
|extractRequestedFileOrder:670|:317/:693|选第几个文件|由稳定 document_id 代替后端猜测|
|shouldExposeDocumentImage:286|视觉后续路径|展示图像|需审查结构化工具返回/展示替代|
|DocumentVisualPolicy:7|canDeferPdfVisualPreparation|视觉词影响 eager VL 路径|资源质量规则保留，文本意图路径移除|

DocumentQueryProcessor 的查询改写、数字保真过滤属于检索；Keyword/BM25、MIME/扩展名、权限、source hash、schema 与结构化页码验证保留。固定自我介绍保留。尚需全量检查其他业务 includes/startsWith/意图分类，不能将本表称全量完成。

注意：自然语言“第X页”驱动自动预读与工具显式参数 pages=[X] 完全不同。此前草稿将二者混同，已被本表替代。
