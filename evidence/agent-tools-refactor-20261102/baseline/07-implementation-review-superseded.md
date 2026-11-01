# 实施复审

## 已实施

- `BaseClient` 深度模式、无新附件时总是先按当前会话历史消息发现文件；文件记录仍由数据库的用户、会话和 ready 状态约束。
- 历史文件恢复不再调用 `hasSanSuoArtifactContinuationSignal` 或 `hasSanSuoPdfContentQuestion`。
- 删除了上述两个恢复门控及其专用的 `hasSanSuoFollowupFileIntent`。
- `read_parsed_pdf`、`read_parsed_docx` 的定义、请求级实例、Registry 和执行回调保持同一名称与参数契约。
- `inspect_page` 继续是 `read_parsed_pdf` action，由 `DocumentPageVisionService` 执行；没有新增平行工具系统。

## 保留的确定性规则

权限、用户/会话资源范围、文件 MIME、解析状态、来源哈希、文档 ID、页码/表格 ID Schema 和缓存版本校验均保留。页码与视觉参数解析仍可作为工具查询参数使用；视觉摘要/原页是否预读取不改变读取工具是否暴露。

## 已知边界

视觉预读取函数仍有关键词作为成本优化信号，但 Repository 已进入按需原页路径时会跳过全页视觉摘要。当前没有在内网生产服务上部署或修改配置；发布副本的 Docker 3080 运行实例不自动加载本次工作副本。
