'use strict';
const fs=require('fs'),crypto=require('crypto'),{createRequire}=require('module');
const req=createRequire('/tmp/sansuo-mineru-vision-20261101/api/package.json'),mongoose=req('mongoose');
const arm=process.argv[2];if(!['candidate','baseline'].includes(arm))throw Error('INVALID_ARM');
const root='/tmp/sansuo-phase5-'+arm+'-20261101';const out=root+'/phase5-export';fs.mkdirSync(out,{recursive:true});
const log=fs.readFileSync(root+'/server.log','utf8').replace(/\x1b\[[0-9;]*m/g,'');
const events=[],timings=[];for(const line of log.split('\n'))for(const [tag,target]of [['[JIT trace] ',events],['[SanSuoFileTiming] ',timings]]){const index=line.indexOf(tag);if(index>=0)try{const event=JSON.parse(line.slice(index+tag.length));event.export_log_time_utc=line.slice(0,19).replace(' ','T')+'Z';target.push(event);}catch{}}
fs.writeFileSync(out+'/events.jsonl',events.map(e=>JSON.stringify(e)).join('\n'));
fs.writeFileSync(out+'/timings.jsonl',timings.map(e=>JSON.stringify(e)).join('\n'));
(async()=>{
 await mongoose.connect('mongodb://mongodb:27017/LibreChatMineruVisionPhase5'+arm+'20261101');
 const messages=await mongoose.connection.collection('messages').find({}).toArray();
 const map={};for(const m of messages){const entry=map[m.conversationId]||={scope_hash:crypto.createHash('sha256').update(String(m.user)+':'+m.conversationId).digest('hex').slice(0,20),message_ids:[],files:[]};entry.message_ids.push(m.messageId);for(const f of m.files||[])if(f.file_id&&!entry.files.includes(f.file_id))entry.files.push(f.file_id);}
 fs.writeFileSync(out+'/scope-map.json',JSON.stringify(map,null,2));
 const jobs=await mongoose.connection.collection('sansuofileparsejobs').find({}).toArray();
 fs.writeFileSync(out+'/parse-jobs.json',JSON.stringify(jobs.map(j=>({libreFileId:j.libreFileId,conversationId:j.conversationId,parserVersion:j.parserVersion,artifactCount:j.artifactCount,startedAt:j.startedAt,completedAt:j.completedAt,status:j.status,attempts:j.attempts,createdAt:j.createdAt,updatedAt:j.updatedAt,errorCode:j.errorCode})),null,2));
 const artifacts=await mongoose.connection.collection('sansuofiles').find({'metadata.artifactKind':'pdf_mineru_provenance'}).toArray();
 fs.writeFileSync(out+'/artifact-counts.json',JSON.stringify({files:await mongoose.connection.collection('files').countDocuments(),derived:await mongoose.connection.collection('sansuofiles').countDocuments(),visual_cache:await mongoose.connection.collection('sansuo_page_vision_results').countDocuments(),vector_cache:await mongoose.connection.collection('sansuo_jit_embedding_cache').countDocuments()},null,2));
 console.log(JSON.stringify({arm,events:events.length,timings:timings.length,conversations:Object.keys(map).length}));
})().finally(()=>mongoose.disconnect());
