# 实施检查点（2026-11-02）

最终10f24ce/c462db6根据真实Agent失败补search范围说明与match_index，17组211项通过；同题两轮r3按1/2→3/4正确续读。完整独立20题仍绑定6d2ec2b，20/20完成但AI严格6/15，未达到部署门槛。原r1/r2失败保留。

基线2911f67，当前业务HEAD6d2ec2b。以下保留阶段记录，最终状态以08-final-report.md为准。

已修改：DocumentRetrieval加权双路融合、单通道独有候选保留、软页多样性；Repository候选池与Reranker输入联动，保留legacy开关；精排length回退并记账。默认实验池40、BM25/Vector=.75/1。

find_exact默认字面、显式nfkc，UTF16原文偏移、签名续读绑定查询与范围，执行前权限复核。早期跨块未实现；现支持原始父块验证后的连续片段，未知父块仍不拼接。

Contextual Retrieval为可选确定性源标题前缀，默认关闭；原始records与retrievalRecords分离，词法缓存包含context key，向量各段附受限前缀并记录命中原文offset。模型上下文3段真实实验已运行，未入索引，真实检索增益未验证。

冻结基线2组22项通过；候选6组57项通过，另新增精排60条及length回退测试通过。非全量回归。

真实轨迹回放每通道仅30项，不能称为完整Recall@60。早期r3回放曾得到新40/60池第3、旧20池未包含，但query并非原tool query；不能作为精确同条件A/B，也不是Agent准确率。首次脚本source字段误用sourceRecordId导致来源数组null，但events里的真实chunk ID完整，保留首次记录并修复后续脚本。


## 后续修正（569cbb5）

- 真实r2失败：同页硬上限压掉不同事实。改为同页且词项Jaccard>=.85才软限制，完全重复仍去重。
- 真实r3失败：预留一半池给独有候选，挤掉BM25第34/Vector第28、融合第28的双路证据。改为保住前75%再预留，回放40池恢复第28。
- 保留普通词法v2与原向量cache键；只有启用context才变版本，避免默认关闭仍全量冷建。
- 原始父块可验证时支持跨chunk原话，返回source_segments和source_block_offset，不把跨页文本归到单页。未知父块不拼接。
- 精确结果限制单次文本20000字符、单次计数扫描阈值10000（超过返回非精确计数和分页）；模型投影不重复content/hits/matches。
- 最终17组210测试通过；另旧BaseClient/initialize 102项中86通过16失败，和基线2911f67测试的16项完全一致。
- 真实find_exact权限10项通过。完整Agent运行仍按独立批次保存。

最终质量修正6d2ec2b：C1控制符乱码标记suspect，原文读取和find_exact不完整范围返回partial。真实129页Cloud MinerU数字核对成功，但造价术语仍不严谨；旧FITZ失败保留。

首次重排回放query口径和sourceRecordId错误详见rerank/first-replay-limitations.md，严格同tool query对照改用exact-tool-query-r1.json。
