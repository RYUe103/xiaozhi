# 工作记录


## 2026-10-31 JIT 合成基线评测

- 用户要求先评测，未修改业务检索、JWT、MinerU、ToolNode、运行服务或用户数据。新增 scripts/evaluation/document-jit 的样本、执行器、指标及报告生成器。
- 实际模块执行 282 个用例（198 有答案、24 无答案、52 结构检查、8 预算），三类自建中文文档各构造 PDF/Word 解析产物，明确为合成适配器基线。
- 精确关键词 R@5=100%、R@1=87.5%、MRR@6=0.938；空格关键词 R@5=100%、R@1=91.7%；自然/同义完整问句 R@5=0%。不代表模型查询改写后端到端效果。
- 结构检查 45/52；6 个 PDF 章节完整性失败，1 个 PDF 跨块表格失败。显式页码/段落、普通表格及引用追问通过。无答案 not_found 12/24，主题命中不能证明问题有答案。
- 长段落 max_chars=500 时 PDF 候选 R@5=100%而正文交付为0%；Word 命中摘录为100%。Token 采用 o200k_base 代理；完整 JSON 的元数据开销单列。未测真实 API、TTFT、业务回答准确率。
- 指标/交付证据校验5项通过；既有5套272项通过。实际源码 evidence/jit-baseline-20261031 保存 results.json、cases.csv、validation.txt；报告 docs/JIT_EVALUATION_BASELINE_20261031.md。模块运行前后 SHA256 相同。
- 恢复基线 HEAD 8f2984c；本轮只新增评测产物/文档及更新 TASK，旧 TASK 快照在 patches/before-jit-evaluation-20261031。未提交/推送，原有修改保留。
- 待做：匿名真实业务文档及完整模型链路 A/B；先修中文查询匹配/PDF 章节/预算证据，再比较更复杂检索。当前不实施修复。


## 2026-10-31 JIT Phase 0 完成

- 六份审计文档已完成；查明源码/运行文件/持久解析/工具执行/权限引用/检索及测试边界。
- 当前本机 MinerU mock 健康，PDF 解析目标指向其5060端口；容器关键源码 hash 与宿主一致。RAG API pgvector 默认配置、schema/file_id过滤及生命周期已追踪，但无实际向量调用，维度待验证。
- 本轮新跑5套272项回归及5项指标验证通过；现有282合成用例结果保留，未改其样本和预期。tracked non-Markdown代码快照3140项无变化；只修改文档/脱敏证据，无数据库写入/依赖新增/服务重启/提交。
- 证据在实际源码 evidence/jit-phase0-20261031。已按用户任务书在Phase 0停止，等待审阅后才能进入Phase 1。


## 2026-10-31：JIT Phase 0.5 PDF 多解析引擎及降级链路专项审计
- 用户授权只读审计并要求完成后暂停；未修改业务代码、数据库、MinerU/FITZ/VL、ToolNode、运行配置，未新增依赖、未提交或重启。
- 交付四份报告：JIT_PARSER_FALLBACK_AUDIT.md、JIT_PARSER_FALLBACK_FLOW.md、JIT_PARSER_TEST_MATRIX.md、JIT_PARSER_ARTIFACT_COMPATIBILITY.md。
- 核心结论：MinerU 主解析异常时真实 FITZ 全页渲染；聊天阶段再真实调用 VL 建逐页摘要索引。纯扫描页只有页图和后续 summary，VL summary 尚未统一回写 DocumentContextService 的 chunks/tables；成功但非空低质量内容不会自动逐页降级。
- 运行证据：MinerU 目标为本机 sansuo-mineru-mock（pdftotext，不能证明 OCR）；容器真实 PyMuPDF 1.26.5 可导入；电子/图片/混合合成 renderer 探针完成。相关 3 套 Jest 回归 212/212 通过，但使用替身，未宣称真实 MinerU/VL 质量通过。
- 代码保护：tracked 非 Markdown 代码 3140 个文件 hash 前后相同；证据目录 evidence/jit-phase05-20261031。
- 阶段完成后暂停，等待审阅，不进入 Phase 1。

