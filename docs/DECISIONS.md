# 工程决策


## 2026-10-31：JIT embedding 复用已授权的百炼 provider

用户明确要求复用既有百炼地址和密钥。JIT 的 DocumentVectorSearch 在识别同一百炼 provider 后复用 QWEN_BASE_URL/QWEN_API_KEY，默认独立 embedding 模型 text-embedding-v4；显式 JIT 设置优先，聊天模型名不用于向量调用。衍生向量使用独立集合与 user/conversation/document/provider/model/revision/content 范围，与知识库 RAG 语料隔离。真实服务、Mongo缓存和 Agent 小任务验证通过；不代表 MinerU OCR 或完整 JIT 验收完成。见 JIT_BAILIAN_EMBEDDING_VALIDATION.md。

## 2026-10-31：JIT质量与延迟优先于成本

用户明确要求准确率和速度优先。保留完整候选重排，拒绝因缩减候选/节选/辅助次数导致召回下降的预算实验；成本只记录，不据此删减证据。速度先消除已证明多余的视觉预处理和重复输出；未知/部分扫描及视觉需求保留视觉路线。固定回归与文档隔离验证集一并比较，原始失败与中间版不删除。来源复核与原gold/原自动评分分开存储，不把编码Agent复核冒充独立人工评审。
