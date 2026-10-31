#!/usr/bin/env python3
"""Recompute transparent metrics from once-only outputs and production telemetry."""
import collections,csv,hashlib,json,math,pathlib,re,statistics,sys
P=pathlib.Path(sys.argv[1]);gold=json.loads((P/'frozen-gold.json').read_text());docs={d['key']:d for d in gold['documents']};events=collections.defaultdict(list);seen=set()
for line in (P/'production-traces.jsonl').read_text().splitlines() if (P/'production-traces.jsonl').exists() else []:
    try:e=json.loads(line)
    except ValueError:continue
    key=json.dumps(e,sort_keys=True)
    if key in seen:continue
    seen.add(key);events[e['evaluation_id']].append(e)
for v in events.values():v.sort(key=lambda x:x.get('at',0))
results={r['id']:r for f in (P/'results').glob('*.json') for r in [json.loads(f.read_text())]}
judges={r['id']:r for f in (P/'grades').glob('*.json') for r in [json.loads(f.read_text())]} if (P/'grades').exists() else {}
reviews={r['id']:r for f in (P/'source-adjudications').glob('*.json') for r in [json.loads(f.read_text())]} if (P/'source-adjudications').exists() else {}
deviations=set(json.loads((P/'protocol-amendment-binding.json').read_text())['deviating_ids']) if (P/'protocol-amendment-binding.json').exists() else set()
def recall(got,gold):return len(set(got)&set(gold))/len(set(gold)) if gold else None
def mean(xs):
    xs=[x for x in xs if x is not None];return sum(xs)/len(xs) if xs else None
def pct(xs,p):
    xs=sorted(x for x in xs if isinstance(x,(int,float)));return xs[max(0,math.ceil(len(xs)*p)-1)] if xs else None
def citations(text):
    # Page-specific anchors only; expand citation lists/ranges without harvesting arbitrary numbers.
    group=r"(\d{1,4}(?:\s*(?:[-–—~～至、,，/]|和|及)\s*\d{1,4})*)"
    patterns=[r"(?:第\s*)?"+group+r"\s*页",r"(?:physical\s+|PDF\s+)?pages?\s*[:：]?\s*"+group,r"\bpp?\.\s*"+group,r"页码\s*[:：]?\s*"+group]
    out=set()
    for pattern in patterns:
        for match in re.finditer(pattern,text,re.I):
            value=match.group(1)
            for token in re.split(r"\s*(?:[、,，/]|和|及)\s*",value):
                bounds=re.split(r"\s*[-–—~～至]\s*",token)
                if len(bounds)==1:out.add(int(bounds[0]))
                elif len(bounds)==2:
                    a,b=map(int,bounds)
                    if 0<a<=b<=2000 and b-a<=100:out.update(range(a,b+1))
    return sorted(x for x in out if 0<x<=2000)
def output_object(value):
    if isinstance(value,dict):return value
    try:
        parsed=json.loads(value);return parsed if isinstance(parsed,dict) else {}
    except (ValueError,TypeError):return {}