## 2026-10-31：JIT Phase 1A-1C 多解析引擎统一读取层
- 按用户 Phase 1 任务书完成最小侵入实施；未进入 Phase 2，未修改 MinerU/FITZ/VL 外部协议、ToolNode 对外 schema、数据库 schema或历史文件。
- 新增 api/server/services/DocumentArtifactAdapter.js：统一 MinerU chunks、FITZ文字层、VL visualIndex 的记录与页面覆盖模型；明确 extracted_text、visual_summary，未把 FITZ/VL summary伪装成 OCR。
- 新增 Adapter 单测；DocumentContextService 导出 Adapter，PDF section read 按标题层级和顺序边界读取；BaseClient 对 visualIndex 增加版本、根文件、会话和用户绑定校验。
- 相关测试 4 suites / 219 tests 全部通过；MinerU、存储、数据库和VL测试场景仍为替身，未宣称真实OCR/VL质量通过。
- 交付 JIT_PHASE1_IMPLEMENTATION_REPORT.md、JIT_PHASE1_ARTIFACT_CONTRACT.md、JIT_PHASE1_TEST_REPORT.md、JIT_PHASE1_COMPATIBILITY_REPORT.md、JIT_PHASE2_READINESS.md。
- 证据目录 evidence/jit-phase1a-20261031，含修改前快照、测试日志和目标文件 hash；未执行历史数据迁移、真实VL大规模推理或Phase 2检索实现。


## 2026-10-31：开发原则调整后的 Phase 1 目标驱动复核
- 用户明确将项目原则从最小侵入改为目标驱动开发；后续不得用代码量、预留接口或单测通过替代真实 Agent 能力验收。
- 复核结论：上一轮 Phase 1 只能标为部分实现。Adapter 尚未成为唯一读取事实层，visualIndex 未进入 read_parsed_pdf，长章节安全续读、跨 chunk 表格、真实 Agent 端到端和历史引用完整验收仍缺失。
- 新增 JIT_PHASE1_REAUDIT_AND_GAPS.md 与 JIT_PHASE2_ARCHITECTURE_PLAN.md，列出状态、结构性补齐方案和 Keyword/BM25/Vector/RRF 实施门槛。
- 本轮未修改业务代码、数据库或运行配置，未启动 Phase 2。


## 2026-10-31：JIT 百炼 embedding 模块实施及运行验证

用户授权复用现有百炼地址/密钥；已实现默认 text-embedding-v4、域名约束的凭据复用、分段向量、隔离增量缓存与 RRF 接入。仅新增 6 个服务挂载并重建 API，配置检查无其他环境或挂载变化；未覆盖 .env 或删除数据。7 套回归 141/141；真实百炼向量、真实 Mongo 缓存及真实 PDF→PyMuPDF→模型自主 list/search/read→ToolNode→RRF 小任务通过。真实 Agent 7665ms/5757 tokens，单任务召回/证据/答案 1/1，不能推广为完整准确率。首次页码评分格式误判已修正，保留原结果。详细证据及整体未完项见 docs/JIT_BAILIAN_EMBEDDING_VALIDATION.md；备份 evidence/jit-implementation-20261031。完整 JIT 原目标继续进行中，未声称网页上传、OCR、跨页表格或整体验收已完成。


## 2026-10-31 公开CiteVQA小样本实测

- 前一任务JIT实现/合成验收状态已保存在 evidence/jit-public-benchmark-20261031/task-before-*.md；先前完整记录继续保留。
- 用户要求“试一下”公开数据集；仅新增公开评测脚本与证据，无业务修改。原12个候选链接2份可用，按固定规则取6题，PDF/标注SHA和下载失败均记录。
- 运行已确认：41页真实FITZ全文与原生表格、真实百炼embedding、qwen3.6-plus、实际read_parsed_pdf ToolNode；检索页Recall@6=83.3%，证据5/6，核心答案4/6，98.965秒/159863聊天Token。
- 限制：非官方bbox/SAA；小样本有可获取性偏差；未经过公开PDF上传/持久化/BaseClient链路，未验证真实MinerU/OCR/本轮VL。错引条款和表格计算未完成各一题，保留原始失败。
- 文件：scripts/evaluation/document-jit/{prepare-citevqa.py,public-citevqa.cjs,grade-public-citevqa.py}；报告 evidence/jit-public-benchmark-20261031/REPORT.md；备份TASK和git-status-before在同目录。
- 验证：JS语法/Python编译及6题真实推理完成。不宣称平台全量文档质量通过。

