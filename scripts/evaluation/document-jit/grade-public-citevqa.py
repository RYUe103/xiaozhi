#!/usr/bin/env python3
"""Frozen pilot-specific answer checks, separate from inference. Not official CiteVQA scoring."""
import json,re,sys
from pathlib import Path
p=Path(sys.argv[1]);r=json.loads(p.read_text())
checks=[lambda a:'我部发送传真的传真号' in a,
 lambda a:'甲方为本理财产品的会计责任人' in a,
 lambda a:bool(re.search(r'(?:贵|差|相差)[^。\n]{0,25}0[.,，]7|0[.,，]7[^。\n]{0,12}(?:元|单位)',a)),
 lambda a:'1.7' in a and bool(re.search(r'(?:最贵|最大|最高)[^。\n]{0,20}6',a)),
 lambda a:'1年' in a and '3年' in a and '8619-5050-FRGB' in a,
 lambda a:'260-280' in a]
notes=['原文匹配，第20页引用正确。','错误地否认第9页目标段落存在；被其他（四）条款干扰。','证据页9/19和结构化表格已交付，但回答未完成差值0.7；出现反复解释且文本截断。初版未记录finish_reason，无法严格证明截断来源。','三型号单价与范围正确，页码5/13/16正确。','核心质保比较正确，但混用尺寸规律推断，论证有噪声。原始necessary标注只含第10页，另一产品所在20页未纳入necessary；Agent实际读取10/20页。','光通量260–280LM及第5页正确。']
for t,check,note in zip(r['tasks'],checks,notes):
 t['answer_review']={'core_answer_correct':check(t.get('answer','')),'review_method':'Frozen sample-specific deterministic check plus human-readable review of actual tool trace and official answer; not independent model judge.','note':note}
 goldpages=t['gold_pages'];content='\n'.join(x['content'] for x in t['traces'] if set(x['delivered_pages'])&set(goldpages))
 if t['id'].endswith('_2'):ok='我部发送传真的传真号' in content
 elif t['id'].endswith('_10'):ok='甲方为本理财产品的会计责任人' in content
 elif t['id'].endswith('_7'):ok=all(x in content for x in ['7520-3030-RGB','4040-3030-RGB'])
 elif t['id'].endswith('_5') and 'xhop' not in t['id']:ok=all(x in content for x in ['10821-2835-3W','4532-3535-3W','7520-3030-3W'])
 elif t['id'].endswith('xhop_1'):ok='8619-5050-FRGB' in content and '12MM-FRGB' in '\n'.join(x['content'] for x in t['traces'])
 else:ok='260-280' in content
 t['evidence_review']={'target_text_delivered':ok,'note':'Checks target terms/value in actual tool payload, together with annotated page delivery. Does not measure bbox alignment.'}
r['metrics']['core_answer_correct']=sum(t['answer_review']['core_answer_correct'] for t in r['tasks']);r['metrics']['target_evidence_delivered']=sum(t['evidence_review']['target_text_delivered'] and t['metrics']['all_evidence_pages_delivered'] for t in r['tasks'])
(p.parent/'reviewed-results.json').write_text(json.dumps(r,ensure_ascii=False,indent=2));print(json.dumps(r['metrics'],indent=2))
