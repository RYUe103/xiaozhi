// Read-only usage export; restricted to explicitly listed isolated evaluation conversations.
'use strict';
const fs=require('fs'),{createRequire}=require('module');
const root=process.env.SANSUO_JIT_REPO_ROOT,req=createRequire(root+'/api/package.json'),mongoose=req('mongoose');
if(!process.env.SANSUO_TEST_MONGO?.endsWith('/LibreChatMineruVisionPhase5candidate20261101'))throw Error('ISOLATION');
const inputs=JSON.parse(fs.readFileSync(process.argv[2]));
(async()=>{await mongoose.connect(process.env.SANSUO_TEST_MONGO);const results=[];
for(const scope of inputs){
 const rows=await mongoose.connection.collection('transactions').find({conversationId:scope.conversationId},{projection:{_id:0,messageId:1,tokenType:1,model:1,context:1,rawAmount:1,tokenValue:1,inputTokens:1,writeTokens:1,readTokens:1,createdAt:1}}).toArray();
 const directory=[];
 for(const line of fs.readFileSync(root+'/server.log','utf8').split('\n')) {
  const marker='[SanSuoDocumentDirectory] ready '; const pos=line.indexOf(marker); if(pos<0)continue;
  try {const entry=JSON.parse(line.slice(pos+marker.length).replace(/\x1b\[[0-9;]*m/g,'')); if(entry.conversationId===scope.conversationId)directory.push(entry);}catch{}
 }
 results.push({...scope,records:rows,directory_snapshots:directory});
}
fs.writeFileSync(process.argv[3],JSON.stringify({scope:'isolated evaluation; accounting records, not complete provider billing',results},null,2),{flag:'wx'});
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>mongoose.disconnect());
