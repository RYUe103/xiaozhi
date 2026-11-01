'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseMineruCloud } = require('../../../api/server/services/Files/Code/mineruCloud');
const axios = require('axios');
const benchmark = process.argv[2], output = process.argv[3];
if (!benchmark || !output || fs.existsSync(output)) throw new Error('NEW_OUTPUT_DIRECTORY_REQUIRED');
const manifest = JSON.parse(fs.readFileSync(path.join(benchmark,'inference-manifest.json')));
const names = ['41489021-892f-5f2a-9c49-d0515dad08a2.pdf','NETFLIX_2015_10K.pdf','2312.10997v5.pdf',
  'academic--DUDE_65b9e17aa028acda5ec3d594f2327ad0.pdf','mi_phone.pdf','finance--DUDE_2879a049d77aae9eccbedf4e9af7ac70.pdf'];
const selectedNames = process.env.SANSUO_TEST_ONLY ? names.filter(name => process.env.SANSUO_TEST_ONLY.split(',').includes(name)) : names;
const documents = selectedNames.map(name => { const doc = manifest.documents.find(d=>d.filename===name); if(!doc) throw Error('SOURCE_NOT_FOUND'); return doc; });
fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(path.join(output,'selection.json'),JSON.stringify({ selected_at:new Date().toISOString(), reason:'Fixed public benchmark documents covering scanning, annual reports, research, charts, images and tables; selection before new results', documents, questions:manifest.questions.filter(q=>documents.some(d=>d.key===q.document_key)) },null,2),{flag:'wx'});
// Freeze gold separately; it is never passed into parsing or Agent prompts.
fs.copyFileSync(path.join(benchmark,'frozen-gold.json'),path.join(output,'frozen-gold.original.json'),fs.constants.COPYFILE_EXCL);
async function run(doc) {
 const source=fs.readFileSync(path.join(benchmark,'pdfs',doc.filename));
 const digest=crypto.createHash('sha256').update(source).digest('hex');
 if(digest!==doc.sha256) throw Error('SOURCE_HASH_MISMATCH');
 const dir=path.join(output,doc.filename.replace(/\.pdf$/,'')); fs.mkdirSync(dir);
 const at=Date.now();
 try {
  const result=await parseMineruCloud({axios,baseURL:process.env.MINERU_URL,apiKey:process.env.MINERU_API_KEY,
   sourceBuffer:source,filename:doc.filename,timeoutMs:600000,allowedSourceHashes:documents.map(d=>d.sha256)});
  fs.writeFileSync(path.join(dir,'original.zip'),result.rawArchive);
  fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result));
  const summary={id:doc.key,sha256:digest,status:'ok',elapsed_ms:Date.now()-at,blocks:result.content_list.length,
   images:Object.keys(result.images).length,mapped_blocks:result.image_mapping.length,provenance:result.provenance};
  fs.writeFileSync(path.join(dir,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
 } catch(error) {const failure={id:doc.key,status:'failed',error:error.message,diagnostics:error.diagnostics || null,elapsed_ms:Date.now()-at};fs.writeFileSync(path.join(dir,'failure.json'),JSON.stringify(failure,null,2));console.log(JSON.stringify(failure));}
}
(async()=>{for(let i=0;i<documents.length;i+=2)await Promise.all(documents.slice(i,i+2).map(run));})().catch(e=>{console.error(e.message);process.exitCode=1;});
