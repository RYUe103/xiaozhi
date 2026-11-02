# 第二阶段源码审计（2026-11-02）

基线与远端：59f412220bda922b1b0c161a764adbe4e6d51048。业务工作树 /tmp/xiaozhi-publish-20261031；主服务3080未改；真实测试仅隔离3185。QueryProcessor源码哈希记录于initial-state.json。

| 实际文件/函数 | 基线能力及缺口 | 本阶段处理 |
| --- | --- | --- |
| api/server/services/SessionDocumentResources.js discover/execute | 元数据目录、按目标延迟加载、请求内Promise复用和重查授权 | 复用 |
| api/server/services/DocumentArtifactRepository.js execute/_executeAsync | 原文read、相邻、目录、结构表格、exact签名续读；单次20000、每文档请求160000字符/32次 | 原入口增加全文/扫描，仍检查授权 |
| api/server/services/DocumentExactSearch.js exactSearch | literal/NFKC及原始偏移，非全文OCR认证 | 保持 |
| api/server/services/Endpoints/agents/documentReadContracts.js createPdfReadContract | 无全文/扫描schema | 同一个原生工具扩展action |
| api/server/services/Endpoints/agents/sansuoToolPolicy.js registerSanSuoPdfReadTool | DynamicStructuredTool执行后compactDocumentResult投影 | 无新增工具；验证原文投影保留 |
| node_modules/@librechat/agents/dist/cjs/tools/ToolNode.cjs runTool | 工具字符串再次截断，限额由模型上下文推导，最高400000字符 | 在业务返回前同时检验JSON总长度，依赖文件未修改 |
| api/server/controllers/agents/client.js chatCompletion | createTokenCounter/formatAgentMessages/createRun；工具无当前预算 | 原生callback记录实际模型输入，扣除回答/schema预留及工具输出 |
| api/server/services/DocumentVectorSearch.js search | 原记录6000字符无重叠，向量最高分聚合回父块 | 阶段B待A验收后实验 |
| api/server/services/DocumentEvidenceReranker.js rank | 每候选一个1200字符窗口，整体排序，无多需求覆盖 | 阶段C待实施 |
| api/server/services/DocumentTables.js buildDocumentTables | 表格原始rows/cells、跨页条件拼接，read_table可用；独立表格未完整参与检索 | 阶段C待实施 |

91页真实冻结源734块，82249字符，最长1199，中位78，无记录超过6000字符。该样本的漏事实不能归因为6000切片；禁止无意义重切短块。详见source-chunk-distribution.json。

Token计数沿用部署Agent的tokenizer与校准、增加安全余量，不宣称等同Qwen供应商精确计数。实际模型上下文/工具投影/最终答案仍需真实Agent验证。单元通过不构成部署门槛。
