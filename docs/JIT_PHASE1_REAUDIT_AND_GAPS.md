# JIT Phase 1 目标驱动复核与缺口清单

日期：2026-10-31。此次复核按最终 Agentic JIT 任务成功标准进行，不把上一轮报告或 219 项单测通过当作完整交付证明。

## 总结判定

上一轮 Phase 1 只能标为“部分实现”，不能标为完整统一读取层。新增 Adapter 能转换数据，但真实 Agent 仍主要通过 BaseClient 临时组装旧 PDF records；visualIndex 没有成为 read_parsed_pdf 的统一数据源。

| 能力 | 状态 | 真实证据与影响 |
|---|---|---|
| MinerU/FITZ/VL 类型区分 | 部分实现 | DocumentArtifactAdapter.js 已区分 extracted_text、visual_summary；但 Adapter 未成为主读取路径，BaseClient 仍有独立解析逻辑 |
| 页面覆盖 | 部分实现 | Adapter 可聚合覆盖，但没有统一挂到 read_parsed_pdf 的 info/list/read 响应，Agent看不到可靠覆盖 |
| visualIndex 读取 | 部分实现 | BaseClient 只做版本/来源校验和视觉上下文注入；read_parsed_pdf 不读取 visual_summary |
| 纯扫描页 | 部分实现 | 能知道 FITZ 文字层为空；Agent工具无法独立读取 VL summary，也无法清晰返回“摘要可用、正文不可用” |
| 混合 PDF | 部分实现 | 页图和 summary 可在视觉上下文中存在；正文 JIT 仍只选文字 chunks，覆盖不统一 |
| 长章节精准读取 | 未实现 | DocumentContextService section 已按标题边界改进，但内容仍先拼接再 slice；没有命中中心摘录和安全 continuation token |
| 跨 chunk 表格 | 未实现 | 只识别单 chunk Markdown pipe table；MinerU HTML/table_body、FITZ扁平文字、VL summary没有统一结构表格模型 |
| 安全续读 | 部分实现 | offset/next_offset 是裸字符偏移，不绑定文档版本、权限和来源；旧引用只保存 document/chunk/table |
| 历史引用 | 部分实现 | 旧 ID继续存在，但没有完整验证历史引用在新的统一 Adapter 与视觉摘要通道中可恢复 |
| Agent真实工具链 | 未验证 | 只有工具注册和替身单测；没有真实登录会话下发现、检索、页码、表格、权限、预算端到端证据 |
| 真实解析质量 | 未验证 | 本机 MinerU 是 pdftotext mock；真实 MinerU/VL、扫描 OCR、复杂表格尚未验收 |

## 必须补齐的结构性问题

1. 统一 Adapter 必须成为唯一读取事实层。BaseClient 的正文加载、视觉摘要和 read_parsed_pdf 都从同一个 DocumentArtifactRepository/Adapter 获取。
2. 增加页面覆盖 envelope，至少返回 textStatus、visualStatus、engines、warnings、pageCount、availablePages、missingPages。
3. 给 visualIndex 加 source content hash、parser/index version、model version和明确 root/user/conversation 绑定；旧索引缺绑定时标记 unknown，不当作可信 complete。
4. 设计安全 continuation token：服务端签名，绑定 user、conversation、document、source version、action、offset/record cursor、过期时间；禁止模型提交裸路径和任意 offset 跨文档复用。
5. 章节读取改成记录游标/命中中心窗口，返回 next token；不把整个章节先拼接后截断。
6. 表格模型区分 markdown_table、structured_table、flat_text、visual_summary；只有可靠结构来源支持 read_table；跨 chunk 只有表头、边界和列数可验证时重组。
7. read_parsed_pdf 增加视觉摘要只读动作，例如 visual_page、visual_search 或 read 的 include_visual_summary 选项，但不能把 summary 混进正文。
8. 用真实 Agent 工具链验收：工具发现、问题检索、页码读取、章节续读、表格、相邻上下文、来源引用、预算、跨用户/会话拒绝。

## 当前不应继续做的事情

不要继续增加只在 BaseClient 或 Adapter 外围的兼容补丁；先确定统一 Repository 接口和安全 token 契约，再把旧路径迁移到该接口。