## 2026-10-31：JIT质量优化与公开数据扩展评测交付

- 用户要求：准确率和速度优先，成本次要；目标驱动、原六题不改标注、不选最好重跑。
- 实际修改：查询编译/分通道排名追踪/语义重排、表格目标块与续表行修复、页码安全绑定、精简证据投影、查询向量隔离缓存；生产ModelEnd/工具执行追踪；完整文字层非视觉请求跳过重复VL预处理。
- 真实评测：6份公开PDF289页，固定6题+文档隔离8题，6个版本全部保留。来源复核固定4/6→6/6、独立5/8→6/8；不是独立人工盲审/官方CiteVQA全量成绩。标注缺页与自动评分误判以独立文件双向纠正，原gold/答案/评分保留。
- 运行已确认：网页HTTP上传/首次原文与页码/继续读取/真实代码计算/外用户消息隔离/SHA256检查通过；原先104.36/21.54/76.39秒，最终30.77/16.97/53.55秒，单次不同版本，不能称稳定P95提升。离线完整重排P50略增，拒绝召回下降的低预算版。
- 端到端已验证：生产read_parsed_pdf、execute_code、ModelEnd完成原因与usage、工具请求/批次/输出耗时JSON日志；请求内trace共享，无原始私密内容。12 suites /111 tests通过；13个运行模块hash一致，API200，RestartCount=0。
- 备份：/Users/yooyoung/Documents/Codex/2026-05-12/files-mentioned-by-the-user-v58/LibreChat-main/evidence/jit-quality-20261031/before；起始HEAD8f2984c14aa74b5f18ba594a976445e5849d04da；保留既有脏文件，不提交、不替换.env、不删卷。
- 限制：两道独立题无最终答案、自然扫描/真实MinerU OCR未验收、额外单位/标题及重复代码执行未完全解决；成本为usage/公开标价估算，非实际账单。真实VL和代码控制样本不冒充全量OCR能力。
- 报告与逐题证据：/Users/yooyoung/Documents/Codex/2026-05-12/files-mentioned-by-the-user-v58/LibreChat-main/evidence/jit-quality-20261031/REPORT.md，详见docs/JIT_QUALITY_EVALUATION.md。

## 2026-10-31：100题公开JIT基准冻结与受阻部分评测

- 用户要求先冻结再真实生产链路评测，不调参/不重跑选优。新增独立评测脚本与证据；原有生产17项文件hash未改，API200。
- 已冻结CiteVQA32/OHR20/MML48，共100原题25PDF1435页，开发32/验收68；原14题与原PDF隔离。全部PDF合法公开下载成功，按研究/非商业限制本地使用，不再分发PDF。锁7a1ebb57c8b9fa181c682a3a15c8b0ddb863e4fe50c942a1b7364d003fe04240。
- 真实HTTP正式46题均收尾，有效协议44：实质最终回答24、账户拒绝16、上传失败2、解析门禁失败2；初始跨会话偏差2保留且不重跑。54未派发，全部MML仍未执行，因此不能交付100题成绩/完整拒答能力。
- 有排名36题页Recall@6=76.39%、@10=80.56%，页交付代理非精确证据交付率。仅8个有效样本直接来源复核；无可靠总体答案准确率。两道OHR标注图例错位、评分器解释错误单列，gold/原判定保留。
- 百炼400 Access denied/good standing/overdue-payment为真实阻塞，未核实账单。已请求用户恢复服务，仅可继续未attempt54题；16失败不覆盖。所有测试驱动/监视器已停止，无在途请求。
- 实测主模型2114844、查询/重排209359、Embedding826589 tokens为已观测下界；VL usage缺失、一题达到trace256上限。有效44题P50 38.322秒、P95 1122.191秒，含快速故障/不同并发，非SLA。详细性能分组另有JSON。
- 核对111项数据/锁/分组/原题/once-only完整性通过，12脚本语法/编译通过；不冒充Agent通过数。备份见该证据目录task-before、head、git-status-before。
- 仍待54题、全量评分/来源复核、可靠分类型正确率。报告入口evidence/jit-benchmark-100-20261031/REPORT.md、逐题per-question.csv/json；task保持阻塞未完成。


