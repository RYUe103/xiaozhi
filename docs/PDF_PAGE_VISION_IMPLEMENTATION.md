# PDF 按需视觉读取：阶段性实现

日期：2026-10-31。基线：`5fe17600c59598f0eee19fe2f48bbe62b5876f07`。

本分支是尚未完成端到端验收的工作成果，不应直接部署。保留已有百题评测、gold 和失败记录；本分支不包含评测数据或模型密钥。

## 已实现

- `read_parsed_pdf` 新增 `inspect_page` 动作，可指定文档逻辑 ID、1 起算的物理页码、问题、任务模式和可选区域。区域使用旋转后页面图像的归一化坐标，左上角为原点。
- `DocumentPageVisionService` 在请求范围内检查文档、页码、来源哈希和授权；使用页面 PNG 及原始问题调用 Qwen VL，标明这是视觉识别而非完整 OCR。处理模式包括文字、表格、图表、公式和自动模式。
- 对相同任务做请求内缓存和并发去重；加入调用次数、并发数、图片大小、模型超时和截断提示。视觉失败返回不可用，不能当作正文缺失的证明。
- 接入现有 `ensureSanSuoPdfPageArtifacts`：已有图片仅在来源哈希匹配时复用；缺页时验证源 PDF 哈希并只请求指定页渲染。无效指定页不再自动回退为渲染整份 PDF。
- Repository 在 MinerU 缺少整页时补入 FITZ 片段，并保留来源标记；当前不解决 MinerU 同页部分缺失或低质量文字的识别。
- FITZ 页面提取保留文本行；以 `--layout` 可选输出文本块、行、文字及坐标，避免默认输出膨胀。文字质量未验证时，视觉准备不再仅因文字非空就被跳过。

主要代码位置：`api/server/services/DocumentPageVisionService.js`、`api/server/services/Endpoints/agents/sansuoToolPolicy.js`、`api/app/clients/BaseClient.js`、`api/server/services/DocumentArtifactRepository.js`、`api/server/services/Files/Code/process.js` 和 `api/server/services/Files/Pdf/render_pages.py`。

## 已验证

- 隔离副本中，视觉服务、工具策略、Repository、视觉策略、文档上下文、检索和表格相关的 7 组 Jest 测试，共 61 项通过。测试不构成完整 Agent 端到端验收。
- 使用既有公开样本 `NETFLIX_2015_10K.pdf` 的物理第 2 页，在本机容器中通过新服务调用真实 Qwen VL：整页识别公司名和目录标题成功，约 2.1 秒、986 tokens；顶部 30% 区域识别相同文字成功，约 2.4 秒、407 tokens。该验证通过服务级注入图片，不是生产 Agent/ToolNode 调用。
- 真实 PDF 的第 2 页布局提取检查得到 41 行、27 个带坐标的文本块；不代表扫描页、复杂表格或全文布局已正确。

## 已知限制和未完成项

- 真实 Agent/ToolNode 调用链尚未端到端验证；扫描小字、数字、复杂表格、图例和跨页关系的固定样本矩阵未完成。
- 未开展要求的独立 A/B 批次，无法报告对照准确率、证据交付率、引用错误率或 P50/P95 的变化。
- 问题驱动视觉结果缓存仅存在于请求内，不是跨请求持久缓存；图片产物来源、版本、并发写入和失败恢复仍需完整审查及验证。
- 文字质量尚无可靠的自动验证机制；当前保守策略可能使普通文字问题触发更多视觉准备，影响延迟。
- 视觉结果是自由文本，`result.answer` 不保证可机器核验的结构化表格或逐项不确定性。源码的跨页检索、重排多样性及证据交付问题仍待专项验证。
- PDF `process.spec.js` 在隔离测试环境因缺少 `winston-daily-rotate-file` 无法启动；Word 和普通聊天端到端回归未运行。
- 本分支没有部署、迁移生产数据或修改实际环境配置。完成上述验证并复核安全和性能后才可考虑上线。
