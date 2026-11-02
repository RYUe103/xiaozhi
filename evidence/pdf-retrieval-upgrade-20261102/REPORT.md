# 最终验收报告（尚未达到部署门槛）

## 最终补测：精确查找与源码边界

最终业务SHA为c462db6；完整独立20题绑定6d2ec2b，不能宣称最终版本重跑了20题。最终专项17组211项通过，记录final-c462db6-tests.json。关键定义最终行号另存source-locations-c462db6.json。

同一自然语言两轮、同一真实91页解析资产，三个独立Agent批次完整保留：

| 批次 | SHA | 两轮秒 | 结果 |
| --- | --- | --- | --- |
| exact-agent-r1 | 6d2ec2b | 38.779/20.782 | 误用相关性search并声称已列全部有序匹配，失败 |
| exact-agent-r2 | 10f24ce | 20.775/43.314 | 自主find_exact及有效跨轮令牌，但取5仅展示2，后续跳项，partial |
| exact-agent-r3 | c462db6 | 13.566/35.057 | 自主limit2，真实匹配序号1/2后用原令牌返回3/4，解析文字分页通过 |

10f24ce补search_scope、ordering、未知match_count和continuation_scope，避免把候选交付完误当全文枚举完。c462db6新增服务端match_index及分页说明。工具仍由模型自主选择，没有关键词硬路由。比较见jit-agent/exact-agent-comparison.json；前两次失败不覆盖。最后模型仍用“全文”指解析范围56处，不代表OCR完整性认证。

代码基线2911f67；候选先后004a1b4、8a40139、569cbb5；当前业务HEADc462db6（完整独立题绑定6d2ec2b）。不能混合各批最佳答案。

| 批次 | SHA | 完成率 | P50/P95秒 | 判断 |
| --- | --- | --- | --- | --- |
| 历史原工具架构r3 | 27df227（2911f67仅报告） | 10/10 | 30.732/37.133 | 关键规模漏答，AI严格3/9 |
| 本任务r2 | 004a1b4 | 8/10 | 32.410/202.447 | 超时+socket中断，目标仍漏 |
| 本任务r3 | 8a40139 | 10/10 | 39.738/79.758 | 保护名额挤掉融合第28位；不能称加速 |
| 本任务r4 | 569cbb5 | 10/10 | 21.642/55.117 | 目标原文成功交付，仍有时态及附加事实错误 |

上述跨时间批次不构成稳定SLA或严格同时A/B。完整原始回答和trace均保留，r2/r3分别有AI暂评，人工独立复核尚缺。

确定性Contextual BM25的页级@20从100%降到95%，@40/60持平，因此默认关闭。三段真实Qwen生成上下文仅验证可行性，2通过基础门槛、1过长拒绝，均不入索引，不能声明检索收益。

find_exact采用内存默认；真实解析文本20次与受控stdin rg命中数一致，内存P50/P95=0.147/0.360ms，rg=28.542/34.314ms。跨块仅支持原父块可核验的边界，不猜拼接。

测试：17组210项专项通过；另BaseClient/initialize 102项86通过16失败，与基线2911f67的失败集合一致。真实存储权限read和find_exact各10项通过，属于工具级。

未完成：最新视觉跨轮恢复、模型Contextual Embedding收益A/B、全量旧断言迁移、正式人工正确率/引用标注、完整多用户并发性能与生产/内网验收。原100题gold、旧失败、生产配置未修改。


## 最终批次的事实与成本边界

r4连续10轮AI严格正确4/9（第9轮缺失性gold不计），前三独立题2正确1缺时分；不是人工正式准确率。r2为3/9、r3为4/9，历史基线r3为3/9。第7轮目标原文已交付，但第8轮仍添加县级政协规模常识，第6轮漏平台完整组成且误绑30万元与路灯。绝不能称总体事实准确率显著改善。

统一线性插值分位数，早期r*-summary.json nearest-rank统计保留作历史，正式比较见performance/linear-comparison.json。r4中位数改善、尾延迟比历史恶化。会话应用记账prompt/completion分别：r2=148839/11063，r3=204561/20021，r4=112741/12534；不等同供应商账单，Query/Rerank/Embedding另见trace。主模型trace无usage时不能误写0消费。