rows=[]
for q in gold['questions']:
    r=results.get(q['id'],{});ev=events[q['id']];goldpages=q['physical_evidence_pages'];rrf=next((e for e in ev if e.get('stage')=='RRF' and e.get('hits')),None);rank=next((e for e in ev if e.get('stage')=='Rerank' and e.get('hits')),rrf)
    model=[e for e in ev if e.get('stage')=='ModelEnd'];delivery=[e for e in ev if e.get('stage')=='EvidenceDelivery' and e.get('content_chars',0)>0];delivered=sorted(set(p for e in delivery for p in e.get('pages',[]) if isinstance(p,int)))
    answer=r.get('answer','');judge=judges.get(q['id'],{});verdict=judge.get('verdict',{});auto=verdict.get('answer_correct');uncertain=verdict.get('uncertain',True)
    main_tokens=sum((e.get('usage') or {}).get('total_tokens',0) for e in model);helper=[e for e in ev if e.get('stage') in ['QueryProcessor','Rerank'] and e.get('usage')]
    vector=[e for e in ev if e.get('stage')=='Vector'];vu=max(((e.get('usage') or {}).get('total_tokens',0) for e in vector),default=0)
    tools=r.get('tool_calls',[]);requested=[e for e in ev if e.get('stage')=='AgentToolRequested'];tool_count=max(len(tools),len(requested))
    visual=[e for e in ev if e.get('event_family')=='file_timing' and e.get('stage') in ['vision_page_batch','vision_model']]
    source_doc=docs[q['document_key']];coverage=next((e.get('coverage') for e in ev if e.get('stage')=='VisualPreparationDecision'),None)
    snapshot_path=P/'delivery-snapshots'/(q['id'].replace(':','_')+'.json')
    snapshot=output_object(snapshot_path.read_text()) if snapshot_path.exists() else {}
    assistant_errors=[c.get('error') for c in snapshot.get('ordered_assistant_content',[]) if c.get('type')=='error']+r.get('assistant_errors',[])
    account_denied=any('Access denied' in str(e) and ('good standing' in str(e) or 'overdue-payment' in str(e)) for e in assistant_errors)
    last_finish=model[-1].get('finish_reason') if model else None
    parse_gate_failed='文件解析失败，尚未启动模型' in answer or any(e.get('event_family')=='file_timing' and e.get('stage')=='deep_gate_wait' and e.get('status')=='failed' for e in ev)
    ordered=snapshot.get('ordered_assistant_content',[]);final_text_after_tools=bool(ordered and ordered[-1].get('type')=='text' and str(ordered[-1].get('text','')).strip())
    bounded_trace_count=sum(e.get('event_family')!='file_timing' for e in ev)
    trace_may_be_capped=bounded_trace_count>=256
    complete=r.get('state')=='completed' and bool(answer.strip()) and (last_finish not in ['tool_calls','length','content_filter'] or (final_text_after_tools and trace_may_be_capped and last_finish=='tool_calls')) and not parse_gate_failed
    rec=recall([h.get('page') for h in (rank or {}).get('hits',[])[:6]],goldpages) if rank else None
    dr=recall(delivered,goldpages);errors=[e.get('error') for e in ev if e.get('error')];warnings=[e.get('warning') for e in ev if e.get('warning')]
    if not r:cause='not_attempted'
    elif q['id'] in deviations:cause='evaluation_protocol_deviation'
    elif account_denied:cause='external_model_account_access_denied'
    elif parse_gate_failed:cause='parse_gate_missing_artifact'
    elif r.get('state') in ['failed','upload_failed']:cause='upload_transport_or_agent_error'
    elif r.get('state') in ['started','observation_timeout']:cause='still_running_or_timeout'
    elif not complete:cause='no_final_answer_evidence_delivered' if dr==1 else 'no_final_answer_missing_evidence'
    elif auto is False:
        cause=verdict.get('failure_type') or ('evidence_recall' if rec is not None and rec<1 else 'evidence_delivery' if dr is not None and dr<1 else 'answer_generation_or_structure')
    elif auto is True and not uncertain:cause='pass_automatic_not_human_truth'
    else:cause='grading_pending_or_uncertain'
    row=dict(id=q['id'],dataset=source_doc['dataset'],document=q['document_key'],split=q['split'],category=q['category'],pdf_pages=source_doc['page_count'],state=r.get('state','not_attempted'),protocol_valid=q['id'] not in deviations,gold_pages=goldpages,recall_at_6=rec,recall_at_10=recall([h.get('page') for h in (rank or {}).get('hits',[])[:10]],goldpages) if rank else None,rrf_recall_at_6=recall([h.get('page') for h in (rrf or {}).get('hits',[])[:6]],goldpages) if rrf else None,rrf_recall_at_10=recall([h.get('page') for h in (rrf or {}).get('hits',[])[:10]],goldpages) if rrf else None,delivered_pages=delivered,delivery_page_recall=dr,delivery_all_gold_pages=dr==1 if goldpages else None,delivery_proxy_only=True,answer_complete=complete,automatic_answer_correct=auto,automatic_uncertain=uncertain,automatic_citation_correct=verdict.get('citations_correct'),automatic_evidence_sufficient=verdict.get('delivered_evidence_sufficient'),finish_reason=model[-1].get('finish_reason') if model else None,finish_reasons=collections.Counter(e.get('finish_reason') for e in model),tool_calls=tool_count,main_model_calls=len(model),helper_model_calls=len(helper),vision_model_calls_observed=len(visual),main_tokens=main_tokens,main_input_tokens=sum((e.get('usage') or {}).get('input_tokens',0) for e in model),main_output_tokens=sum((e.get('usage') or {}).get('output_tokens',0) for e in model),main_reasoning_tokens=sum((e.get('usage') or {}).get('output_token_details',{}).get('reasoning',0) for e in model),helper_tokens=sum(e['usage'].get('total_tokens',0) for e in helper),vector_tokens=vu,vision_tokens=None,vision_token_missing_reason='production vision helper discards provider usage; not estimable accurately',elapsed_ms=r.get('elapsed_ms'),upload_ms=r.get('upload_ms'),vision_elapsed_ms=sum(e.get('elapsedMs',0) for e in visual),citations=citations(answer),failure_cause=cause,errors=errors,warnings=warnings,coverage=coverage,trace_events=len(ev),answer=answer,reference_answer=q['answer'])
    rows.append(row)
    row['assistant_errors']=assistant_errors
    row['external_model_account_denied']=account_denied
    row['parse_gate_failed']=parse_gate_failed
    row['trace_may_be_capped']=trace_may_be_capped
    row['tokens_lower_bound']=trace_may_be_capped
    if trace_may_be_capped and final_text_after_tools and last_finish=='tool_calls':row['finish_reason']='unreported_trace_limit'
    review=reviews.get(q['id']);row['source_review']=review
    row['reviewed_answer_correct']=review.get('answer_correct') if review else auto if not uncertain else None
    row['reviewed_uncertain']=review.get('uncertain',False) if review else uncertain
    row['actual_long_pdf']=source_doc['page_count']>=80
    row['execution_phase']='resumed_workers2' if r.get('started_at','')>=json.loads((P/'resume-baseline.json').read_text()).get('at','~') else 'original_mixed_workers2_6'
    row['reviewed_citation_correct']=review.get('citations_correct') if review and 'citations_correct' in review else verdict.get('citations_correct') if not uncertain else None
    row['reviewed_evidence_sufficient']=review.get('delivered_evidence_sufficient') if review and 'delivered_evidence_sufficient' in review else verdict.get('delivered_evidence_sufficient') if not uncertain else None
    row['reference_disputed']=bool((review or {}).get('disputed_reference') or verdict.get('disputed_reference'))
    row['retrieval_union_page_recall']=recall([h.get('page') for e in ev if e.get('stage') in ['RRF','Rerank'] for h in e.get('hits',[])],goldpages) if rank else None
    row['model_answer_scored']=bool(judge.get('raw'))
    row['automatic_grade_error']=judge.get('error')
    def normalize_answer(x):
        if isinstance(x,list):return '|'.join(sorted(normalize_answer(v) for v in x))
        return re.sub(r'\s+',' ',str(x)).strip().casefold()
    row['literal_reference_match']=normalize_answer(answer)==normalize_answer(q['answer']) if complete else False
    row['reviewed_failure_cause']=cause
    if review and complete:
        row['reviewed_failure_cause']=('citation_error_source_review' if review.get('citations_correct') is False else 'pass_source_review') if review.get('answer_correct') else review.get('failure_type', 'source_review_answer_incorrect')

    row['tool_rounds_exhausted_confirmed']=any(re.search(r'GraphRecursionError|recursion limit|maximum iterations|最大.{0,8}轮',str(x),re.I) for x in assistant_errors+errors)
    row['tool_rounds_exhausted_suspected']=not complete and last_finish=='tool_calls' and len(model)>=24
    row['evidence_arrived_without_final_answer']=not complete and dr==1
    row['evidence_source_kinds_observed']=sorted(set(h.get('kind','unknown') for tool in tools for h in output_object(tool.get('output')).get('hits',[])))
