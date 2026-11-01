const crypto = require('crypto');
const dns = require('dns').promises;
const https = require('https');
const net = require('net');
const path = require('path').posix;
const yauzl = require('yauzl');
const sharp = require('sharp');

const VERSION = 'mineru-cloud-v4-assets-v2';
const LIMITS = {
  zip: 100 * 1024 * 1024,
  entry: 32 * 1024 * 1024,
  total: 256 * 1024 * 1024,
  entries: 10000,
  ratio: 1000,
};
const DEFAULT_HOSTS = [
  'mineru.net',
  'cdn-mineru.openxlab.org.cn',
  'mineru.oss-cn-shanghai.aliyuncs.com',
  'mineru.oss-cn-hangzhou.aliyuncs.com',
];
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const fail = (code) => {
  throw new Error(code);
};

function normalizeAssetPath(value) {
  if (typeof value !== 'string' || !value || /[\x00-\x1f\x7f?#]/.test(value))
    fail('MINERU_PATH_INVALID');
  const raw = value.replace(/\\/g, '/');
  if (
    raw.startsWith('/') ||
    /^[a-z]:/i.test(raw) ||
    raw.split('/').includes('..') ||
    raw.includes('://')
  )
    fail('MINERU_PATH_INVALID');
  const normalized = path.normalize(raw).replace(/^\.\//, '').replace(/\/$/, '');
  if (!normalized || normalized === '.') fail('MINERU_PATH_INVALID');
  return normalized;
}

const blocked = new net.BlockList();
for (const [address, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
])
  blocked.addSubnet(address, bits, 'ipv4');
const blockedV6 = new net.BlockList();
for (const [address, bits] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
])
  blockedV6.addSubnet(address, bits, 'ipv6');
const globalV6 = new net.BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
function publicIP(address) {
  if (net.isIP(address) === 4) return !blocked.check(address, 'ipv4');
  return (
    net.isIP(address) === 6 && globalV6.check(address, 'ipv6') && !blockedV6.check(address, 'ipv6')
  );
}

async function validateTarget(value, allowedHosts = DEFAULT_HOSTS, lookup = dns.lookup, signal) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail('MINERU_TARGET_INVALID');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== '443') ||
    !allowedHosts.includes(url.hostname) ||
    net.isIP(url.hostname)
  )
    fail('MINERU_TARGET_DENIED');
  const addresses = await new Promise((resolve, reject) => {
    const abort = () => reject(new Error('MINERU_CLOUD_ABORTED_OR_TIMEOUT'));
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve()
      .then(() => lookup(url.hostname, { all: true, verbatim: true }))
      .then(resolve, reject)
      .finally(() => signal?.removeEventListener('abort', abort));
  });
  if (!addresses.length || addresses.some((item) => !publicIP(item.address)))
    fail('MINERU_TARGET_DENIED');
  // Pin the vetted addresses for this connection. No second DNS resolution and no environment proxy.
  const agent = new https.Agent({
    keepAlive: false,
    lookup: (hostname, options, callback) => {
      if (hostname !== url.hostname) return callback(new Error('MINERU_TARGET_DENIED'));
      if (options?.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    },
  });
  return { url, agent };
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let value = n;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crcUpdate(crc, bytes) {
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return crc >>> 0;
}

async function readArchive(buffer, { signal, limits = LIMITS } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length > limits.zip) fail('MINERU_ARCHIVE_LIMIT');
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, strictFileNames: true, validateEntrySizes: true },
      (error, zip) => {
        if (error) return reject(new Error('MINERU_ARCHIVE_INVALID'));
        const files = [],
          inventory = [],
          paths = new Set();
        let count = 0,
          total = 0,
          active,
          settled = false;
        const abort = () => end(new Error('MINERU_ABORTED'));
        function end(err) {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', abort);
          active?.destroy();
          zip.close();
          if (err) reject(err);
          else {
            files.inventory = inventory;
            resolve(files);
          }
        }
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) return abort();
        zip.on('error', () => end(new Error('MINERU_ARCHIVE_INVALID')));
        zip.on('end', () => end());
        zip.on('entry', (entry) => {
          if (settled) return;
          try {
            if (++count > limits.entries) fail('MINERU_ARCHIVE_LIMIT');
            const name = normalizeAssetPath(entry.fileName);
            if (paths.has(name)) fail('MINERU_DUPLICATE_PATH');
            paths.add(name);
            if (/\/$/.test(entry.fileName)) return zip.readEntry();
            const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
            if (mode && mode !== 0x8000) fail('MINERU_ARCHIVE_FILE_TYPE');
            if (entry.generalPurposeBitFlag & 1) fail('MINERU_ARCHIVE_ENCRYPTED');
            if (!/\.(?:md|json|pdf|png|jpe?g|webp|gif)$/i.test(name))
              fail('MINERU_ARCHIVE_FILE_TYPE');
            const entryLimit = /\.pdf$/i.test(name) ? limits.zip : limits.entry;
            if (
              entry.uncompressedSize > entryLimit ||
              entry.uncompressedSize > Math.max(1, entry.compressedSize) * limits.ratio
            )
              fail('MINERU_ARCHIVE_LIMIT');
            zip.openReadStream(entry, (streamError, stream) => {
              if (settled) { stream?.destroy(); return; }
              if (streamError) return end(new Error('MINERU_ARCHIVE_INVALID'));
              active = stream;
              let size = 0,
                crc = 0xffffffff;
              const chunks = [],
                digest = crypto.createHash('sha256');
              // Preserve raw ZIP; only materialize consumer assets in addition to it.
              const retain = /(?:\.md|_content_list\.json|\.(?:png|jpe?g|webp|gif))$/i.test(name);
              stream.on('data', (chunk) => {
                size += chunk.length;
                total += chunk.length;
                if (
                  size > entryLimit ||
                  total > limits.total ||
                  size > Math.max(1, entry.compressedSize) * limits.ratio
                )
                  return end(new Error('MINERU_ARCHIVE_LIMIT'));
                crc = crcUpdate(crc, chunk);
                digest.update(chunk);
                if (retain) chunks.push(chunk);
              });
              stream.on('error', () => end(new Error('MINERU_ARCHIVE_INVALID')));
              stream.on('end', () => {
                if (settled) return;
                if (size !== entry.uncompressedSize || (crc ^ 0xffffffff) >>> 0 !== entry.crc32)
                  return end(new Error('MINERU_ARCHIVE_CRC'));
                inventory.push({
                  original_path: entry.fileName,
                  normalized_path: name,
                  bytes: size,
                  sha256: digest.digest('hex'),
                });
                if (retain) files.push({ name, bytes: Buffer.concat(chunks) });
                active = null;
                zip.readEntry();
              });
            });
          } catch (err) {
            end(err);
          }
        });
        zip.readEntry();
      },
    );
  });
}