完整深度60真实通道回放：legacy40丢目标，legacy60目标第50；双路权重1/.75/.5的40池目标为28/28/26，无证据证明.75全局最优。保留.75实验值。严格使用原工具短句真实Qwen：legacy20无目标，weighted40目标进入前6，weighted60模型排序无效回退且漏交付。60池失败保留。

其他中文PDF第一次实际走FITZ（云端SHA白名单未包含该公开文件），产生乱码；Agent自动search/read_table/inspect_page/find_exact，真实Qwen VL 1次7.858s/5100tokens、返回partial，最后错误推断全文没有。13工具、171.531秒，失败而非成功。6d2ec2b修复C1乱码质量标记和精确搜索不完整范围partial，未宣称从根本恢复OCR。另已将明确公开PDF哈希加入隔离进程白名单做云端独立批次，无.env修改。

HTTP普通聊天/Word/跨轮/CSV/Excel/生成下载/异用户7项通过，绑定1dd5f66。最后质量修正之后未把该历史回归冒充同SHA全量验收。

## 129页中文PDF：真实云端批次与原页核验

独立结果 `jit-agent/other-chinese-cloud-r2.json`，运行清单 `runtime-manifest-cloud-r2.json`，业务源码6d2ec2b。仅对明确许可的公开PDF SHA追加隔离进程allowlist，未改.env。PDF SHA256为 `eb78d5cb7a90fc93ca8521541de85a30d5b160987c178cbe8689409e1b28987b`。首次FITZ失败记录保留，不与新云端批次拼接。

真实上传、Cloud MinerU、138份产物持久化、Repository、Agent自动检索与原文补读、最终答案及6条引用已完成。全程327.563秒、上传0.333秒、解析237.144秒；7次PDF工具，0次VL，主要等待是首次解析。与171.531秒FITZ失败批次不可只比速度而忽略证据质量。

原页图 `jit-agent/source-pages/page-013.png` 与 `page-014.png` 已由AI查看：物理13/14页（印刷10/11页）确认2022年7月遵义27层住宅，总造价64,957,234.06元、建筑工程59,059,932.45元、安装工程5,897,301.61元（9.08%），差额与安装工程一致。数字及表格归属通过AI原页复核，尚非独立人工验收。Agent未用VL，本报告的离线原页复核不计入Agent工具调用。

仍有措辞问题：原表造价类型为“最高投标限价”，模型称“整体投入概算/开支”，不应理解为实际支出或结算金额。不能据此宣布所有事实完全正确。

## 为什么慢、为什么失败

以下均可由r4逐轮trace复核，阶段存在包含关系，不能把表中耗时全部相加。

| 场景 | 总耗时 | 主要证据 | 判断 |
| --- | --- | --- | --- |
| r4首轮，新隔离会话冷向量 | 43.211秒 | Vector21.803秒、75次embedding、82,258字符；EvidenceDelivery26.478秒 | 复用解析，但按授权范围新建向量缓存；不是MinerU重新解析 |
| r4第6轮，无工具 | 54.548秒 | 主模型流53.925秒 | 慢在模型生成；同时发生事实遗漏/误绑，增加候选数不能直接解决 |
| r4第7轮，热向量 | 55.582秒 | Vector1.684秒，仅1次12字符query embedding；重排3.701秒，证据交付6.423秒，最终模型流43.046秒 | 本轮没有重新嵌入整份文档；尾延迟主要在模型 |
| 129页Cloud首次上传 | 327.563秒 | 解析job237.144秒，随后检索/回答 | 首次解析等待与Agent阶段必须分开；job内排队/推理/下载细项本轮未完整采集 |

r2第6轮在工具完成后模型流超时，第10轮socket中断，保留错误而未重播已执行工具。本轮不是自然网络可靠性验收。r5新独立题按实际失败情况另列。

本轮明确区分：A类候选截断/保护失当（已用相同输入回放修复）；B类证据已交付但模型漏答（例如r5第8题源输出含培训人名）；C类模型超证据断言（例如r4未来计划写为已落实、r5“尚未转化为政策/拨款”）。129页FITZ乱码是更上游的解析质量问题；partial标记仅防止把坏证据当完整成功，不能恢复OCR。

