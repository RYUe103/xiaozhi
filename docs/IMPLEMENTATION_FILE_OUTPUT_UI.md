# 文件生成正文 UI 实施与验收

日期：2026-10-31。本机 4444 已部署；内网未部署、未验收。

## 最终设计依据

用户纠正图 1/图 2 顺序，并明确确认以 `截屏2026-10-31 07.39.22.png`（篮球策划书）完整复刻，覆盖原请求中禁止绿色标签/黑色按钮的相反文字。北极星：轻量绿色生成标签，左侧类型图标，黑色粗体文件名、灰色类型/大小，右侧黑色圆角下载按钮，正文内容说明在卡片下方。

保留现有处理过程、耗时、编辑/复制动作；不把“已分析”写死或覆盖真实状态。Word 图标已在用户后续反馈后改为微软官网 FY26 正式 SVG，本地静态加载；其他类型仍沿用 Lucide。当前不能宣称所有像素完全相同。局部自检一轮，未进行独立评审。按钮沿用轻量颜色过渡，无新增入场动画。

## 链路与最小修改

- `ContentParts.tsx`：助手真实输出附件进入 `FileOutputContext`，输出卡片在最终正文上方，来源仍在下方；过程内附件继续隐藏以免重复。
- `Markdown.tsx`、新增 `FileOutputContext.ts` / `utils/remarkFileOutputs.ts`：仅对本消息真实附件匹配的下载链接做 AST 去重，保留同名外部链接、网页引用、代码。ReactMarkdown 和 Streamdown 两条渲染路径均覆盖。去除仅下载链接及其装饰形成的空段落。
- `FileWorkspacePanel.tsx`：真实文件名、类型、bytes、状态；仅右侧按钮负责下载，复用 `useAttachmentLink` 和已有接口。多文件显示数量并纵向排列，文件名窄屏可换行。来源下载/预览不重写。
- `utils/fileWorkspace.ts`：真实输出身份检查、CSV/ZIP 类型区分；不新增文件 schema、存储或 Artifact 系统。
- `activity.ts`、`ToolOutput/OutputRenderer.tsx`：识别实际 CodeAPI 错误包络和 stderr Python traceback，显示失败原因。stderr 普通警告不误报失败。Office 的 previewRevision/previewError 状态与文件是否生成成功分开。
- 对应测试文件补充上述行为。

未修改 MinerU、ToolNode、工具执行语义、后端存储与下载路由、右侧 Sources/Artifacts 实现；完整多 Agent 并列输出布局不在本轮真实流程覆盖范围。

## 可恢复位置

- 原源码备份：`patches/before-file-output-ui-20261031-110419/`；基线 HEAD `8f2984c`，既有未提交修改保留，无提交/推送。
- 4444 原始 dist：`/Users/yooyoung/Library/Application Support/SanSuoFrontend4444/dist.before-file-output-ui-20261031-112441`。
- 最终部署前 dist：`/Users/yooyoung/Library/Application Support/SanSuoFrontend4444/dist.before-file-output-reversed-20261031-113556`。
- 最终 build ID：`20261031033422882-5bbd19fb`，见 `evidence/file-output-ui-20261031/deployment-corrected.json`。

## 运行修复

原 Docker 未运行，启动原 Docker 后恢复 API；code-api LaunchAgent 原未读取既有 .env，真实执行返回 auth_not_configured。为原 Node ProgramArguments 补 `--env-file=.env` 后重载原服务，未修改密钥/.env。启动项备份 `/tmp/sansuo-file-output-codeapi-before.plist`。原账号旧会话缺 ownership metadata 被安全策略拒绝，未绕过或认领；真实验收使用独立普通测试账号，未开放注册、未清理已有账号/文件。

## 实际验收结果

| 场景 | 实际结果 |
| --- | --- |
| Word | 真实生成 DOCX 并通过按钮下载；ZIP/XML 可读 |
| Excel | 真实生成 XLSX，下载 4970 bytes，工作表含 SUM(B2:B3) |
| PDF | 真实生成 PDF，下载 13560 bytes，PDF 头正确 |
| 多文件 | 同次执行生成 DOCX/XLSX/TXT，输出数量 3，分别下载非空 |
| 失败 | 实际执行一次 RuntimeError；显示执行失败/原因，0 输出卡片 |
| 普通文本 | 0 文件卡片，example.com 网页链接保留 |
| 继续修改 | 同会话真实修改，下载 36935 bytes；XML 保留原文且含新增段落 |
| 下载 | 桌面 6 个文件均实际点击按钮下载并核验内容；手机窄屏另下载 XLSX |
| 桌面/手机 | 1440×900、390×844；均无文档横向溢出，按钮在可视范围，手机侧栏关闭后重新截图 |