async function convertArchive(buffer, { signal } = {}) {
  const files = await readArchive(buffer, { signal });
  const allMarkdown = files.filter((f) => /\.md$/i.test(f.name));
  const canonical = allMarkdown.filter((f) => path.basename(f.name).toLowerCase() === 'full.md');
  const mds = canonical.length ? canonical : allMarkdown;
  const lists = files.filter((f) => /_content_list\.json$/i.test(f.name));
  if (mds.length !== 1 || lists.length !== 1) fail('MINERU_MAIN_ARTIFACT_AMBIGUOUS_OR_MISSING');
  const md = mds[0],
    list = lists[0];
  if (path.dirname(md.name) !== path.dirname(list.name) || !md.bytes.toString('utf8').trim())
    fail('MINERU_MAIN_ARTIFACT_INVALID');
  let content;
  try {
    content = JSON.parse(list.bytes.toString('utf8'));
  } catch {
    fail('MINERU_CONTENT_LIST_INVALID');
  }
  if (
    !Array.isArray(content) ||
    !content.length ||
    content.some(
      (b) =>
        !b ||
        typeof b !== 'object' ||
        Array.isArray(b) ||
        typeof b.type !== 'string' ||
        !Number.isInteger(b.page_idx) ||
        b.page_idx < 0,
    )
  )
    fail('MINERU_CONTENT_LIST_INVALID');
  const images = Object.create(null),
    mapping = [],
    imageFiles = new Map();
  for (const file of files.filter((f) => /\.(?:png|jpe?g|webp|gif)$/i.test(f.name))) {
    if (signal?.aborted) fail('MINERU_ABORTED');
    const decoder = sharp(file.bytes, { failOn: 'warning', limitInputPixels: 40000000 });
    const meta = await decoder.metadata();
    const ext = path.extname(file.name).slice(1).toLowerCase().replace('jpg', 'jpeg');
    if (meta.format !== ext) fail('MINERU_IMAGE_TYPE_MISMATCH');
    await decoder.stats(); // Decode pixels, not only magic bytes.
    images[file.name] = file.bytes.toString('base64');
    imageFiles.set(file.name, {
      sha256: hash(file.bytes),
      width: meta.width,
      height: meta.height,
      format: meta.format,
    });
  }
  for (const [index, block] of content.entries()) {
    if (!block.img_path) continue;
    const raw = normalizeAssetPath(block.img_path);
    const options = [
      ...new Set([raw, normalizeAssetPath(path.join(path.dirname(list.name), raw))]),
    ].filter((p) => imageFiles.has(p));
    if (options.length !== 1) fail('MINERU_IMAGE_MAPPING_INVALID');
    mapping.push({
      source_block_index: index,
      original_path: block.img_path,
      normalized_path: options[0],
      ...imageFiles.get(options[0]),
      verified: true,
    });
  }
  return {
    md_content: md.bytes.toString('utf8'),
    content_list: content,
    images,
    image_mapping: mapping,
    conversion_warnings: [...imageFiles.keys()]
      .filter((name) => !mapping.some((m) => m.normalized_path === name))
      .map((name) => ({ code: 'UNREFERENCED_IMAGE', path: name })),
    output_files: files.inventory,
    main_artifacts: { markdown: md.name, content_list: list.name },
  };
}

