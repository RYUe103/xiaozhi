审计/实施日期：2026-10-31。
实际源码目录：/Users/yooyoung/Documents/Codex/2026-05-12/files-mentioned-by-the-user-v58/LibreChat-main。
本阶段按 Phase 1A → 1B → 1C 完成最小侵入实施。未修改 MinerU、FITZ、VL 外部协议、ToolNode 对外 schema、数据库 schema，未迁移旧文件，未进入 Phase 2。

# JIT Phase 1 测试报告

## 已执行

命令：
./node_modules/.bin/jest --config api/jest.config.js --runInBand api/server/services/Files/Code/process.spec.js api/app/clients/specs/BaseClient.test.js api/server/services/DocumentContextService.spec.js api/server/services/DocumentArtifactAdapter.spec.js

结果：4 suites passed，219 tests passed，0 failed。日志：evidence/jit-phase1a-20261031/phase1a-full-tests.log。

新增 Adapter 测试覆盖：
1. MinerU chunks 稳定 ID。
2. FITZ 文字层归类为 extracted_text，绝不归类 OCR。
3. 纯扫描页无伪造正文，页图状态 pending。
4. VL 完整/部分索引摘要。
5. 混合 PDF 页面覆盖。
6. 无可信页码不补页。
7. visualIndex 版本或根文件不匹配拒绝读取。

原有 process、BaseClient、DocumentContextService 回归全部通过。它们中的 MinerU、存储、数据库和 VL 场景依赖替身；不能作为真实 OCR/VL 质量证明。

## 未执行

未调用真实 VL 大规模推理，未执行真实 MinerU 端到端质量验收，未做内网验收，未迁移历史文件，未运行 BM25、Vector、RRF。Phase 0.5 的真实 FITZ renderer 探针继续有效，但只验证页面渲染和文字层。

## 验收状态

纯扫描、混合页、部分 VL、来源绑定和旧 ID 适配已经有单元级证据；真实服务质量、复杂表格、公式、历史生产数据仍为未执行。
