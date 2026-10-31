# 综合升级实施变更日志

## 基线与恢复点

- 分支：`codex/architecture-upgrade-20261030`
- 初始安全检查点：`68b2318 checkpoint: preserve pre-upgrade working state`
- 未纳入提交：真实 `.env`、密钥、日志、数据库、运行数据、`outputs/`、`evidence/`、`wheels/` 和历史备份目录。
- 本次没有修改生产数据库、清理持久文件、重启内网服务、轮换密钥或启动无关 OpenSandbox。

## 分阶段提交

| 阶段 | 提交 | 结果 |
| --- | --- | --- |
| Code API 安全 | `0aa7081` | JWT/旧 key 过渡认证、主体与对象授权、路径边界和负向测试 |
| Artifact 生命周期 | `2491874` | 分类、血缘、引用追踪、报告、dry run、隔离/恢复元数据与审计 |
| PDF Document JIT | `d35d101` | 持久 MinerU 产物按页/块/章节/表格读取，不启动 Sandbox |
| Word Document JIT | `82df14b` | 持久 Mammoth blocks 按目录/段落/章节/表格读取，不启动 Sandbox |
| Sources / Outputs UI | `332c6c2` | 真实来源与交付物面板、预览/下载/缺失状态和移动端适配 |
| Tool UI | `491c67f` | 按真实文档 action 映射名称与图标，SSE 状态、折叠详情和输出摘要 |
| 渐进解耦 | 本文所在提交 | 新增 `ExecutionResourceService`，删除旧执行资源副本，保留调用顺序 |

## 新增与复用的服务

- 新增 `DocumentContextService`：统一 PDF/Word 的稳定 document ID、目录、搜索、读取、表格、相邻内容和引用恢复。
- 新增 `ArtifactService`：在现有 SanSuoFile/ParseJob/storage 上提供分类、血缘、引用和治理计划，不建立平行存储。
- 新增 `ExecutionResourceService`：只在真实执行需要时按当前用户和会话加载 Code API refs，归一化并排序可挂载资源。
- 复用 `ToolNode`、SSE、`ToolCallGroup`、SanSuoFile、SanSuoFileParseJob、MinerU、Mammoth、Code API、OpenSandbox 和现有附件/预览/下载链路。

真实文档工具仍是 `read_parsed_pdf` 和 `read_parsed_docx`。七种用户可见操作来自 `action` 展示映射，没有创建不存在的工具。`execute_code` 继续由主模型自动选择；注册工具不等于启动 Sandbox。

## 执行资源解耦

`ExecutionResourceService` 从 Agent 初始化层抽出：

- SanSuoMain 请求识别。
- 持久 Code API ref 归一化与完整性过滤。
- 当前用户、当前 conversation、`ready` 文件查询。
- 当前请求文件、已有资源和持久资源去重合并。
- 当前 PDF 与 MinerU/smart manifest 产物优先排序。
- 原 `tool_resources` 字段和日志结构保持兼容。

深度模式初始化仍不查询或挂载会话文件；只有真实 `execute_code` 调用进入工具加载时以 `force=true` 刷新资源。普通 PDF/Word 内容追问继续走后端 JIT，不启动 OpenSandbox。

`BaseClient` 中无调用方的旧资源加载、归一化和排序副本已删除。`BaseClient` 继续负责高层消息编排，没有重写、事件总线化或改变消息协议。

## 测试与验证

- Code API 安全：7 项安全顺序测试、10 项 JWT 测试，以及 Code CRUD/process/BaseClient/工具加载回归。
- Artifact：3 套 99 项。
- PDF JIT：4 套 152 项。
- Word JIT：5 套 269 项。
- Sources / Outputs：BaseClient 85 项、前端 6 项及生产构建和桌面/移动视觉验收。
- Tool UI：5 套 87 项、定向 ESLint、生产构建和 1440x900 明暗主题/390x844 视觉验收。
- ExecutionResourceService 最终回归：服务、Agent 初始化、工具策略和 ToolService 76 项；BaseClient 与 DocumentContext 101 项，合计 177 项通过。
- 最终 Node 语法、定向 ESLint、Prettier、`git diff --check` 和 `npm run build:api` 通过。

全仓 TypeScript 检查仍受仓库既有缺失依赖和旧 Agent/测试类型错误阻断；相关阶段均已通过实际生产构建。没有将既有问题误记为本次新增回归。

## 部署影响

后端需要同步本阶段服务文件、Agent 初始化入口、BaseClient 及各阶段相关文件，并确保运行容器/宿主进程实际读取这些源码或对应 patch/dist。`packages/api` 已完成构建；如果内网运行的是打包后的 `packages/api/dist`，必须同步匹配的构建产物。

前端需要按内网 Chromium 80+ 目标重新构建并整体替换静态 `dist`。仅更新源码或只重启 API 不会更新独立前端服务。

Code API 安全配置需按 `docs/IMPLEMENTATION_CODE_API_SECURITY.md` 先使用兼容过渡模式，再完成 JWT 和对象 owner 验证；不得把示例密钥直接用于生产。Artifact 本阶段只允许 dry run，不应直接执行批量清理。

部署前后必须核对真实 bind mounts、宿主 Code API 进程、容器内文件 hash、API health，并完成普通聊天、PDF/Word 连续追问、明确 Word/Excel 生成、下载和跨用户负向访问验收。

## 回滚

每个阶段均为独立提交，可按依赖逆序恢复到前一阶段。数据结构均采用兼容增量或 metadata 扩展，没有要求破坏性数据库迁移。回滚前端需重新部署上一版本完整 `dist`；回滚后端需恢复源码、patch/dist 与 Compose 挂载的一致版本，再按实际运行方式重建或重启对应服务。

不要使用 `git reset --hard` 或清理未跟踪历史目录。生产回滚应从明确的阶段提交或部署备份恢复，并保留数据库卷、上传文件、Code API storage 和用户会话。

## 未实施项

- BM25 文档索引、新向量数据库和新对象存储。
- Browser MCP、Chrome Extension 和用户浏览器登录态桥接。
- 真实批量 Artifact 删除或生产数据迁移。
- 内网生产部署与端到端验收。

这些项目按原任务边界只做评估，不属于本次代码实施。
