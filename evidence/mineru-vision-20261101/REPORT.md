# 真实验收与失败记录（2026-11-01）

代码基线/远端分支为 ff2304f；未改原100题gold、历史评分或失败。A是独立ff2304f API，B2–B6是分别保留的开发快照；B6只做两题定点回归，不能把各批最好答案拼成一轮“通过率”。编码Agent自行对照原gold和原页，不是独立人工盲评。

## 实际结果

| 冻结题目 | A / ff2304f | B5（向量预算修复前） | B6（最新定点） |
| --- | --- | --- | --- |
| 财务图例 ohr:acb5…，Gray at 1% | 无原图，仅计算1.37%，失败 | 原页VL得到1%及Licenses/Permits，但颜色pink，不符合原gold | 未重跑 |
| 学术海报 ohr:aacc…，2016-17 T3 | 拒答，失败 | 自动inspect_page已调用，VISION_INSPECTION_FAILED，未给正确答案 | 未重跑 |
| 论文表II mml:80 | PopQA/MS MARCO/SST-2，匹配 | 正确，合并行不再误纳入NQ | 未重跑 |
| 论文树图 mml:76 | 核心Pre-training匹配；附加计数无原图支持 | VL超时，主模型Connection error，无最终答案 | 未重跑 |
| Netflix mml:1021 | 1902216千美元，匹配 | 1902216千美元，匹配；引用另一处重复财务表，页17 | 未重跑 |
| phone mml:888 | 正确指出文档30页，无法回答40–47页 | 主模型Connection error，无最终答案 | 正确指出仅30页 |
| 91页扫描件 xhop_0 | 原百题已确认遗漏评价/互融事实，保留原失败；未纳入新A六题分母 | 自动定位81页，核心答案符合gold，0次VL | 自动定位并读81页，核心答案符合gold，0次VL |

固定共同六题核心答案匹配：A=4/6，B2=2/6，B3=3/6，B5=2/6（含2题主模型连接失败）。A的树图附加数量不可靠，因此4/6不代表四份答复完全无事实问题。B5另加扫描题1/1；B6定点2/2，均不能外推全100题准确率。财务原页图例色块与冻结Gray标注存在分歧，仍严格保留不通过，不改gold。原图可在本机geometry-finance/page2.png复核。

## 原页链路

B5财务：真实HTTP上传→云端认证任务/data_id→完整ZIP/派生产物持久化→Repository检索→Agent选物理2页→read_parsed_pdf(action=inspect_page)→FITZ原页渲染→真实Qwen3-VL→最终答案与original_pdf_page引用保存。初答88.544s；2次文档工具；1次成功VL，23.140s、4386 tokens。追问38.284s，DocumentReferenceRestored事件与保存引用可核对。初答没有由测试程序注入页码。

B6扫描件：上传约1.219s；云端180.337s（创建0.574、上传16.983、排队/解析轮询145.196、下载13.526、转换4.057）；产物构建0.207s、存储0.854s、解析任务182.463s；首次完整答复256.946s，1次文档工具，0次VL。云端耗时与解析任务/回答耗时是包含关系，不可相加。

B5→B6向量冷索引：16.108s/40次后预算失败/0候选 → 9.429s/75次累计请求/30候选。后续两查询0.709s、0.646s复用索引，累计77次、49269 embedding tokens。未删正文或限制到gold页；完整候选仍进入RRF与重排。

B6首次EvidenceDelivery页列表含81、65两处原标注页；Agent随后读81页。B5后续专门查社区活动时65页降到重排第16位并被top6截去，但首轮注入已覆盖65/81。故不能只凭最后一次工具结果断言跨页证据全漏。另有Vector预算失败、图表无正文/摘要、表格合并元数据被预算移除等不同阶段故障，分别记录并修复。

## 分开统计

