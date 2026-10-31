#!/usr/bin/env python3
"""Filter existing production trace logs to this run's isolated identity/scopes."""
import hashlib,json,pathlib,re,subprocess,sys,time
p=pathlib.Path(sys.argv[1]);identity=json.loads((p/'identity.json').read_text());start=json.loads((p/'freeze-lock.json').read_text())['frozen_at'];out=p/'production-traces.jsonl'
proc=subprocess.Popen(['docker','logs','--follow','--since',start,'LibreChat'],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
ansi=re.compile(r'\x1b\[[0-9;]*m');cache={};filecache={};last=0
try:
    with out.open('a',encoding='utf-8') as f:
        for raw in proc.stdout:
            marker='[JIT trace] ' if '[JIT trace] ' in raw else '[SanSuoFileTiming] ' if '[SanSuoFileTiming] ' in raw else None
            if not marker:continue
            try:e=json.loads(ansi.sub('',raw).split(marker,1)[1])
            except (ValueError,IndexError):continue
            # Only scoped evaluation events; no unrelated user text or credentials saved.
            if time.time()-last>2:
                r=subprocess.run(['docker','exec','LibreChat','node','-e','const f=require("fs"),p="/tmp/jit-benchmark100/results";console.log(JSON.stringify(f.existsSync(p)?f.readdirSync(p).map(n=>{try{const x=JSON.parse(f.readFileSync(p+"/"+n));return [x.scope_hash,x.id,x.file_id]}catch{return []}}):[]))'],capture_output=True,text=True)
                try:
                    for x in json.loads(r.stdout):
                        if len(x)==3:
                            cache[x[0]]=x[1]
                            if x[2]:filecache[x[2]]=x[1]
                except ValueError:pass
                last=time.time()
            if e.get('scope_hash') in cache:
                e['evaluation_id']=cache[e['scope_hash']];f.write(json.dumps(e,ensure_ascii=False)+'\n');f.flush()
            elif marker=='[SanSuoFileTiming] ':
                ids=[qid for fid,qid in filecache.items() if fid in e.get('traceId','') or fid in e.get('fileIds',[])]
                if ids:
                    e['evaluation_id']=ids[0];e['event_family']='file_timing';f.write(json.dumps(e,ensure_ascii=False)+'\n');f.flush()
except KeyboardInterrupt:pass
finally:proc.terminate()
