# 当前任务：公开文档 JIT 100题基准

2026-10-31：用户已回复百炼服务恢复。核对原46题结果与容器SHA一致、111项完整性通过，正准备按并发2继续剩余54题；前46题不重跑，未完成最终验收。

## 用户要求与边界

约100道真实公开原题、20–30份PDF；文档分组开发/验收隔离，先冻结后推理，每题一次。生产检索/回答/参数不修改，保留失败，原14开发题单列。准确率和速度优先；不以Mock或接口占位交付。

## 已完成（源码/运行证据）

- 25份PDF、100原题、1435物理页，开发32/独立验收68；原14题及6份PDF按来源/SHA排除。全部PDF下载成功，无失败后替换。版本、原答案、页码、SHA和选样规则锁定。
- 冻结锁SHA256：7a1ebb57c8b9fa181c682a3a15c8b0ddb863e4fe50c942a1b7364d003fe04240。
- 实际HTTP上传/持久化/BaseClient/Repository/检索/ToolNode/Agent已运行46题；全部收尾。两题初始跨会话绑定协议偏差保留且不重跑，有效协议44题。
- 有效协议44题：24个实质最终回答、16个百炼账户类400拒绝、2个上传失败、2个解析产物门禁失败。54题未派发，含全部48道MML题；无不可回答题完整成绩。
- 36个有效协议样本有排名记录：页级Recall@6=76.39%、@10=80.56%；仅部分运行数据，不是100题成绩。8个有效样本直接来源复核，不能推断总体准确率。
- 已记录各阶段追踪/finish reason/工具/Token/耗时；VL usage不可得，一题trace256上限导致Token为观测下界。生产17项哈希不变、API200。
- 111项基准完整性核对、12个脚本语法/编译检查通过，不等于111道Agent任务通过。

## 阻塞与下一步

- 百炼返回400 Access denied / good standing并指向overdue-payment。仅确认账户类拒绝，未取得供应商账单，不断言欠费事实。已请求用户核查余额/权限。停止新题派发，所有既有请求收尾，测试驱动/监视器已停止。
- 待服务恢复后，仅继续无attempt标记的54题；失败题不删除、不覆盖、不重推理。不得用本轮失败调参；若另做改进复测，建立独立run。
- 完成剩余推理、完整评分/争议来源复核、分题型准确率与错误引用率；现不能声明100题完成。
- 发现源标注与原图冲突2题，保留gold并单列复核；模型评分也有解释错误。扫描页摘要缺细节、图例绑定、重复VL及CodeAPI产物失败均待后续修复，本轮未改生产。

## 证据与复算

实际源码：/Users/yooyoung/Documents/Codex/2026-05-12/files-mentioned-by-the-user-v58/LibreChat-main。
报告：evidence/jit-benchmark-100-20261031/REPORT.md；逐题per-question.csv/json；原始results/grades/source-adjudications/production-traces.jsonl。
离线复算：python3 scripts/evaluation/document-jit/{verify,summarize,report}-benchmark100.py evidence/jit-benchmark-100-20261031（分别运行三个脚本，无模型调用）。
仅新增评测脚本/证据与记忆文件，未提交/推送、未覆盖.env、未改生产逻辑或配置、未删除数据。
