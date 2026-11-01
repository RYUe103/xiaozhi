# Phase 5 真实 Agent 验收报告（2026-11-01）

## 范围与冻结输入

开发分支 `codex/pdf-page-vision-wip-20261031`，基线 `f345e175600c1e95f2733cd8f938932f0e172ac7`。冻结题子集哈希见 `integrity.json`；原 PDF、题目、gold、历史失败记录未修改。r1-r5 每批独立保存，未混合最佳答案。所有真实运行使用隔离 API、Mongo 和 code-api 存储，生产 3080、内网服务和 `.env` 未改。

## 已实施

- `ModelTransportReliability.js` 只对模型 HTTP 首字节前的瞬时网络/503/限流做有界重试；流开始后不重播，异常持久化为明确未完成错误。
- `DocumentPageVisionService.js` 保留 raw model output，结构化 cells/series/uncertainties；`finish_reason=length`、非 stop、缺绑定证据和解析失败均为 `partial`。
- `render_pages.py` 与 `process.js` 对大页使用像素预算；区域从 PDF 直接 FITZ 渲染，保存 source hash、renderer version、region、DPI 和尺寸。布局块/坐标仍是可选导出。
- `BaseClient.js` 将原始用户问题传入视觉提示，持久视觉引用带 document/page/hash/image/region/result/version；文档授权和源版本每次缓存命中前复核。
- `DocumentToolResult.js` 保留完整 source reference/page coverage；`DocumentVectorSearch.js` 缓存绑定源 hash、文档版本、解析器/引擎和模型；工具策略明确跨页、partial 与不确定边界。

## 真实结果

历史 r3：候选 P50/P95 105.418/288.665 秒，基线 86.571/221.052 秒；不能宣称提速。r4 两臂 7 题全部产生最终回答，候选 P50/P95 125.177/281.000 秒，基线 125.115/294.569 秒；仅为描述性小样本，不能作为 SLA。r4 候选海报自动定位并真实 `inspect_page`/FITZ/Qwen VL，核心答案 `2016-17 T3` 正确，但附加媒体数与冻结证据不一致，故该题不算完整事实通过。候选扫描题取得“既有高度又有深度、通俗易懂、阵阵好评”等原文片段，最终答案仍需人工核对，不能以页码命中替代事实评审。财务题视觉结果为 `partial`（输出截断/超过 max_chars），未当完全成功。

r4 的候选手机、财务、海报、树图、表格、Netflix、扫描结果见 `candidate/r4/`；基线见 `baseline/r4/`。模型/检索/工具阶段脱敏事件在各自 `events.jsonl`、`timings.jsonl`。`retrieval-metrics.json` 仅报告真实 trace 的物理页 Recall@6/@10 和原文片段到达情况，不把召回当答案正确率。

## 生命周期与回归

真实缓存检查 `cache-r4-attempt4.json`：17 个产物加载为 27 个解析记录；持久视觉命中 0 次渲染/0 次 VL，撤权返回 `DOCUMENT_ACCESS_DENIED`，源 hash 变化返回 `DOCUMENT_VERSION_MISMATCH`；向量热查第二次 0 次 embedding。第一次因测试身份头缺失得到 401，原始失败保留。

16 个相关 Jest 套件 303 项通过，日志 `regression-round3.log`。Agent 专项新增的内部 deadline 记账与空答案失败测试通过，日志 `agent-lifecycle-focused.log`。原 `client.test.js` 另有 14 项历史 memory/subagent 测试失败；用基线客户端复现，未归因于本轮 PDF 改动。

普通聊天、DOCX/CSV/权限 HTTP 回归脚本已补齐，但本轮尚未完成新的隔离运行；不能宣称通过。故障注入脚本已准备，尚未把注入错误写成自然供应商失败。

## 未完成与部署结论

尚未完成稳定的 r5 全 7 题重复、完整100题评分、独立盲评、真实普通 Word/Excel/权限端到端回归、自然模型错误恢复及扫描小字/公式/复杂表格的全面事实核验。r4 已显示解析云端耗时可达约222秒，普通文字非退化仍未证明。当前不达到内网生产部署门槛。

可重复命令：

```bash
docker exec LibreChat node /tmp/run-phase5-matrix.cjs candidate rN
docker exec LibreChat node /tmp/run-phase5-matrix.cjs baseline rN
python3 scripts/evaluation/document-jit/summarize-phase5.py evidence/phase5-20261101
python3 scripts/evaluation/document-jit/phase5-retrieval-metrics.py evidence/phase5-20261101
```