async function parseMineruCloud({
  axios,
  baseURL,
  apiKey,
  sourceBuffer,
  filename,
  timeoutMs = 180000,
  signal,
  pollMs = 2000,
  allowedSourceHashes = String(process.env.SANSUO_MINERU_CLOUD_ALLOWED_SHA256 || '').split(','),
  allowedHosts = [
    ...DEFAULT_HOSTS,
    ...String(process.env.SANSUO_MINERU_CLOUD_ALLOWED_HOSTS || '')
      .split(',')
      .filter(Boolean),
  ],
  lookup = dns.lookup,
}) {
  const sourceHash = hash(sourceBuffer);
  if (!allowedSourceHashes.includes(sourceHash)) fail('MINERU_CLOUD_DOCUMENT_NOT_ALLOWED');
  if (!baseURL || !apiKey) fail('MINERU_CLOUD_NOT_CONFIGURED');
  const started = Date.now(),
    timings = {},
    deadline = started + timeoutMs;
  let stage = 'create',
    batchId = null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const request = async (options, redirects = 0, attempt = 0) => {
    if (controller.signal.aborted || Date.now() >= deadline)
      fail('MINERU_CLOUD_ABORTED_OR_TIMEOUT');
    const { url, agent } = await validateTarget(
      options.url,
      allowedHosts,
      lookup,
      controller.signal,
    );
    try {
      const response = await axios({
        ...options,
        url: url.href,
        httpsAgent: agent,
        proxy: false,
        maxRedirects: 0,
        timeout: Math.max(1, Math.min(deadline - Date.now(), options.method === 'put' ? 120000 : options.responseType === 'arraybuffer' ? 60000 : 30000)),
        signal: controller.signal,
        maxContentLength: LIMITS.zip,
        maxBodyLength: LIMITS.zip,
        validateStatus: (s) => s >= 200 && s < 400,
      });
      if (response.status >= 300) {
        if (
          options.method !== 'get' ||
          options.headers?.Authorization ||
          redirects >= 3 ||
          !response.headers?.location
        )
          fail('MINERU_REDIRECT_DENIED');
        return request(
          { ...options, url: new URL(response.headers.location, url).href },
          redirects + 1,
        );
      }
      return response;
    } catch (error) {
      const retryable = ['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ECONNABORTED'].includes(error.code) || error.response?.status >= 500;
      if (['get', 'put'].includes(options.method) && retryable && attempt < 2 && !controller.signal.aborted) {
        agent.destroy();
        timings.network_retries = (timings.network_retries || 0) + 1;
        return request(options, redirects, attempt + 1);
      }
      throw error;
    } finally {
      agent.destroy();
    }
  };
  try {
    const base = baseURL.replace(/\/+$/, '');
    const auth = { Authorization: `Bearer ${apiKey}` };
    let at = Date.now();
    const created = await request({
      method: 'post',
      url: `${base}/v4/file-urls/batch`,
      headers: auth,
      data: { files: [{ name: filename, data_id: sourceHash }], model_version: 'vlm' },
    });
    const data = created.data?.data;
    if (
      (created.data?.code != null && created.data.code !== 0) ||
      !data?.batch_id ||
      data.file_urls?.length !== 1
    )
      fail('MINERU_CLOUD_INVALID_BATCH');
    batchId = data.batch_id;
    stage = 'upload';
    timings.create_ms = Date.now() - at;
    at = Date.now();
    await request({
      method: 'put',
      url: data.file_urls[0],
      data: sourceBuffer,
      headers: { 'Content-Type': null },
    });
    timings.upload_ms = Date.now() - at;
    at = Date.now();
    stage = 'poll';
    let item;
    const states = [];
    while (Date.now() < deadline) {
      const response = await request({
        method: 'get',
        url: `${base}/v4/extract-results/batch/${encodeURIComponent(data.batch_id)}`,
        headers: auth,
      });
      const results = response.data?.data?.extract_result;
      if (
        (response.data?.code != null && response.data.code !== 0) ||
        !Array.isArray(results) ||
        results.length !== 1
      )
        fail('MINERU_CLOUD_INVALID_STATUS');
      item = results[0];
      if (item.data_id !== sourceHash || (item.file_name != null && item.file_name !== filename))
        fail('MINERU_CLOUD_SOURCE_BINDING_MISMATCH');
      const state = String(item.state || item.status || '').toLowerCase();
      if (states.at(-1)?.state !== state) states.push({ state, elapsed_ms: Date.now() - started });
      if (['failed', 'error'].includes(state)) fail('MINERU_CLOUD_PARSE_FAILED');
      if (['done', 'success', 'completed'].includes(state)) break;
      item = null;
      await new Promise((resolve, reject) => {
        const done = () => {
          controller.signal.removeEventListener('abort', cancel);
          resolve();
        };
        const cancel = () => {
          clearTimeout(wait);
          controller.signal.removeEventListener('abort', cancel);
          reject(new Error('MINERU_CLOUD_ABORTED_OR_TIMEOUT'));
        };
        const wait = setTimeout(done, pollMs);
        controller.signal.addEventListener('abort', cancel, { once: true });
        if (controller.signal.aborted) cancel();
      });
    }
    if (!item?.full_zip_url) fail('MINERU_CLOUD_RESULT_MISSING');
    timings.poll_ms = Date.now() - at;
    at = Date.now();
    stage = 'download';
    const downloaded = await request({
      method: 'get',
      url: item.full_zip_url,
      responseType: 'arraybuffer',
    });
    const rawArchive = Buffer.from(downloaded.data);
    timings.download_ms = Date.now() - at;
    at = Date.now();
    stage = 'convert';
    const converted = await convertArchive(rawArchive, { signal: controller.signal });
    const origins = converted.output_files.filter(file => /_origin\.pdf$/i.test(file.normalized_path));
    if (origins.length > 1) fail('MINERU_ORIGIN_AMBIGUOUS');
    // The provider can reserialize its PDF. It is a provider artifact, never our source.
    // Bind the result to the actual upload via the authenticated batch and echoed data_id.
    if (origins.length && origins[0].sha256 !== sourceHash)
      converted.conversion_warnings.push({ code: 'PROVIDER_PDF_BYTES_DIFFER', sha256: origins[0].sha256 });
    if (!origins.length) converted.conversion_warnings.push({ code: 'ORIGIN_PDF_NOT_INCLUDED' });
    timings.convert_ms = Date.now() - at;
    timings.total_ms = Date.now() - started;
    converted.provenance = {
      provider: 'mineru_cloud',
      protocol: 'v4',
      adapter_version: VERSION,
      model_requested: 'vlm',
      model_reported:
        typeof item.model_version === 'string' ? item.model_version.slice(0, 100) : null,
      batch_id: data.batch_id,
      state: 'done',
      source_sha256: sourceHash,
      source_binding: 'uploaded_bytes_sha256_authenticated_batch_data_id',
      provider_pdf_sha256: origins[0]?.sha256 || null,
      provider_pdf_byte_identical: origins.length ? origins[0].sha256 === sourceHash : null,
      archive_sha256: hash(rawArchive),
      timings,
      states,
      conversion_status: 'complete',
      warnings: converted.conversion_warnings || [],
      page_index_convention: 'zero_based_provider',
      bbox_coordinate_system: 'unknown',
    };
    Object.defineProperty(converted, 'rawArchive', { value: rawArchive, enumerable: false });
    return converted;
  } catch (error) {
    // Never propagate signed URLs or Axios config/credentials to callers/logs.
    const safe = new Error(
      /^MINERU_[A-Z_]+$/.test(error.message)
        ? error.message
        : controller.signal.aborted
          ? 'MINERU_CLOUD_ABORTED_OR_TIMEOUT'
          : 'MINERU_CLOUD_REQUEST_OR_CONVERSION_FAILED',
    );
    safe.diagnostics = {
      stage,
      batch_id: batchId,
      source_sha256: sourceHash,
      elapsed_ms: Date.now() - started,
      timings,
      network_code: ['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ECONNABORTED', 'ENOTFOUND', 'EAI_AGAIN'].includes(error.code) ? error.code : null,
      http_status: Number.isInteger(error.response?.status) ? error.response.status : null,
    };
    throw safe;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
module.exports = {
  parseMineruCloud,
  readArchive,
  convertArchive,
  normalizeAssetPath,
  validateTarget,
  publicIP,
  LIMITS,
};