指标边界：完整人工片段Recall@20/40/60、事实完整率和引用准确率缺少可靠逐片段标注，保留未知；页级coverage另列，不能替代这些指标。缓存已有权限/版本测试与热请求调用证据，未采集可发布的命中率。新模型Contextual索引构建成本没有实测，因为未启用。主模型应用记账、embedding累计用量、成功rerank用量分开记录，失败重排未上报的Token不能当0。

## 关键代码定位

行号绑定业务源码6d2ec2b；完整定义定位见证据目录source-locations.json。

| 文件 | 函数 | 行号 |
| --- | --- | --- |
| `api/server/services/DocumentRetrieval.js` | `weightedReciprocalRankFusion` | 127 |
| `api/server/services/DocumentRetrieval.js` | `protectDiverseCandidates` | 154 |
| `api/server/services/DocumentRetrieval.js` | `static async load` | 52 |
| `api/server/services/DocumentArtifactRepository.js` | `async _executeAsync` | 345 |
| `api/server/services/DocumentArtifactRepository.js` | `findExact(` | 442 |
| `api/server/services/DocumentArtifactRepository.js` | `async executeAsync` | 329 |
| `api/server/services/DocumentExactSearch.js` | `searchable(` | 5 |
| `api/server/services/DocumentExactSearch.js` | `crossChunkSources` | 18 |
| `api/server/services/DocumentExactSearch.js` | `exactSearch(` | 42 |
| `api/server/services/DocumentRetrievalContext.js` | `buildRetrievalContext` | 7 |
| `api/server/services/DocumentEvidenceReranker.js` | `async rank` | 6 |
| `api/server/services/DocumentVectorSearch.js` | `async search` | 70 |
| `api/server/services/DocumentToolResult.js` | `compactDocumentResult` | 2 |

## 完整独立20题r5：未证明总体改善

源码6d2ec2b，原题/gold未变、同一真实91页PDF、qwen3.6-plus、每题独立会话；均复用既有MinerU解析资产，新授权范围冷向量另计。20/20正常完成，无模型连接失败；票价题1次原页VL，8.303秒/3,337Token、partial。P50/P95=48.331/89.538秒。旧独立20题45.423/78.923秒，但旧运行绑定0730ded及未提交业务文件hash（source-freeze/runtime-start），不是本次2911f67的同时对照，不能做单因素因果解释。

AI暂评：保留原来5道gold缺陷/缺失性未核验题的排除规则，全部20题结果仍保存。可评分15题中严格6/15（历史8/15），核心事实13/15，按冻结要求完整10/15。严格口径包括未证实的附加说法；不是独立人工正确率。没有证据可宣称总体准确率提升。最终文字引用暂评7正确、1部分适用、7缺失，不能与工具保存的引用条数混为一谈。

