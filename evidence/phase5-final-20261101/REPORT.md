# Phase 5 最终优化验收（2026-11-01）

## 当前结论

**不达到生产部署门槛。** 真实重复测试没有证明总体准确率/速度优于基线。已经定位并修复三个工程问题：无定位的 `read+query` 被误当空页；原地更改解析代际/版本/完成状态未使已加载资产绑定失效；长文档 FITZ 布局 JSON 超过 stdout 1 MiB。视觉模型仍会自信地错误计数/错绑图例。自动追加局部视觉核查在真实海报上没有收益，已撤回，保留实验补丁和原始结果。已有流式失败分类在自然网络中断时生效，但不能恢复已交付流，也不能保证供应商网络稳定。

## 版本、环境与证据边界

- 分支 `codex/pdf-page-vision-wip-20261031`；开始时本地/SSH远端 HEAD `0730dedf00de985753e6ee70f1b09d5348b1396f`。本轮不自动提交、推送或部署。
- 基线实际业务文件匹配 `f345e17`；r5候选匹配前轮 v7 快照，逐文件校验见 `runtime-source-check.json`。r6候选为 HEAD+`r6-source.json` 列出的改动；最终源码另见 `final-source.json`，不能把 r6 成绩当成最终源码成绩。
- 独立候选3185/基线3186，code-api5057/5058，各自 Phase5 Mongo；同一容器共享算力和外部模型/解析服务，HTTP回归曾与r6重叠。此环境不能做稳定SLA归因。
- 主模型 qwen3.6-plus、VL qwen3-vl-plus；固定原100题子集及PDF SHA见 `frozen-question-subset.json` 和逐题JSON。统一追加物理页引用要求，不传gold或答案页。云端仅使用许可公开测试PDF；普通文件回归为明确标记的合成兼容性夹具。
- 旧 `evidence/phase5-20261101/`、100题gold和失败记录未修改。r5原结果已存在，核实后复制，未重新付费跑r5。r6两臂独立运行，无跨批最佳答案拼接。
- 原始题级回答/工具输出：`baseline/r5|r6`、`candidate/r5|r6`。脱敏事件、阶段耗时、任务状态在两臂对应目录。`summary.json` 是描述统计，`retrieval-metrics.json` 是逐检索通道诊断。

## r5逐题核查

| 题 | 基线核心gold | 候选核心gold | 根因与附加事实 |
|---|---|---|---|
| phone | 对 | 对 | 文件仅30页，问题要求40–47页，明确不可回答是正确行为 |
| finance | 不匹配 | 不匹配 | frozen gold为Gray/1%；源图图例为粉橙色，保留争议，不改gold；候选VL错绑深红且把partial当确定 |
| academic | 错 | 错 | 基线在VL之前图片解码失败后谎称图不存在；候选把学年轴标签读成月份，错误来自视觉事实 |
| tree | 对 | 对 | 核心Pre-training对，附加数量错；橙色分支实际5标签，不能将核心命中当整答正确 |
| table | 对 | 对 | PopQA、MS MARCO、SST-2；合并行表格证据可用 |
| netflix | 对 | 对 | 1,902,216千美元；物理17页也是有效重复财务表，不能仅因gold43页判引用错 |
| scan | 对（附加细节待复核） | 错 | 候选`read`仅query无selector，返回PAGE_TEXT_UNAVAILABLE后错误说文档没评价，属于证据读取/利用B类 |

核心匹配基线5/7、候选4/7；完成均7/7。此为Codex对原页和工具的审阅，**不是独立人工盲审**；不以关键词命中替代整答正确。逐项附加错误/待核实见 `r5-adjudications.json`。

r5 P50/P95：基线99.171/228.078s，候选80.639/287.586s；r4为125.115/294.569s与125.177/281.000s。P95方向不一致，不能宣称稳定提升。r5扫描候选287.586s中MinerU181.681s，基线228.078s中MinerU143.658s。主模型Token日志分别至少140067/64777，VL12250/13167；部分直答没有ModelEnd事件，未知Token不能算零成本。

## 为什么答错：按失败阶段区分

- A：无可靠OCR时，基线r6扫描件MinerU失败→FITZ无正文→搜索没有目标证据；Agent乱选多页看图仍遗漏81页。不能要求BM25凭空找出未解析文字。
- B：r5候选扫描`read(query)`没有页/块定位，被执行为读取空页。修复入口归一化后调用原异步search，沿用QueryProcessor/Keyword/BM25/Vector/RRF/Reranker，不新增检索引擎。明确页码的read及continuation不被改写。
- B：视觉partial或失败被最终模型扩展成“全文不存在”；这是证据利用错误，不能把失败输出当OCR缺失的证明。
- C：树图已交付正确原始页，VL仍输出不存在的叶节点数量；`status=ok`仅代表解析完整，assessment明确not_independently_verified。schema不能验证事实。
- C：海报局部视觉读错学年，财务颜色/扇区绑定错，附加解释引入错误数字。仅增加提示词约束未解决。
- 基线r6论文表格已检索并交付，主模型流中断：属于传输失败，不是检索召回失败。

