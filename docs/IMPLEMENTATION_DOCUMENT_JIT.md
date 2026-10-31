# Document JIT 实施说明

实施日期：2026-10-30。

## 当前进度

- PDF JIT：已实施。
- Word JIT：已实施。
- Excel/PPT JIT：不在本次 PDF/Word 阶段范围。

## 1. PDF 架构

PDF 仍沿用既有上传和解析链：

```text
LibreChat File
  -> SanSuoFileParseJob
  -> MinerU（失败时既有 PyMuPDF + VL 路径）
  -> Markdown / chunks / content list / images / manifest
  -> Code API storage + SanSuoFile
```

本阶段没有重新解析历史 PDF，也没有改变 MinerU 产物格式。`DocumentContextService` 在后端成功
下载既有 chunks/Markdown 后建立请求级 PDF Adapter。普通正文仍由后端自动选择并注入；只有上下文
不足、指定页、完整表格、目录或相邻内容需要补读时，模型才调用请求级 `read_parsed_pdf`。

`read_parsed_pdf` 不注册到 Code API，不准备 execute_code resources，不创建 OpenSandbox。

## 2. 稳定身份

Document、chunk、section、table ID 使用 owner 与现有文件/记录身份生成确定性 SHA-256 摘要：

- `doc_<20 hex>`；
- `chunk_<20 hex>`；
- `section_<20 hex>`；
- `table_<20 hex>`。

ID 不包含 storage session、file path 或 `/mnt/data`。同一用户同一 LibreChat file ID 保持稳定；
不同用户不能得到相同 document ID。

旧 MinerU `chunk_id` 保留为 provenance 的 `source_chunk_id`，无需数据迁移。

## 3. PDF Adapter 能力

一个复合只读工具提供七类逻辑能力，避免堆叠多个服务：

| action          | 逻辑能力                                   |
| --------------- | ------------------------------------------ |
| `list`          | 列出当前可访问 PDF                         |
| `info`          | 文档页数、chunk、section、table 数量和状态 |
| `toc`           | 从 Markdown heading 建立目录和 section ID  |
| `search`        | 当前持久 chunks 的关键词定位               |
| `read`          | 按 page、chunk 或 section 读取             |
| `read_table`    | 按稳定 table ID 读取完整 Markdown 表格     |
| `read_adjacent` | 按 chunk ID 读取前后内容                   |

单次返回最多 20000 字符，超出时返回 `truncated` 和 `next_offset`。多份 PDF 存在时不猜测文件，
必须先 `list` 并传 `document_id`。

## 4. 跨轮引用

工具返回 provenance 后，将最近 10 个引用写入当前真实用户消息的
`metadata.sansuoDocumentReferences`，字段包含 document、chunk、page、table 和记录时间。
写入前最多短暂等待 5 次确认消息已经落库，避免模型很快调用工具时先更新、后插入造成引用丢失。

下一轮恢复顺序：

1. 当前加载消息树里的最近引用；
2. 如果消息树因摘要或截断没有引用，从当前用户、当前 conversation 的 Message metadata 查询；
3. 无稳定引用时要求重新 search/list，不根据自然语言伪造 ID。

“第二行是什么意思”“下一段呢”可以沿用上一 table/chunk。上一引用只有在其 `document_id` 与本次
目标文档一致时才可复用；切换 PDF 后不会把旧 table/chunk 引用套到新文档。

## 5. 错误与回退

- 多 PDF 未指定 ID：`document_id_required`；
- 解析产物为空：`unavailable`；
- 页、chunk、section、table 未命中：`not_found`；
- 单行 JSONL 损坏：跳过该行，保留其他合法 chunks；
- 整体产物缺失或 ParseJob 失败：沿用现有明确失败链，不进入 Sandbox 重读 PDF；
- 视觉细节：沿用既有持久视觉索引和原页复核，不由文本 JIT 工具伪造。

## 6. 与 execute_code 的关系

深度模式仍同时具备 `execute_code`。PDF 普通读取和推理计算不需要它；根据 PDF 生成 Word/Excel、
批处理或真实代码计算时仍可调用 execute_code。工具加载器对 `read_parsed_pdf` 提前返回，因此只读
工具事件不会刷新会话代码资源或初始化 OpenSandbox。

提示词和 execute_code 工具说明已同步：