| 题号 | 完成 | 秒 | 工具数 | AI暂评 | 最终文字引用 | 主要结论 |
| --- | --- | --- | --- | --- | --- | --- |
| longpdf_001 | True | 55.718 | 3 | partial | correct | 日期未明确年份，省略gold主分会场；8时30分和主持人/地点/原页引用正确。主分会场并非显式问项，gold过细风险单列。 |
| longpdf_002 | True | 31.801 | 1 | correct | correct | 95/31/53/11和截止时间正确；明确引用42页。 |
| longpdf_003 | True | 49.472 | 2 | correct | correct | 36/12/6及69页正确；额外6次交流/120多次/32个项目可见同页源文字。 |
| longpdf_004 | True | 30.986 | 2 | correct | correct | 地点、展期和140/60/80正确；76页引用正确。 |
| longpdf_005 | True | 42.368 | 5 | correct | missing | 开闭幕日期、313/271和313/267以及差4正确；最终未标原页。 |
| longpdf_006 | True | 33.208 | 1 | correct | correct | 两届78/67/85.9和95/82/86.3准确，区分35/67办结率，未重现历史把满意率主体错绑。 |
| longpdf_007 | True | 54.763 | 1 | partial | missing | 主要问题和4000/2000/10.13亿/930正确；将问题发生年份2021写成黄焯指出问题的时间，现有证据未证实该时间归属。对策对应图可视为分析，不能当已证实因果；最终未标页。 |
| longpdf_008 | True | 88.051 | 2 | incorrect | missing | 遗漏莫宇宁；无经济增收证据的判断合理，但进一步断言建议尚未转化为政策/拨款、均停留投入规划端，缺乏完整证据。 |
| longpdf_009 | True | 88.082 | 8 | unscored | correct | 按原有gold地名上平/上坪缺陷排除正式暂评分母。此次自主纠正上坪，取得72和84页，明确30万元仍为下一步，保留完整答案。 |
| longpdf_010 | True | 47.362 | 1 | partial | missing | 金秀15次/2500余人次缺失，目标RRF28进入40池但rerank27落出最终10条。把80余名委员因未声明去重而降格也不准确；不得由此推出线上线下交集。 |
| longpdf_011 | True | 55.664 | 3 | partial | missing | 三类质量及三机制基本覆盖，但将报告提出机制写为建立了；后续又混入其他文章的已联合发文与制度固化结论，时态/主体风险。 |
| longpdf_012 | True | 64.032 | 4 | correct | missing | 主要障碍与对应政策/保障/风险建议覆盖，三权分立及收益权是原文现有表述，未按外部常识改写；归纳六项为分组，最终无原页引用。 |
| longpdf_013 | True | 43.273 | 2 | partial | correct | 调研协商整改及反馈数字正确，有72页引用；和基线一样缺gold要求的5月观察时间。 |
| longpdf_014 | True | 46.484 | 3 | partial | correct | 两类工作室服务侧重点基本正确；省略gold的6月1日，且将服务划分为事后/事前没有原文支持，群众诉求与履职平台未充分展开。 |
| longpdf_015 | True | 74.923 | 1 | partial | missing | 规划评审/未认定/5至10年建设目标正确；额外断言周期从认定获批后才开始，以及国家或自治区正式认定的具体主体，原文引段未支持。 |
| longpdf_016 | True | 39.459 | 1 | partial | partly_correct | 35/67约52.2和32件正确，25页支持；但追加11件未立案一律不进入正式交办督办，属于未核实的流程扩展，5/15/18交叉引用的适用范围未充分标明。 |
| longpdf_017 | True | 42.452 | 1 | unscored | correct | 6500/1000/2000/9500及不同捐助主体正确，按原页写防溺水；原gold误写防疫，本题沿用历史排除规则，完整记录不删除。 |
| longpdf_018 | True | 49.299 | 3 | unscored | correct | 不编造票价，76页引用与展览资料一致；但从局部核查扩展为全文没有收费信息未独立证实，沿用缺失性gold排除规则。 |
| longpdf_019 | True | 43.579 | 4 | unscored | correct | 不编造逐人名单，90/91页所列规模和匿名老人合理；全文无任何患者姓名仍需独立全篇核验，沿用缺失性gold排除规则。 |
| longpdf_020 | True | 117.194 | 11 | unscored | correct | 明确五年为未来计划，不造实际增收百分比；10次相近search和1次相邻读取共117.194秒，重复检索开销明显。缺失性gold按原规则排除。 |

第10题必要片段仍未交付：Keyword36/BM2518/Vector51→RRF28→Rerank27→最终10条之外；见fusion/independent-r5-target-loss.json。第20题10次相近search加1次read_adjacent耗时117.194秒，虽有预算上限，仍存在冗余调用。不得把连续r4第7轮成功替换本批第10题失败。

本批应用Token记账prompt/completion=619982/29633；59次PDF工具，Vector累计请求用量按每题最大值汇总1,642次embedding，33条Rerank事件包含预算跳过/失败，不能直接当33次模型调用。费用不是供应商完整账单。票价题真实VL1次partial，最终没有编造票价，但全文缺失性仍未独立核验。

## 最终源码HTTP回归

c462db6真实HTTP 7/7通过：普通聊天7.280秒、Word读取8.172秒、CSV实际执行37.032秒、无附件Word追问3.232秒、Excel4.164秒、文件生成并实际下载11.328秒、异用户消息隔离通过。文件存在且非空、内容校验通过，见permissions/http-final-c462db6.json。不是只看HTTP200；也不替代多用户完整攻击矩阵或内网部署验收。
