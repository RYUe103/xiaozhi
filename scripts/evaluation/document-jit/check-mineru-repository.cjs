const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {buildMineruStructure}=require('../../../api/server/services/Files/Code/mineruStructure');
const {DocumentArtifactRepository}=require('../../../api/server/services/DocumentArtifactRepository');
const {convertArchive}=require('../../../api/server/services/Files/Code/mineruCloud');
const input=process.argv[2],output=process.argv[3];
if(fs.existsSync(output))throw Error('NEW_OUTPUT_REQUIRED');
(async()=>{
 const summaries=[];
 for(const name of fs.readdirSync(input)){
  const p=path.join(input,name,'result.json');if(!fs.existsSync(p))continue;
  const data=JSON.parse(fs.readFileSync(p));
  const converted=await convertArchive(fs.readFileSync(path.join(input,name,'original.zip')));
  const structure=buildMineruStructure(data,data.content_list,name+'.pdf',{sourceHash:data.provenance.source_sha256,documentId:name});
  const artifacts=[{libreFileId:'chunks',displayFilename:'x_mineru_chunks.jsonl',value:structure.chunks.map(c=>JSON.stringify(c)).join('\n')},
   {libreFileId:'blocks',displayFilename:'x_mineru_blocks.json',value:JSON.stringify({...structure,chunks:undefined})}].map(a=>({...a,metadata:{rootSourceLibreFileId:name,sourceHash:structure.source_sha256}}));
  const repo=new DocumentArtifactRepository({userId:'offline-public-test',conversationId:name,secret:'offline-test-only'});
  await repo.load({roots:[{file_id:name,filename:name+'.pdf',metadata:{sha256:structure.source_sha256}}],artifacts,download:async a=>Buffer.from(a.value)});
  const doc=[...repo.documents.values()][0];
  const row={document:name,source_sha256:structure.source_sha256,blocks:structure.blocks.length,retrieval_chunks:doc.records.length,
    headings_excluded:structure.blocks.filter(b=>['header','footer','page_number'].includes(b.raw_type)).length,
    parent_links:doc.records.every(r=>structure.blocks.some(b=>b.block_id===r.block_id)),
    image_count:structure.images.length,mapped_blocks:converted.image_mapping.length,
    all_image_hashes_match:converted.image_mapping.every(m=>crypto.createHash('sha256').update(Buffer.from(converted.images[m.normalized_path],'base64')).digest('hex')===m.sha256),
    tables:doc.tables.length,readable_tables:doc.tables.filter(t=>t.readable).length,table_warnings:doc.tables.flatMap(t=>t.warnings),
    geometry_verified:false,scope:'real-cloud-assets/offline-repository; not Agent end-to-end'};
  summaries.push(row);console.log(JSON.stringify(row));
 }
 fs.writeFileSync(output,JSON.stringify(summaries,null,2),{flag:'wx'});
})().catch(e=>{console.error(e);process.exitCode=1});
