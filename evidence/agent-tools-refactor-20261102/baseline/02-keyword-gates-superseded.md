# 关键词门控审计

已确认的业务门控位于 `api/app/clients/BaseClient.js`：

- `hasSanSuoArtifactContinuationSignal` 与 `hasSanSuoPdfContentQuestion` 控制无新附件时是否执行 `findRecentMessageWithFiles -> db.getFiles -> addFileContextToMessage`。
- `shouldBuildDocxVisualContext`、`shouldReviewPdfOriginalPage`、`isVisualDocumentFollowup`、`shouldRefreshVisualWithVL` 还控制视觉上下文准备；这些应只影响预读取/视觉复核成本，不应影响文档工具的授权暴露。
- `getSanSuoRequestedPdfPages`、`isSanSuoWholePdfRequest` 是确定性页码/范围解析，可保留为检索参数处理，不应用来决定工具是否存在。

既有诊断显示自然主题切换会让两个恢复门控均为 false，导致 Agent 看到或调用 `read_parsed_pdf` 时出现 not found。修复方向是用当前用户、conversation_id、历史消息文件关系和 ready/版本状态恢复资源，用户文本只作为查询参数，不作为资源可用性的前置条件。