## 2026-11-01：MinerU云端与按需视觉实际实施及独立验收

- 用户要求：沿用现有分支，以真实PDF/Agent证据验收，不改gold，不覆盖.env或内网生产。
- 源码：加固ZIP/URL/DNS/资源限制，原ZIP与provenance、完整图片路径→artifact映射；统一结构块/父块chunks/表格合并；按需原页及视觉引用持久化；记录schema/截断partial；提交代际/图片hash；向量预检与4批并发。
- 实际发现：云端_origin.pdf重写字节，六份hash均与输入不同，16个页面抽样渲染一致；改用认证batch+回传data_id绑定上传SHA，云端PDF另存hash。旧误拒绝失败保留。
- 验证：14组270项单测、26文件语法检查；六份复杂真实PDF均有成功资产，首次5/6。真实财务完整Agent/FITZ/QwenVL/引用追问；扫描最新256.946s、0VL，向量9.429s/30候选，原为16.108s预算失败。普通聊天、合成Word、外用户隔离HTTP通过。
- 未通过：图例与冻结gold分歧、VL/主模型网络失败；B5共同六题2/6，B6两题定点2/2不合并选优；普通文字非退化与全OCR/公式/表格精度、混合页缺失、真实更新恢复等未完，不能生产部署。
- 恢复：HEAD ff2304f，开发副本/tmp/xiaozhi-publish-20261031，稳定备份evidence/mineru-vision-20261101/source-changes.tar.gz。原100题gold/结果未改；来源姓名旧评审另有纠正说明，旧记录保留。
- 运行：仅本轮隔离3183/3184 API已停止；库/资产保留；3080配置接口200，生产/内网/.env未替换；没有提交推送。
- 报告：docs/PDF_PAGE_VISION_IMPLEMENTATION.md及evidence/mineru-vision-20261101/REPORT.md，逐批真实结果、原始工具输出、脱敏事件、来源/源码hash和失败均保留。

## 2026-11-01：用户授权推送本轮实施与验收证据

- 提交范围：MinerU/Repository/按需视觉/检索代码、测试脚本、实施说明和脱敏真实Agent证据；保留所有失败及未完成事项。
- 排除依赖软链接、原始PDF/ZIP大资产和服务凭据；未改生产配置。推送前代码与文档diff检查通过（原始休眠日志的行尾空白保留），163项证据约3.89MB，凭据模式扫描无命中。
- 既有验证为14组270项测试通过；本轮仅发布，不重新运行付费Agent评测。远端提交结果在发布后独立核实。

- 发布核对：本地提交8028d780559cd5c3b0d5bcbd5a2610a19d059e71，共194文件；依赖软链接未提交。GitHub ls-remote与独立IPv4 HTTPS探测均连接超时，不能声明远端已更新。
- push最终结果：退出128，could not read Username for https://github.com（terminal prompts disabled）；当前CLI无可用认证，gh未安装。需恢复GitHub认证及网络后重试普通push；未强推，原测试结果保持不变。

## 2026-11-01 Phase 5 实时 Agent 验收续记

- 在隔离 candidate/baseline 上完成 r3、r4；r4 两臂各7题均结束并保留原始回答、工具输出、事件和计时。候选海报已走自动定位、inspect_page、FITZ按需渲染和真实 Qwen VL，核心学期命中但附加数值错误；财务视觉输出被正确标记 partial；跨页扫描证据片段已到达但最终答案仍需事实盲评。
- 修复大页渲染像素上限、视觉原问题上下文、内部 deadline 不应被用户 abort 逻辑吞掉、导出解析任务字段、缓存测试身份头。缓存/撤权/源版本与向量热查真实检查通过。
- 相关16套测试303项通过；Agent 原 client.test 的14项历史 memory/subagent失败由基线客户端复现，单独保留。r5仍在运行，未把未结束结果写成结论。
- 报告入口：`evidence/phase5-20261101/REPORT.md`；阶段实现入口已更新。当前不满足生产部署门槛，未提交、未推送、未改生产配置。