def summary(rs):
    finished=[r for r in rs if r['state'] not in ['not_attempted','started']];valid=[r for r in finished if r['protocol_valid']];graded=[r for r in valid if r['automatic_answer_correct'] is not None];supported=[r for r in valid if r['recall_at_6'] is not None];lat=[r['elapsed_ms'] for r in valid if r['elapsed_ms'] is not None]
    resolved=[r for r in valid if r['reviewed_answer_correct'] is not None and not r['reviewed_uncertain']]
    directly_reviewed=[r for r in valid if r.get('source_review')]
    model_graded=[r for r in graded if judges.get(r['id'],{}).get('raw')]
    return dict(selected=len(rs),attempted=sum(r['state']!='not_attempted' for r in rs),finished=len(finished),valid_protocol_finished=len(valid),automatic_graded=len(graded),retrieval_measured=len(supported),mean_recall_at_6=mean(r['recall_at_6'] for r in valid),mean_recall_at_10=mean(r['recall_at_10'] for r in valid),mean_delivery_page_recall=mean(r['delivery_page_recall'] for r in valid),all_evidence_page_delivery_rate=mean(r['delivery_all_gold_pages'] for r in valid),answer_completion_rate=mean(r['answer_complete'] for r in valid),automatic_answer_accuracy=mean(r['automatic_answer_correct'] for r in graded),automatic_unambiguous_correct_rate=mean(bool(r['automatic_answer_correct']) and not r['automatic_uncertain'] for r in graded),model_judged=len(model_graded),deterministic_terminal_graded=len(graded)-len(model_graded),source_review_resolved=sum(r['reviewed_answer_correct'] is not None and not r['reviewed_uncertain'] for r in directly_reviewed),source_review_correct=sum(bool(r['reviewed_answer_correct']) for r in directly_reviewed),source_review_known_accuracy=mean(r['reviewed_answer_correct'] for r in directly_reviewed),answer_adjudication_resolved=len(resolved),unresolved_valid_cases=len(valid)-len(resolved),automatic_citation_error_rate=mean(not r['automatic_citation_correct'] for r in graded if r['automatic_citation_correct'] is not None),latency_ms=dict(p50=pct(lat,.5),p90=pct(lat,.9),p95=pct(lat,.95),max=max(lat) if lat else None,mean=mean(lat)),tokens=dict(main=sum(r['main_tokens'] for r in valid),helper=sum(r['helper_tokens'] for r in valid),vector=sum(r['vector_tokens'] for r in valid),vision=None,reasoning=sum(r['main_reasoning_tokens'] for r in valid)),tool_calls=sum(r['tool_calls'] for r in valid),evidence_arrived_no_final=sum(r['evidence_arrived_without_final_answer'] for r in valid),tool_rounds_exhausted_suspected=sum(r['tool_rounds_exhausted_suspected'] for r in valid),failure_causes=dict(collections.Counter(r['failure_cause'] for r in rs)))
