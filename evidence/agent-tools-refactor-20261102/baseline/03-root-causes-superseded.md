# 根因

1. 工具注册条件依赖 `_sansuoDocumentRepository` 和 `_sansuoPersisted*ContextReady`。
2. 这些状态在无新附件的请求中由关键词判断触发的历史文件恢复流程设置。
3. 因此“工具是否暴露”被用户自然语言偶然命中与否间接控制，违反按授权资源决定能力的原则。
4. 执行期 `loadToolsForExecution` 已能从当前用户和 conversation_id 刷新代码资源，但读取工具在此前没有稳定绑定，故无法补救模型看见工具后找不到实例的问题。

证据：`evidence/longpdf-accuracy-20261101/followup-gate-diagnostic.json` 与 `raw/turn_07.json`。
