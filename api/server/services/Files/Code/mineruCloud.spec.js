const JSZip = require('jszip');
const sharp = require('sharp');
const crypto = require('crypto');
const {
  parseMineruCloud,
  convertArchive,
  readArchive,
  normalizeAssetPath,
  validateTarget,
  LIMITS,
} = require('./mineruCloud');
const lookup = async () => [{ address: '8.8.8.8', family: 4 }];
const sourceBuffer = Buffer.from('pdf');
const options = {
  baseURL: 'https://mineru.example/api',
  apiKey: 'test',
  sourceBuffer,
  filename: 'file.pdf',
  timeoutMs: 10000,
  pollMs: 1,
  lookup,
  allowedHosts: ['mineru.example', 'upload.example', 'download.example'],
  allowedSourceHashes: [crypto.createHash('sha256').update(sourceBuffer).digest('hex')],
};
async function archive(change) {
  const zip = new JSZip();
  zip.file('result/full.md', '# sample');
  zip.file(
    'result/file_content_list.json',
    JSON.stringify([{ type: 'image', img_path: 'images/a.png', page_idx: 0 }]),
  );
  zip.file(
    'result/images/a.png',
    await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } })
      .png()
      .toBuffer(),
  );
  change?.(zip);
  return zip.generateAsync({ type: 'nodebuffer' });
}
test('uploads, preserves exact paths, verified mapping and raw archive without signed URLs', async () => {
  const zip = await archive();
  const axios = jest
    .fn()
    .mockResolvedValueOnce({
      data: { data: { batch_id: 'batch', file_urls: ['https://upload.example/file?secret=1'] } },
    })
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({
      data: {
        data: {
          extract_result: [
            { data_id: options.allowedSourceHashes[0], state: 'done', full_zip_url: 'https://download.example/result?secret=2' },
          ],
        },
      },
    })
    .mockResolvedValueOnce({ data: zip });
  const result = await parseMineruCloud({ ...options, axios });
  expect(Object.keys(result.images)).toEqual(['result/images/a.png']);
  expect(result.image_mapping[0]).toMatchObject({
    original_path: 'images/a.png',
    normalized_path: 'result/images/a.png',
    verified: true,
  });
  expect(result.rawArchive).toEqual(zip);
  expect(JSON.stringify(result)).not.toContain('secret=');
  expect(axios.mock.calls[1][0].headers['Content-Type']).toBeNull();
  expect(axios.mock.calls[1][0].headers.Authorization).toBeUndefined();
});
test('unapproved document never starts network requests', async () => {
  const axios = jest.fn();
  await expect(parseMineruCloud({ ...options, axios, allowedSourceHashes: [] })).rejects.toThrow(
    'DOCUMENT_NOT_ALLOWED',
  );
  expect(axios).not.toHaveBeenCalled();
});
test.each(['../x.png', '/etc/passwd', 'C:\\x', 'a/../../x', 'a\u0000b'])(
  'rejects unsafe path %s',
  (value) => expect(() => normalizeAssetPath(value)).toThrow(),
);
test('rejects private DNS, unauthorized hosts and credentials', async () => {
  await expect(
    validateTarget('https://mineru.example/', options.allowedHosts, async () => [
      { address: '127.0.0.1', family: 4 },
    ]),
  ).rejects.toThrow('TARGET_DENIED');
  await expect(
    validateTarget('https://evil.example/', options.allowedHosts, lookup),
  ).rejects.toThrow('TARGET_DENIED');
  await expect(
    validateTarget('https://user:pass@mineru.example/', options.allowedHosts, lookup),
  ).rejects.toThrow('TARGET_DENIED');
});
test('ambiguous Markdown and missing mapped image fail closed', async () => {
  await expect(
    convertArchive(await archive((z) => z.file('other/full.md', 'other'))),
  ).rejects.toThrow('AMBIGUOUS');
  await expect(
    convertArchive(await archive((z) => z.remove('result/images/a.png'))),
  ).rejects.toThrow('MAPPING_INVALID');
});
test('actual extraction budgets and cancellation', async () => {
  const zip = await archive();
  await expect(readArchive(zip, { limits: { ...LIMITS, total: 10 } })).rejects.toThrow('LIMIT');
  const controller = new AbortController();
  controller.abort();
  await expect(readArchive(zip, { signal: controller.signal })).rejects.toThrow('ABORTED');
});
test('failed cloud job remains failed', async () => {
  const axios = jest
    .fn()
    .mockResolvedValueOnce({
      data: { data: { batch_id: 'batch', file_urls: ['https://upload.example/file'] } },
    })
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ data: { data: { extract_result: [{ data_id: options.allowedSourceHashes[0], state: 'failed' }] } } });
  await expect(parseMineruCloud({ ...options, axios })).rejects.toThrow(
    'MINERU_CLOUD_PARSE_FAILED',
  );
});

