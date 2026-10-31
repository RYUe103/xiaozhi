
## 2026-10-31：JIT阶段追踪与质量评测

本机Compose `SANSUO_JIT_TRACE`默认true；可由启动环境设false后重建API关闭，无需替换.env。新增DocumentJitTrace/DocumentQueryProcessor/DocumentEvidenceReranker/DocumentToolResult/DocumentTableFocus/DocumentVisualPolicy挂载，新增挂载需重建API，不只restart。生产每行`[JIT trace] {JSON}`，按trace_id关联请求、scope_hash关联隔离范围；没有原始问题/正文/代码。模型完成原因和Token来自真实usage；工具批次时间包含加载，工具请求→输出包含调度，不当成纯执行CPU时间。事件有请求上限，不把缺日志直接解释为无执行。

离线重算已有结果：在实际源码根目录执行 `python3 scripts/evaluation/document-jit/summarize-quality.py evidence/jit-quality-20261031`，不调用模型。重跑模型评测会消耗真实服务、创建隔离测试数据，必须冻结新版本并保留全部样本；不得覆盖原gold或挑选最好结果。报告入口docs/JIT_QUALITY_EVALUATION.md。
