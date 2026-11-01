# Agent 工具架构审计与真实验收报告

2026-11-02，Asia/Shanghai。**部分实现已验证，最终验收未通过，不可据此部署生产。** 工具恢复缺陷已在真实测试中消失；事实准确性和全部旧测试回归未达标。未合并main，未修改生产.env、生产Mongo或内网服务。

## 版本与环境

|批次|业务源码|范围|环境|
|---|---|---|---|
|历史基线|1a9922760f2fb94349b62d2717c36cfa540b892d|已有91页评测及本次原始109项测试|旧证据原封保留|
|multiturn/r1|0198c13|冻结10轮|候选3185，复用已有PDF解析字节，新的会话绑定|
|multiturn/r2、academic-r1、http-r3|a3d057b|冻结10轮、真实海报、HTTP|部分运行重叠，性能受干扰|
|multiturn/r3、http-r4|27df227|冻结10轮、7项HTTP含真实文件生成|同一隔离候选；普通HTTP先完成再运行10轮|

源码文件hash和隔离端口/数据库见runtime*.json。候选数据库LibreChatMineruVisionPhase5candidate20261101、Code API5057；主3080未切换。模型qwen3.6-plus，视觉qwen3-vl-plus。日志UTC日期为11月1日，对应北京时间11月2日。

原91页PDF SHA256 `5be30160ab9d6cfe86e338111fd0f7dafaa00a6194efe854b3e3f3699c8cccd0`。三批均复用冻结问题和顺序，无gold传入推理，不注入答案页。fixture与parse_job_after保留继承解析证据；这不是首次解析性能测试。r3首次启动缺少manifest，在模型请求前失败，保留r3-launch-failure.json；复制不变manifest后才实际开始。

## 根因与修复

原生链路是initialize/loadAgentTools→toolDefinitions+Registry→BaseClient→Graph/ToolNode→ON_TOOL_EXECUTE→loadToolsForExecution。原生工具实例可按请求建立；错误在文档恢复、正文下载、关键词预读和注册耦合，未命中自然语言门控就没有读工具。历史第7轮模型从历史记住名称，3次not found后走代码绕行；不能据此推断当轮schema曾暴露。

采用会话元数据目录＋懒加载方案，复用原生Registry与Repository。准备阶段不搜正文、不做VL；模型自主选择read/search/table/adjacent/inspect。PDF和Word统一按当前用户、会话、根文件与版本验证；执行及加载完成后再验证；多Agent按ID绑定。代码兼容层及文档读取器复用原生capabilities，禁止把已禁用工具重新加入。Word旧reading-pack与图片/相邻引用持久化缺口已补。完整文件/函数/行号见docs/agent-tools-audit/07-implementation-review.md。

## 真实91页结果

|批次|完成|P50秒|P95秒|第7轮秒|工具总调用|VL|
|---|---:|---:|---:|---:|---:|---:|
|历史10轮|9/10|31.609|140.603|156.870|见旧报告|0|
|r1|10/10|25.236|38.118|38.177|5|0|
|r2|10/10|27.244|62.452|29.936|6|0|
|r3|10/10|30.732|37.133|33.037|6|0|

三批第7轮均一次read_parsed_pdf search，正确定位p87，没有Tool not found、没有execute_code绕行、没有沿用旧p84当证据。r3每轮实际定义与Registry均含两个工具，目录日志10/10见tool-registry/r3.json；初始化目录9–43ms（含能力解析及绑定）。这证明测试会话上的生命周期改善，不证明所有生产Agent配置正确。

**事实准确性未通过。** 严格AI暂评全对r1=6/9、r2=3/9、r3=3/9；第9题gold缺失性未独立核验，另列不评分。不是人工准确率，不能与不同题组的旧8/15相减。三批第7轮都漏15次/2500余人次；第8轮都给出缺乏依据的推断。r2第5轮错误否认30万元未来计划；r3第4/5/6轮有附加时态/因果推断。逐题见multiturn/answer-review.md和json，未挑最佳答案。

失败分层：
- A 检索损失：原始MinerU保留p87的15次2500余人次；r1/r2 Vector第10/25召回，但RRF前20截断后消失，重排与交付均没有这段。见retrieval-failure-diagnostic.json及各轮trace。不是OCR缺失，也不是视觉问题。
- B 证据使用不足：r1第4轮主动read_adjacent获得完整路灯/30万元段；r2第4轮只有search后直接作答，漏具体路灯；r2第5轮使用泛化“资金 计划 下一步”召回别的项目，未补读已定位页面。
- C 理解/幻觉：搜索缺失被第8轮提升为材料没有；猜县级委员人数、推测线上线下互补。r3第4轮已读到明确“下一步”，前文仍写成投资事实。当前架构改造没有证明这些错误已修复。

## 视觉、缓存、权限与普通回归

