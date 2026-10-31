# JIT 检索审计（Phase 0）

## 三条检索链

### 1. 三所小智自动上下文选择

入口 `api/app/clients/BaseClient.js:1964-2148,2255-2290`。PDF 记录由 `selectSanSuoPdfRecords` 选择：指定页优先；否则抽取查询项、按文档频率和匹配次数排序，补前后块；无命中时标题/首中尾覆盖。Word 使用对应 `selectSanSuoDocxRecords`。结果进入自动注入的持久文件上下文，默认 PDF 上限约 60,000 字符（环境可调，最低12,000），DOCX 默认24,000字符。

### 2. JIT DocumentContextService search

`DocumentContextService.js:508-518,617-651,450-468` 的 `getQueryTerms` 使用正则提取英文/数字词或连续中文串；评分为字符串出现次数乘词长权重，按 score、原始 index 排序，默认最多6条、上限12。没有倒排索引、BM25、向量、RRF、标题/页眉降权或术语识别。

### 3. LibreChat 原生 file_search/RAG

`api/app/clients/tools/util/fileSearch.js` 调用 `${RAG_API_URL}/query`，每个 file_id 传自然语言 query、k=5；`api/server/services/Files/VectorDB/crud.js` 上传时调用 `/embed`。RAG API 容器默认 pgvector，embedding 配置来自容器默认/环境；当前审计未观察到其与 MinerU chunks 接线。知识库外部服务 `api/server/services/SanSuoKnowledge.js` 是另一范围。

## 是否存在 BM25/全文索引

在当前 JIT 源码、RAG API 容器代码及已审计知识库源码中没有发现 BM25、RRF 或 SQLite FTS5 作为当前 JIT 检索实现。RAG API 的 `RecursiveCharacterTextSplitter`、embedding 和 pgvector 相似度查询已确认；它不是 BM25。

## 向量能力审计

- 原生 RAG：`rag_api` 使用 `VECTOR_DB_TYPE=pgvector` 默认、`COLLECTION_NAME=testcollection` 默认、默认 embedding provider/model 为 `openai/text-embedding-3-small`（运行环境未覆盖这些安全可读配置项），数据表有 `langchain_pg_embedding.embedding vector`。查询按 `file_id` filter，随后检查 metadata `user_id`。
- 三所小智 JIT：没有调用 `RAG_API_URL`、`/embed` 或 `/query` 的证据；PDF MinerU chunks 和 Word blocks 由 Mongo/Code API 产物直接读取。
- 2026-10-31 只读数据库查询按维度统计 pgvector 行，输出为空；没有调用写接口，没有改变向量库。
- 知识库项目 `知识库/app/retrieval.py` 有 `vector_search`，通过 Dify retrieve；其本地 `RetrievalTools` 也有 keyword/metadata/page/adjacent 读取，但属于外部知识库服务，不能当上传 JIT 已接入能力。

## 现有优点

- 不需要新增索引即可在解析完成后使用；页码、chunk、段落和表格引用可追溯。
- PDF 自动选择有稀有度、前后块和首中尾覆盖；Word 有段落/标题/表格坐标。
- 规模基线显示 DocumentContextService 内存扫描小样本很快；先优化正确性和证据交付，不应只因架构名称引入索引。

## 已知缺陷（已有评测证据）

见 `docs/JIT_EVALUATION_BASELINE_20261031.md`：合成集精确/空格关键词 Recall@5=100%，自然/同义完整问句=0%；PDF 章节完整性和跨块表格失败；预算截断可能出现 hits 有记录但正文没有完整答案；重复主题词会干扰排序。

## 建议审计后的决策

保留当前 Keyword 作为 A 基线；Phase 1 先做统一读取、章节/表格/续读和引用安全。之后用匿名真实数据比较 Keyword、BM25、Vector、Hybrid，不预先宣称混合检索一定更好。若复用原生 RAG，必须补文档版本、JIT 会话范围和生命周期同步，不能直接把现有 file_search 接到 MinerU 产物。

## 自动选择与 JIT 的重要区别

自动 PDF 选择的 `getSanSuoPdfQueryTerms`（`BaseClient.js:1964-2002`）已有中文2/3/4字滑窗和部分通用问词去除，评分还有文档频率；JIT 的 `getQueryTerms` **没有复用它**。因此自然问句0召回的基线只针对 JIT 服务，不能套到自动上下文选择。统一 QueryProcessor 应比较并复用这一现有能力，保留标准号/型号/单位精确字符串。

## 向量存储 API、维度、过滤与生命周期

| 项目 | 代码/运行确认 | 仍需补齐 |
|---|---|---|
| Embedding | RAG `/app/app/config.py:218-328` 初始化 OpenAI/HF/Ollama 等 provider；本机当前走默认 OpenAI/text-embedding-3-small 配置 | 未发真实 embedding 请求；实际输出维度未验证，不能拿模型默认维度当本机实测 |
| Store | `/app/app/services/vector_store/factory.py:16-45` 选择 Extended/AsyncPgVector，use_jsonb=True | 实际运行 sync/async mode 需后续确认；本轮没有发向量查询 |
| Chunk | RAG `document_routes.py:650-684` RecursiveCharacterTextSplitter 默认1500/100；page_content+metadata(file_id,user_id,digest,loader metadata) | 与 MinerU 4500/350 chunks 不同，不能无映射重切后冒用旧 chunk_id |
| 查询 | `/query` body query/file_id/k/entity_id；源码 filter file_id=$eq，随后检查首个结果 user_id | 当前 HTTP schema 无任意 metadata filter/document_id/version_id；必须服务端可信范围过滤，不能仅事后前K检查 |
| 创建 | `uploadVectors` POST `/embed`，RAG embed/prepare/store 新建数据 | JIT ParseJob ready 没有接入；需要独立幂等文档版本索引状态 |
| 删除 | `deleteVectors` DELETE `/documents`；RAG `document_routes.py:281-297` 清除文件关联向量 | 未看到 JIT source/artifact 删除触发同一索引清理 |
| 失败回滚 | RAG route 的 batch pipeline 有 rollback delete，`document_routes.py:535-640` | 不保证 JIT 与该链跨服务一致，需设计重试和幂等 |
| 数据状态 | 只读 SQL 查到向量表元数据，维度聚合无结果 | 只说明当次未观察到向量行，不证明 embedding 服务可用 |

复用建议：先确定 RAG 服务源码/镜像版本固定方式，补接收**已解析 chunks**的受控写入适配，不重新解析源 PDF；补 document/version/owner/tenant/conversation 的可信过滤和删除/重解析生命周期。在当前 `/query` 上直接增加模型传入 owner 或裸任意 filter 不符合目标。

## Meilisearch 与知识库

`packages/data-schemas/src/models/message.ts:8-15`、`convo.ts:8-16` 注册 messages/convos index，没有 MinerU 文档索引。不能把 Meilisearch 可运行等同 BM25 已接入；Meilisearch 排序也不能未经验证称为目标 BM25 算法。

独立知识库 `/Users/yooyoung/Documents/ChatGPT/知识库/app/retrieval.py:624-649` 的 vector_search 通过 Dify retrieve 后映射 SourceRepository；本次只读核心 retrieval 文件，没有审计 Dify 底层存储/embedding 配置。该库文档有 BM25/hybrid 描述，但在本次实际代码搜索中未找到对应可直接复用实现，不能把文档描述认定为已运行。
