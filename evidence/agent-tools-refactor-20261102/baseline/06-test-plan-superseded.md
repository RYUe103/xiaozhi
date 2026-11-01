# 测试计划

- 工具策略单元测试：模式隔离、契约、Registry/definition/执行器一致性。
- BaseClient 回归：无新附件且自然主题切换时恢复历史 PDF/DOCX；不跨用户/会话；失效产物不暴露。
- ToolService：延迟工具加载和 `loadToolsForExecution` 能接收请求级读取器。
- 真实 Agent：91 页 PDF 固定追问，重点复测“换个关注点，金秀如何开展线上线下读书？活动规模有哪些数据？”。记录源码 SHA、调用时序、耗时、引用和失败。
- 普通聊天、Word、代码执行、权限与版本失效回归。
