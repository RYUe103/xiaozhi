// Evaluation-only controlled stdin. No shell, paths or regex from model input.
const fs=require('fs'),cp=require('child_process'),{performance}=require('perf_hooks');
const {exactSearch}=require('../../../api/server/services/DocumentExactSearch');
const file=process.argv[2],output=process.argv[3];
const records=fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse).map((r,i)=>({id:String(i),text:r.text||r.content||''}));
const selected=records.filter(r=>r.text.length>30).filter((_,i)=>i%20===0).slice(0,20);
const stats={scope:'actual frozen parsed text; host backend benchmark, no Agent',rounds:[],rg_available:true};
for(const record of selected){
 const query=record.text.slice(Math.floor(record.text.length/2),Math.floor(record.text.length/2)+10).replace(/\n/g,' ');
 const start=performance.now();const found=exactSearch(records,{query,limit:12,context_chars:0});const memory=performance.now()-start;
 const text=records.map(r=>r.text).join('\n'),t=performance.now();
 const result=cp.spawnSync('rg',['--no-config','--fixed-strings','--json','--',query],{input:text,encoding:'utf8',timeout:2000,maxBuffer:1024*1024,shell:false});
 if(result.error?.code==='ENOENT'){stats.rg_available=false;break;}
 const rows=(result.stdout||'').split('\n').filter(Boolean).map(JSON.parse).filter(x=>x.type==='match');
 const count=rows.reduce((n,r)=>n+r.data.submatches.length,0);
 stats.rounds.push({memory_ms:memory,rg_ms:performance.now()-t,memory_matches:found.match_count,rg_matches:count,same_count:count===found.match_count,rg_exit:result.status});
}
const percentile=(values,p)=>values.sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
for(const name of ['memory','rg']){const v=stats.rounds.map(r=>r[name+'_ms']);stats[name]={p50_ms:percentile([...v],.5),p95_ms:percentile([...v],.95)};}
stats.decision='Keep memory default: source offsets and authorization already in Repository; rg deployment and normalized-source mapping add complexity. No rg runtime dependency.';
fs.writeFileSync(output,JSON.stringify(stats,null,2),{flag:'wx'});console.log(JSON.stringify(stats));
