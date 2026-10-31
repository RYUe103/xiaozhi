# Agent Activity 状态展示实施说明

## 目标与边界

本阶段在 LibreChat 已有 Agent Graph、ToolNode、SSE、消息内容和工具组件上，增加三层用户可见执行状态：

- Activity：默认只显示一句当前阶段或最终结果。
- Timeline：展开后按真实工具调用和思考里程碑显示执行顺序。
- Details：用户继续展开单个工具后，显示浅层参数、返回摘要和真实错误。

状态不等同于模型内部推理。本阶段不展示 Chain of Thought，不新增进度百分比，不根据预计步骤虚构进度，也不改变 ToolNode 的执行语义、消息协议或工具返回数据。

## 真实事件链

```text
Agent Graph / ToolNode
  -> api/server/controllers/agents/callbacks.js
  -> 现有 SSE 事件
     ON_RUN_STEP
     ON_REASONING_DELTA
     ON_RUN_STEP_DELTA
     ON_RUN_STEP_COMPLETED
  -> client/src/hooks/SSE/useStepHandler.ts
  -> 聚合为 message.content 中的 reasoning / tool_call parts
  -> ContentParts.tsx
  -> MessageProcessGroup / ToolCallGroup / ToolCallInfo
```

事件与界面的映射如下：

| 真实数据                    | 现有作用                      | 用户可见状态                 |
| --------------------------- | ----------------------------- | ---------------------------- |
| `ON_RUN_STEP`               | 建立工具调用 part             | 工具“进行中”                 |
| `ON_REASONING_DELTA`        | 更新 reasoning part           | 只显示“正在思考”或“思考完成” |
| `ON_RUN_STEP_DELTA`         | 增量更新工具参数              | 更新详情，不新增 Activity 行 |
| `ON_RUN_STEP_COMPLETED`     | 写入 `progress: 1` 和真实输出 | 工具“已完成”或“失败”         |
| final message               | 结束本轮提交并给出正文        | Activity 变为终态并自动收起  |
| resumable SSE sync snapshot | 恢复聚合后的消息内容          | 重连后从真实内容恢复状态     |

因此没有增加新的 Activity SSE。高频 token、reasoning delta 和参数 chunk 仍由原 hook 聚合，展示层只从当前聚合结果派生状态，避免为每个 chunk 创建时间线节点或增加协议负担。

## 重复事件根因

真实持久消息的执行序列可能是：

```text
THINK -> TOOL_CALL -> THINK -> TOOL_CALL -> THINK -> TEXT
```

旧版 `ContentParts.tsx` 直接把 `THINK` 与 `TOOL_CALL` 当作过程行渲染，
`groupSequentialToolCalls` 又只合并物理相邻的工具调用。因此 reasoning 会把同一任务的两次
`execute_code` 隔开，最终形成“思考完成 / 代码执行 / 思考完成 / 代码执行”的机械流水账。

本次没有通过 CSS 隐藏这些行，而是在前端增加确定性的 Activity Aggregator：Raw Events 仍保存在
消息和展开详情中，Activity 只从真实工具名、参数、结果与生命周期投影语义阶段，Deliverables 继续
由现有 Outputs 组件独立展示。

## 三层展示

### Activity

`ContentParts.tsx` 从现有文件解析状态、知识检索状态和工具 part 推导一句话状态：

- 正在处理
- 正在解析文件
- 正在检索资料
- 正在生成 Word 文档等有真实证据的语义阶段
- 正在整理结果
- 已处理，耗时 N 秒
- 执行失败 · 真实错误摘要
- 处理已中断，耗时 N 秒

`MessageProcessGroup.tsx` 使用 Lucide 图标区分运行、成功、失败和中断。运行时只有一个克制的旋转图标；完成使用低饱和绿色，失败使用红色，中断使用中性灰。数字使用 `tabular-nums`，并保留 `prefers-reduced-motion` 降级。

整轮计时优先使用消息中的真实开始时间和已保存耗时。组件重新挂载时可继续显示同一轮时间；没有结束时间的历史记录不会被伪造为已完成耗时。

### Timeline

`activity.ts` 和 `ToolCallGroup.tsx` 按工具的真实生命周期显示“进行中 / 已完成 / 失败 / 已中断”。
语义分类只使用工具名、参数、返回结果和任务生命周期，不读取 reasoning 文本猜测进度：

- 生成或读取 `.docx` 显示 Word 阶段。
- 生成或读取 `.xlsx` 显示 Excel 阶段。
- PDF 读取、搜索、页码、条款和表格动作按真实参数显示对应阶段。
- 简单计算显示“执行计算”；证据不足时安全回退为“执行代码”或工具原有名称。
- 相同语义阶段可以跨 reasoning 合并；不同语义阶段保持真实顺序。
- 重复 SSE snapshot 按工具调用 ID 去重；同阶段重复状态更新原阶段，不追加新行。

已完成语义阶段默认折叠，不受旧“自动展开工具”偏好影响；没有语义标签的旧工具组和子 Agent
继续沿用原设置。整轮完成后默认折叠，失败和中断默认展开。用户按需展开阶段后，仍能看到其中
每个真实 ToolCall。

### Details

`ToolCallInfo.tsx` 保留现有参数展示和 UI Resource 渲染，但工具返回只展示摘要：最多 12 行、1200 字符。完整原始输出仍在消息数据中，不修改工具返回或持久化结构。

工具参数继续采用浅层结构化展示；错误只显示真实错误摘要，不展示原始调试日志或完整工具 JSON。

## 思考内容边界

