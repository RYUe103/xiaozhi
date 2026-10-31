#!/usr/bin/env python3
"""Offline benchmark integrity checks; never calls any model or edits labels."""
import collections,hashlib,json,pathlib,sys
p=pathlib.Path(sys.argv[1]);lock=json.loads((p/'freeze-lock.json').read_text());checks=[]
def check(n,condition):
    checks.append({'name':n,'ok':bool(condition)})
    if not condition:raise AssertionError(n)
sha=lambda b:hashlib.sha256(b).hexdigest()
check('all_frozen_files_hash_match',all(sha((p/f).read_bytes())==h for f,h in lock['files'].items()))
check('lock_hash_matches',sha((p/'freeze-lock.json').read_bytes())==(p/'freeze-lock.sha256').read_text().strip())
g=json.loads((p/'frozen-gold.json').read_text());infer=json.loads((p/'inference-manifest.json').read_text());docs={d['key']:d for d in g['documents']};qs=g['questions'];ex=json.loads((p/'regression-exclusion.json').read_text())
check('100_original_unique_questions_25_pdfs',len(qs)==len({q['id'] for q in qs})==100 and len(docs)==25)
check('32_68_document_grouped_split',collections.Counter(q['split'] for q in qs)=={'development':32,'acceptance':68} and all(q['split']==docs[q['document_key']]['split'] for q in qs))
scope=collections.defaultdict(set)
for d in docs.values():scope[d['download']['sha256']].add(d['split'])
check('no_pdf_sha_cross_split',all(len(x)==1 for x in scope.values()))
check('no_previous14_pdf_sha',not set(scope)&set(ex['excluded_pdf_sha256']))
check('valid_physical_evidence_ranges',all(not q['invalid_evidence_pages'] for q in qs))
check('inference_no_gold_evidence_fields',all(set(q)=={'id','question','document_key','split','category'} for q in infer['questions']))
check('inference_original_question_text',all(q['question']==next(x['question'] for x in qs if x['id']==q['id']) for q in infer['questions']))
for q in qs:
    original=q['original'];question=original.get('Question',original.get('question',original.get('questions')));answer=original.get('Standard_Answer',original.get('answer',original.get('answers')))
    check('original_'+q['id'],q['question']==question and q['answer']==answer)
results=[json.loads(f.read_text()) for f in (p/'results').glob('*.json')]
check('no_duplicate_question_attempt',len(results)==len({r['id'] for r in results}) and all(r.get('attempt',1)<=1 for r in results))
production=json.loads((p/'production-code-before.json').read_text());check('production_files_unchanged',all(sha(pathlib.Path(f).read_bytes())==h for f,h in production.items()))
report={'ok':True,'checks':checks,'count':len(checks),'model_calls':0};(p/'integrity-checks.json').write_text(json.dumps(report,indent=2));print(json.dumps({'ok':True,'checks':len(checks),'formal_attempt_markers':len(results)}))