截图、下载检查 JSON、复核脚本均在 `evidence/file-output-ui-20261031/`。`before-after-excel.png` 对比同一 Excel 消息；`*-final-message.png` 和 `*-final-mobile.png` 为最终图。多文件截图含下方正常正文的文件名说明，不属于重复下载链接。单输出隐藏多余“输出 1”标题，按最终参考保留绿色标签。

定向 Jest 9 组 78 项通过；本次业务文件 ESLint 0 errors/0 warnings；Chromium80+ 生产构建通过。全仓 tsc 仍有既有 e2e config/env 等错误，本次改动相关文件未出现错误，不能声称全仓类型检查通过。未运行全量后端/SSE 测试；现有定向消息/状态测试通过。内网、真实旧版 Chromium、Sources/Artifacts 右侧面板完整浏览器流程尚未重新验收。

## 复核方式

1. 4444 登录正常测试账号，深度模式分别要求生成 DOCX/XLSX/PDF，再同轮生成三类文件。
2. 观察真实工具执行过程，结束后检查绿标签、类型、大小、唯一下载按钮与正文位置；刷新后应相同。
3. 点击按钮下载并打开；继续要求保留原文追加段落，下载更新版本核对原文/新增内容。
4. 执行一次故意 RuntimeError，预期失败且无输出文件；普通文字回答仍保留网页链接。
5. 390px 窄屏关闭导航抽屉，检查名称换行和下载；截图对照最终确认的篮球策划书参考。

复核自动脚本只连接任务创建的临时 Chrome 9335，需相同已登录测试会话；不读取用户浏览器凭据。截图保存成功后已逐张查看关键桌面、失败和移动区域。


## 后续：Word 正式图标（2026-10-31）

用户指出 Word 线框图标差距过大。已找到微软官网 Word 产品页同款蓝色渐变 W 图标，保存为 client/public/assets/file-types/microsoft-word.svg，原始来源见同目录 README.md。文件卡片 Word 分支使用本地 SVG，不依赖外网。只改图标，不改下载/状态。

源码备份 patches/before-official-word-icon-20261031/FileWorkspacePanel.tsx；前端备份 dist.before-official-word-icon-20261031-114505，build 20261031034403063-5bbd19fb。9 项文件卡片测试、单文件 lint、Chromium80+ 构建通过；真实消息桌面/手机 SVG 完整加载（naturalWidth 48），无横向溢出。截图 word-official-icon-desktop.png / word-official-icon-mobile.png 位于原 evidence 目录。此前“Word 尚非品牌图标”的限制已失效；其他类型未在本轮替换。


## 后续：统一图标与桌面缩进（2026-10-31）

用户要求其他可能出现的文件类型统一采用正式图标，同时将生成标签与具体输出稍向右移动；随后明确“我是网页，不需要手机端”。本轮只验收 1440×900 桌面网页。

- Office：保留官方 FY26 Word，补齐同系列 Excel/PowerPoint。
- PDF、图片、TXT、CSV、ZIP、Markdown、代码/JSON、音视频、未知文件：采用微软 Fluent 官方文件类型 SVG，准确来源见 client/public/assets/file-types/README.md / sources.json。全部本地加载。
- FileWorkspacePanel 的输出行和来源行复用 WorkspaceFileIcon；失败来源仍显示原错误状态。输出区 padding-left 12px，标签、数量、文件行一起右移，右侧下载按钮不移动。
- 文件分类补齐音频、视频与常见代码扩展名；保留原 text/* 源文件预览能力。未知类型使用通用文件图标。
- 本轮只涉及 FileWorkspacePanel.tsx、utils/fileWorkspace.ts、fileWorkspace 测试和本地 SVG/来源说明；不修改文件存储、工具执行或下载接口。

源码备份 patches/before-unified-file-icons-20261031（测试沿用 Git 及前次备份基线）；前端备份 dist.before-unified-file-icons-20261031-115506；build 20261031035403507-5bbd19fb。2 组 13 项测试、定向 lint、Chromium80+ 构建通过。真实 Word/Excel/PDF/三文件消息桌面截图已查看，所有 13 个 SVG 在浏览器完整解码，输出区实际 padding 12px，无横向溢出；再次点击 PDF 下载得到 13560 bytes 且 PDF 文件头正常。没有在本轮重新生成全部文件或验收手机端。

证据：evidence/file-output-ui-20261031/*-unified-icons-message.png、multiple-unified-icons-desktop.png、unified-icons-results.json、deployment-unified-icons.json。旧说明中其他类型仍为 Lucide 的陈述由本节替代。