- 解析成功率：最初真实资产批次5/6，扫描件独立失败重试后六份均有成功资产；不能称首次6/6。全文OCR准确率、全表格单元格准确率和公式准确率没有足够独立gold，未提供虚假百分比。
- 精确片段：扫描题三条原始文字标注共266个规范化字符在真实MinerU OCR中全部找到（3/3）；B5实际Tool输出包含其中两条（2/3），首轮注入仅有页级追踪，没有逐字快照，不能称整体片段召回率。详见scan-annotation-coverage.json和scan-tool-fragment-coverage.json。
- 离线六文档24题中21题有页标注，Keyword/BM25/RRF宏平均页召回78.57%；不包括Vector、重排和Agent，不能冒充精确片段召回。
- 最终答案：以上逐题表及answer-adjudications.json；原始回答/Tool输出全部保留。格式status=ok不等于事实正确。
- 视觉调用：成功返回与usage可核实；失败尝试缺usage时视为未知，不能当0 tokens。ab-run-summary.json区分PageVision尝试、确认响应、缺usage与缓存事件。当前成功运行没有实际VL结果缓存命中证据，持久缓存/隔离/失效已通过单测。

## 延迟（毫秒，nearest-rank，小样本）

| 对照 | N | P50 | P95 | 解释 |
| --- | ---: | ---: | ---: | --- |
| A共同六题 | 6 | 128237 | 154007 | 含错误答案 |
| B2共同六题 | 6 | 106654 | 181204 | 含失败 |
| B5共同六题 | 6 | 117867 | 374623 | 含网络失败及08:58–09:00宿主睡眠，不能证明尾延迟改善 |
| B6定点两题 | 2 | 85649 | 256946 | 样本构成不同，不与上表作总体优劣比较 |

B6普通phone首答85.649s，A为74.652s；Netflix B5为165.176s，A为138.958s。单次数据不能证明普通文字PDF无明显退化，本项未验收通过。扫描件B5 292.992s→B6 256.946s，仅为两次开发运行，不是稳定P95或对历史475s全页VL的严格同环境提速结论。宿主睡眠和网络故障记录保留。

## 回归、来源与可部署性

14组270项单测通过，覆盖ZIP/SSRF/路径/资源限额/图片映射/源绑定、结构块、合并表格、partial与缓存/权限、PDF上下文、检索与向量等。真实HTTP普通聊天、合成Word17天、外用户消息隔离通过（live-regression.json）；不是完整生产权限矩阵或真实复杂Word验证。

最终源码/测试脚本语法与git diff检查通过。隔离3183/3184测试API已停止，数据库与资产保留。实际3080服务、内网服务和.env未替换；没有提交推送。

**本轮不是全部目标验收通过，尚不可直接部署内网生产。** 未完成：全100题新批次、模型连接故障恢复的可靠验收、图例/小字/公式全面内容准确率、真实源更新/部分失败完整HTTP矩阵、跨进程渲染互斥、混合PDF缺页/同页局部缺失的真实融合验收、旋转坐标协议认证、全负载内存峰值与普通文字稳定P50/P95非退化。

## 文件导航

- ab-run-summary.json：逐运行答案、耗时、工具/VL及阶段指标；answer-adjudications.json：原gold对照说明。
- candidate/、baseline/：独立结果、失败日志、脱敏事件。batch4-interruption.json记录主动停止的旧快照。
- parse-stage-timings.json、agent-provenance/：云端/持久化分段时间与来源链。
- frozen-question-subset.json、historical-100-selected-results.json、integrity.json：原题/答案与旧失败、gold一致性。
- source-final5.json、source-final6.json：运行源码hash。B6之后只整理测试报告脚本与文档，业务源码不再改变。
- raw-assets-inventory.json：大型原ZIP/result的本机位置、长度及SHA；仓库不重复分发PDF/大体积Base64。
- provider-pdf-reserialization.json、source-review-corrections.json：来源PDF重写及本轮原页复核；旧记录保持原样。

本机完整原资产目录：/Users/yooyoung/Documents/ChatGPT/三所小智/evidence/mineru-vision-20261101。仓库副本仅包含必要脱敏证据。统计脚本接受该独立运行目录，不能向旧百题目录输出。
