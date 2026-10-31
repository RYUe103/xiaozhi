# JIT 质量优化与公开扩展评测（2026-10-31）

用户确认：准确率、响应速度优先，成本只记录；不为省Token削减有效证据。

本轮实际实现查询语义提取、候选扩展/语义重排、表格目标行与续表表头修复、显式页码安全选择、模型侧证据精简、隔离查询向量缓存、生产全阶段追踪，以及完整文字层非视觉问答延迟视觉预处理。未修改MinerU/ToolNode语义、未替换.env或清空数据库/卷。

原六题原标注未改，独立八题按文档隔离，6份公开PDF共289页，模型/工具真实执行，每版每题单次结果全部保留。固定核心正确4/6→6/6，独立5/8→6/8；编码Agent来源复核口径，非独立人工盲评。原自动评分及发现的标注缺页、评分器误判均保留，不能只看一个百分比。

完整方案离线P50固定14.62→17.76秒、独立27.05→30.46秒，不能称全局提速。真实网页三轮单次对照首次104.36→30.77秒、追问21.54→16.97秒、计算76.39→53.55秒；中间版和失败探测均保留，不挑最快。最终五项HTTP业务检查通过，真实read_parsed_pdf和execute_code执行、外用户消息隔离、原PDF SHA256持久化均有证据。

生产trace包含QueryProcessor/Keyword/BM25/Vector/RRF/Rerank/EvidenceDelivery/ToolOutput/ModelEnd及工具请求/执行/完成计时，生产不记原始问题、正文、代码。真实JSON日志、统一请求trace已验证；工具批次计时包含调度与加载。12 suites /111 tests通过，13个关键挂载文件hash匹配，API200且RestartCount=0。本机验收不代表内网部署。

尚未完成：八轮预算内的全部表格汇总最终合成、真实接线图视觉证据、自然扫描OCR的大样本验收、模型偶发多余单位/标题与重复代码调用治理、统计可靠的负载P95/更大盲测。未将适配器、派生扫描控制题或mock MinerU视为OCR交付。

完整报告：[REPORT.md](/Users/yooyoung/Documents/Codex/2026-05-12/files-mentioned-by-the-user-v58/LibreChat-main/evidence/jit-quality-20261031/REPORT.md)。
逐题数据：[metrics.json](/Users/yooyoung/Documents/Codex/2026-05-12/files-mentioned-by-the-user-v58/LibreChat-main/evidence/jit-quality-20261031/metrics.json)。
当前源码/运行位置仍为 PROJECT.md 所列LibreChat-main，未迁移到工程记忆目录。
