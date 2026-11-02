const fs=require('fs'),path=require('path');
const {DocumentArtifactRepository}=require('../../../api/server/services/DocumentArtifactRepository');
const {reciprocalRankFusion,weightedReciprocalRankFusion,protectDiverseCandidates}=require('../../../api/server/services/DocumentRetrieval');
const dir=process.argv[2],chunks=process.argv[3],out=process.argv[4];
const turn=JSON.parse(fs.readFileSync(path.join(dir,'turn_07.json'))),fixture=JSON.parse(fs.readFileSync(path.join(dir,'fixture-'+turn.conversation_id+'.json')));
const repo=new DocumentArtifactRepository({userId:'6ae73548fbae1de9b1b18ae2',conversationId:turn.conversation_id});
const doc=repo.add({fileId:fixture.file_id,records:fs.readFileSync(chunks,'utf8').trim().split('\n').map(JSON.parse)}),byId=new Map(doc.records.map(r=>[r.id,r]));
const target=doc.records.find(r=>r.sourceChunkId==='mineru_fe620c0ffc31706d034e0f04').id;
const sets={};
for(const name of ['keyword','bm25','vector']){const events=turn.trace_events.filter(e=>e.stage.toLowerCase()===name);if(events.length!==1)throw Error('SINGLE_QUERY_FROZEN_TRACE_REQUIRED');sets[name]=events[0].hits.map(h=>{const record=byId.get(h.id);if(!record)throw Error('SOURCE_MAPPING_FAILED');return {record,score:h.score,source:name};});}
const rows=[];for(const limit of [20,40,60]){
 const legacy=reciprocalRankFusion(Object.values(sets)).slice(0,limit);rows.push({mode:'legacy',limit,target_rank:legacy.findIndex(h=>h.record.id===target)+1||null});
 for(const weight of [1,.75,.5])for(const protect of [false,true]){
 const channels=[{name:'bm25',weight,results:sets.bm25},{name:'vector',weight:1,results:sets.vector}],fused=weightedReciprocalRankFusion(channels);
 const selected=protect?protectDiverseCandidates(fused,[...channels,{name:'keyword',maxProtected:4,results:sets.keyword}],{limit}):fused.slice(0,limit);
 rows.push({mode:'weighted',bm25_weight:weight,vector_weight:1,protect,limit,target_rank:selected.findIndex(h=>h.record.id===target)+1||null,candidate_count:selected.length});
 }}
fs.writeFileSync(out,JSON.stringify({scope:'real depth60 channel trace and immutable original text; one annotated missing fragment, NOT corpus-wide Recall',source_trace:path.join(dir,'turn_07.json'),target_source_chunk:'mineru_fe620c0ffc31706d034e0f04',channel_depths:Object.fromEntries(Object.entries(sets).map(([k,v])=>[k,v.length])),rows},null,2),{flag:'wx'});
console.log(rows);
