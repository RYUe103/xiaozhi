// Isolated live HTTP regressions. DOCX is an explicit synthetic fixture, not PDF quality evidence.
const fs=require('fs'),crypto=require('crypto');const {createRequire}=require('module');
const root=process.env.SANSUO_JIT_REPO_ROOT;const req=createRequire(root+'/api/package.json');req('module-alias')({base:root+'/api'});
const mongoose=req('mongoose'),jwt=req('jsonwebtoken'),JSZip=req('jszip');req('@librechat/data-schemas').createModels(mongoose);const db=req(root+'/api/models');
const base=process.env.SANSUO_TEST_BASE,mongo=process.env.SANSUO_TEST_MONGO;
if(!/\/LibreChatMineruVisionPhase5candidate20261101$/.test(mongo)||!/^http:\/\/127\.0\.0\.1:3185$/.test(base))throw Error('ISOLATED_TARGET_REQUIRED');
const report={scope:'Explicit model-transport fault injection with real Agent; not natural failure or accuracy benchmark',checks:[]};let token,user;
const request=(url,init={},auth=token)=>fetch(base+url,{...init,headers:{Authorization:'Bearer '+auth,'User-Agent':'Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36',...init.headers},signal:init.signal || AbortSignal.timeout(180000)});
async function chat(text,files=[],conversationId=crypto.randomUUID()){
 const at=Date.now();const response=await request('/api/agents/chat/SanSuoMain',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint:'SanSuoMain',endpointType:'custom',model:'qwen3.6-plus',spec:'sansuo-main',sansuoMode:'deep',ephemeralAgent:{execute_code:true},conversationId,parentMessageId:'00000000-0000-0000-0000-000000000000',text,files,messageId:crypto.randomUUID(),clientRequestId:crypto.randomUUID(),isContinued:false,isRegenerate:false})});
 if(!response.ok)throw Error('CHAT_HTTP_'+response.status);const started=await response.json();const controller=new AbortController();
 const stream=request('/api/agents/chat/stream/'+started.streamId,{signal:controller.signal}).then(async r=>{for await(const x of r.body){}}).catch(()=>{});
 let active=true;for(let i=0;i<180&&active;i++){await new Promise(r=>setTimeout(r,1000));active=Boolean((await(await request('/api/agents/chat/status/'+conversationId)).json()).active);}controller.abort();await stream;
 const messages=await db.getMessages({user:String(user._id),conversationId});const last=messages.filter(m=>!m.isCreatedByUser).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt)).at(-1);
 const answer=(last?.content||[]).filter(c=>c.type==='text').map(c=>typeof c.text==='string'?c.text:c.text?.value||'').join('\n')||last?.text||'';
 return {conversationId,elapsed_ms:Date.now()-at,answer,active,error:Boolean(last?.error),failure:last?.metadata?.sansuoModelFailure,tools:(last?.content||[]).filter(c=>c.type==='tool_call').map(c=>c.tool_call)};
}
(async()=>{
 await mongoose.connect(mongo);user=await db.createUser({name:'Phase5 fault',email:'fault-'+crypto.randomUUID()+'@example.invalid',provider:'local',role:'USER',emailVerified:true},undefined,true,true);
 token=jwt.sign({id:String(user._id)},process.env.JWT_SECRET,{expiresIn:'1h'});
 const mode=process.argv[3];if(!['reset_once','deny'].includes(mode))throw Error('INVALID_FAULT_MODE');
 const result=await chat(mode==='deny'?'只回答 7 加 8 的结果。':'请实际调用 execute_code，用 Python 计算从 1 到 100 的所有整数的平方和。必须依据代码执行结果回答。');
 report.mode=mode;report.result=result;
 report.checks.push({name:mode,ok:mode==='deny'?result.error&&/MODEL_AUTH_REJECTED/.test(result.answer):!result.error&&!result.active&&/338.?350/.test(result.answer)&&result.tools.some(t=>t.name==='execute_code'&&t.output)});
})().catch(error=>{report.error=error.message;process.exitCode=1;}).finally(async()=>{fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({checks:report.checks,error:report.error}));await mongoose.disconnect();process.exit(report.error||report.checks.some(c=>!c.ok)?1:0);});
