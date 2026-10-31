# Sources / Outputs UI 实施说明

实施日期：2026-10-31。

更新：当日后续正文输出视觉已被用户纠正后的篮球策划书参考替代，见 IMPLEMENTATION_FILE_OUTPUT_UI.md。本文的“正文之后”、单行省略及原输出行样式已失效；来源数据合同与预览机制保留。

## 1. 数据合同

后端只在持久 PDF/Word/文本/表格正文或视觉上下文实际读取成功后记录来源，并随助手消息保存到
`metadata.sansuoSources`。每项只包含：

```json
{
  "file_id": "...",
  "filename": "...",
  "type": "application/pdf",
  "source": "local",
  "bytes": 12345,
  "status": "ready",
  "kind": "file"
}
```

不保存或下发 filepath、storage session、Code API ref、内部 metadata 或文档正文。来源按 file ID
去重并限制为 30 项。记忆当前只能证明被注入，不能证明模型实际使用，因此本阶段不显示记忆来源。

## 2. 输出与来源

- Outputs 只取助手消息的真实附件，过滤 Web Search、Memory、工具可见性内部产物和重复文件。
- Sources 只取后端确认本轮实际读取的根文件，不把聊天中所有历史附件冒充来源。
- Outputs 位于 Sources 上方；两者均使用紧凑文件行和 Lucide 图标。
- PDF/JSON/Markdown/文本来源可预览，Office 文件直接下载。
- 不可用来源显示明确失败状态并禁用操作。
- 文件名使用单行省略和 title，多个输出改为纵向紧凑行，避免移动端宽卡片溢出。
- 没有真实数据时整个面板不渲染；没有真实添加动作时不显示加号。

过程区不再重复渲染工具附件。最终输出统一放在正文之后，折叠处理过程不会隐藏交付文件。

## 3. 兼容性

- 消息 metadata 字段为可选，旧消息继续按原方式显示正文。
- 不修改 File、SanSuoFile 或 Message schema，不需要数据库迁移。
- 使用现有下载、文件预览、Recoil、React Query 和 Lucide，不新增依赖。
- 折叠使用 max-height/opacity，保留 Chromium 80+ 兼容性。
- 新增简体中文、繁体中文和英文界面文案，其他语言沿用英文 fallback。

## 4. 验证

自动验证：

- `BaseClient.test.js`：85/85；
- `fileWorkspace.test.ts` 与 `FileWorkspacePanel.test.tsx`：6/6；
- 定向 ESLint：0 error，仅 BaseClient/ContentParts 既有 warning；
- Prettier、Node 语法和 `git diff --check` 通过；
- `npm run build:client` production build 成功。

视觉验收使用临时本机开发入口加载真实组件和样式，入口验收后已删除，不进入提交。已检查：

- 1440×900 暗色桌面；
- 390×844 亮色移动端；
- 长中文文件名、两个输出、三个来源；
- 预览/下载按钮、不可用状态和 Sources 折叠；
- 移动端无横向溢出。

当前本机测试账号没有历史助手输出文件，所以没有修改数据库伪造真实会话。内网仍需用真实文件生成和
文档追问各验收一次。

## 5. 部署与回滚

后端部署需要同步 `BaseClient.js`；前端需重新构建并发布完整静态 `dist`。仅重启 API 不会更新
前端，且本机 4444 稳定目录不会自动读取源码仓库 `client/dist`。

回滚使用本阶段提交的 `git revert`。旧消息中已存在的可选 `metadata.sansuoSources` 无需清理；
旧前端会忽略该字段。
