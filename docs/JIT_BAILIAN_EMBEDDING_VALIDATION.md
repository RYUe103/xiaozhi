# JIT 百炼 embedding 接入验证

日期：2026-10-31。用户明确授权复用现有百炼地址和密钥。

## 本次完成

- `DocumentVectorSearch` 自动识别既有百炼 `QWEN_BASE_URL`，从相同百炼域名复用 `QWEN_API_KEY`，模型默认 `text-embedding-v4`。显式 JIT embedding 配置仍优先；不把聊天模型名当 embedding 模型，不向其他域名发送百炼密钥。
- 真实 embedding 请求成功，返回 1024 维向量；长文本分段、按记录聚合相似度，保留原文证据；百炼按 10 条批处理，限制新增索引字符总量。
- 增量缓存绑定用户、会话、文档、provider/model/revision 和记录内容；Mongo 使用独立 `sansuo_jit_embedding_cache`，唯一索引及 7 天 TTL，仅保存衍生向量。
- Repository 的异步 search 使用真实 Vector 与 Keyword/BM25/RRF，保留来源和排名。补充 JSONL 部分损坏保留、VL 当前轮刷新、实际交付引用及向量排序续读修复。
- Compose 新增 6 个 JIT 服务文件挂载；实际配置核对只有新增挂载，镜像、已有挂载和环境值一致；已仅重建 API。未覆盖 .env，未移动源码，未删除源文件或数据库卷，未提交。

## 验证结果与边界

1. 真实百炼向量探针：HTTP 200，3 条 1024 维向量，22 tokens，约 698ms。
2. 真实语义检索：温度证据相似度约 0.648，篮球干扰约 0.130；首次约 661ms，热缓存约 145ms，第二次文档向量写入 0。证据 `bailian-vector-probe.json`。
3. 实际 Mongo 缓存小探针：首次 2 个 embedding 输入（文档 + 查询），再次 1 个（查询）；约 693ms。写入隔离测试范围的衍生向量，7 天 TTL；未写用户源产物。
4. 真实 PDF 小任务：实际生成 2 页电子 PDF，实际 PyMuPDF 提取，真实模型 qwen3.6-plus 自行依次调用 list/search/read，实际 DynamicStructuredTool 和 ToolNode 执行；百炼 embedding 与 RRF 返回第 1 页 80℃ 证据；最终模型正确中文回答并注明第 1 页。耗时 7665ms，5757 total tokens；search 约 397ms。
   - 检索候选召回 1/1；最终证据交付 1/1；最终答案及页码 1/1。仅是单任务冒烟，不是总体准确率。
   - 排除网页上传、文件存储、真实 MinerU/OCR 和扫描页 VL 的整链路验收。
   - 首次评分误把正确的“页码：1”当成未引用，已保留 first-run 结果；修正评分格式后重新运行真实调用，见 `bailian-agent-result.json`。
5. 模块与兼容回归：7 套 141/141 通过，含 BaseClient 85 项；日志 `bailian-integration-tests.log`。其中依赖替身单测与上述真实服务测试分开报告。
6. 本机运行核对：API /api/config HTTP 200，容器 running，RestartCount=0；运行容器直接加载新 Repository 成功，embedding configured=true，model=text-embedding-v4。

7. 旧 282 项合成基线已原样复跑至 `evidence/jit-implementation-20261031/legacy-baseline`。该 runner 调用的是旧 Service，不是本次 Repository/Vector，因此不能用其自然语言召回率评价新向量路径；保留原缺口：controls 51/52（跨 chunk 表格失败）、negatives 12/24；这些缺口未被百炼接入自动解决。

## 尚未完成的整体 JIT 验收

- 浏览器登录态真实上传/问答/跨轮/权限/预算完整矩阵尚未完成。
- 结构化表格目前支持显式 rows/cells 与带完整性警告的 Markdown；MinerU HTML、跨 chunk/跨页表格的完整恢复与验收仍待补齐。
- 中文 BM25 已实现分词检索，持久化词法倒排索引、增量性能和大文档系统预算尚需完善。
- 历史 source hash 缺失、页面级 source binding 和旧引用失效策略仍需完整回归。
- 本机 MinerU mock 不具备真实 OCR。百炼 embedding 可用不代表解析器能力、扫描件识别或整个 JIT 项目已完成。

## 恢复与重跑

代码前置备份及 Git 状态在 `evidence/jit-implementation-20261031/`；新增模块无需源数据迁移。Compose 增量前备份为 `docker-compose.override.before-jit-mounts.yml`。

测试：`npx jest --config api/jest.config.js --runInBand api/server/services/DocumentVectorSearch.spec.js api/server/services/DocumentArtifactRepository.spec.js api/server/services/DocumentRetrieval.spec.js api/server/services/DocumentContextService.spec.js api/server/services/DocumentArtifactAdapter.spec.js api/server/services/Endpoints/agents/sansuoToolPolicy.spec.js api/app/clients/specs/BaseClient.test.js`。

真实 Agent 小任务脚本：`scripts/evaluation/document-jit/bailian-toolchain.cjs`，需真实 provider 环境、实际 renderer JSON 及独立结果路径；只处理合成 PDF。默认最多 6 次模型请求，每次 600 completion tokens，单次 45 秒超时。
