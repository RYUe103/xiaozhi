# 根因与证据

> 以下保留实施前检查点，基于 1a99227；不代表最新状态。实施与实测结论见 07、08 和独立 evidence 目录。
历史 turn_07：156.870 秒、8 次主模型、7 次工具；3 次 PDF not found，直接 FITZ 被沙箱策略拒绝，最终读取既有 Markdown。证据原封保留在 evidence/longpdf-accuracy-20261101/raw/turn_07.json 与 failure-analysis.md。两恢复 helper 均 false，当前请求未重建 Repository；工具名称可从历史调用进入模型上下文，不等于证明本轮 schema 已暴露。不能断言“本轮 schema 存在而 handler 缺失”，需要新运行抓取各层工具集合。

结构根因：资源发现、正文检索、视觉预处理、工具注册耦合。仅取消 if 会每轮完整下载与检索，并且只恢复最近一条带文件消息；有新附件时历史文档仍不恢复。因而局部试验不能满足目标，已保存 patch 后撤回。

权限根因待修：PDF executeAsync 通过 authorize 复核当前 artifact signature/root hash；Word 当前回调直接执行快照。Repository.load 对部分缺少身份字段的旧产物容忍，必须由上游已认证查询提供范围。不能把模型遵守 document_id 当鉴权。

基线自动测试已执行并保存 baseline/jest.json 和 jest.log：109 项，104 通过、5 失败，均为旧 eager 视觉测试预期与按需链路不一致。试验曾额外两项失败，修改 ready 标记断言后的通过不作为基线通过；原断言已恢复。
