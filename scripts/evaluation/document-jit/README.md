# Document JIT synthetic baseline

从项目根目录执行（使用现有 node_modules，无新增依赖）：

```bash
node --test scripts/evaluation/document-jit/metrics.test.cjs
node scripts/evaluation/document-jit/run.cjs
node scripts/evaluation/document-jit/report.cjs
```

默认结果为 `evidence/jit-baseline-20261031/{results.json,cases.csv}`，报告为 `docs/JIT_EVALUATION_BASELINE_20261031.md`。复跑会覆盖这些评测产物；也可传自定义输出：

```bash
node scripts/evaluation/document-jit/run.cjs /tmp/jit-recheck
node scripts/evaluation/document-jit/report.cjs /tmp/jit-recheck/results.json /tmp/jit-recheck/report.md
```

`corpus.cjs` 保存独立编写的事实、四种查询及标准答案片段，runner 构造 PDF chunks / Word JSONL，调用真实模块。包含有意设计的词频干扰、自然中文、同义改写、章节/表格/跨文档/连续读取及预算边界。它测的是已解析文本适配器，不代表真实上传、模型改写、回答正确率或业务文档效果。

`metrics.cjs` 同时测候选记录和实际交付证据；`metrics.test.cjs` 使用手算排名和截断反例校验，避免把命中元数据当成答案。Precision@K 固定除以 K；无答案单列，MRR 截止 6；缺失证据不提高后续排名。Token 采用已有 o200k_base 编码，非部署模型计费数据。详见生成报告中的范围、压力条件和局限。

评测进程只写评测输出，不修改业务模块、服务、数据库、用户文件或配置。发现缺陷仍正常输出基线，不把检索质量不足误当成脚本异常；读取模块前后 SHA256 不同则失败退出。相关源码回归测试独立运行，基线验证证据记录于 validation.txt。
