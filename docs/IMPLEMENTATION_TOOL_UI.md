# Tool UI 实施说明

## 目标与边界

本阶段在现有 LibreChat `ToolNode`、SSE、`ToolCall`、`ToolCallGroup` 和消息协议上补充文档 JIT 工具的展示能力，不创建新的执行协议，也不把一个复合工具伪装成多个真实工具。

后端实际注册的文档工具仍是：

- `read_parsed_pdf`
- `read_parsed_docx`
- `execute_code`

PDF 和 Word 工具通过参数中的 `action` 表达具体读取动作。前端只在展示层把这些动作映射为友好名称和图标，执行、事件和持久消息仍保留原结构。

## 展示映射

| `action` | 用户可见名称 | Lucide 图标 |
| --- | --- | --- |
| `list` | 查找文档 | `Files` |
| `info` | 获取文档信息 | `FileText` |
| `toc` | 查看文档目录 | `ListTree` |
| `search` | 搜索文档 | `Search` |
| `read` | 读取文档 | `BookOpen` |
| `read_table` | 读取表格 | `Table` |
| `read_adjacent` | 读取相邻内容 | `ArrowRightLeft` |

未知动作、旧消息以及流式期间尚未闭合的 JSON 参数统一安全回退为“读取文档”，不会显示内部 helper 名或渲染失败。

`execute_code`、MCP、Action 和其他既有工具继续使用原有名称、图标和状态逻辑。

## 状态与交互

- 状态完全来自既有 SSE 和工具消息数据，不推测工具是否开始或完成。
- 文档工具运行时显示“正在搜索文档”等动作状态，完成后显示“已完成：读取表格”等结果状态。
- 单次和多次工具调用都继续由现有 `ToolCallGroup` 组织，默认折叠详细参数和结果。
- 展开后保留输入摘要和输出摘要；文档输出只做浅层摘要，避免把长 Markdown、正文或巨大数组完整塞入过程框。
- 原始工具结果仍保存在消息数据中，本阶段没有修改消息协议或后端返回值。
- 窄屏隐藏合并状态中的动作列表，只保留图标、工具数量和展开控制，避免文字拥挤和孤立分隔符。
- 附件和 Sources / Outputs 保持独立展示，不因过程折叠而消失。

当前工具事件没有可靠的单工具开始/结束时间。为避免虚构数据，本阶段不显示单工具耗时；整轮处理耗时继续由现有 `MessageProcessGroup` 展示。未来如需单工具耗时，应先在后端事件中增加稳定时间戳，再由前端消费。

## 兼容性

- 没有新增前端依赖。
- 保留旧工具消息、未知工具、MCP、`execute_code`、附件和历史对话兼容。
- 使用项目现有 Lucide 图标和 CSS 能力，兼容项目要求的 Chromium 80+ 构建目标。
- 没有修改数据库、真实 `.env`、工具注册、Sandbox、OpenSandbox 或文档读取实现。

## 验证

定向测试覆盖七种文档动作、未知动作、半截 JSON、运行/完成状态、单条/合并展示、输出摘要、MCP、`execute_code`、详情和附件兼容：

```bash
cd client
npm run test:ci -- --runInBand --silent \
  src/utils/__tests__/toolLabels.test.ts \
  src/components/Chat/Messages/Content/__tests__/ToolIcon.test.tsx \
  src/components/Chat/Messages/Content/__tests__/ToolCall.test.tsx \
  src/components/Chat/Messages/Content/__tests__/ToolCallGroup.test.tsx \
  src/components/Chat/Messages/Content/__tests__/ToolCallInfo.test.tsx
```

结果：5 套测试、87 项全部通过；定向 ESLint 零错误。

生产构建成功：

```bash
cd client
npm run build
```

视觉验收覆盖 1440x900 亮色、1440x900 暗色和 390x844 移动端，检查默认折叠、展开详情、合并摘要和横向溢出。临时预览路由已删除，没有进入正式变更。

全仓 TypeScript 检查仍被仓库既有问题阻断，包括缺失 `react-zoom-pan-pinch` 及旧 Agent 组件/测试类型错误；本阶段相关文件没有出现在新增错误中，生产构建已通过。

## 部署与回滚

本阶段只有前端变更。部署时需使用目标环境对应的 Chromium 80+ 构建配置重新构建并替换静态 `dist`，不需要重启 API、Code API、MongoDB 或 OpenSandbox。

回滚可恢复本阶段提交前的前端文件并重新构建静态资源；不会涉及数据迁移或持久文件恢复。
