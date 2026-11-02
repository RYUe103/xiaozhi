const fs=require('fs'),path=require('path');
const dir=process.argv[2],output=process.argv[3];
const rows=fs.readdirSync(dir).filter(n=>/^turn_\d+\.json$/.test(n)).sort().map(n=>{
 const d=JSON.parse(fs.readFileSync(path.join(dir,n)));
 const stages={};for(const e of d.trace_events||[]){const s=stages[e.stage]||={count:0,elapsed_ms:0};s.count++;s.elapsed_ms+=e.elapsed_ms||0;}
 return {id:d.id,completed:d.completed,elapsed_ms:d.elapsed_ms,tools:(d.tools||[]).map(t=>({name:t.name,args:t.args})),stages,
  model_usage:(d.trace_events||[]).filter(e=>e.stage==='ModelEnd').map(e=>e.usage),
  rerank_usage:(d.trace_events||[]).filter(e=>e.stage==='Rerank').map(e=>e.usage),
  vector_usage:(d.trace_events||[]).filter(e=>e.stage==='Vector').map(e=>e.usage),
  answer:d.answer,factual_review:'pending',error:d.harness_error||d.model_failure||null};
});
const times=rows.map(r=>r.elapsed_ms).sort((a,b)=>a-b),pct=p=>times[Math.ceil(times.length*p)-1];
fs.writeFileSync(output,JSON.stringify({scope:'one frozen candidate batch; completion is not correctness; not a matched simultaneous A/B',completed:rows.filter(r=>r.completed).length,total:rows.length,p50_ms:pct(.5),p95_ms:pct(.95),rows},null,2),{flag:'wx'});
