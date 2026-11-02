# 工程决策


## 2026-10-31：JIT embedding 复用已授权的百炼 provider

用户明确要求复用既有百炼地址和密钥。JIT 的 DocumentVectorSearch 在识别同一百炼 provider 后复用 QWEN_BASE_URL/QWEN_API_KEY，默认独立 embedding 模型 text-embedding-v4；显式 JIT 设置优先，聊天模型名不用于向量调用。衍生向量使用独立集合与 user/conversation/document/provider/model/revision/content 范围，与知识库 RAG 语料隔离。真实服务、Mongo缓存和 Agent 小任务验证通过；不代表 MinerU OCR 或完整 JIT 验收完成。见 JIT_BAILIAN_EMBEDDING_VALIDATION.md。

## 2026-10-31：JIT质量与延迟优先于成本

用户明确要求准确率和速度优先。保留完整候选重排，拒绝因缩减候选/节选/辅助次数导致召回下降的预算实验；成本只记录，不据此删减证据。速度先消除已证明多余的视觉预处理和重复输出；未知/部分扫描及视觉需求保留视觉路线。固定回归与文档隔离验证集一并比较，原始失败与中间版不删除。来源复核与原gold/原自动评分分开存储，不把编码Agent复核冒充独立人工评审。


## 2026-11-01：MinerU主证据与按需原页视觉

仅外网隔离测试启用云端Provider，必须服务端显式配置获许可PDF SHA256。保留内网 /pdf_parse 默认；实际.env、生产服务和数据库不变。沿用原Repository与read_parsed_pdf；结构化正文/表格优先，FITZ/Qwen仅按问题核对原页，不默认生成整份摘要。VL结果完整/schema有效不等于事实正确，截断/不确定保留partial与原始输出。

云端资产按认证batch与回传data_id绑定实际上传字节SHA。云端重写PDF另存hash，不误认同源字节。生成代际manifest最后提交，Repository忽略不完整代际；未知MinerU坐标不自动裁剪。依据六份真实PDF与Agent运行修正，结果和限制见PDF_PAGE_VISION_IMPLEMENTATION.md及独立evidence/mineru-vision-20261101。

## 2026-11-02：PDF检索升级的实验边界

沿用原生Agent、Repository和Qwen，实验双路BM25/Vector加权RRF，Keyword仅补候选；40池与精排输入联动，融合前75%保留后补独有候选。权重0.75/1不是全局最优结论；不同query和模型随机性不与确定性回放混为因果证明。

Contextual标题索引可选且默认关闭，真实页级@20下降；模型上下文仅三段可行性实验，尚未发布到索引。find_exact使用原始解析文本，默认内存，显式NFKC与签名续读；跨块仅核验原始父块，乱码/缺页为partial。

统计采用线性分位数；Vector用量按请求累计最大值，重叠阶段不能相加当墙钟耗时。原始失败和gold保留；AI复核与独立人工标注区分。报告在evidence/pdf-retrieval-upgrade-20261102，当前未达到生产部署门槛。