def enhanced(rs):
    out=summary(rs);valid=[r for r in rs if r['protocol_valid'] and r['state'] not in ['not_attempted','started']]
    known=[r for r in valid if r['reviewed_answer_correct'] is not None and not r['reviewed_uncertain']]
    correct=sum(r['reviewed_answer_correct'] is True for r in known)
    citation=[r for r in valid if r['reviewed_citation_correct'] is not None]
    evidence=[r for r in valid if r['reviewed_evidence_sufficient'] is not None]
    out.update(answer_correct_resolved=correct,answer_accuracy_known_subset=mean(r['reviewed_answer_correct'] for r in known),answer_accuracy_lower_bound=correct/len(valid) if valid else None,answer_accuracy_upper_bound=(correct+len(valid)-len(known))/len(valid) if valid else None,reviewed_citation_measured=len(citation),reviewed_citation_error_rate=mean(not r['reviewed_citation_correct'] for r in citation),fragment_evidence_measured=len(evidence),fragment_evidence_success_rate=mean(r['reviewed_evidence_sufficient'] for r in evidence),reference_disputed=sum(r['reference_disputed'] for r in valid),retrieval_union_page_recall=mean(r['retrieval_union_page_recall'] for r in valid),main_input_tokens=sum(r['main_input_tokens'] for r in valid),main_output_tokens=sum(r['main_output_tokens'] for r in valid),main_model_calls=sum(r['main_model_calls'] for r in valid),helper_model_calls=sum(r['helper_model_calls'] for r in valid),vision_model_calls_observed=sum(r['vision_model_calls_observed'] for r in valid),trace_capped_questions=sum(r['trace_may_be_capped'] for r in valid),model_grade_errors=sum(bool(r['automatic_grade_error']) for r in valid),reviewed_failure_causes=dict(collections.Counter(r['reviewed_failure_cause'] for r in valid)),tool_names=dict(collections.Counter(t.get('name','unknown') for r in valid for t in results.get(r['id'],{}).get('tool_calls',[]))))
    out['tool_rounds_exhausted_confirmed']=sum(r['tool_rounds_exhausted_confirmed'] for r in valid)
    out['final_finish_reason_counts']=dict(collections.Counter(r['finish_reason'] or 'unreported' for r in valid))
    out['main_all_finish_reason_counts']=dict(sum((collections.Counter(r['finish_reasons']) for r in valid),collections.Counter()))
    out['evidence_arrived_no_final_by_cause']=dict(collections.Counter(r['failure_cause'] for r in valid if r['evidence_arrived_without_final_answer']))
    return out
report=dict(overall=enhanced(rows),by_split={k:enhanced([r for r in rows if r['split']==k]) for k in ['development','acceptance']},by_category={k:enhanced([r for r in rows if r['category']==k]) for k in sorted(set(r['category'] for r in rows))},by_dataset={k:enhanced([r for r in rows if r['dataset']==k]) for k in sorted(set(r['dataset'] for r in rows))},limitations=['Page recall is page-level proxy, not official bbox or answer-fragment match. Missing telemetry stays unknown.','Production VL helper does not retain provider usage; vision tokens unavailable. Main/helper/embedding measured separately.','Same-family automatic grading is not human truth; raw verdict preserved and source review separate.','Two initial questions retain protocol deviations; valid-protocol denominator excludes them, all100 record retains them.','No real MinerU OCR; local mock rejected, real FITZ text/native table plus VL summaries only.'])
report['by_execution_phase']={k:enhanced([r for r in rows if r['execution_phase']==k]) for k in sorted(set(r['execution_phase'] for r in rows))}
report['by_document_length']={k:enhanced([r for r in rows if r['actual_long_pdf']==v]) for k,v in [('at_least80_pages',True),('under80_pages',False)]}
(P/'per-question.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8');(P/'metrics.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
with (P/'per-question.csv').open('w',newline='',encoding='utf-8-sig') as f:
    w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows({k:json.dumps(v,ensure_ascii=False) if isinstance(v,(dict,list)) else v for k,v in r.items()} for r in rows)
print(json.dumps(report['overall'],ensure_ascii=False))
