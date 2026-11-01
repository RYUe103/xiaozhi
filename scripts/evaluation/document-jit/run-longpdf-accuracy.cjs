// Evaluation-only: reuse immutable authorized assets through fresh test bindings. Never changes business configuration.
'use strict';
const fs=require('fs'),crypto=require('crypto'),{createRequire}=require('module');
const root=process.env.SANSUO_JIT_REPO_ROOT,req=createRequire(root+'/api/package.json');req('module-alias')({base:root+'/api'});
const mongoose=req('mongoose'),jwt=req('jsonwebtoken');req('@librechat/data-schemas').createModels(mongoose);const db=req(root+'/api/models');
const mongo=process.env.SANSUO_TEST_MONGO,base=process.env.SANSUO_TEST_BASE;
if(!mongo?.endsWith('/LibreChatMineruVisionPhase5candidate20261101')||base!=='http://127.0.0.1:3185')throw Error('ISOLATED_TARGET_REQUIRED');
const manifest=JSON.parse(fs.readFileSync(process.argv[2])),out=process.argv[3];fs.mkdirSync(out,{recursive:true});
const uid='6ae73548fbae1de9b1b18ae2',fid='f44df096-a3f4-48b5-988d-ce199cbe7fed',oldConv='751caa85-f6ff-4a31-8e54-e415bedfaaad',sha='5be30160ab9d6cfe86e338111fd0f7dafaa00a6194efe854b3e3f3699c8cccd0';
const write=(name,obj)=>fs.writeFileSync(out+'/'+name,JSON.stringify(obj,null,2),{flag:'wx'});
let token;
const http=(url,init={})=>fetch(base+url,{...init,headers:{Authorization:'Bearer '+token,'User-Agent':'Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36',...init.headers},signal:init.signal||AbortSignal.timeout(60000)});
async function fixture(){
 const c=mongoose.connection,original=await c.collection('files').findOne({file_id:fid,user:{$in:[uid,new mongoose.Types.ObjectId(uid)]}});
 if(!original||original.metadata?.sha256!==sha)throw Error('ROOT_HASH_OR_OWNER');
 const a=await c.collection('sansuofiles').find({userId:new mongoose.Types.ObjectId(uid),conversationId:oldConv,$or:[{libreFileId:fid},{'metadata.rootSourceLibreFileId':fid}],status:'ready'}).toArray();
 const job=await c.collection('sansuofileparsejobs').findOne({libreFileId:fid,userId:new mongoose.Types.ObjectId(uid),status:'ready'});
 if(!job||a.length<74||!a.some(x=>x.metadata?.artifactSetStatus==='complete'))throw Error('INCOMPLETE_ARTIFACT_SET');
 const conversationId=crypto.randomUUID(),id=crypto.randomUUID(),ids=new Map([[fid,id],...a.filter(x=>x.libreFileId!==fid).map(x=>[x.libreFileId,crypto.randomUUID()])]);
 function remap(v){if(typeof v==='string')return ids.get(v)||v;if(v instanceof Date||v instanceof mongoose.Types.ObjectId)return v;if(Array.isArray(v))return v.map(remap);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,remap(x)]));return v;}
 const f=remap(original);delete f._id;f.file_id=id;f.conversationId=conversationId;await c.collection('files').insertOne(f);
 const copies=a.map(x=>{const v=remap(x);delete v._id;v.conversationId=conversationId;v.metadata={...v.metadata,evaluationReuse:{sourceFileId:fid,sourceConversation:oldConv,batch:'longpdf-accuracy-20261101'}};return v;});await c.collection('sansuofiles').insertMany(copies);
 const j=remap(job);delete j._id;j.conversationId=conversationId;j.evaluationReuse={sourceFileId:fid,sourceJobId:String(job._id),notNewParse:true};await c.collection('sansuofileparsejobs').insertOne(j);
 write('fixture-'+conversationId+'.json',{conversationId,file_id:id,source_file_id:fid,sha256:sha,artifacts:copies.length,mode:'metadata-only alias; immutable bytes and parse generation reused',parser_job_inherited:true});
 return {conversationId,file:f,jobId:j._id};
}
async function chat(q,fx,parent,first){
 const start=Date.now(),requestId=crypto.randomUUID(),logStart=fs.statSync(root+'/server.log').size;
 const result={id:q.id,question:q.question,conversation_id:fx.conversationId,parent_message_id:parent,request_id:requestId,started_at:new Date(start).toISOString()};
 let controller;
 try{
 const r=await http('/api/agents/chat/SanSuoMain',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint:'SanSuoMain',endpointType:'custom',model:'qwen3.6-plus',spec:'sansuo-main',sansuoMode:'deep',ephemeralAgent:{execute_code:true},conversationId:fx.conversationId,parentMessageId:parent,text:q.question,files:first?[fx.file]:[],messageId:crypto.randomUUID(),clientRequestId:requestId,isContinued:false,isRegenerate:false})});
 result.http_status=r.status;if(!r.ok)throw Error('CHAT_HTTP_'+r.status);const begin=await r.json();controller=new AbortController();
 const stream=http('/api/agents/chat/stream/'+begin.streamId,{signal:controller.signal}).then(async s=>{for await(const b of s.body){}}).catch(e=>{if(!controller.signal.aborted)result.stream_error=e.message;});
 let active=true;for(let n=0;n<660&&active;n++){await new Promise(r=>setTimeout(r,1000));const st=await http('/api/agents/chat/status/'+fx.conversationId);if(!st.ok)throw Error('STATUS_'+st.status);active=Boolean((await st.json()).active);}result.active_at_end=active;controller.abort();await stream;
 const messages=await db.getMessages({user:uid,conversationId:fx.conversationId});const current=messages.filter(m=>new Date(m.createdAt).getTime()>=start-1000);result.messages=current;
 const assistant=current.filter(m=>!m.isCreatedByUser).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt)).at(-1);
 result.message_id=assistant?.messageId;result.answer=(assistant?.content||[]).filter(x=>x.type==='text').map(x=>typeof x.text==='string'?x.text:x.text?.value||'').join('\n')||assistant?.text||'';result.error=Boolean(assistant?.error);result.model_failure=assistant?.metadata?.sansuoModelFailure;result.tools=(assistant?.content||[]).filter(x=>x.type==='tool_call').map(x=>x.tool_call);result.completed=Boolean(result.answer)&&!active&&!result.error&&!result.model_failure;
 }catch(e){result.harness_error=e.message;result.completed=false;}finally{controller?.abort();}
 result.elapsed_ms=Date.now()-start;
 const bytes=fs.readFileSync(root+'/server.log').subarray(logStart).toString().replace(/\x1b\[[0-9;]*m/g,'');const scope=crypto.createHash('sha256').update(uid+':'+fx.conversationId).digest('hex').slice(0,20);
 result.trace_events=[];result.timings=[];for(const line of bytes.split('\n'))for(const [tag,key]of [['[JIT trace] ','trace_events'],['[SanSuoFileTiming] ','timings']]){const n=line.indexOf(tag);if(n<0)continue;try{const e=JSON.parse(line.slice(n+tag.length));if(e.scope_hash===scope||e.conversationId===fx.conversationId||e.conversation_id===fx.conversationId)result[key].push(e);}catch{}}
 result.parse_job_after=await mongoose.connection.collection('sansuofileparsejobs').findOne({libreFileId:fx.file.file_id},{projection:{status:1,attempts:1,startedAt:1,completedAt:1,evaluationReuse:1}});
 write(q.id+'.json',result);console.log(JSON.stringify({id:q.id,completed:result.completed,elapsed_ms:result.elapsed_ms,tools:result.tools?.map(t=>t.name),events:result.trace_events.length,error:result.harness_error}));return result;
}
(async()=>{await mongoose.connect(mongo);token=jwt.sign({id:uid},process.env.JWT_SECRET,{expiresIn:'8h'});write('run-start.json',{at:new Date().toISOString(),model:'qwen3.6-plus',mode:'deep',manifest_sha256:crypto.createHash('sha256').update(fs.readFileSync(process.argv[2])).digest('hex'),parse_jobs:await mongoose.connection.collection('sansuofileparsejobs').countDocuments()});
 for(const q of manifest.independent){if(fs.existsSync(out+'/'+q.id+'.json'))throw Error('NO_OVERWRITE');const fx=await fixture();await chat(q,fx,'00000000-0000-0000-0000-000000000000',true);}
 const fx=await fixture();let parent='00000000-0000-0000-0000-000000000000';for(let i=0;i<manifest.multiturn.length;i++){const r=await chat(manifest.multiturn[i],fx,parent,i===0);if(!r.message_id)throw Error('MULTITURN_MISSING_PARENT');parent=r.message_id;}
 write('run-end.json',{at:new Date().toISOString(),parse_jobs:await mongoose.connection.collection('sansuofileparsejobs').countDocuments()});
})().catch(e=>{console.error(e.message);if(!fs.existsSync(out+'/harness-error.json'))write('harness-error.json',{error:e.message,at:new Date().toISOString()});process.exitCode=1;}).finally(async()=>{await mongoose.disconnect();process.exit(process.exitCode||0);});
