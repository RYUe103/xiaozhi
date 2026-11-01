'use strict';
// Run inside the isolated container. Frozen questions and PDFs are inputs; gold is not sent.
const fs = require('fs'), cp = require('child_process'), crypto = require('crypto');
const arm = process.argv[2], round = process.argv[3] || 'r1';
if (!['baseline', 'candidate'].includes(arm) || !/^r\d+$/.test(round)) throw Error('INVALID_BATCH');
const root = '/tmp/sansuo-phase5-' + arm + '-20261101';
const pid = fs.readFileSync(root + '/server.pid', 'utf8');
if(fs.readlinkSync('/proc/'+pid+'/cwd')!==root)throw Error('ISOLATION_MISMATCH');
const env = Object.fromEntries(fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0').filter(Boolean).map(s=>[s.slice(0,s.indexOf('=')),s.slice(s.indexOf('=')+1)]));
if(!env.MONGO_URI.includes('/LibreChatMineruVisionPhase5') || !env.SANSUO_CODE_API_DATA.startsWith(root+'/'))throw Error('ISOLATION_REQUIRED');
Object.assign(env,{SANSUO_JIT_REPO_ROOT:root,SANSUO_TEST_BASE:'http://127.0.0.1:'+env.PORT,SANSUO_TEST_MONGO:env.MONGO_URI});
const cases = [
 ['mi_phone.pdf','mml:888','phone'],
 ['finance--DUDE_2879a049d77aae9eccbedf4e9af7ac70.pdf','ohr:acb5da22-516c-429d-9bf2-5e055b367fe0','finance'],
 ['academic--DUDE_65b9e17aa028acda5ec3d594f2327ad0.pdf','ohr:aacc1e7d-d191-44ff-8eda-38c8f6f64725','academic'],
 ['2312.10997v5.pdf','mml:76','tree'],
 ['2312.10997v5.pdf','mml:80','table'],
 ['NETFLIX_2015_10K.pdf','mml:1021','netflix'],
 ['41489021-892f-5f2a-9c49-d0515dad08a2.pdf','citevqa:41489021-892f-5f2a-9c49-d0515dad08a2_xhop_0','scan'],
];
const outdir=root+'/phase5-results/'+round;fs.mkdirSync(outdir,{recursive:true});
const selection=process.argv[4]?cases.filter(c=>c[2]===process.argv[4]):cases;
if(!selection.length)throw Error('UNKNOWN_CASE');
(async()=>{for(const c of selection){
 const output=outdir+'/'+c[2]+'.json';if(fs.existsSync(output)||fs.existsSync(output+'.failure.json'))throw Error('BATCH_ALREADY_ATTEMPTED');
 const fd=fs.openSync(output+'.log','wx');const started=Date.now();
 const code=await new Promise(resolve=>{const p=cp.spawn(process.execPath,[root+'/scripts/evaluation/document-jit/run-page-vision-e2e.cjs','/tmp/jit-inference-manifest.json','/tmp/jit-benchmark100-pdfs/'+c[0],c[1],output],{cwd:root,env:{...env,SANSUO_TEST_FOLLOWUP:c[2]==='finance'?'true':'false',SANSUO_TEST_WARM_REPEAT:['phone','netflix'].includes(c[2])&&Number(round.slice(1))>=4?'true':'false'},stdio:['ignore',fd,fd]});p.on('exit',resolve);});
 fs.closeSync(fd);console.log(JSON.stringify({arm,round,case:c[2],code,elapsed_ms:Date.now()-started}));
}})().catch(e=>{console.error(e.message);process.exitCode=1;});
