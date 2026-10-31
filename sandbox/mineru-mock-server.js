const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const express = require('express');
const multer = require('multer');

const PORT = Number(process.env.SANSUO_MINERU_MOCK_PORT || 5060);
const TMP_DIR = process.env.SANSUO_MINERU_MOCK_TMP || path.join(os.tmpdir(), 'sansuo-mineru-mock');

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

function normalizeText(value) {
  return String(value || '').replace(/\r\n/g, '\n').trim();
}

function splitIntoPages(text) {
  const clean = normalizeText(text);
  if (!clean) {
    return [];
  }

  const pageMarkers = clean.split(/\f+/g).map((part) => part.trim()).filter(Boolean);
  if (pageMarkers.length > 1) {
    return pageMarkers;
  }

  const lines = clean.split('\n').map((line) => line.trim()).filter(Boolean);
  const pages = [];
  for (let index = 0; index < lines.length; index += 40) {
    pages.push(lines.slice(index, index + 40).join('\n'));
  }
  return pages;
}

async function buildMockResult(pdfPath) {
  const { execFile } = require('child_process');
  const execFileAsync = (file, args) =>
    new Promise((resolve, reject) => {
      execFile(file, args, { maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve(String(stdout || ''));
      });
    });

  let extractedText = '';
  try {
    extractedText = await execFileAsync('pdftotext', ['-layout', pdfPath, '-']);
  } catch {
    extractedText = '';
  }

  const pages = splitIntoPages(extractedText);
  const basename = path.basename(pdfPath);

  if (pages.length === 0) {
    const fallbackPages = [
      `第 1 页\n这是本地 MinerU mock 路径返回的扫描版占位内容。\n文件：${basename}\n说明：当前本机已成功走到 /pdf_parse，但这个 mock 不做真实 OCR。`,
    ];
    return {
      md_content: fallbackPages.map((text) => `## ${text}`).join('\n\n'),
      content_list: fallbackPages.map((text, index) => ({
        page: index + 1,
        text,
        source: basename,
        note: 'local_mineru_mock_no_ocr',
      })),
    };
  }

  const contentList = pages.map((text, index) => ({
    page: index + 1,
    text,
    source: basename,
    note: 'local_mineru_mock_from_pdftotext',
  }));
  const mdContent = contentList
    .map((item) => `## 第 ${item.page} 页\n${item.text}`)
    .join('\n\n');

  return {
    md_content: mdContent,
    content_list: contentList,
  };
}

async function main() {
  await ensureDir(TMP_DIR);
  const upload = multer({ dest: TMP_DIR, limits: { fileSize: 200 * 1024 * 1024 } });
  const app = express();

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'sansuo-mineru-mock', port: PORT });
  });

  app.post('/pdf_parse', upload.single('pdf_file'), async (req, res) => {
    const uploaded = req.file;
    if (!uploaded?.path) {
      res.status(400).json({ error: 'pdf_file is required' });
      return;
    }

    try {
      const result = await buildMockResult(uploaded.path);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error?.message || error) });
    } finally {
      try {
        await fsp.unlink(uploaded.path);
      } catch {}
    }
  });

  app.listen(PORT, '127.0.0.1', () => {
    console.log(`[sansuo-mineru-mock] listening on http://127.0.0.1:${PORT}`);
  });
}

main().catch((error) => {
  console.error('[sansuo-mineru-mock] fatal', error);
  process.exit(1);
});
