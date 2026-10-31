#!/usr/bin/env python3
"""Offline latency/token distributions; keeps load phases and failures separate."""
import collections,datetime,json,math,pathlib,sys
p=pathlib.Path(sys.argv[1]);rows=json.loads((p/'per-question.json').read_text())
def mean(xs):return sum(xs)/len(xs) if xs else None
def dist(xs):
 xs=sorted(x for x in xs if isinstance(x,(int,float)))
 return dict(n=len(xs),p50=xs[max(0,math.ceil(len(xs)*.5)-1)] if xs else None,p90=xs[max(0,math.ceil(len(xs)*.9)-1)] if xs else None,p95=xs[max(0,math.ceil(len(xs)*.95)-1)] if xs else None,max=max(xs) if xs else None,mean=mean(xs))
valid=[r for r in rows if r['protocol_valid'] and r['state'] not in ['not_attempted','started']]
def group(rs):
 return dict(n=len(rs),latency_ms=dist([r['elapsed_ms'] for r in rs]),tools=dist([r['tool_calls'] for r in rs]),main_calls=dist([r['main_model_calls'] for r in rs]),helper_calls=dist([r['helper_model_calls'] for r in rs]),main_tokens=sum(r['main_tokens'] for r in rs),input_tokens=sum(r['main_input_tokens'] for r in rs),output_tokens=sum(r['main_output_tokens'] for r in rs),helper_tokens=sum(r['helper_tokens'] for r in rs),embedding_tokens=sum(r['vector_tokens'] for r in rs),vision_tokens=None,trace_capped=sum(r['trace_may_be_capped'] for r in rs))
account=lambda r:r['external_model_account_denied']
groups={'all_valid_terminal':valid,'substantive_final_answers':[r for r in valid if r['answer_complete']],'external_account_denied':[r for r in valid if account(r)],'other_no_final':[r for r in valid if not r['answer_complete'] and not account(r)]}
phases={k:{name:group([r for r in rs if r['execution_phase']==k]) for name,rs in groups.items()} for k in sorted(set(r['execution_phase'] for r in valid))}
main=sum(r['main_tokens'] for r in valid);inp=sum(r['main_input_tokens'] for r in valid)
grades=[json.loads(f.read_text()) for f in (p/'grades').glob('*.json')]
out=dict(at=datetime.datetime.now(datetime.timezone.utc).isoformat(),groups={k:group(v) for k,v in groups.items()},by_load_phase=phases,observed_main_input_share=inp/main if main else None,no_final_with_all_gold_pages_by_cause=dict(collections.Counter(r['failure_cause'] for r in valid if r['evidence_arrived_without_final_answer'])),automatic_grading=dict(provider_total_tokens=sum((j.get('usage') or {}).get('total_tokens',0) for j in grades),calls=sum(bool(j.get('raw')) for j in grades),errors=sum(bool(j.get('error')) for j in grades),separate_from_agent=True),slowest=[{k:r[k] for k in ['id','elapsed_ms','execution_phase','pdf_pages','category','answer_complete','tool_calls','main_model_calls','vision_model_calls_observed','failure_cause']} for r in sorted(valid,key=lambda r:r['elapsed_ms'] or 0,reverse=True)[:15]],limits=['VL usage is discarded in production; unavailable, never treated as zero.','Main total includes repeated input across turns. Exact system/context/tool token decomposition not captured.','Mixed concurrency, service interruption and cache state prevent causal speed comparisons.','No inference is retried to improve score.'])
(p/'performance-token-analysis.json').write_text(json.dumps(out,ensure_ascii=False,indent=2));print(json.dumps({k:v['n'] for k,v in out['groups'].items()}))