test('DNS cancellation ends without waiting for a hung resolver', async () => {
  const controller = new AbortController();
  const request = validateTarget(
    'https://mineru.example/',
    options.allowedHosts,
    () => new Promise(() => {}),
    controller.signal,
  );
  controller.abort();
  await expect(request).rejects.toThrow('TIMEOUT');
});
test('CRC corruption, duplicate paths and symlinks are rejected', async () => {
  const zip = new JSZip();
  zip.file('full.md', 'unique-sentinel');
  zip.file('a_content_list.json', '[]');
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  bytes[bytes.indexOf('unique-sentinel')] = 90;
  await expect(readArchive(bytes)).rejects.toThrow('CRC');
  const duplicate = new JSZip();
  duplicate.file('a.md', 'a');
  duplicate.file('b.md', 'b');
  const data = await duplicate.generateAsync({ type: 'nodebuffer' });
  for (let at = data.indexOf('b.md'); at >= 0; at = data.indexOf('b.md', at + 4))
    data.write('a.md', at);
  await expect(readArchive(data)).rejects.toThrow('DUPLICATE');
  const link = new JSZip();
  link.file('link.md', '/etc/passwd', { unixPermissions: 0o120777 });
  await expect(
    readArchive(await link.generateAsync({ type: 'nodebuffer', platform: 'UNIX' })),
  ).rejects.toThrow('FILE_TYPE');
});
test('metadata cannot hide invalid image bytes', async () => {
  await expect(
    convertArchive(await archive((z) => z.file('result/images/a.png', 'not an image'))),
  ).rejects.toThrow();
});
test('fully expanded special IPv6 is denied, not bypassed by text formatting',async()=>{
 await expect(validateTarget('https://mineru.example/',options.allowedHosts,async()=>[{address:'2001:0db8:0000:0000:0000:0000:0000:0001',family:6}])).rejects.toThrow('TARGET_DENIED');
});
test('provider reserialized PDF is separately hashed and never labelled as source',async()=>{
 const zip=await archive(z=>z.file('wrong_origin.pdf','different pdf'));
 const axios=jest.fn().mockResolvedValueOnce({data:{data:{batch_id:'batch',file_urls:['https://upload.example/file']}}}).mockResolvedValueOnce({}).mockResolvedValueOnce({data:{data:{extract_result:[{data_id: options.allowedSourceHashes[0],state:'done',full_zip_url:'https://download.example/result'}]}}}).mockResolvedValueOnce({data:zip});
 const result = await parseMineruCloud({...options,axios});
 expect(result.provenance.source_sha256).toBe(options.allowedSourceHashes[0]);
 expect(result.provenance.provider_pdf_byte_identical).toBe(false);
 expect(result.provenance.provider_pdf_sha256).not.toBe(result.provenance.source_sha256);
 expect(result.provenance.warnings).toContainEqual(expect.objectContaining({code:'PROVIDER_PDF_BYTES_DIFFER'}));
});

test.each([null, 'wrong-source'])('rejects missing or mismatching result data_id %s before download', async (data_id) => {
 const axios=jest.fn().mockResolvedValueOnce({data:{data:{batch_id:'batch',file_urls:['https://upload.example/file']}}}).mockResolvedValueOnce({}).mockResolvedValueOnce({data:{data:{extract_result:[{data_id,state:'done',full_zip_url:'https://download.example/result'}]}}});
 await expect(parseMineruCloud({...options,axios})).rejects.toThrow('SOURCE_BINDING_MISMATCH');
 expect(axios).toHaveBeenCalledTimes(3);
 expect(axios.mock.calls[0][0].data.files[0].data_id).toBe(options.allowedSourceHashes[0]);
});
