'use strict';
/* Official once-only inference through the running authenticated HTTP endpoint.
 * No gold answers or evidence are loaded into the inference process. */
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{createRequire}=require('module');
const root=process.env.SANSUO_JIT_REPO_ROOT||'/app',req=createRequire(root+'/api/package.json');
req('module-alias')({base:root+'/api'});
const mongoose=req('mongoose'),jwt=req('jsonwebtoken');req('@librechat/data-schemas').createModels(mongoose);
const db=req(root+'/api/models'),dir=process.argv[2],base='http://127.0.0.1:3080';
const read=p=>JSON.parse(fs.readFileSync(path.join(dir,p),'utf8'));
const save=(p,v)=>{const dest=path.join(dir,p);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,JSON.stringify(v,null,2));};
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let token,identity;
async function request(route,init={}) {return fetch(base+route,{...init,headers:{Authorization:'Bearer '+token,'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',...init.headers},signal:init.signal||AbortSignal.timeout(180000)});}
async function question(q,file,document){
  const name='results/'+q.id.replace(/[^a-zA-Z0-9_-]/g,'_')+'.json';
  if(fs.existsSync(path.join(dir,name))) {console.log('SKIP_ALREADY_ATTEMPTED',q.id);return;}
  const conversationId=crypto.randomUUID(),start=Date.now();
  const t={id:q.id,document_key:document.key,split:q.split,category:q.category,question:q.question,conversation_id:conversationId,user_id:identity.user_id,scope_hash:hash(identity.user_id+':'+conversationId).slice(0,20),started_at:new Date().toISOString(),attempt:1,state:'started',model_parameters:'server-owned production sansuo-main/deep; no inference overrides',prompt:q.question+'\n\n请依据所附文档回答，并引用 PDF 物理页码；无法从文档确认时请明确说明。'};
  // Exclusive marker is written BEFORE the HTTP request. Crash recovery never re-infers.
  fs.mkdirSync(path.dirname(path.join(dir,name)),{recursive:true});try{fs.writeFileSync(path.join(dir,name),JSON.stringify(t,null,2),{flag:'wx'});}catch(e){if(e.code==='EEXIST'){console.log('SKIP_ALREADY_CLAIMED',q.id);return;}throw e;}
  let streamController,consume;
  try{
    // Real UI upload semantics: parsing artifacts are scoped to THIS conversation.
    // Never rebind an attachment from another established conversation.
    const bytes=fs.readFileSync(path.join(dir,'pdfs',document.filename));
    if(hash(bytes)!==document.sha256)throw Error('PDF_HASH_MISMATCH');
    const form=new FormData();form.append('file',new Blob([bytes],{type:'application/pdf'}),document.filename);
    for(const[k,v]of Object.entries({endpoint:'SanSuoMain',endpointType:'custom',file_id:crypto.randomUUID(),conversationId,message_file:'true',tool_resource:'execute_code'}))form.append(k,v);
    const upstart=Date.now(),up=await request('/api/files',{method:'POST',body:form});const upraw=await up.text();
    if(!up.ok)throw Error('UPLOAD_HTTP_'+up.status+':'+upraw.slice(0,300));
    let uploaded;try{uploaded=JSON.parse(upraw);}catch{throw Error('UPLOAD_RESPONSE_NOT_JSON:'+upraw.slice(0,300));}
    file=uploaded.file||uploaded;if(!file.file_id)throw Error('NO_UPLOAD_FILE_ID');t.upload_ms=Date.now()-upstart;t.file_id=file.file_id;t.protocol='same-conversation upload and fresh Agent';save(name,t);
    const r=await request('/api/agents/chat/SanSuoMain',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint:'SanSuoMain',endpointType:'custom',model:'qwen3.6-plus',spec:'sansuo-main',sansuoMode:'deep',ephemeralAgent:{execute_code:true},conversationId,parentMessageId:'00000000-0000-0000-0000-000000000000',text:t.prompt,files:[file],messageId:crypto.randomUUID(),clientRequestId:crypto.randomUUID(),isContinued:false,isRegenerate:false})});
    if(!r.ok)throw Error('CHAT_HTTP_'+r.status+':'+(await r.text()).slice(0,300));
    const initiated=await r.json();t.stream_id=initiated.streamId;save(name,t);
    if(!t.stream_id)throw Error('NO_STREAM_ID');
    streamController=new AbortController();t.sse_events=0;
    consume=fetch(base+'/api/agents/chat/stream/'+t.stream_id,{headers:{Authorization:'Bearer '+token},signal:streamController.signal}).then(async res=>{
      if(!res.ok)throw Error('STREAM_HTTP_'+res.status);
      for await(const b of res.body)t.sse_events+=(Buffer.from(b).toString().match(/data:/g)||[]).length;
    }).catch(e=>{if(e.name!=='AbortError')t.stream_error=e.message;});
    // A generous observation timeout, not an altered production recursion/token budget.
    for(let i=0;i<1200;i++){
      await sleep(1500);const res=await request('/api/agents/chat/status/'+conversationId);t.status=await res.json();
      if(!t.status.active)break;
      if(i%40===0){save(name,t);console.log(JSON.stringify({id:q.id,state:'running',elapsed_ms:Date.now()-start}));}
    }
    const msgs=await db.getMessages({user:identity.user_id,conversationId});
    const assistant=msgs.filter(m=>!m.isCreatedByUser).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt)).at(-1);
    t.answer=(assistant?.content||[]).filter(c=>c.type==='text').map(c=>typeof c.text==='string'?c.text:c.text?.value||'').join('\n')||assistant?.text||'';
    t.message_id=assistant?.messageId;t.message_metadata=assistant?.metadata;
    t.tool_calls=(assistant?.content||[]).filter(c=>c.type==='tool_call').map(c=>c.tool_call);
    t.references=msgs.flatMap(m=>m.metadata?.sansuoDocumentReferences||[]);
    t.state=t.status?.active?'observation_timeout':t.answer?'completed':'no_final_answer';
    t.response_fields=assistant?Object.keys(assistant):[];
    const artifacts=await db.getSanSuoFiles({userId:identity.user_id,conversationId});
    t.artifacts=artifacts.filter(a=>a.metadata?.rootSourceLibreFileId===file.file_id).map(a=>({name:a.displayFilename,status:a.status,kind:a.metadata?.artifactKind,metadata:a.metadata,storage_session_id:a.sandboxSessionId,file_id:a.sandboxFileId}));
  }catch(e){t.state='failed';t.error=e.message;}
  finally{streamController?.abort();if(consume)await consume;t.elapsed_ms=Date.now()-start;t.completed_at=new Date().toISOString();save(name,t);console.log(JSON.stringify({id:q.id,state:t.state,elapsed_ms:t.elapsed_ms,tools:t.tool_calls?.length,error:t.error}));}
}
async function document(d,questions){
  const upath='uploads/'+hash(d.key).slice(0,16)+'.json';let file;
  if(fs.existsSync(path.join(dir,upath)))file=read(upath).file;
  else{
    const p=path.join(dir,'pdfs',d.filename),bytes=fs.readFileSync(p);
    if(hash(bytes)!==d.sha256)throw Error('PDF_HASH_MISMATCH:'+d.key);
    const form=new FormData();form.append('file',new Blob([bytes],{type:'application/pdf'}),d.filename);
    for(const[k,v]of Object.entries({endpoint:'SanSuoMain',endpointType:'custom',file_id:crypto.randomUUID(),conversationId:crypto.randomUUID(),message_file:'true',tool_resource:'execute_code'}))form.append(k,v);
    const start=Date.now();const r=await request('/api/files',{method:'POST',body:form});
    if(!r.ok){save(upath,{error:'UPLOAD_HTTP_'+r.status,body:(await r.text()).slice(0,400)});for(const q of questions)save('results/'+q.id.replace(/[^a-zA-Z0-9_-]/g,'_')+'.json',{id:q.id,document_key:d.key,split:q.split,category:q.category,state:'upload_failed',error:'UPLOAD_HTTP_'+r.status,attempt:0});return;}
    const raw=await r.text();let uploaded;try{uploaded=JSON.parse(raw);}catch(e){save(upath,{error:'UPLOAD_RESPONSE_NOT_JSON',raw});throw Error('UPLOAD_RESPONSE_NOT_JSON');}file=uploaded.file||uploaded;if(!file.file_id)throw Error('NO_UPLOAD_FILE_ID');save(upath,{document:d.key,elapsed_ms:Date.now()-start,file});
  }
  if(!file)return;
  for(const q of questions)await question(q,file,d);
}
async function main(){
  const lock=read('freeze-lock.json');for(const[p,expected]of Object.entries(lock.files)){if(hash(fs.readFileSync(path.join(dir,p)))!==expected)throw Error('FREEZE_CHANGED:'+p);}
  const manifest=read('inference-manifest.json'); // Deliberately excludes every gold field.
  await mongoose.connect(process.env.MONGO_URI);
  if(fs.existsSync(path.join(dir,'identity.json')))identity=read('identity.json');
  else{const u=await db.createUser({name:'JIT100 isolated research evaluation',email:'jit100-'+crypto.randomUUID()+'@example.invalid',provider:'local',role:'USER',emailVerified:true},undefined,true,true);identity={user_id:String(u._id),created_at:new Date().toISOString()};save('identity.json',identity);}
  token=jwt.sign({id:identity.user_id},process.env.JWT_SECRET,{expiresIn:'24h'});
  const queue=manifest.documents.slice();async function worker(){while(queue.length){const d=queue.shift();try{for(const q of manifest.questions.filter(q=>q.document_key===d.key))await question(q,null,d);}catch(e){save('document-errors/'+hash(d.key).slice(0,16)+'.json',{key:d.key,error:e.message});console.error(d.key,e.message);}}}
  // Predeclared concurrency=2 documents. Questions within a document run sequentially.
  await Promise.all(Array.from({length:Number(process.env.JIT_BENCHMARK_WORKERS||2)},()=>worker()));
  save('inference-complete.json',{at:new Date().toISOString(),question_results:fs.readdirSync(path.join(dir,'results')).length});
}
main().catch(e=>{save('runner-error.json',{error:e.message});console.error(e.message);process.exitCode=1;}).finally(async()=>{await mongoose.disconnect();process.exit(process.exitCode||0);});
