const JSZip = require('jszip');
const { parseMineruCloud } = require('./mineruCloud');

const options = { baseURL: 'https://mineru.example/api', apiKey: 'test', sourceBuffer: Buffer.from('pdf'), filename: 'file.pdf', timeoutMs: 10000, pollMs: 1 };

test('uploads, polls and converts the ZIP into existing MinerU artifact shape', async () => {
  const zip = new JSZip();
  zip.file('result/full.md', '# sample');
  zip.file('result/file_content_list.json', JSON.stringify([{ type: 'text', text: 'sample', page_idx: 0 }]));
  zip.file('result/images/a.png', Buffer.from('image'));
  const archive = await zip.generateAsync({ type: 'nodebuffer' });
  const axios = jest.fn().mockResolvedValueOnce({ data: { data: { batch_id: 'batch', file_urls: ['https://upload.example/file'] } } })
    .mockResolvedValueOnce({}).mockResolvedValueOnce({ data: { data: { extract_result: [{ state: 'done', full_zip_url: 'https://download.example/result' }] } } })
    .mockResolvedValueOnce({ data: archive });
  const result = await parseMineruCloud({ ...options, axios });
  expect(result).toMatchObject({ md_content: '# sample', content_list: [{ page_idx: 0 }], images: { 'a.png': Buffer.from('image').toString('base64') } });
  expect(axios.mock.calls[1][0].headers['Content-Type']).toBeNull();
  expect(axios.mock.calls[1][0].headers.Authorization).toBeUndefined();
});

test('reports a failed cloud job without returning partial output as success', async () => {
  const axios = jest.fn().mockResolvedValueOnce({ data: { data: { batch_id: 'batch', file_urls: ['https://upload.example/file'] } } })
    .mockResolvedValueOnce({}).mockResolvedValueOnce({ data: { data: { extract_result: [{ state: 'failed' }] } } });
  await expect(parseMineruCloud({ ...options, axios })).rejects.toThrow('mineru_cloud_parse_failed');
});