逐通道top-k物理页召回和冻结原文片段匹配见 `retrieval-metrics.json`。页召回不是片段充分性；精确片段匹配会漏等价OCR；无工具直答的预注入证据未覆盖完整追踪，不伪报召回率。

## 实际保留的代码修复

| 文件/函数/行 | 缺陷及修复 | 验证 |
|---|---|---|
| `api/server/services/DocumentArtifactRepository.js:317` `executeAsync` | 无selector的read+query转原search，防止上一引用误导和假空页 | 真实r5复现；Repository测试验证旧引用不会劫持、明确page仍保留语义 |
| `api/server/services/Files/Code/process.js:117` `renderSanSuoPdfPages` | 布局不走1MiB stdout；使用私有临时JSON、读取前64MiB上限、保留诊断stdout上限与finally清理 | r6基线Netflix三次解析失败记录；真实72页布局1,720,582bytes、1434块、300805字，17页Working capital可见 |
| `api/server/services/Files/Pdf/render_pages.py:17` `main` | 新增`--result-json`，临时文件写完再rename；旧stdout调用兼容 | 原真实PDF与原renderer结果比较；合成>1MiB回归验证实际父进程消费 |
| `api/server/services/ModelTransportReliability.spec.js` | 补流体期间用户取消/内部deadline不重放测试 | 区分MODEL_CANCELLED/MODEL_TIMEOUT；已有503/429/重试预算/中断用例 |
| `scripts/evaluation/document-jit/run-phase5-regression.cjs` | CSV错误字符串曾被truthy当成功；新增实际输出检查、Word追问及Excel | http-r1假阳性保留并明确失效；http-r3有真实CSV stdout及正确答案 |
| `run-phase5-fault.cjs` | 工具必须成功输出；null content安全处理 | 保留失败r1/r2，不再以模型自行算对当工具成功 |
| `phase5-live-cache.cjs` | 补真实删除/撤权/源hash变化/失败产物/用户会话隔离，失败返回非零 | cache-r1.json，8项真实持久化工具级检查 |
| `summarize-phase5.py` | 解析失败文本/active不能算完成 | 基线Netflix解析失败不计完成 |

### 撤回的视觉实验

`r6-visual-experiment.patch` 保存完整代码和测试，`experiment-decision.json`记录原因。仅在partial+明确region时追加一次原页+高清局部VL，确实在academic触发；追加16877ms/5852tokens，结果错误写2015-16 T1。最终模型虽提及T3，仍给错误数量并回避明确结论。tree仍报3/14/20，不是事实修复。撤回自动追加调用与未证实有效的提示改动，恢复v7；保留原有显式`inspect_page.region`，不引入第二视觉系统。

## 稳定性、回归和权限

- 自然中断：r6基线table无最终文本且error=false、error part为terminated；候选table保留部分文本并明确MODEL_NETWORK_ERROR/error=true，不能算完成。说明失败标注改善，**不说明连接已稳定**。
- 注入403：`deny.json`明确MODEL_AUTH_REJECTED，error=true，无工具；不得重试永久认证错误。
- 注入reset_once旧记录证明首字节前重试发生，但工具因为环境不可达失败，不能证明完整恢复成功；`reset-once-r2.json`还保留harness空content异常。
- HTTP回归 `http-r3.json`：聊天8.344s、Word5.232s、Word无重附追问3.196s、CSV实际execute_code39.114s、Excel15.406s及外用户消息隔离通过。都是合成兼容性文件，不是复杂PDF准确率。
- 隔离code-api最初误用容器loopback8090。仅测试服务改用宿主端点，并对动态sandbox返回loopback做隔离映射，详情`environment-corrections.json`；未改生产.env或部署配置。
- `cache-r1.json`：真实视觉持久缓存命中，0图像读取/0VL；撤权、源hash变化、实际删除根文件、产物failed均拒绝；外用户和外会话没有记录；全部变更finally恢复。
- 同一359块文档向量首调用1次、第二次0次；两次合计1040ms，第二次215ms。不是冷库首次建索引指标；视觉缓存正确不保证缓存里的事实正确（tree的错误数量仍存在）。
- 最终15组257项测试通过，见`final-tests-r2.log`（此前256项保留在`final-tests.log`）；前轮303项、历史Agent client失败保留，不能直接加总成新验收数。

## 性能与部署缺口

