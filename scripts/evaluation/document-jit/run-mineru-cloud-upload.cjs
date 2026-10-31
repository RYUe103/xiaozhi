'use strict';
const fs = require('fs');
const crypto = require('crypto');
const { createRequire } = require('module');
const root = process.env.SANSUO_JIT_REPO_ROOT || '/tmp/sansuo-pdf-audit-20261101';
const req = createRequire(root + '/api/package.json');
req('module-alias')({ base: root + '/api' });
const mongoose = req('mongoose');
const jwt = req('jsonwebtoken');
req('@librechat/data-schemas').createModels(mongoose);
const db = req(root + '/api/models');

async function main() {
  await mongoose.connect('mongodb://mongodb:27017/LibreChatPdfAudit20261101');
  const user = await db.createUser({ name: 'Isolated MinerU cloud test', email: `mineru-${crypto.randomUUID()}@example.invalid`,
    provider: 'local', role: 'USER', emailVerified: true }, undefined, true, true);
  const token = jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const conversationId = crypto.randomUUID();
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(process.argv[2])], { type: 'application/pdf' }), 'synthetic-acceptance.pdf');
  for (const [key, value] of Object.entries({ endpoint: 'SanSuoMain', endpointType: 'custom', file_id: crypto.randomUUID(),
    conversationId, message_file: 'true', tool_resource: 'execute_code' })) form.append(key, value);
  const response = await fetch('http://127.0.0.1:3182/api/files', { method: 'POST', body: form,
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36' } });
  if (!response.ok) throw new Error(`UPLOAD_HTTP_${response.status}`);
  const payload = await response.json();
  const file = payload.file || payload;
  const started = Date.now();
  const jobs = mongoose.connection.collection('sansuofileparsejobs');
  for (let i = 0; i < 120; i++) {
    const job = await jobs.findOne({ userId: user._id, libreFileId: file.file_id });
    if (job && ['ready', 'failed'].includes(job.status)) {
      const artifacts = await mongoose.connection.collection('sansuofiles').find({ userId: user._id, conversationId,
        'metadata.rootSourceLibreFileId': file.file_id, status: 'ready' }).toArray();
      console.log(JSON.stringify({ status: job.status, elapsed_ms: Date.now() - started, errorCode: job.errorCode || null,
        artifacts: artifacts.map((a) => a.displayFilename) }));
      if (job.status !== 'ready' || !artifacts.some((a) => /_mineru_content_list\.json$/.test(a.displayFilename))) process.exitCode = 1;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error('PARSE_JOB_TIMEOUT');
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
