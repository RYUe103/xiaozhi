'use strict';
const fs=require('fs'),path=require('path'),{createRequire}=require('module');
const root=process.env.SANSUO_JIT_REPO_ROOT||'/app',req=createRequire(root+'/api/package.json');req('module-alias')({base:root+'/api'});const mongoose=req('mongoose');req('@librechat/data-schemas').createModels(mongoose);const db=req(root+'/api/models'),dir=process.argv[2];
async function main(){
 await mongoose.connect(process.env.MONGO_URI);fs.mkdirSync(path.join(dir,'delivery-snapshots'),{recursive:true});
 for(const name of fs.readdirSync(path.join(dir,'results'))){
  const r=JSON.parse(fs.readFileSync(path.join(dir,'results',name)));if(!['completed','no_final_answer','failed'].includes(r.state))continue;
  const dest=path.join(dir,'delivery-snapshots',name);if(fs.existsSync(dest)&&JSON.parse(fs.readFileSync(dest)).ordered_assistant_content)continue;
  const msgs=await db.getMessages({user:r.user_id,conversationId:r.conversation_id});
  const users=msgs.filter(m=>m.isCreatedByUser).map(m=>({message_id:m.messageId,metadata_keys:Object.keys(m.metadata||{}),visual_context:m.metadata?.sansuoVisualContext,visual_artifacts:m.metadata?.sansuoVisualArtifacts,document_references:m.metadata?.sansuoDocumentReferences,fileContext:m.fileContext}));
  const assistant=msgs.filter(m=>!m.isCreatedByUser).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt)).at(-1);
  const ordered_assistant_content=(assistant?.content||[]).filter(c=>['text','tool_call','error'].includes(c.type));
  fs.writeFileSync(dest,JSON.stringify({id:r.id,users,ordered_assistant_content,response_metadata:assistant?.metadata},null,2));
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(async()=>{await mongoose.disconnect();process.exit(process.exitCode||0);});