r6云端失败/排队明显：基线scan解析355.448s后fallback，最终897.429s；候选Netflix第一次89.700s失败、第二次125.964s成功，首答228.852s。解析与模型耗时必须分开。表格候选MinerU78.401s，基线34.941s；产物构建/保存通常毫秒至数百毫秒，不能把主要瓶颈归结为Repository。

已解析文档追问（r6）：phone两臂13.835/13.741s；candidate Netflix12.384s。新上传首答含解析，不能与这些热问答混算。向量缓存及视觉缓存见独立工具级证据；未完成相同最终源码下、全部冷热路径独立重复的HTTP性能矩阵。

尚未通过：视觉事实可靠性、最终版本完整A/B、普通文件同基线完整对照、真实内容替换/解析版本更新后端到端重建恢复、所有真实HTTP取消/空答/超时注入、自然网络恢复成功率、全100题。解析阶段供应商仅暴露有限状态，不能可靠拆分内部排队和推理。样本少且服务抖动/并行测试影响明显，不给SLA承诺。

因此停止扩展付费评测；先稳定外部解析/模型连接，再用固定开发子集验证视觉事实策略。不要通过扩大调用或修改gold让报告变好。本轮可部署性结论为**未通过**。

## r6完整逐题结果（独立批次）

|题|基线完成/核心|候选完成/核心|基线/候选秒|主要说明|
|---|---|---|---|---|
|phone|是/对|是/对|102.304/158.894|无40–47页，正确不可回答|
|finance|是/错/未完成|是/错/未完成|79.590/146.503|VL60秒超时，改按表计算1.37%，遗漏颜色|
|academic|是/错/未完成|是/错/未完成|50.462/211.281|提及T3但最终无法确认；两次VL年份冲突且附加数字错，不判通过|
|tree|是/对|是/对|99.180/131.339|核心正确，VL误数橙色3，实际5|
|table|否/错/未完成|否/错/未完成|157.696/259.938|已有核心正确片段但流中断，error=true，不计完成或准确|
|netflix|否/错/未完成|是/对|182.418/228.852|首次解析失败、重试成功；17页核心正确，持久引用缺失|
|scan|是/错/未完成|是/对|897.429/252.816|自动定位81页并读到评价原文；附加活动细节仍待独立审阅|

基线完成5/7、核心2/7；候选完成6/7、核心4/7。core不包含附加事实正确性，树图不等于整答通过，海报条件性提到T3仍不判通过。基线P50/P95=102.304/897.429s，候选211.281/259.938s（7题nearest-rank，包含失败）。不能据此宣称中位延迟改善。每臂自然主模型流中断1/7；这是运行级观察比例，不是供应商请求失败率。基线另有解析失败1/7，候选有VL超时。详见`r6-adjudications.json`。

baseline主模型Token日志下界283744，VL Token37674；未知/缺事件不当零消耗。

candidate主模型Token日志下界84593，VL Token14411；未知/缺事件不当零消耗。

## 最终版本追加验证与边界

- `DocumentArtifactRepository.js:26 artifactSignature` 绑定parseGeneration、artifactSetStatus、parserVersion，补充同一记录原地更新的校验。`cache-r3.json`真实修改这些字段均触发DOCUMENT_VERSION_MISMATCH，finally恢复；明确不等于已完成新解析任务全生命周期恢复验收。
- 最终v7缓存读取r6-v8结果的`cache-r2.json`出现预期不命中（测试当时要求命中而失败），证明提示版本隔离生效；未删除。改选同版本r5真实资产的`cache-r3.json`12项全部通过。包含真实359块语料上query-only read路由到search。
- `reset-once-r3.json`及对应events：人工注入首字节前ECONNRESET，首轮与工具后主模型请求各失败一次/第二次成功，最终15.608s，实际execute_code只有一个调用且有stdout338350。没有重放Agent工具；不证明自然供应商故障都可恢复。此运行使用最终业务代码（后追加的artifactSignature字段校验不影响该无文件请求）。
- `http-r4.json`保留重启后尚未就绪的fetch失败；健康接口确认200后独立r5重跑，不覆盖失败批次。
- 原renderer与新文件传递renderer在同一真实72页Netflix PDF产生的JSON完全相等，见`netflix-layout-repair.json`。这证明没有靠削减布局规避缓冲区错误；64MiB结果读取限额仍保留。单元用2MiB夹具验证父进程路径；最终修复尚未独立重跑整套复杂PDF Agent。

最终`http-r5.json`（绑定`final-source.json`及`final-runtime.json`）6项全部通过：普通聊天12.697s，Word5.131s，CSV真实执行22.675s，Word无重附追问3.204s，Excel5.201s，外用户消息隔离。未混入r6准确率统计。生产3080 `/api/config` 返回200，此仅健康检查，不冒充生产聊天验收。

资源采样见`resource-samples.jsonl`（已停止）。隔离测试服务保留供复核，无付费矩阵运行；不触动生产服务或历史数据。
