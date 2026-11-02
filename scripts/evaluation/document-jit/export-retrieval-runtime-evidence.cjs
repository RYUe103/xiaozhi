// Read-only audit of explicitly selected isolated evaluation conversations.
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const { createRequire } = require('module');
const root = process.env.SANSUO_JIT_REPO_ROOT;
const req = createRequire(root + '/api/package.json');
const mongoose = req('mongoose');
const mongo = process.env.SANSUO_TEST_MONGO;
if (!mongo?.endsWith('/LibreChatMineruVisionPhase5candidate20261101') ||
    process.env.SANSUO_TEST_BASE !== 'http://127.0.0.1:3185') throw Error('ISOLATED_TARGET_REQUIRED');
const targets = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const output = process.argv[3];
if (!Array.isArray(targets) || targets.length > 50 || fs.existsSync(output)) throw Error('INVALID_TARGET_OR_EXISTING_OUTPUT');
(async () => {
  await mongoose.connect(mongo);
  const lines = fs.readFileSync(root + '/server.log', 'utf8').replace(/\x1b\[[0-9;]*m/g, '').split('\n');
  const results = [];
  for (const target of targets) {
    if (!/^[a-f0-9-]{36}$/.test(target.conversation_id)) throw Error('CONVERSATION_REQUIRED');
    const job = await mongoose.connection.collection('sansuofileparsejobs').findOne(
      { conversationId: target.conversation_id },
      { projection: { userId: 1, status: 1, attempts: 1, startedAt: 1, completedAt: 1, libreFileId: 1 } });
    const scope = job?.userId ? crypto.createHash('sha256').update(String(job.userId) + ':' + target.conversation_id).digest('hex').slice(0, 20) : target.scope_hash;
    const events = [], timings = [];
    for (const line of lines) for (const [tag, bucket] of [['[JIT trace] ', events], ['[SanSuoFileTiming] ', timings]]) {
      const start = line.indexOf(tag);
      if (start < 0) continue;
      let event;
      try { event = JSON.parse(line.slice(start + tag.length)); } catch { continue; }
      if ((scope && event.scope_hash === scope) || event.conversationId === target.conversation_id || event.conversation_id === target.conversation_id) bucket.push(event);
    }
    if (job) delete job.userId;
    results.push({ id: target.id, conversation_id: target.conversation_id, scope_hash: scope, parse_job: job, events, timings });
  }
  fs.writeFileSync(output, JSON.stringify({ captured_at: new Date().toISOString(), results }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ exported: results.length, events: results.reduce((n, r) => n + r.events.length, 0) }));
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
