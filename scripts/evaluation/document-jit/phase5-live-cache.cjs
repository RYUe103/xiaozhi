'use strict';
// Real persisted Mongo/cache/authorization test; tool-level, not autonomous Agent acceptance.
const fs=require('fs'),{createRequire}=require('module');
const root=process.env.SANSUO_JIT_REPO_ROOT,req=createRequire(root+'/api/package.json');req('module-alias')({base:root+'/api'});
const mongoose=req('mongoose');req('@librechat/data-schemas').createModels(mongoose);const db=req(root+'/api/models');
const {DocumentArtifactRepository,artifactSignature}=req(root+'/api/server/services/DocumentArtifactRepository');
const {DocumentPageVisionService}=req(root+'/api/server/services/DocumentPageVisionService');
const {DocumentVectorSearch,createMongoVectorCache}=req(root+'/api/server/services/DocumentVectorSearch');
if(!process.env.MONGO_URI.includes('/LibreChatMineruVisionPhase5'))throw Error('ISOLATION_REQUIRED');
const result=JSON.parse(fs.readFileSync(process.argv[2]));const output=process.argv[3];
const report={scope:'real persisted artifacts/cache with tool-level calls; isolated database mutations restored',checks:[],events:[]};
(async()=>{
 await mongoose.connect(process.env.MONGO_URI);
 const conversationId=result.conversation_id;
 const message=await mongoose.connection.collection('messages').findOne({conversationId,isCreatedByUser:true});
 const userId=String(message.user);const file=(await db.getFiles({user:userId,file_id:message.files[0].file_id},{},{}))[0];
 const artifacts=await db.getSanSuoFiles({userId,conversationId,status:'ready','metadata.rootSourceLibreFileId':file.file_id});
 const download=async a=>{const r=await fetch(process.env.LIBRECHAT_CODE_BASEURL+'/download/'+a.sandboxSessionId+'/'+a.sandboxFileId+'?kind=user&id='+userId,{headers:{'X-API-Key':process.env.LIBRECHAT_CODE_API_KEY,'User-Id':userId}});if(!r.ok){report.download_status=r.status;throw Error('ASSET_DOWNLOAD_'+r.status);}return Buffer.from(await r.arrayBuffer());};
 const repo=new DocumentArtifactRepository({userId,conversationId,authorize:async document=>{
  const currentArtifacts=await db.getSanSuoFiles({userId,conversationId,status:'ready','metadata.rootSourceLibreFileId':document.fileId});
  const byId=new Map(currentArtifacts.map(a=>[a.libreFileId,a]));for(const binding of document.artifactBindings||[]){const a=byId.get(binding.id);if(!a)return 'DOCUMENT_ACCESS_DENIED';if(artifactSignature(a)!==binding.signature)return 'DOCUMENT_VERSION_MISMATCH';}
  const current=await db.getFiles({user:userId,file_id:document.fileId},{},{});const source=current[0];if(!source)return 'DOCUMENT_ACCESS_DENIED';
  if((source.metadata?.sha256||source.metadata?.contentHash)!==document.sourceHash)return 'DOCUMENT_VERSION_MISMATCH';return true;
 }});
 await repo.load({roots:[file],artifacts,download});repo.trace={emit:(stage,data)=>report.events.push({stage,...data})};
 const doc=[...repo.documents.values()][0];report.loaded={artifacts:artifacts.length,records:doc?.records.length,warnings:doc?.warnings,sourceHash:doc?.sourceHash};if(!doc?.records.length)throw Error('NO_PARSED_RECORDS_LOADED');
 const call=result.tool_calls.map(t=>{try{return {args:JSON.parse(t.args),out:JSON.parse(t.output)}}catch{return {}}}).find(t=>t.args?.action==='inspect_page'&&t.out?.status==='ok');
 if(call){
  const collection=mongoose.connection.collection('sansuo_page_vision_results');let imageCalls=0,modelCalls=0;
  const service=new DocumentPageVisionService({repository:repo,requestQuestion:message.text,baseURL:process.env.QWEN_BASE_URL,apiKey:process.env.QWEN_API_KEY,model:process.env.SANSUO_VISION_MODEL||'qwen3-vl-plus',
   getPage:async()=>{imageCalls++;throw Error('CACHE_MISS_IMAGE_FETCH');},fetchImpl:async()=>{modelCalls++;throw Error('CACHE_MISS_MODEL_FETCH');},resultStore:{get:async key=>(await collection.findOne({_id:key,userId,conversationId,expiresAt:{$gt:new Date()}}))?.result,set:async()=>{}}});
  const hit=await service.inspect(call.args);report.checks.push({name:'persisted_visual_hit',ok:hit.telemetry?.cache_hit===true&&imageCalls===0&&modelCalls===0,imageCalls,modelCalls,status:hit.status});
  const files=mongoose.connection.collection('files');const original=await files.findOne({file_id:file.file_id});
  try{
   await files.updateOne({_id:original._id},{$set:{user:'phase5-revoked-test'}});const denied=await service.inspect(call.args);report.checks.push({name:'revocation_before_cached_visual_read',ok:denied.error?.code==='DOCUMENT_ACCESS_DENIED',code:denied.error?.code});
   await files.replaceOne({_id:original._id},original);
   await files.updateOne({_id:original._id},{$set:{'metadata.sha256':'phase5-changed-source'}});const changed=await service.inspect(call.args);report.checks.push({name:'source_metadata_change_rejects_cached_visual',ok:changed.error?.code==='DOCUMENT_VERSION_MISMATCH',code:changed.error?.code});
  }finally{await files.replaceOne({_id:original._id},original);}
 }else report.checks.push({name:'persisted_visual_hit',ok:false,reason:'NO_COMPLETE_VISUAL_RESULT_IN_SELECTED_AGENT_RUN'});
 const vector=new DocumentVectorSearch({cache:createMongoVectorCache(mongoose)});const query=JSON.parse(fs.readFileSync('/tmp/jit-inference-manifest.json')).questions.find(q=>q.id===result.id).question;
 const before=vector.usage.calls,t=Date.now();await vector.search({userId,conversationId,document:doc,query});const first=vector.usage.calls-before;
 const t2=Date.now();await vector.search({userId,conversationId,document:doc,query});report.checks.push({name:'vector_warm_reuse',ok:doc.records.length>0&&vector.usage.calls===before+first,first_calls:first,records:doc.records.length,second_calls:vector.usage.calls-before-first,total_ms:Date.now()-t,second_ms:Date.now()-t2});
})().catch(e=>{report.error=e.message;process.exitCode=1;}).finally(async()=>{fs.writeFileSync(output,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({download_status:report.download_status,loaded:report.loaded,checks:report.checks,error:report.error}));await mongoose.disconnect();process.exit(process.exitCode||0);});
