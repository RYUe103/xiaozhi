#!/usr/bin/env python3
"""Offline report from immutable attempts; no inference, grading or label edits."""
import collections,datetime,json,pathlib,sys
p=pathlib.Path(sys.argv[1]);m=json.loads((p/'metrics.json').read_text());rows=json.loads((p/'per-question.json').read_text());g=json.loads((p/'frozen-gold.json').read_text());o=m['overall']
def pc(x):return '未知' if x is None else f'{x*100:.2f}%'
def sec(x):return '—' if x is None else f'{x/1000:.2f}s'
def table(headers,data):return ['|'+'|'.join(headers)+'|','|'+'|'.join(['---']*len(headers))+'|']+['|'+'|'.join(str(x) for x in r)+'|' for r in data]
remaining=sum(r['state']=='not_attempted' for r in rows);running=sum(r['state']=='started' for r in rows);terminal=o['finished']==len(rows)
state='100题均已终态；评分与来源复核的完成范围见下文' if terminal else f'运行中：{o["finished"]}题终态、{running}题进行中、{remaining}题未派发'
lines=['# 三所小智 JIT 公开文档质量基准','',f'生成时间：{datetime.datetime.now(datetime.timezone.utc).isoformat()}。**{state}**。','',
'## 范围、冻结与执行协议','',
'冻结100道公开原题、25份真实PDF、1435物理页；开发32题、独立验收68题，按PDF来源和SHA分组。旧14道开发题及其6份PDF单列排除，没有纳入新的独立成绩。25份PDF全部获取成功，没有因失败换成容易题。','',
'CiteVQA：8份/32题，revision d80d4f281b849da2f22a1855f4a693357e988ff6；OHR-Bench：5份/20题，HF 7f833e3eda9a571a9ea545a8f6d476fa1685033d、GitHub 1f421eb428f9f5b8ac0bc8064d6ad1f13fab7af7；MMLongBench-Doc：12份/48题，PDF revision 2ff6aa9237fc777b6627dc57a486e9225ac5fb86、作者GitHub标注 d73f0dc0be7e0a2ff6a403d5fe65fcd96461f384。MML使用1082题版本的samples.json，不混用旧HF1091题版本。','',
'仅用于授权允许的本地研究/非商业评测，不再分发PDF。OHR元数据CC-BY-4.0不代表全部原PDF无限授权；MML作者README声明CC-BY-NC-4.0，未找到独立数据LICENSE；CiteVQA保留来源版权。授权、访问与下载证据见license-audit.json、sources/、acquisition-caveats。','',
'冻结锁SHA256：`'+(p/'freeze-lock.sha256').read_text().strip()+'`。原题、参考答案、原证据与物理页映射全部保留在frozen-gold.json；模型推理只读取无gold的inference-manifest.json。冻结完成后才开始模型执行。','',
'真实链路：认证HTTP上传→持久解析→BaseClient→DocumentArtifactRepository→Keyword/中文BM25/百炼Vector/RRF/EvidenceReranker→ToolNode→Agent。工具由Agent自主选择；未向Agent提供参考答案、人工OCR、gold页提示。每题一次正式执行，排他attempt文件在请求前创建，失败不删除、不重推理选优。','',
'生产参数保持：qwen3.6-plus、temperature0.7、max_tokens20000、context120000、recursion_limit50；Repository32次/160000字符，候选30，重排20×1200字符/12秒/4次；Vector text-embedding-v4，VL qwen3-vl-plus。详见production-parameters.json。生产17项文件哈希不变，不按验收题调整逻辑。','',
'本机MinerU是mock，占位产物被拒绝后走真实FITZ文字层/原生表格及VL摘要。VL摘要是独立视觉描述，**不是真OCR、不是完整正文**。226页无文字层，5份PDF全文无文字层。','',
'协议偏差：最初两题跨会话绑定已保留并排除有效协议成绩，不重跑。因此100题意向范围始终展示，有效协议上限98题（开发32/验收66）。早期非浏览器UA上传错误另留记录。执行负载先2后最多6并发，出现过CodeAPI上传/产物保存异常；账户恢复后并发固定2。故障和不同负载必须分开分析。','',
'前46题全部保留，其中16题百炼返回账户类400拒绝；不能由错误链接推断已核实欠费账单。用户回复恢复后，独立非基准短请求HTTP200，只继续剩余54题。原46题SHA见resume-baseline.json。','',
'## 题型覆盖','']
counts=collections.Counter(r['category'] for r in rows)
lines+=table(['题型','期望','实际'],[(c,t,counts[c]) for c,t in [('exact',25),('table',20),('cross_page',15),('visual',15),('long',15),('unanswerable',10)]])+['',
'以上是冻结的主标签。exact为局部事实，并非全部精确法律条款，标准号/条款覆盖不足；long包含部分普通文本类型，不能声称19题都是长文档。实际9份PDF至少80页、对应36题，长度1–166页。没有修改原题凑配额。','',
'## 总体结果与统计边界','',
f'冻结{o["selected"]}题，派发{o["attempted"]}题，终态{o["finished"]}题，有效协议终态{o["valid_protocol_finished"]}题。外部账户拒绝{sum(r["external_model_account_denied"] for r in rows)}题，解析门禁失败{sum(r["parse_gate_failed"] for r in rows)}题，初始协议偏差2题。','',
f'页级Recall@6 {pc(o["mean_recall_at_6"])}/@10 {pc(o["mean_recall_at_10"])}，有排名记录{o["retrieval_measured"]}题。标注证据位置错误的题仍按冻结gold计主指标，不能将此页级Recall当绝对证据质量；来源纠错另存。使用首次初始检索的生产Rerank（缺失时RRF），按chunk排名映射物理页；各次检索并集页召回{pc(o["retrieval_union_page_recall"])}。这些不是官方bbox或答案片段Recall；不可回答题Recall未定义，缺测不填0或1。','',
f'实际EvidenceDelivery正内容事件的页覆盖均值{pc(o["mean_delivery_page_recall"])}，全部gold页到达比例{pc(o["all_evidence_page_delivery_rate"])}。这是页面代理；逐片段证据充分性已判定{o["fragment_evidence_measured"]}题，成功{pc(o["fragment_evidence_success_rate"])}，不能把页面命中当成正文支持。初始视觉context未完整持久化，无法重建全部真实注入。','',
f'实质最终回答完成率{pc(o["answer_completion_rate"])}；gold页已到但无最终答{o["evidence_arrived_no_final"]}题；疑似工具轮次耗尽{o["tool_rounds_exhausted_suspected"]}题。账户拒绝、产物失败与轮次耗尽分别保留，不统一归咎检索。','',
f'自动模型评分{o["model_judged"]}题，确定性无答案终态判定{o["deterministic_terminal_graded"]}题，直接原始来源复核{o["source_review_resolved"]}题；已解决答案判定{o["answer_adjudication_resolved"]}题、未解决{o["unresolved_valid_cases"]}题。自动评分使用同模型家族，保留raw且不当绝对真值；来源复核是Codex直接看原PDF，不是独立人工盲审。','',
f'原自动口径答案正确率{pc(o["automatic_answer_accuracy"])}（仅已评分子集）；来源复核覆盖后的已知子集正确率{pc(o["answer_accuracy_known_subset"])}。有效终态分母上的正确率区间[{pc(o["answer_accuracy_lower_bound"])}, {pc(o["answer_accuracy_upper_bound"])}]，上下界分别把未解决视为全错/全对。**存在未解决样本时不发布单一总体准确率**。','',
f'引用已判定{o["reviewed_citation_measured"]}题，来源复核优先后的错误引用率{pc(o["reviewed_citation_error_rate"])}；原自动错误引用率{pc(o["automatic_citation_error_rate"])}。未判定引用不算正确，额外页不因gold没列就算错误。原标注争议{o["reference_disputed"]}题单列，不更改gold。','',
'## 独立验收与分题型','']
headers=['范围','冻结','有效终态','有排名','R@6','R@10','页交付','完成率','已判定/正确','答案区间','错引率/已判定']
data=[]
for k,v in list(m['by_split'].items())+list(m['by_category'].items()):
 data.append([k,v['selected'],v['valid_protocol_finished'],v['retrieval_measured'],pc(v['mean_recall_at_6']),pc(v['mean_recall_at_10']),pc(v['mean_delivery_page_recall']),pc(v['answer_completion_rate']),f'{v["answer_adjudication_resolved"]}/{v["answer_correct_resolved"]}',f'{pc(v["answer_accuracy_lower_bound"])}–{pc(v["answer_accuracy_upper_bound"])}',f'{pc(v["reviewed_citation_error_rate"])}/{v["reviewed_citation_measured"]}'])
