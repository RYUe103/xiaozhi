# 当前工具架构

基线源码：`1a9922760f2fb94349b62d2717c36cfa540b892d`（2026-11-01）。

LibreChat 原生链路为 `initializeClient -> createToolLoader/loadAgentTools -> toolDefinitions/toolRegistry -> LLM -> ON_TOOL_EXECUTE -> loadToolsForExecution`。`ToolService.js` 负责通用工具分类、延迟加载和执行期加载；`initialize.js` 保存每个 Agent 的 tool context，避免把用户私有状态放入全局工具对象。

三所小智在深度模式通过 `prepareSanSuoDeepCodeCapability` 注入 `execute_code`，并在文档 Repository 与来源集合就绪后，通过 `registerSanSuoPdfReadTool`/`registerSanSuoDocxReadTool` 将请求级读取器加入定义、实例和 Registry。`inspect_page` 是 `read_parsed_pdf` 的 action，最终由 `DocumentPageVisionService.inspect` 执行。

快速模式和知识库模式不建立三所小智 Agent 工具列表；知识库模式由后端直接调用 `answerKnowledge`。当前关键缺陷不是 DynamicStructuredTool 请求级实例本身，而是无新附件的追问只有在关键词门控命中时才恢复历史文件和 Repository。
