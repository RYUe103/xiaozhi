# 冻结与实验
基线2911f67，旧三批10轮及20独立题/原gold只读。阶段A：对历史真实通道分数回放权重1/.75/.5×20/40/60，对比保护开关；另外用隔离Mongo/真实embedding/Qwen重排回放完整原文。Recall使用冻结页/源chunk标签，区分页覆盖与真正必要事实，不以页命中等同事实召回。
阶段B：确定性context vs raw；选有限章节/公开文档实验模型context；版本失败及cache复用。阶段C：UTF16/UTF8、全角/组合字符、分页/长块/权限/续读，内存与rg固定字符串性能对照。阶段D：固定10轮及独立组、新中文文档、HTTP/权限回归，计量每阶段。不得把合成测试当真实Agent。
当前保留16项旧BaseClient失败，先逐项迁移等价显式调用，不删除记录。未知指标null。实验及当前源码hash独立保存。

## 复现入口与环境边界

本轮隔离API在LibreChat容器内部3185，CodeAPI5057，Mongo数据库名为LibreChatMineruVisionPhase5candidate20261101。主3080不切换。`runtime-manifest-*.json`保存各批业务SHA、关键实际生效文件哈希及非敏感开关；依赖复用既有环境，不把本机依赖链接打包提交。上述地址是本轮测试配置，不是内网部署模板。

本机已有 `/tmp/phase5-run-with-env.cjs candidate` 安全runner从隔离进程复制服务端配置，不打印密钥。换环境须自行准备隔离数据库/授权测试账号、有效MinerU/embedding/Qwen配置；不能仅克隆仓库后宣称真实测试可运行。

| 目的 | 脚本与输入 | 验证层级 |
| --- | --- | --- |
| 冻结独立20题 | run-longpdf-accuracy.cjs + independent-r5-manifest.json，输出新目录 | 真实Agent；只传问题、不传gold，复用原91页解析 |
| 冻结连续10轮 | run-longpdf-accuracy.cjs + multiturn-manifest.json | 真实Agent；新会话独立运行 |
| 精确查找续读 | run-longpdf-accuracy.cjs + exact-agent-manifest.json | 补充Agent协议验收，非冻结准确率题 |
| 20/40/60融合网格 | replay-full-depth-fusion.cjs + r3目录 + 原mineru_chunks.jsonl | 确定性真实trace回放，不调用Agent |
| 真实Qwen精排 | replay-real-rerank-upgrade.cjs + 单次search的原turn JSON + chunks + 对应fixture JSON + 新输出路径 | 工具级付费对照；拒绝混合多次search，使用实际tool query |
| 权限/撤权/版本 | run-exact-permissions.cjs + 隔离已保存消息样本 | 真Mongo/storage工具级；仅隔离对象临时变更并恢复 |
| 聊天/Word/CSV/Excel/生成 | run-phase5-regression.cjs，指定新输出路径并加--generation | 真实HTTP，DOCX等为明示兼容性fixture，不充当PDF质量证据 |
| 阶段统计 | summarize-fixed-retrieval-batch.py RUN_DIR 原questions.json NEW_OUTPUT | 离线；线性分位数、累计向量用量去重、页覆盖proxy |
| 解析状态与trace | export-retrieval-runtime-evidence.cjs TARGETS_JSON NEW_OUTPUT | 指定隔离会话只读，不导出密钥/临时下载URL |

精排脚本默认从SANSUO_JIT_REPO_ROOT读取候选服务模块，从本轮baseline目录读取原精排器；可用SANSUO_REPLAY_MODULE_ROOT/SANSUO_REPLAY_BASELINE_RERANKER指定冻结文件。后续脚本记录模块哈希，历史已运行结果保留原清单，不能用新源码解释旧批次。首次回放口径问题见rerank/first-replay-limitations.md。

run-longpdf-accuracy的解析资产别名绑定依赖本轮固定隔离账号和原文件哈希；若这些资产不存在，应先按原上传脚本建立测试fixture，不能修改脚本绕过所有权与哈希检查。新增输出使用新目录，保留错误JSON；本轮未执行100题全量付费推理。
