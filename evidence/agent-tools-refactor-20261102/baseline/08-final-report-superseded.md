# 最终报告（当前批次）

## 结论

根因是历史会话资源恢复被自然语言关键词门控，间接造成模型看到 `read_parsed_pdf` 后执行阶段找不到对应实例。LibreChat 原生 ToolService/Registry/延迟执行链路可以满足目标，不需要新增 MCP Server 或独立 Agent 系统。

## 改造后流程

深度请求先按用户和 conversation_id 发现历史文件与持久解析产物，再将请求级读取器同时绑定到定义、Registry 和回调。模型保持自动工具选择；执行期继续由 `loadToolsForExecution` 加载并由 Handler 做当前资源校验。快速模式仍不暴露深度工具，知识库模式仍走后端知识库问答路径。

## 验证

- `node --check api/app/clients/BaseClient.js`：通过。
- `sansuoToolPolicy.spec.js`：通过。
- `initialize.spec.js`：通过。
- 新增/修改的 PDF 深度回归（含“不含 PDF/文件关键词的金秀主题切换问题”）：定向测试通过 2/2。
- BaseClient 全套当前 109 项中 102 项通过、7 项失败；失败集中在既有视觉 mock/持久 FITZ 测试和环境依赖，未将其隐藏。完整输出见本次运行记录，不能据此宣称全量回归通过。
- 尚未完成真实 Qwen Agent 新批次和内网部署验收；历史 91 页失败证据保留，未覆盖旧 gold。

## 部署判断

达到“关键词不再决定跨轮文档工具可见性”的代码级修复条件；尚未达到生产部署门槛。仍需在隔离环境执行真实 91 页连续追问、跨用户/撤权/版本失效和普通聊天 HTTP 回归，并记录源码 SHA、工具事件、引用和阶段耗时。
