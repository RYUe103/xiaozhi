审计日期：2026-10-31。阶段：Phase 0.5，只读审计，完成后等待审阅。
真实源码根目录：/Users/yooyoung/Documents/Codex/2026-05-12/files-mentioned-by-the-user-v58/LibreChat-main。
证据分级：源码已确认＝追踪到执行调用；运行已确认＝本轮只读配置、哈希或探针；单测已通过＝依赖替身回归；未端到端验收＝真实服务和完整聊天流程未执行。本轮不改业务代码、数据库、运行配置，不新增依赖，不调用真实 VL。

# PDF 多解析引擎专项测试矩阵

本轮不是八项端到端通过报告。已执行：3套 Jest 212/212；运行核对和代码 hash；真实 renderer 合成电子/图片/混合页探针。未执行真实 MinerU、VL、完整聊天、内网验收。

| 编号 | 输入 | 预期路线 | 产物和验收 | 当前状态 |
|---|---|---|---|---|
| T1 | 普通电子PDF | MinerU成功→JIT | Markdown/chunks非空，页标记准确，DocumentContextService按页可读 | 未真实E2E；mock只证明协议 |
| T2 | MinerU不可用 | HTTP/连接失败→FITZ→聊天VL | 全页PNG非空、主原因可追溯、真实VL摘要逐页核对 | 未E2E；已有HTTP500替身测试 |
| T3 | MinerU超时 | ECONNABORTED→FITZ；门禁可能超时 | reason=mineru_timeout，区分任务/门禁/VL超时 | 未E2E；VL无显式timeout |
| T4 | 纯扫描PDF | 主OCR成功或空正文fallback；非空占位会掩盖 | 逐页文字/数字准确率；不可把summary当全文 | renderer文字层已确认，真实VL未测 |
| T5 | 电子+扫描混合PDF | 当前可能主路径成功而漏扫描页；强制失败才整份fallback | 分页覆盖和扫描页信息；应报告自动逐页缺口 | renderer混合探针已确认；自动局部降级未实现 |
| T6 | 复杂表格 | MinerU或整份FITZ+VL | 行列、合并、跨页、公式逐项对照 | 未质量实测；无cell契约 |
| T7 | 图文混排 | MinerU图或原页复核；失败则整份fallback | 图注/流程/页码对应，missingImages可追溯 | 单测覆盖base64/远程图边界，质量未测 |
| T8 | 主备均失败 | FITZ损坏或VL HTTP/缺页/缺配置 | 最终错误可追溯，不能显示虚假成功；检查残留与重试 | 未E2E；VL全失败可能仍保留ready/partial，设计缺口 |

后续可重复执行：固定人工样本与 SHA256；在隔离环境让真实 MinerU 端点故障；读回所有产物并检查非空/JSON；记录 route、reason、attempts、页级状态、耗时；真实聊天先用小样本验证 VL；再做 JIT 按页/块/表格读取和跨会话隔离；最后按通过/失败/设计缺口/未执行归档。不得用本机 mock 代替真实 OCR。

指标：路线顺序与重试、每阶段耗时；每页关键事实/数字准确率；总页数/渲染页数/文字层页数/VL成功页数/JIT页数覆盖；表格 cell/行列/合并/公式；物理页命中率；错误可追溯；JIT Recall@K、Precision@K、MRR 只用于带标准相关页标签的检索子集。