- academic-r1真实上传197ms，最终回答90.185s；12次PDF工具调用，最后Agent自主inspect_page(p1)，真实Qwen VL 1次13.887s、3594 tokens，finish_reason=stop。主问题T3正确，附加160/50/220数值未通过独立复核。页面resolution_limited，约71.772dpi；JSON结构合规不等于数字正确。结果引用保存source hash、image_id、visual_result_id、vision version，见原始结果。此视觉运行基于a3d057b，未冒充27df227完整视觉回归。
- visual-cache-r1：12项工具级真实Mongo/storage检查通过。持久VL命中0图片/模型调用；撤权、删除、源hash、失败产物、generation/parserVersion/complete状态改变、异用户异会话拒绝；向量第二次0embedding调用、30ms。不是完整Agent权限攻击，也不是跨轮视觉引用完整验收。
- permissions-r1：10项真实目录/下载/权限/恢复检查通过，共6次实际下载；目录发现零下载。同请求复用、伪造document_id、跨用户/会话、撤权、hash/parser改变拒绝并恢复。未改生产库。
- http-r4：7/7通过，普通问答3.413s，Word上传后读取7.286s、无附件追问2.161s，CSV真实execute_code18.479s，Excel4.104s，真实生成下载16.405s，异用户消息隔离。生成acceptance.txt实存21字节、内容校验通过。Word/Excel夹具为合成兼容测试，不是复杂文档准确率证明。前批http-r2/r3也保留。

## 自动测试与限制

baseline/jest.json：109项104通过5失败。最新regression/r8.json：8组228项212通过16失败。另adjacent-r1四组23通过。不可跨批相加冒充一次全部通过。16失败详情见failure-classification-final.json：5项基线已失败，11项为本次行为改变后的旧eager/ready/未作用域夹具断言，尚未完成等价迁移。没有删除或屏蔽旧失败。

新增Word reading-pack兼容、inspect_image缓存引用、read_adjacent引用、有效capability拒绝测试通过。r6曾有额外测试夹具错误：临时Agent空能力按原生规则回退appConfig；已修正夹具并保留失败日志，详见capability-test-correction.md。本轮没有修改原生回退规则。

仍缺：全量旧断言迁移后的绿灯、多文件PDF+Word真实Agent交叉选择及攻击矩阵、无效continuation专项全覆盖、Word真实图片VL、快/知识库模式真实HTTP、生产/内网验收、最新代码完整视觉跨轮、干净依赖安装及全仓lint/build。旧Word无source hash时不能核验静默覆盖字节。查询失败不应断言全文无数据，事实层仍阻塞上线。

## 性能与Token口径

P50/P95为10题线性插值，仅描述本批。旧测试含冷向量、超时；新批复用已解析产物，r2有并行干扰，模型采样不同；不是严格A/B或稳定SLA改善。未测新PDF MinerU排队/首次解析，不能用本批问答耗时推断解析速度。

主模型Token来自隔离transactions原始账目，逐message归集abs(rawAmount)，见performance/usage-export.json；不把tokenValue计为Token，不将分段usage重复汇总。此账目不含完整embedding/VL/重排供应商账单，不代表总成本。

|批次|主模型prompt|completion|
|---|---:|---:|
|r1|203344|11824|
|r2|177898|15369|
|r3|173250|13317|

每轮model transport、各检索阶段elapsed和trace usage分别在performance/metrics.json。嵌套stage不可简单相加当总耗时。大量输出示意图和重复规划仍占时间；academic12次工具调用说明工具稳定不等于调用高效。没有修改模型强制调用策略来提高通过率。

## 验收与下一步

A生命周期、B按资源暴露、C自主调用在本测试范围已验证；D多文件、E完整权限矩阵、F全部回归仍不全，G真实运行记录已交付。因此最终A–G验收未完成，暂不建议生产部署。

下一步首先迁移旧自动预读测试到等价的显式工具契约并补多文件真实Agent；检索侧另设固定实验比较候选多样性/向量独有证据保护，保留原始gold与全部失败；答案侧验证有限结果不足以作全文否定。不要为金秀或特定题写关键词路由，也不要强制每轮VL或无条件全页读取。

## 复现入口

在隔离候选运行 run-longpdf-accuracy.cjs，输入本目录multiturn-manifest.json，输出新的独立目录；运行run-phase5-regression.cjs <新结果文件> --generation；run-tool-directory-permissions.cjs <真实turn01结果> <新输出>。脚本带端口/数据库隔离限制，输出wx避免覆盖。export-tool-audit-usage.cjs只读取指定测试会话；summarize-tool-audit.py可重算指标。

联合测试：`npx jest --config api/jest.config.js --runInBand api/app/clients/specs/BaseClient.test.js api/server/services/SessionDocumentResources.spec.js api/server/services/Endpoints/agents/sansuoToolPolicy.spec.js api/server/services/Endpoints/agents/initialize.spec.js api/server/services/__tests__/ToolService.spec.js api/server/services/DocumentArtifactRepository.spec.js api/server/services/DocumentContextService.spec.js api/server/services/DocumentPageVisionService.spec.js`。预期本次记录是16失败，而非全绿。
