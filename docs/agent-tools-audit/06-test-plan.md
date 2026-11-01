# 回归与真实验收

> 以下保留实施前检查点，基于 1a99227；不代表最新状态。实施与实测结论见 07、08 和独立 evidence 目录。
基线命令（api cwd）：npx jest app/clients/specs/BaseClient.test.js server/services/Endpoints/agents/sansuoToolPolicy.spec.js server/services/Endpoints/agents/initialize.spec.js --runInBand --config jest.config.js --json --outputFile=../evidence/agent-tools-refactor-20261102/baseline/jest.json

目录发现不得调用下载、MinerU、embedding、VL；工具 load 前验证此条件。两用户两会话＋多 PDF/Word＋本轮新附件；模拟撤权/删除/hash/generation 变化，必须拒绝。并发同目标只加载一次、不同请求不可共享私有状态。所有 action/schema/continuation 参数保持。

ToolService 集成验证模型 definitions、Registry、executor 三份集合；多 Agent 应按各自 scope，未暴露工具不得通过 req 缓存越权加载。fast/knowledge 不得注入 deep 读取器；execute_code 不强制。

真实测试复用冻结 10 轮顺序，新目录 multiturn，保留每轮原请求/模型工具/引用/错误。不能只跑 turn07 或预填页面。分别报告可见、可执行、模型是否选用、证据正确、事实正确、引用页和完成率。旧 AI 评分不变，无人工复核不报正式准确率。

性能分目录发现、首次实际内容加载、热读取、检索、VL、模型与总时间；schema token 使用实际 tokenizer/usage，未知写未知。没有新运行不得声称性能改善。
