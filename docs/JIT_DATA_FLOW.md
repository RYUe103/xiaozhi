# JIT 数据流审计（Phase 0）

```text
上传附件
  -> processAgentFileUpload (Files/process.js)
  -> db.createFile + SanSuoFile(input)
  -> upsertSanSuoFileParseJob(parserVersion)
  -> setImmediate/runSanSuoDocumentParseJob
  -> download code-api 源文件
  -> PDF: POST MinerU /pdf_parse（本机为 127.0.0.1:5060 mock）
     Word: Mammoth；表格/图片结构化
  -> code-api 持久化隐藏 artifacts
  -> SanSuoFile(output, rootSourceLibreFileId, conversationId)
  -> 当前消息 waitForSanSuoDocumentPreparse 等待 ready
  -> buildSanSuoPreparsedFileTextContext 查询 artifacts
  -> DocumentContextService buildPdfDocument/buildWordDocument
  -> req._sansuoPdfReadSources/_sansuoDocxReadSources
  -> register read_parsed_pdf/read_parsed_docx
  -> ToolNode 调用并记录 reference
  -> userMessage.metadata.sansuoDocumentReferences
  -> 下一轮从当前消息或数据库恢复最近 reference
```

## 关键数据

### 源文件映射

`SanSuoFile` 的 `userId`, `tenantId`, `conversationId`, `messageId`, `role`, `source`, `libreFileId`, code-api `storage_session_id/file_id`, `status` 和 artifact 治理字段。源输入为 `role=input, source=upload, artifactType=source`；解析产物为 `role=output, source=sandbox, artifactType=derived`，通过 `metadata.rootSourceLibreFileId` 关联。

### 解析任务

`SanSuoFileParseJob` 保存用户、源文件、`parserVersion`, conversation/message, sourceRef, status、attempt、lease、artifact 数量和错误；唯一键是用户+Libre 文件+parserVersion。上传排队，深度首轮在 `waitForSanSuoDocumentPreparse` 中复用或领取任务并轮询。

### PDF

MinerU 返回 `md_content/markdown/md` 与 `content_list`；`buildSanSuoMineruArtifacts` 将内容列表切成约4500字符 chunks，优先页字段，稀疏列表低于 Markdown 一半时以 Markdown 重新分块。持久化 markdown、chunks、content_list、result、manifest、图片。

### Word

Mammoth 遍历段落/表格，输出 block JSONL：paragraph index、style/heading、table/row/cell index、文本和图片锚点；同时输出 reading pack、manifest、图片。`parseWordBlocks` 对超过6000字符段落分段。

### 读取和续读

`DocumentContextService.sliceContent` 用 `offset` 字符位置返回 `truncated` 和 `next_offset`；它不是签名 token。工具结果 `reference` 包含 document/chunk/page/paragraph/table 等位置，写入消息元数据并最多保留10条。跨轮恢复只选择相同 document_id 的 previousReference，但未重新查询文档版本/授权。

## 运行边界

- MinerU mock 用 `pdftotext`，扫描页不做真实 OCR；因此 mock 解析质量不能代表真实 MinerU。
- code-api 临时 sandbox 不承担跨轮持久；持久对象在 code-api storage，Mongo 映射承担会话关联。
- 当前聊天路由先做会话访问校验；`req.user.id` 和 `conversationId` 进入文件查询。JIT 工具本身拿的是已筛选请求文档 Map。
- 容器和源码关键挂载哈希一致；实际运行文件已核对，见 `runtime-audit.json`。

## 失败、重试、重复上传与版本

- 预解析只在 SanSuoMain 消息附件+execute_code 存储引用+支持 MIME 条件下排队（`Files/process.js:965-984`）；不是全站所有上传都进 MinerU。DOCX 实际走 Mammoth，不走 MinerU；旧 DOC 需要代码服务转换后再解析（`Files/Code/process.js:1713-1729`）。
- `claimSanSuoFileParseJob` 原子领取 pending/failed 或过期 running，maxAttempts 默认3，租约为解析超时+30秒；进程内 activeDocumentParses 也去重（`sansuoFile.js:403-431`、`process.js:1659-1680`）。没有看到独立常驻任务队列 worker，上传 setImmediate 和聊天等待会驱动任务。
- 相同用户+相同 Libre file ID+parserVersion 复用任务；重传同一文件内容但取得新 Libre ID 没有内容哈希去重证据。parserVersion 当前硬编码 document-preparse-v1，**不是文档内容 version_id**。
- PDF 至少 Markdown/chunks 之一持久化成功即可 ready，不等于所有图片/结构产物完整；Word 必需 blocks/manifest/reading_pack 三个文件，图片失败不阻断正文（`process.js:1178-1202,1414-1455`）。
- artifactCount/artifacts 记录成功产物名称，不等于结构质量校验；异常/耗尽重试在 ParseJob 保存错误和 failed，深度请求门控失败后不正常启动模型（BaseClient 对应测试已覆盖）。
- 上传时 conversationId=new/null 后可在首轮绑定到当前会话；`rebindSanSuoFileConversationRefs` 只允许 new/null/当前会话，并过滤 userId，不把另一已有会话的映射强行搬过来（`sansuoFile.js:477-529`）。

## 权限与可信上下文

1. `/agents` 上层 `requireJwtAuth` 建立 req.user；chat middleware 执行 Agent access 与 `validateConvoAccess`，请求 body 的会话ID是选择值，不能单独当权限（`routes/agents/index.js:41`、`chat.js:27-32`）。
2. Graph 配置的 user_id/user/thread_id/requestBody 来自服务端 client；native ToolNode 的直接 invoke 和 ON_TOOL_EXECUTE event 传 config；当前文档 handler 用闭包里的 req/Map，而不是模型传 user_id。
3. `buildSanSuoPreparsedFileTextContext` 查询 `userId+conversationId+rootSourceLibreFileId+status=ready+artifactKind`；code-api 下载使用可信用户 identity（`Code/crud.js:79-109`、`BaseClient.js:2327-2350`）。
4. `metadata.sansuoDocumentReferences` 最近10条保存于用户消息；读取前扫描 currentMessages，再按 user+conversation 查数据库消息。只恢复最后一条，可能不是用户正在追问的多个文件之一；没有 branch-aware/reference intent 选择保证。
5. continuation **没有持久状态记录**；next_offset 仅存在工具结果，reference 不保存 offset/target/version。模型/调用方需重新携带同一读取参数；跨轮自动连续位置恢复尚不足。

## 删除与撤权边界

`Files/process.js:291` 调用 markSanSuoFilesDeletedByLibreIds；实现仅按传入 libre IDs 标 deleted（`sansuoFile.js:274-283`）。派生文件有独立 synthetic Libre ID。当前 artifacts 查询过滤派生物 ready，未在每次 JIT execute 时重新验证源文件是否 deleted，**需要验证/补齐 source 与 derived 撤权级联**；本轮没有做真实删除探针。

SanSuoFile 有 tenantId 字段，但此处主查询未显式 tenantId，也没有在此模型文件发现 tenantIsolation 插件；不要直接宣称租户隔离已完整验收。需后续通过可信 tenant 筛选与跨租户负例验证。