- `execute_code` 是唯一代码/文件执行工具；
- `read_parsed_pdf/read_parsed_docx` 是请求级持久产物只读工具；
- 禁止发明或调用 `read_pdf_smart/read_pdf_find` 等旧名称。

## 7. 测试

PDF 阶段定向测试：4 套、152 项全部通过。

覆盖：

- 稳定且 owner 隔离的 document/chunk ID；
- malformed JSONL 局部容错；
- info、TOC、关键词、指定页、完整表格、相邻 chunk；
- 上一 table 引用；
- Message metadata 数据库恢复和消息落库时序；
- 跨文档引用隔离、owner 隔离和显式 chunk ID 稳定性；
- 空/整体损坏产物状态和保守 Markdown 表格识别；
- 多 PDF 必须明确 document ID；
- request-local reader 的 ToolNode 延迟加载；
- 首轮和后续 PDF 问答不请求 `/v1/exec`；
- `execute_code` 与只读工具并存。

运行：

```bash
npx jest --config api/jest.config.js \
  server/services/DocumentContextService.spec.js \
  server/services/Endpoints/agents/sansuoToolPolicy.spec.js \
  server/services/__tests__/ToolService.spec.js \
  app/clients/specs/BaseClient.test.js \
  --runInBand
```

## 8. 部署与回滚

本阶段修改 LibreChat API 源码、运行时 handleTools patch 和 `librechat.yaml`，没有修改 Code API
进程。部署时必须核对 BaseClient、ToolService、policy、DocumentContextService、handleTools patch
和 yaml 的实际 bind mounts/build 来源；新增 Service 若容器未挂载源码目录，需要随镜像或新增明确挂载。

不需要数据库迁移。Message metadata 为可选字段，旧消息继续兼容。

回滚使用本阶段提交的 `git revert`；不要清理 Message metadata、SanSuoFile、MinerU 产物或 storage。

## 9. Word 架构

Word 继续复用现有上传预解析链，不打开原文件建立第二套存储：

```text
LibreChat File
  -> SanSuoFileParseJob
  -> Mammoth document AST
  -> reading markdown / blocks.jsonl / images / manifest
  -> Code API storage + SanSuoFile
  -> DocumentContextService Word Adapter
```

新生成的 `blocks.jsonl` 在原有段落文本基础上保存可选的 `style_id`、`style_name`、
`heading_level` 和 `table_index/row_index/cell_index`。Mammoth 表格节点只遍历一次，段落不会因通用
children 遍历而重复。历史 blocks 不迁移、不重解析，仍可按段落和关键词读取。

## 10. Word Adapter 能力

`read_parsed_docx` 与 PDF 只读工具保持相同的七类 action：`list`、`info`、`toc`、`search`、
`read`、`read_table`、`read_adjacent`。Word 使用稳定 document、paragraph、chunk、section 和 table ID；
多份 Word 必须通过 `list` 选择 `document_id`。

章节读取从命中标题开始，到下一个同级或更高层级标题之前结束。新 blocks 可恢复真实标题样式和
表格坐标；旧 blocks 仅保守识别 Markdown/中文编号标题。旧产物没有表格坐标时明确返回
“现有解析产物没有可定位的表格结构”，不会猜测表格边界，也不会为此调用 execute_code 打开原 Word。

旧版 `file_id/query/paragraph_start/paragraph_end/offset` 调用继续兼容。跨轮引用复用
`metadata.sansuoDocumentReferences`，且必须同时匹配 owner、conversation 和 document ID，避免多文件串读。

## 11. Word 测试

Word 阶段定向回归共 5 套、269 项全部通过（包含最终兼容边界测试）。覆盖：

- Mammoth 标题元数据和表格坐标持久化，表格段落不重复；
- 稳定 ID、目录、章节截止、段落、关键词、完整表格和相邻内容读取；
- 旧 blocks、旧工具参数、多 Word 选择、owner 与跨文档引用隔离；
- `null`、零和负数表格坐标不被误识别为真实表格；
- 空或损坏产物明确返回 unavailable；
- 首轮与后续 Word 补读不请求 `/v1/exec`，同时保留真正生成/修改文件时的 execute_code。

运行：

```bash
npx jest --config api/jest.config.js \
  server/services/DocumentContextService.spec.js \
  server/services/Endpoints/agents/sansuoToolPolicy.spec.js \
  server/services/__tests__/ToolService.spec.js \
  server/services/Files/Code/process.spec.js \
  app/clients/specs/BaseClient.test.js \
  --runInBand --silent
```
