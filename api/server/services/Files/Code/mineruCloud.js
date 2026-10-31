const path = require('path');
const yauzl = require('yauzl');

const MAX_ZIP_BYTES = 100 * 1024 * 1024;
const MAX_ENTRY_BYTES = 25 * 1024 * 1024;

async function readArchive(buffer) {
  if (buffer.length > MAX_ZIP_BYTES) throw new Error('mineru_archive_too_large');
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const files = [];
      let total = 0;
      zip.on('error', reject);
      zip.on('end', () => resolve(files));
      zip.on('entry', (entry) => {
        const name = entry.fileName;
        if (!/(?:\.md|_content_list\.json|\.(?:png|jpe?g|webp))$/i.test(name)) return zip.readEntry();
        total += entry.uncompressedSize;
        if (entry.uncompressedSize > MAX_ENTRY_BYTES || total > MAX_ZIP_BYTES) {
          zip.close();
          return reject(new Error('mineru_archive_too_large'));
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return reject(streamError);
          const chunks = [];
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('error', reject);
          stream.on('end', () => { files.push({ name, bytes: Buffer.concat(chunks) }); zip.readEntry(); });
        });
      });
      zip.readEntry();
    });
  });
}

async function parseMineruCloud({ axios, baseURL, apiKey, sourceBuffer, filename, timeoutMs, signal, pollMs = 2000 }) {
  if (!baseURL || !apiKey) throw new Error('mineru_cloud_not_configured');
  const base = new URL(baseURL);
  if (base.protocol !== 'https:') throw new Error('mineru_cloud_https_required');
  const deadline = Date.now() + timeoutMs;
  const request = (options) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('mineru_cloud_timeout');
    return axios({ ...options, timeout: remaining, signal });
  };
  const auth = { Authorization: `Bearer ${apiKey}` };
  const created = await request({ method: 'post', url: `${baseURL.replace(/\/+$/, '')}/v4/file-urls/batch`, headers: auth,
    data: { files: [{ name: filename }], model_version: 'vlm' } });
  const data = created.data?.data;
  if (!data?.batch_id || !data?.file_urls?.[0]) throw new Error('mineru_cloud_invalid_batch');
  await request({ method: 'put', url: data.file_urls[0], data: sourceBuffer, headers: { 'Content-Type': null }, maxBodyLength: Infinity });
  let item;
  while (Date.now() < deadline) {
    const response = await request({ method: 'get', url: `${baseURL.replace(/\/+$/, '')}/v4/extract-results/batch/${encodeURIComponent(data.batch_id)}`, headers: auth });
    item = response.data?.data?.extract_result?.[0];
    const state = String(item?.state || item?.status || '').toLowerCase();
    if (['failed', 'error'].includes(state)) throw new Error('mineru_cloud_parse_failed');
    if (['done', 'success', 'completed'].includes(state)) break;
    item = null;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(done, Math.min(pollMs, Math.max(0, deadline - Date.now())));
      function done() { signal?.removeEventListener('abort', aborted); resolve(); }
      function aborted() { clearTimeout(timer); reject(new Error('mineru_cloud_aborted')); }
      if (signal?.aborted) aborted(); else signal?.addEventListener('abort', aborted, { once: true });
    });
  }
  if (!item) throw new Error('mineru_cloud_timeout');
  if (!item.full_zip_url) return { md_content: item.md_content || item.markdown || '', content_list: item.content_list || [], images: {} };
  const downloaded = await request({ method: 'get', url: item.full_zip_url, responseType: 'arraybuffer', maxContentLength: MAX_ZIP_BYTES });
  const files = await readArchive(Buffer.from(downloaded.data));
  const markdown = files.find((file) => /\.md$/i.test(file.name));
  const content = files.find((file) => /_content_list\.json$/i.test(file.name));
  const images = {};
  for (const file of files.filter((entry) => /\.(?:png|jpe?g|webp)$/i.test(entry.name))) {
    const name = path.basename(file.name);
    if (images[name]) throw new Error('mineru_archive_duplicate_image');
    images[name] = file.bytes.toString('base64');
  }
  return { md_content: markdown?.bytes.toString('utf8') || '', content_list: content ? JSON.parse(content.bytes.toString('utf8')) : [], images };
}

module.exports = { parseMineruCloud, readArchive };
