#!/usr/bin/env python3
"""Read-only progress/snapshot supervisor. Does not start or retry Agent questions."""
import collections,datetime,json,pathlib,subprocess,sys,time
p=pathlib.Path(sys.argv[1]);previous=None
while True:
    subprocess.run(['docker','cp','LibreChat:/tmp/jit-benchmark100/results/.',str(p/'results')],capture_output=True)
    files=list((p/'results').glob('*.json'));results=[]
    for f in files:
        try:results.append(json.loads(f.read_text()))
        except ValueError:pass
    states=collections.Counter(r.get('state') for r in results);done=sum(n for s,n in states.items() if s!='started')
    status=dict(at=datetime.datetime.now(datetime.timezone.utc).isoformat(),attempted=len(results),finished=done,states=dict(states))
    (p/'progress.json').write_text(json.dumps(status,indent=2))
    if previous!=dict(states):
        print(json.dumps(status),flush=True);previous=dict(states)
        subprocess.run(['python3','scripts/evaluation/document-jit/summarize-benchmark100.py',str(p)],capture_output=True)
    if done==100:
        subprocess.run(['docker','exec','LibreChat','node','/tmp/benchmark100-delivery-snapshot.cjs','/tmp/jit-benchmark100'],capture_output=True)
        subprocess.run(['docker','cp','LibreChat:/tmp/jit-benchmark100/delivery-snapshots/.',str(p/'delivery-snapshots')],capture_output=True)
        print('ALL_100_TERMINAL. Starting deferred automatic scoring; no inference retries.',flush=True)
        with (p/'grading.log').open('w') as log:
            subprocess.run(['docker','exec','LibreChat','node','/tmp/grade-benchmark100.cjs','/tmp/jit-benchmark100'],stdout=log,stderr=subprocess.STDOUT)
        subprocess.run(['docker','cp','LibreChat:/tmp/jit-benchmark100/grades/.',str(p/'grades')],capture_output=True)
        subprocess.run(['python3','scripts/evaluation/document-jit/summarize-benchmark100.py',str(p)])
        print('SCORING_COMPLETE',flush=True);break
    time.sleep(30)
