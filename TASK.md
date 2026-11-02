# PDF阅读升级第二阶段（2026-11-02）

当前任务：按用户第二阶段要求完成A全文/扫描与真实预算，阶段验收后依次B子父块实验、C表格及事实覆盖、D质量/缓存/真实回归。保持Query Rewrite行为/配置/测试不变，不新增路由/查询模型/MCP。

恢复点：/tmp/xiaozhi-publish-20261031，分支codex/pdf-page-vision-wip-20261031，HEAD及远端59f412220bda922b1b0c161a764adbe4e6d51048。初始仅两个依赖软链接未跟踪。此前任务与失败证据见evidence/pdf-retrieval-upgrade-20261102/REPORT.md，禁止覆盖。

范围：只修改开发工作树，必要运行验证在容器隔离3185与专用Mongo；不改主3080/生产.env/内网/gold，不自动提交推送。

验收：签名续读、原文顺序/偏移/去重/覆盖与缺页、实际上下文预算和ToolNode大输出、真实Agent短长PDF/多轮、同题A/B、权限撤销版本变化、HTTP普通文件回归。区分单元/工具/真实Agent及AI暂评。

进度：完成初步源码审计与远端核对；正在核查Agent上下文预算及ToolNode。阶段A已修改业务代码；70项相关测试通过。隔离真实Agent试跑因Qwen返回Arrearage未进入工具，已在付费恢复后重跑：read_full 预算拒绝、严格扫描最终诚实报告未读范围；尚未达到完整长文 Agent 自动扫描的部署门槛。新证据目录evidence/pdf-reading-stage2-20261102/。