reasoning/thinking 不再生成 Activity 或 Timeline 项，也不参与语义阶段命名。原始 part 仍保留在
消息和持久数据中；本次没有删除工具参数、工具输出或最终答案，也不影响后端事件和消息持久化。

过程组外的旧消息兼容逻辑保留，避免改变其他模型或历史消息的既有渲染契约。

## 生命周期判定

`activity.ts` 统一把现有工具 part 投影为四种生命周期：

- `running`：存在真实工具调用，尚无终态，且本轮仍在提交。
- `success`：`progress === 1` 或已存在真实完成输出，且没有错误状态。
- `failed`：工具状态为 `failed/error` 或存在真实错误字段。
- `interrupted`：工具尚未完成但 SSE 已停止，或整轮已停止、存在过程内容但没有最终正文。

最终状态从真实消息内容和提交状态派生；完成后不会继续显示运行中。真实页面测试发现“工具已经
成功、但用户在最终回答前停止”的情况原先会误报完成，现已按整轮生命周期显示中断。

## 单工具耗时限制

当前消息协议没有为每个工具提供可靠、持久化的开始和结束时间戳。`ON_RUN_STEP` 与 `ON_RUN_STEP_COMPLETED` 可以表达生命周期，但重连快照和历史消息不能稳定还原每个事件的到达时间。

因此本阶段只展示整轮真实耗时，不展示单工具耗时。以后如需单工具耗时，应先在后端工具事件和持久消息中增加稳定时间戳，再由前端消费；不能用浏览器收到事件的本地时间代替。

## 流式空槽修复

真实页面验收时发现，流式 `content` 数组可能暂时包含 `undefined`。`MessageNav.tsx` 原先直接读取 `part.type`，会抛出异常并干扰页面状态观察。

现在预览提取会跳过空槽，并有定向测试覆盖。修复不改变消息内容或导航协议，只提高流式渲染容错性。

## 测试与验证

前端测试覆盖单次代码、多次代码、纯 reasoning、PDF 多次读取、多工具顺序、Word 跨 THINK 合并、
Excel 读取与生成、失败、中断、重复 SSE snapshot、最终完成、耗时恢复、详情摘要、MessageNav
流式空槽，以及附件只进入文件工作区而不在过程区重复显示。语义聚合初版 9 套 125 项通过；
最后的默认折叠与整轮中断修正又运行 7 套 88 项，全部通过。

SSE 回归覆盖事件聚合、中断、重连、resume 和 sync snapshot：

```bash
cd client
npm run test:ci -- --runInBand --silent \
  src/hooks/SSE/__tests__/useStepHandler.spec.ts \
  src/hooks/SSE/__tests__/useResumableSSE.spec.ts
```

结果：2 套、67 项全部通过。

相关文件定向 ESLint 零错误。全仓 TypeScript 检查仍被仓库既有缺失依赖和旧组件/测试类型错误阻断；本阶段新增的类型错误已修复，生产构建成功。

Chromium 80+ 构建命令：

```bash
cd client
SANSUO_LEGACY_CHROMIUM=true npm run build
```

构建成功，共转换 9373 个模块。最终构建已部署到本机 4444，构建 ID 为
`20261030181220030-5bbd19fb`，主 bundle 为 `index.DZYy2YqO.js`。

登录态真实验收结果：

- 普通问题只保留整轮耗时，不再生成“思考完成”时间线行。
- `98765 * 4321` 真实调用 `execute_code`，完成后默认只显示“已处理，耗时 20秒”；展开整轮后
  只显示一行“执行计算”，继续展开才显示代码、参数和 stdout。
- 新请求 `19 * 23` 的真实状态依次为“正在处理”与“正在整理结果”。模型实际重复调用两次
  `execute_code`，UI 仍只显示一个“执行计算”阶段，原始两次调用保留在详情中。
- 该请求在模型超过 1 分钟仍未结束后被人工停止；重新加载后准确显示
  “处理已中断，耗时 1分49秒”，不再误报“已处理”。
- 当前登录测试账号没有 Word 历史消息；已知 Word 消息属于另一用户，权限检查正确返回“对话未找到”。
  Word 的两次生成调用合并由真实消息结构分析和自动测试验证，没有绕过用户隔离做页面验收。
- 本次浏览器实际视口为 319x779，`scrollWidth === innerWidth === 319`，无横向溢出。桌面布局沿用
  上一阶段 1440x900 基线；本轮浏览器控制面不能切换视口，因此没有伪称重新取得桌面截图。
- Outputs 组件代码未改，当前账号本轮未生成文件，未重复执行新文件下载验收。

## 部署与回滚

本阶段前端运行构建位于：

`/Users/yooyoung/Library/Application Support/SanSuoFrontend4444/dist`

备份：

- Activity 部署前：`/Users/yooyoung/Library/Application Support/SanSuoFrontend4444/backups/dist.before-agent-activity-20261031-014100`
- MessageNav 修复前：`/Users/yooyoung/Library/Application Support/SanSuoFrontend4444/backups/dist.before-message-nav-fix-20261031-014501`
- 本次语义聚合部署前：`/Users/yooyoung/Library/Application Support/SanSuoFrontend4444/dist.before-agent-activity-20261031-020537`

回滚时恢复对应 `dist` 备份并重载 4444 前端服务即可。本阶段没有数据库迁移，不需要修改或恢复 MongoDB、上传文件、生成文件、Code API storage 或 OpenSandbox。

## 影响范围

- 不改变 ToolNode 执行语义。
- 不改变 SSE 或消息协议。
- 不新增依赖。
- 不修改工具注册、Sandbox、OpenSandbox、数据库或真实 `.env`。
- 旧工具消息、未知工具、MCP、`execute_code`、附件和 Sources / Outputs 继续兼容。
