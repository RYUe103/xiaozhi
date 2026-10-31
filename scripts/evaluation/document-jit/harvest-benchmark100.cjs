'use strict';
/* Read-only recovery of already attempted conversations; NEVER starts inference. */
const fs=require('fs'),path=require('path'),{createRequire}=require('module');
const root=process.env.SANSUO_JIT_REPO_ROOT||'/app',req=createRequire(root+'/api/package.json');req('module-alias')({base:root+'/api'});
const mongoose=req('mongoose'),jwt=req('jsonwebtoken');req('@librechat/data-schemas').createModels(mongoose);const db=req(root+'/api/models');
const dir=process.argv[2];
async function main(){
 await mongoose.connect(process.env.MONGO_URI);const identity=JSON.parse(fs.readFileSync(path.join(dir,'identity.json'))),token=jwt.sign({id:identity.user_id},process.env.JWT_SECRET,{expiresIn:'30m'});
 const deviations=new Set(['citevqa:41489021-892f-5f2a-9c49-d0515dad08a2_4','citevqa:e114c893-9c6e-54bc-ba75-b89ec5e02679_xhop_2']);
 for(const n of fs.readdirSync(path.join(dir,'results'))){
  const dest=path.join(dir,'results',n),t=JSON.parse(fs.readFileSync(dest));if(t.state!=='started')continue;
  const r=await fetch('http://127.0.0.1:3080/api/agents/chat/status/'+t.conversation_id,{headers:{Authorization:'Bearer '+token,'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'}});const status=await r.json();if(status.active)continue;
  const msgs=await db.getMessages({user:identity.user_id,conversationId:t.conversation_id});const a=msgs.filter(m=>!m.isCreatedByUser).sort((x,y)=>new Date(x.createdAt)-new Date(y.createdAt)).at(-1);
  t.answer=(a?.content||[]).filter(c=>c.type==='text').map(c=>typeof c.text==='string'?c.text:c.text?.value||'').join('\n')||a?.text||'';
  t.tool_calls=(a?.content||[]).filter(c=>c.type==='tool_call').map(c=>c.tool_call);t.references=msgs.flatMap(m=>m.metadata?.sansuoDocumentReferences||[]);
  t.status=status;t.state=t.answer?'completed':'no_final_answer';if(deviations.has(t.id))t.protocol_deviation='upload bound to separate conversation; excluded from valid-protocol denominator but retained in all100';t.observed_completed_at=a?.updatedAt||null;t.elapsed_ms=a?.updatedAt?new Date(a.updatedAt)-new Date(t.started_at):null;t.harvested_read_only=true;
  t.assistant_errors=(a?.content||[]).filter(c=>c.type==='error').map(c=>c.error);t.message_metadata=a?.metadata;
  fs.writeFileSync(dest,JSON.stringify(t,null,2));console.log(t.id,t.state,t.elapsed_ms);
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(async()=>{await mongoose.disconnect();process.exit(process.exitCode||0);});