lines+=table(headers,data)+['','各题型互斥主标签，实际长PDF另见metrics.json/by_document_length。开发与独立验收分别报告；旧14题只作为原回归记录，未并入上表。','',
'## 延迟、工具与Token','']
phases=[('overall',o)]+list(m.get('by_execution_phase',{}).items())
lines+=table(['阶段','有效终态','P50','P90','P95','最大'],[(k,v['valid_protocol_finished'],sec(v['latency_ms']['p50']),sec(v['latency_ms']['p90']),sec(v['latency_ms']['p95']),sec(v['latency_ms']['max'])) for k,v in phases])+['',
'端到端含每题上传、解析等待、VL、检索与Agent。故障快速返回会降低总体P50；正常完成/基础设施失败的单独分布见performance-token-analysis.json。不同负载与日期阶段不可作稳定SLA或优化前后因果比较。','']
lines+=table(['来源','已观测Token','调用/说明'],[
('主Agent',o['tokens']['main'],f'{o["main_model_calls"]}次ModelEnd；输入{o["main_input_tokens"]}，输出{o["main_output_tokens"]}'),
('查询+重排',o['tokens']['helper'],f'{o["helper_model_calls"]}次有usage事件'),
('Embedding',o['tokens']['vector'],'各题累计观测最大值，独立统计'),
('reasoning',o['tokens']['reasoning'],'主模型输出子集，不再次相加'),
('VL','未知',f'可观测事件{o["vision_model_calls_observed"]}；生产函数丢弃供应商usage，不能记0')])+['',
f'工具调用{o["tool_calls"]}次，名称计数{json.dumps(o["tool_names"],ensure_ascii=False)}。{o["trace_capped_questions"]}题达到trace事件上限，Token/辅助调用为观测下界；最终已持久化但ModelEnd缺失时单列unreported_trace_limit。辅助自动评分usage另存在grades/，不算Agent Token。','',
'高输入Token包含多轮历史/工具上下文重复，尚无逐轮完整请求，不能精确拆分为全文注入、系统提示或冗余工具输出。用户优先准确率和速度，未为成本降低生产预算。','',
'## 失败根因','']
lines+=table(['类别（来源复核优先）','题数'],collections.Counter(r['reviewed_failure_cause'] for r in rows if r['protocol_valid'] and r['state'] not in ['started','not_attempted']).most_common())+['',
'grading_pending/uncertain不是已证实失败。逐题原自动类型和来源复核类型分别保留。账户/上传/解析失败算本轮真实端到端未完成，但不代表检索模型能力差。','',
'已复核：扫描中文原第81页有群众好评与融合成效，摘要遗漏且read返回PAGE_TEXT_UNAVAILABLE，最终漏答；退伍军人图表Sheltered/Unsheltered图例交换，算术正确但数据序列错误。OHR疫苗原图Definitely no为11→18，gold两题错误映射为29；贵州价格题gold将凯里物理102页的155元误配安顺，安顺实际物理68页为133元；Grasslands型号题原文存在G100/G150/G200/G250多个系列型号，唯一指代有歧义。标注与原自动判定不改，来源复核单列。自动judge也曾误把原图真实动物造型/三条滑道当幻觉，不能独立作为真值。','',
'## 下一轮优先修复方向（本轮不修改生产）','',
'1. 按需读取原页视觉细节/OCR，并保留图例、单位、表格行列与物理页绑定。扫描摘要不能替代正文，未识别细节必须明确状态。',
'2. 缩短重复视觉准备和长等待，建立请求内产物复用与可追踪的页级完成状态；同时保护CodeAPI上传/产物完整性。避免用降低预算换取表面加速。',
'3. 建立失败终态与答案完成保障：供应商异常及时停止新派发、保留已交付证据与明确失败原因；完整记录最终completion、预算耗尽及VL usage，降低有证据无答案问题。','',
'上述方向来自已复现证据；完整失败排序见逐题记录。若后续修复后再测，必须建立新的run，不能覆盖本次成绩。','',
'## 文件、复算与限制','',
'逐题：per-question.json/csv；原始执行results/；模型原判定grades/；独立来源记录source-adjudications/；阶段追踪production-traces.jsonl；冻结与许可见前述文件。最终锁另存，不覆盖原部分锁。','',
'111项离线完整性核对验证原题原答案、SHA、划分、旧14排除、推理无gold、once-only和生产文件；不是111个Agent任务成功。真实MinerU/OCR与内网尚未验证，VL Token/完整初始视觉注入不可得；同家族自动评分和来源复核仍有不确定性。','',
'离线复算（不调用模型）：','```bash','python3 scripts/evaluation/document-jit/verify-benchmark100.py evidence/jit-benchmark-100-20261031','python3 scripts/evaluation/document-jit/summarize-benchmark100.py evidence/jit-benchmark-100-20261031','python3 scripts/evaluation/document-jit/report-benchmark100.py evidence/jit-benchmark-100-20261031','```','']
(p/'REPORT.md').write_text('\n'.join(lines));print(str(p/'REPORT.md'))
