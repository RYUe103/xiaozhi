# 现有工具到目标工具能力映射（Phase 0）

审计对象：`read_parsed_pdf`、`read_parsed_docx`。注册定义见 `api/server/services/Endpoints/agents/sansuoToolPolicy.js:248-424`；执行实现见 `api/server/services/DocumentContextService.js:317-505,547-681`。

| 旧聚合 action | 现有参数/返回 | 目标工具 | 可直接迁移 | 已知问题 |
|---|---|---|---|---|
| `list` | 无文档参数；返回文档 ID、文件名、格式、计数、ready/empty | `list_documents` | `listDocuments()` | 当前集合由请求预加载；没有 query/file_type/limit 过滤和显式 ACL 查询。 |
| `info` | `document_id`；返回 list 元信息 | `document_info` | `listDocuments` + resolver | parser version、artifact version、warnings 不在返回。 |
| `toc` | `document_id`；返回 sections | `document_toc` | `headings` | PDF section 只保存标题块 ID，不能可靠映射整段章节。 |
| `search` | PDF `query,limit,max_chars`；Word `query,max_chars`（内部支持 limit，对外 Schema 未暴露）；返回 content、hits、tables、reference | `document_search` | 现有评分与 provenance | 中文自然问句整句匹配弱；不是 BM25/vector/hybrid；hits 可能比正文实际可见证据完整。 |
| `read` | PDF pages/chunk/section；Word paragraph range/chunk/section；`offset,max_chars` | `document_read` | 读取与 `sliceContent` | 章节范围、continuation token、版本校验缺失；PDF section 仅标题 chunk。 |
| `read_table` | `table_id` 或 previous reference；`offset,max_chars`；返回 content/provenance | `document_read_table` | tables + `sliceContent` | PDF 表格必须单 chunk；Word 无坐标旧产物无法恢复；无 max_rows/结构完整性 warning。 |
| `read_adjacent` | `chunk_id` 或 previous reference；radius 1-3 | `document_read_adjacent` | 原始 records 顺序读取 | 目标参数是 `chunk_id`，任务书目标用 `block_id`；没有 before/after 独立参数和版本校验。 |
| 页面视觉能力 | 当前没有 Agent 暴露工具；后端已有 `ensureSanSuoPdfPageArtifacts` | `document_render_page`（Phase 4） | 后端渲染/持久化函数 | 未形成安全的 document/page 工具入口；不能在 Phase 0 宣称已上线。 |

## 当前工具 Schema

- PDF `action` 枚举：`list/info/toc/search/read/read_table/read_adjacent`，另有 `pages`, `chunk_id`, `section_id`, `table_id`, `adjacent_count`, `offset`, `max_chars`, `limit`。
- Word Schema 同上，另有 `file_id`, `paragraph_start`, `paragraph_end`；`action` 可省略，默认按 query 走 search。
- 工具描述明确“不执行代码、不启动沙箱、不重新解析”，多文档要求先 `list` 再使用稳定 `document_id`。
- 工具返回 JSON 字符串；没有任务书建议的统一 `{ok,data,source,warnings,error}` 封装。

## 迁移要求

保留 DocumentContextService 的稳定 ID、解析结果读取、表格和相邻记录逻辑；在新工具外层补 `DocumentResolver`、每次调用鉴权、版本/引用检查、统一 continuation token 和结构化错误。旧工具不能和新工具长期同时暴露；历史 `sansuoDocumentReferences` 需要兼容转换。

## 参数、结果与底层复用细节

| 项目 | PDF | Word |
|---|---|---|
| 注册条件 | req._sansuoPdfReadSources.size>0 | req._sansuoDocxReadSources.size>0 |
| 工具 action | 必填枚举 | 可选：有 query 则 search，否则 read |
| 文档选择 | document_id；单文档可省略 | document_id 或兼容 file_id；单文档可省略 |
| 列表 | document_id,filename,format,page_count,chunk_count,table_count,section_count,status | 多 file_id,paragraph_count；没有真实 page_count |
| read 范围 | pages 最多30项；chunk_id；section_id | paragraph_start/end（含端点）、chunk_id、section_id；无目标读当前全部 records |
| 搜索条数 | Schema limit=1..12；服务默认6 | 内部服务支持 limit，**对外 Word Schema 没有 limit**，不能把服务参数当成已暴露参数 |
| 字符预算 | max_chars=100..20000，默认20000 | 同左；search 先围绕首命中摘录每段最多6000字符 |
| 续读 | offset + next_offset；作用于同一选择结果拼接 | 同左，必须重新给相同选择参数，否则不是同一结果 |
| 相邻范围 | adjacent_count=1..3，默认1，对称前后 | 同左；按 record segment 顺序，未必等同段落数量 |
| 正常返回 | status,document_id,filename,action,content,offset,truncated,next_offset,hits,tables,reference | 多 file_id、scope、matched/total paragraphs/segments 和 paragraph_start/end |
| 表格返回 | table_id,content,provenance.chunk_id/page_start/page_end | table_id,content,provenance.paragraph_start/end |
| 表格局限 | Markdown 管道表，单块；无 HTML/合并单元格恢复 | 基于明确 table/row/cell coordinates；空缺/合并格不能保证原排版 |

`read_table` 返回没有常规 reference；`toc` 也不记录当前章节引用；普通 reference 主要保存首条 chunk 和首张 table，**没有 section_id/version_id/continuation 状态**。因此“所有位置都能自动跨轮恢复”尚未成立（`DocumentContextService.js:490-503,671-678`）。

复用依赖：稳定 ID 工具、parsePdfChunks/normalizePdfChunk、parseWordBlocks、headings 推导、tables 聚合、相邻 records、消息引用持久化。应迁移它们并补足逻辑；不能因为删除对外旧 Schema 同时删掉底层函数。list 当前只能看到已装载正文的 ready/empty 文档，pending/running/failed 需要从 ParseJob/Registry 补齐。
