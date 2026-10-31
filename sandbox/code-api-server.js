const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const axios = require('axios');
const cors = require('cors');
const express = require('express');
const FormData = require('form-data');
const multer = require('multer');
const { CodeApiSecurityError, createCodeApiSecurity } = require('./code-api-security');

const PORT = Number(process.env.SANSUO_CODE_API_PORT || 5055);
const ROOT = process.env.SANSUO_CODE_API_DATA || path.join(__dirname, 'codeapi-data');
const BACKEND = String(process.env.SANSUO_CODE_BACKEND || 'opensandbox').toLowerCase();
const IMAGE = process.env.SANSUO_SANDBOX_IMAGE || 'sansuo-python-sandbox:latest';
const OPENSANDBOX_BASE_URL = String(
  process.env.SANSUO_OPENSANDBOX_BASE_URL || 'http://127.0.0.1:8090/v1',
).replace(/\/$/, '');
const OPENSANDBOX_API_KEY = process.env.SANSUO_OPENSANDBOX_API_KEY || 'local-dev';
const OPENSANDBOX_IMAGE =
  process.env.SANSUO_OPENSANDBOX_IMAGE || 'sansuo/opensandbox-office:latest';
const OPENSANDBOX_TIMEOUT_SECONDS = Number(process.env.SANSUO_OPENSANDBOX_TIMEOUT_SECONDS || 900);
const OPENSANDBOX_READY_TIMEOUT_MS = Number(
  process.env.SANSUO_OPENSANDBOX_READY_TIMEOUT_MS || 120000,
);
const OPENSANDBOX_USE_SERVER_PROXY =
  String(process.env.SANSUO_OPENSANDBOX_USE_SERVER_PROXY || 'false').toLowerCase() === 'true';
const MINERU_PDF_PARSE_URL = process.env.SANSUO_MINERU_PDF_PARSE_URL || '';
const MINERU_BASE_URL = process.env.SANSUO_MINERU_BASE_URL || '';
const MINERU_TIMEOUT_MS = process.env.SANSUO_MINERU_TIMEOUT_MS || '';
const TIMEOUT_MS = Number(process.env.SANSUO_SANDBOX_TIMEOUT_MS || 900000);
const DEBUG_LOGS = String(process.env.SANSUO_CODE_API_DEBUG || 'true').toLowerCase() !== 'false';
const LOG_CODE = String(process.env.SANSUO_CODE_API_LOG_CODE || 'false').toLowerCase() === 'true';
const MEMORY = process.env.SANSUO_SANDBOX_MEMORY || '2g';
const CPUS = process.env.SANSUO_SANDBOX_CPUS || '2';
const HOST_SONGTI = process.env.SANSUO_FONT_SONGTI || path.join(__dirname, 'fonts', 'Songti.ttc');
const HOST_TIMES =
  process.env.SANSUO_FONT_TIMES || path.join(__dirname, 'fonts', 'TimesNewRoman.ttf');
const CONTAINER_SONGTI = '/mnt/fonts/Songti.ttc';
const CONTAINER_TIMES = '/mnt/fonts/TimesNewRoman.ttf';
const MAX_OUTPUT_FILES = Number(process.env.SANSUO_MAX_OUTPUT_FILES || 30);
const MAX_UPLOAD_FILE_SIZE =
  Number(process.env.SANSUO_MAX_UPLOAD_FILE_SIZE_MB || 150) * 1024 * 1024;
const MAX_OUTPUT_FILE_SIZE = Number(process.env.SANSUO_MAX_OUTPUT_FILE_SIZE_MB || 80) * 1024 * 1024;
const MAX_TOTAL_OUTPUT_SIZE =
  Number(process.env.SANSUO_MAX_TOTAL_OUTPUT_SIZE_MB || 160) * 1024 * 1024;
const TEMP_RETENTION_DAYS = Number(process.env.SANSUO_SANDBOX_TEMP_RETENTION_DAYS || 7);
const CLEANUP_INTERVAL_MS = Number(
  process.env.SANSUO_SANDBOX_CLEANUP_INTERVAL_MS || 6 * 60 * 60 * 1000,
);
const ENABLE_FILENAME_AUTOMOUNT =
  String(process.env.SANSUO_ENABLE_FILENAME_AUTOMOUNT || 'false').toLowerCase() === 'true';
const AVAILABLE_FILES_MANIFEST = 'SANDBOX_AVAILABLE_FILES.json';
const INTERNAL_OUTPUT_NAMES = new Set([
  'sitecustomize.py',
  'sansuo_tools.py',
  'TOOL_REFERENCE.md',
  AVAILABLE_FILES_MANIFEST,
]);

const app = express();
const upload = multer({ dest: path.join(ROOT, 'tmp'), limits: { fileSize: 150 * 1024 * 1024 } });

const CORS_ORIGINS = String(process.env.SANSUO_CODE_API_CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || CORS_ORIGINS.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
  }),
);
app.use(express.json({ limit: '5mb' }));

const storageDir = (...parts) => path.join(ROOT, 'storage', ...parts);
const DISALLOWED_IMAGE_OCR_PATTERNS = [
  /\bpytesseract\b/i,
  /\beasyocr\b/i,
  /\bocrmypdf\b/i,
  /\bPaddleOCR\b/i,
  /\bimage_to_string\s*\(/i,
  /\bImage\.open\s*\(/i,
];
const DIRECT_PDF_READ_PATTERNS = [
  /\b(?:fitz|pymupdf)\.open\s*\(\s*[^)\s]/i,
  /\b(?:pypdf|PyPDF2)\b[\s\S]{0,240}\b(?:PdfReader|PdfFileReader)\s*\(/i,
  /\b(?:PdfReader|PdfFileReader)\s*\(/i,
  /\bpdfplumber\.open\s*\(/i,
  /(?:^|[;&|\n]\s*)\b(?:pdftotext|pdftoppm|pdfimages|pdfinfo)\b/i,
  /(?:^|[;&|\n]\s*)\bmutool\s+(?:draw|convert|extract|info)\b/i,
];

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(10).toString('hex')}`;
}

function mineruEnv() {
  const env = {};
  if (MINERU_PDF_PARSE_URL) {
    env.SANSUO_MINERU_PDF_PARSE_URL = MINERU_PDF_PARSE_URL;
  }
  if (MINERU_BASE_URL) {
    env.SANSUO_MINERU_BASE_URL = MINERU_BASE_URL;
  }
  if (MINERU_TIMEOUT_MS) {
    env.SANSUO_MINERU_TIMEOUT_MS = MINERU_TIMEOUT_MS;
  }
  return env;
}

function logDebug(event, data = {}) {
  if (!DEBUG_LOGS) {
    return;
  }
  const payload = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      payload[key] = value;
    }
  }
  console.log(`[sansuo-code-api] ${event} ${JSON.stringify(payload, null, 0)}`);
}

function logPdfChain(event, data = {}) {
  const payload = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      payload[key] = value;
    }
  }
  console.log(`[SanSuoPdfChain] ${event} ${JSON.stringify(payload, null, 0)}`);
}

const codeApiSecurity = createCodeApiSecurity({
  root: ROOT,
  audit(event, data) {
    logDebug(`security.${event}`, data);
  },
});

app.use('/v1', codeApiSecurity.middleware);

function decodeMaybeMojibake(value) {
  const text = String(value || '');
  if (!/[ÃÂÄÅÆÇÈÉåæçèéäöü�]/.test(text)) {
    return text;
  }
  try {
    const decoded = Buffer.from(text, 'latin1').toString('utf8');
    return decoded.includes('�') ? text : decoded;
  } catch {
    return text;
  }
}

function safeName(name) {
  const decoded = decodeMaybeMojibake(name);
  const base = path.posix.basename(String(decoded || 'file').replace(/\\/g, '/'));
  return base && base !== '.' && base !== '..' ? base.replace(/[\0-\x1f\x7f]/g, '_') : 'file';
}

function extensionOf(name) {
  return path.posix.extname(String(name || '').toLowerCase());
}

function isInternalReadingArtifact(name) {
  const normalized = String(name || '').toLowerCase();
  return (
    /(^|__|\/)[^/]+_(profile\.json|pages\.jsonl|chunks\.jsonl|reading_pack\.md)$/.test(
      normalized,
    ) ||
    /(^|__|\/)[^/]+_mineru(\.md|_result\.json|_content_list\.json|_chunks\.jsonl)$/.test(
      normalized,
    ) ||
    /(^|__|\/)[^/]+_smart_manifest\.json$/.test(normalized) ||
    /(^|__|\/)[^/]+_docx_(blocks\.jsonl|manifest\.json|reading_pack\.md)$/.test(normalized) ||
    /(^|__|\/)[^/]+_tabular_(rows\.jsonl|manifest\.json|reading_pack\.md)$/.test(normalized) ||
    /(^|__|\/)[^/]+_text_(blocks\.jsonl|manifest\.json|reading_pack\.md)$/.test(normalized) ||
    normalized.includes('_docx_assets__') ||
    normalized.includes('_docx_assets/') ||
    /(^|__|\/)[^/]+_raw_response\.txt$/.test(normalized)
  );
}

function classifyInternalArtifact(name = '') {
  const normalized = String(name || '').toLowerCase();
  const artifact = {
    hidden: true,
    intermediate: true,
    reusable: true,
    visibility: 'tool',
    artifact_kind: 'internal_reading_artifact',
    recommended_reader: 'read_file_auto',
  };

  if (/(^|__|\/)[^/]+_smart_manifest\.json$/.test(normalized)) {
    return {
      ...artifact,
      artifact_kind: 'pdf_smart_manifest',
      recommended_reader: 'backend',
    };
  }
  if (/(^|__|\/)[^/]+_mineru_chunks\.jsonl$/.test(normalized)) {
    return { ...artifact, artifact_kind: 'pdf_mineru_chunks', recommended_reader: 'backend' };
  }
  if (/(^|__|\/)[^/]+_mineru_content_list\.json$/.test(normalized)) {
    return {
      ...artifact,
      artifact_kind: 'pdf_mineru_content_list',
      recommended_reader: 'backend',
    };
  }
  if (/(^|__|\/)[^/]+_mineru_result\.json$/.test(normalized)) {
    return {
      ...artifact,
      artifact_kind: 'pdf_mineru_result',
      recommended_reader: 'read_file_auto',
    };
  }
  if (/(^|__|\/)[^/]+_mineru\.md$/.test(normalized)) {
    return {
      ...artifact,
      artifact_kind: 'pdf_mineru_markdown',
      recommended_reader: 'read_file_auto',
    };
  }
  if (/(^|__|\/)[^/]+_chunks\.jsonl$/.test(normalized)) {
    return { ...artifact, artifact_kind: 'pdf_chunks', recommended_reader: 'backend' };
  }
  if (/(^|__|\/)[^/]+_pages\.jsonl$/.test(normalized)) {
    return { ...artifact, artifact_kind: 'pdf_pages', recommended_reader: 'read_file_auto' };
  }
  if (/(^|__|\/)[^/]+_profile\.json$/.test(normalized)) {
    return { ...artifact, artifact_kind: 'pdf_profile', recommended_reader: 'read_file_auto' };
  }
  if (/(^|__|\/)[^/]+_reading_pack\.md$/.test(normalized)) {
    return { ...artifact, artifact_kind: 'pdf_reading_pack', recommended_reader: 'read_file_auto' };
  }
  if (/(^|__|\/)[^/]+_docx_blocks\.jsonl$/.test(normalized)) {
    return { ...artifact, artifact_kind: 'docx_blocks', recommended_reader: 'read_file_auto' };
  }
  if (/(^|__|\/)[^/]+_docx_manifest\.json$/.test(normalized)) {
    return { ...artifact, artifact_kind: 'docx_manifest', recommended_reader: 'read_file_auto' };
  }
  if (/(^|__|\/)[^/]+_docx_reading_pack\.md$/.test(normalized)) {
    return {
      ...artifact,
      artifact_kind: 'docx_reading_pack',
      recommended_reader: 'read_file_auto',
    };
  }
  if (/(^|__|\/)[^/]+_tabular_rows\.jsonl$/.test(normalized)) {
    return { ...artifact, artifact_kind: 'tabular_rows', recommended_reader: 'read_file_auto' };
  }
  if (/(^|__|\/)[^/]+_tabular_manifest\.json$/.test(normalized)) {
    return { ...artifact, artifact_kind: 'tabular_manifest', recommended_reader: 'read_file_auto' };
  }
  if (/(^|__|\/)[^/]+_tabular_reading_pack\.md$/.test(normalized)) {
    return {
      ...artifact,
      artifact_kind: 'tabular_reading_pack',
      recommended_reader: 'read_file_auto',
    };
  }
  if (/(^|__|\/)[^/]+_text_blocks\.jsonl$/.test(normalized)) {
    return { ...artifact, artifact_kind: 'text_blocks', recommended_reader: 'read_file_auto' };
  }
  if (/(^|__|\/)[^/]+_text_manifest\.json$/.test(normalized)) {
    return { ...artifact, artifact_kind: 'text_manifest', recommended_reader: 'read_file_auto' };
  }
  if (/(^|__|\/)[^/]+_text_reading_pack\.md$/.test(normalized)) {
    return {
      ...artifact,
      artifact_kind: 'text_reading_pack',
      recommended_reader: 'read_file_auto',
    };
  }
  if (normalized.includes('_docx_assets__') || normalized.includes('_docx_assets/')) {
    return { ...artifact, artifact_kind: 'docx_asset', recommended_reader: 'read_file_auto' };
  }
  if (/(^|__|\/)[^/]+_raw_response\.txt$/.test(normalized)) {
    return {
      ...artifact,
      artifact_kind: 'raw_response',
      reusable: false,
      recommended_reader: 'read_file_auto',
    };
  }
  return artifact;
}

function isHiddenSandboxSupportFile(name) {
  return (
    INTERNAL_OUTPUT_NAMES.has(String(name || '')) || String(name || '') === AVAILABLE_FILES_MANIFEST
  );
}

function partitionGeneratedFilesForIntent(files, code, stdout, warnings = [], intent = {}) {
  const allFiles = Array.isArray(files) ? files : [];
  if (allFiles.length === 0) {
    return { artifactFiles: [], visibleFiles: [], internalFiles: [], hiddenIntermediateFiles: [] };
  }

  const visibleFiles = allFiles.filter((file) => !isInternalReadingArtifact(file.name));
  const internalFiles = allFiles
    .filter((file) => !visibleFiles.includes(file))
    .map((file) => ({
      ...file,
      ...classifyInternalArtifact(file.name),
    }));
  const hiddenIntermediateFiles = internalFiles
    .filter((file) => file.reusable !== false)
    .map((file) => ({
      id: file.id,
      name: file.name,
      storage_session_id: file.storage_session_id,
      session_id: file.session_id,
      hidden: true,
      intermediate: true,
      reusable: file.reusable !== false,
      visibility: file.visibility || 'tool',
      artifact_kind: file.artifact_kind,
      recommended_reader: file.recommended_reader,
    }));
  const internalRemoved = internalFiles.map((file) => file.name);
  if (internalRemoved.length) {
    warnings.push(
      `Tool-readable hidden intermediate file(s), not shown as user-downloadable attachments: ${internalRemoved.join(
        ', ',
      )}. Persisted PDF artifacts are consumed by the LibreChat backend; they must not be reopened through sandbox PDF readers.`,
    );
  }

  const text = `${code || ''}\n${stdout || ''}`.toLowerCase();
  const targetFormat = String(intent?.target_format || intent?.targetFormat || '').toLowerCase();
  const requestedFormats = Array.isArray(intent?.requested_formats)
    ? intent.requested_formats.map((format) => String(format || '').toLowerCase())
    : Array.isArray(intent?.requestedFormats)
      ? intent.requestedFormats.map((format) => String(format || '').toLowerCase())
      : [];
  const effectiveFormats = requestedFormats.length
    ? requestedFormats
    : [targetFormat].filter(Boolean);
  const targetIsOffice = effectiveFormats.some((format) =>
    ['word', 'doc', 'docx', 'odt', 'rtf'].includes(format),
  );
  const targetIsPdf = effectiveFormats.includes('pdf');
  if (allFiles.length <= 1) {
    return {
      artifactFiles: visibleFiles.concat(internalFiles),
      visibleFiles,
      internalFiles,
      hiddenIntermediateFiles,
    };
  }

  const pdfFiles = files.filter((file) => extensionOf(file.name) === '.pdf');
  const officeFiles = files.filter((file) =>
    ['.doc', '.docx', '.odt', '.rtf'].includes(extensionOf(file.name)),
  );
  if (targetIsOffice && !targetIsPdf && officeFiles.length > 0 && pdfFiles.length > 0) {
    const filtered = files.filter((file) => extensionOf(file.name) !== '.pdf');
    const removed = files.filter((file) => !filtered.includes(file)).map((file) => file.name);
    if (removed.length && filtered.length) {
      warnings.push(
        `Extra PDF file(s), not shown as user attachments because the request target is Word/docx: ${removed.join(
          ', ',
        )}.`,
      );
      const filteredInternalFiles = internalFiles.filter((file) => !filtered.includes(file));
      return {
        artifactFiles: filtered.concat(filteredInternalFiles),
        visibleFiles: filtered,
        internalFiles: filteredInternalFiles,
        hiddenIntermediateFiles,
      };
    }
  }
  const hasOfficeDeliverableIntent =
    officeFiles.length > 0 &&
    (targetIsOffice ||
      text.includes('create_docx') ||
      text.includes('.docx') ||
      text.includes('word') ||
      text.includes('docx') ||
      text.includes('word文档') ||
      text.includes('word 文档') ||
      text.includes('生成word') ||
      text.includes('生成 word') ||
      text.includes('已生成word') ||
      text.includes('已生成 word'));
  const hasPdfIntent =
    pdfFiles.length > 0 &&
    (text.includes('convert_to_pdf') ||
      text.includes('create_pdf') ||
      text.includes('.pdf') ||
      text.includes('pdf created') ||
      text.includes('生成pdf') ||
      text.includes('转pdf') ||
      text.includes('转成pdf'));

  if (hasPdfIntent && targetIsPdf && !targetIsOffice) {
    const filtered = visibleFiles.filter((file) => {
      const ext = extensionOf(file.name);
      return ext === '.pdf' || !['.doc', '.docx', '.odt', '.rtf'].includes(ext);
    });
    const removed = files.filter((file) => !filtered.includes(file)).map((file) => file.name);
    if (removed.length && filtered.length) {
      warnings.push(
        `Tool-readable intermediate file(s), hidden from user-downloadable attachments: ${removed.join(
          ', ',
        )}. generatedFiles/outputFiles are visible deliverables; hidden intermediate files remain valid for follow-up sandbox reads.`,
      );
      return {
        artifactFiles: filtered.concat(internalFiles),
        visibleFiles: filtered,
        internalFiles,
        hiddenIntermediateFiles,
      };
    }
  }

  return {
    artifactFiles: visibleFiles.concat(internalFiles),
    visibleFiles,
    internalFiles,
    hiddenIntermediateFiles,
  };
}

function encodeRFC5987ValueChars(value) {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function getAsciiFilenameFallback(name) {
  const fallback = safeName(name)
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\\r\n]/g, '_');

  return fallback || 'download';
}

function getContentDisposition(name, disposition = 'attachment') {
  const filename = safeName(name || 'download');
  const fallback = getAsciiFilenameFallback(filename);
  const encoded = encodeRFC5987ValueChars(filename);
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function validateSandboxCode(code, intent = {}) {
  if (intent.pdf_read_only === true) {
    throw new Error(
      'PDF read-only questions are handled by the LibreChat backend using MinerU or the server-side PyMuPDF/VL fallback. Sandbox execution is disabled for this turn.',
    );
  }
  if (intent.docx_read_only === true && intent.persisted_docx_context_ready === true) {
    throw new Error(
      'DOCX read-only questions must use the persisted context. Sandbox execution is disabled for this turn.',
    );
  }
  const readsPdfInSandbox =
    /\b(read_pdf|read_pdf_smart|read_pdf_find|mineru_parse_pdf|pdf_build_reading_pack)\s*\(/i.test(
      code,
    ) ||
    (/\bread_file_auto\s*\(/i.test(code) && /\.pdf\b/i.test(code));
  if (readsPdfInSandbox) {
    throw new Error(
      'PDF reading is handled exclusively by the LibreChat backend using persisted MinerU chunks or the PyMuPDF/VL page index. Sandbox PDF readers are disabled. File generation, editing, conversion, and calculation remain available.',
    );
  }
  const directlyReadsPdf = DIRECT_PDF_READ_PATTERNS.some((pattern) => pattern.test(code));
  if (directlyReadsPdf && intent.file_required !== true) {
    throw new Error(
      'Direct PDF reading or rendering inside sandbox is disabled for read-only requests. Use the LibreChat backend PDF context. Explicit file generation, editing, and conversion remain available.',
    );
  }
  if (DISALLOWED_IMAGE_OCR_PATTERNS.some((pattern) => pattern.test(code))) {
    throw new Error(
      [
        'Image OCR inside sandbox is disabled.',
        'Do not read uploaded images with PIL/Image.open/pytesseract/easyocr for understanding.',
        'Use the native VL model first, then call sandbox only to write the already-understood summary into txt/docx/pdf or other output files.',
        'For image file conversion, use sansuo_tools.image_convert or sansuo_tools.image_to_pdf instead of direct Image.open.',
      ].join(' '),
    );
  }
  if (intent?.persisted_docx_context_ready === true) {
    const repeatsDocxParsing =
      /\b(docx_build_reading_pack|docx_extract_blocks|read_docx)\s*\(/i.test(code) ||
      (/\bread_file_auto\s*\(/i.test(code) && /\.docx\b/i.test(code));
    if (repeatsDocxParsing) {
      throw new Error(
        'DOCX reading and image understanding are handled by the backend using persisted artifacts. Use the provided text and visual summaries; do not reopen the Word file or extract images again. File generation and explicit format conversion remain available.',
      );
    }
  }
}

function ensureInside(parent, target) {
  const resolvedParent = path.resolve(parent);
  const resolvedTarget = path.resolve(target);
  if (
    resolvedTarget !== resolvedParent &&
    !resolvedTarget.startsWith(`${resolvedParent}${path.sep}`)
  ) {
    throw new Error('Invalid file path');
  }
  return resolvedTarget;
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function collectInputSnapshots(workdir, names = new Set()) {
  const snapshots = new Map();
  for (const rawName of names || []) {
    const name = safeName(rawName);
    if (!name || isHiddenSandboxSupportFile(name)) {
      continue;
    }
    const filePath = ensureInside(workdir, path.join(workdir, name));
    if (!fs.existsSync(filePath)) {
      continue;
    }
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) {
      continue;
    }
    snapshots.set(name, {
      size: stat.size,
      sha256: await hashFile(filePath),
    });
  }
  return snapshots;
}

function outputIdentityNames(output) {
  const names = new Set();
  const outputName = safeName(output?.name || '');
  if (outputName) {
    names.add(outputName);
  }
  const rawPath = String(output?.path || '');
  const relPath = rawPath.startsWith('/mnt/data/') ? rawPath.slice('/mnt/data/'.length) : rawPath;
  if (relPath && !relPath.startsWith('/')) {
    const normalizedRelPath = relPath.split(path.sep).join('/').replace(/^\/+/, '');
    if (normalizedRelPath) {
      names.add(normalizedRelPath);
      names.add(normalizedRelPath.replace(/\//g, '__'));
      names.add(safeName(normalizedRelPath));
    }
  }
  return names;
}

function getInputSnapshotForOutput(output, inputSnapshots) {
  for (const name of outputIdentityNames(output)) {
    const snapshot = inputSnapshots.get(name);
    if (snapshot) {
      return { name, snapshot };
    }
  }
  return null;
}

function sameAsInputSnapshot(output, snapshot) {
  if (!snapshot) {
    return false;
  }
  const outputHash = output?.sha256 || output?.hash;
  if (outputHash && snapshot.sha256) {
    return outputHash === snapshot.sha256;
  }
  const outputSize = Number(output?.size);
  return Number.isFinite(outputSize) && outputSize === snapshot.size;
}

function isExcludedOutput(output, excludedNames = new Set()) {
  for (const name of outputIdentityNames(output)) {
    if (excludedNames.has(name)) {
      return true;
    }
  }
  return false;
}

function filterUnchangedMountedOutputs(outputs, excludedNames, inputSnapshots, warnings = []) {
  if (!Array.isArray(outputs) || outputs.length === 0 || !excludedNames?.size) {
    return outputs || [];
  }
  return outputs.filter((output) => {
    if (!isExcludedOutput(output, excludedNames)) {
      return true;
    }
    const match = getInputSnapshotForOutput(output, inputSnapshots);
    if (!match) {
      return false;
    }
    if (sameAsInputSnapshot(output, match.snapshot)) {
      return false;
    }
    warnings.push(`Modified mounted input returned as output: ${output.name || match.name}.`);
    return true;
  });
}

async function cleanupOldEntries(rootDir, maxAgeMs) {
  const result = { scanned: 0, deleted: 0, errors: [] };
  if (!fs.existsSync(rootDir)) {
    return result;
  }
  const now = Date.now();
  const entries = await fsp.readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(rootDir, entry.name);
    try {
      const stat = await fsp.stat(target);
      result.scanned += 1;
      if (now - stat.mtimeMs <= maxAgeMs) {
        continue;
      }
      await fsp.rm(target, { recursive: true, force: true });
      result.deleted += 1;
    } catch (error) {
      result.errors.push({ name: entry.name, error: error.message || String(error) });
    }
  }
  return result;
}

async function cleanupSandboxTemp() {
  if (!Number.isFinite(TEMP_RETENTION_DAYS) || TEMP_RETENTION_DAYS <= 0) {
    return { disabled: true };
  }
  const maxAgeMs = TEMP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const [runs, tmp] = await Promise.all([
    cleanupOldEntries(path.join(ROOT, 'runs'), maxAgeMs),
    cleanupOldEntries(path.join(ROOT, 'tmp'), maxAgeMs),
  ]);
  return { retentionDays: TEMP_RETENTION_DAYS, runs, tmp };
}

function scheduleSandboxCleanup() {
  cleanupSandboxTemp()
    .then((result) => console.log('[cleanup] sandbox temp cleanup:', JSON.stringify(result)))
    .catch((error) =>
      console.warn('[cleanup] sandbox temp cleanup failed:', error.message || String(error)),
    );
  if (CLEANUP_INTERVAL_MS > 0) {
    setInterval(() => {
      cleanupSandboxTemp()
        .then((result) => console.log('[cleanup] sandbox temp cleanup:', JSON.stringify(result)))
        .catch((error) =>
          console.warn('[cleanup] sandbox temp cleanup failed:', error.message || String(error)),
        );
    }, CLEANUP_INTERVAL_MS).unref();
  }
}

async function copyInputFiles(workdir, files = [], principal) {
  const copied = new Set();
  const mounted = [];
  for (const file of files) {
    const authorized = await codeApiSecurity.authorizeFile(principal, file);
    const storageSessionId = authorized.storageSessionId;
    const fileId = authorized.storageFileId;
    const src = authorized.path;
    const name = safeName(file.name || file.filename || fileId);
    const dest = ensureInside(workdir, path.join(workdir, name));
    await fsp.copyFile(src, dest);
    copied.add(name);
    mounted.push({
      name,
      source: 'request',
      storage_session_id: String(storageSessionId),
      file_id: String(fileId),
      hidden: file.hidden === true,
      intermediate: file.intermediate === true,
      reusable: file.reusable !== false,
      artifact_kind: file.artifact_kind,
      recommended_reader: file.recommended_reader,
      visibility: file.visibility,
    });
  }
  copied.mounted = mounted;
  return copied;
}

function getReferencedFilenames(code) {
  const names = new Set();
  const filePattern =
    /(?:^|[/"'\s])([^/"'\s\\]+\.(?:txt|md|csv|json|pdf|docx|xlsx|pptx|doc|xls|ppt|png|jpe?g|webp|gif|html?))(?:$|[)"'\s])/gi;
  let match;
  while ((match = filePattern.exec(code))) {
    names.add(safeName(match[1]));
  }
  return names;
}

function getAutoMountFilenames(code) {
  const names = new Set();
  for (const name of getReferencedFilenames(code)) {
    if (!isHiddenSandboxSupportFile(name)) {
      names.add(name);
    }
  }
  const assignedFiles = new Map();
  const assignmentPattern =
    /(?:^|\n)\s*([A-Za-z_]\w*)\s*=\s*(?:Path\s*\([^)]*\)\s*\/\s*)?['"]([^'"\n]+\.(?:txt|md|csv|json|pdf|docx|xlsx|pptx|doc|xls|ppt|png|jpe?g|webp|gif|html?))['"]/gi;
  let assignmentMatch;
  while ((assignmentMatch = assignmentPattern.exec(code))) {
    assignedFiles.set(assignmentMatch[1], safeName(assignmentMatch[2]));
  }

  function addAssignedFilesFromArgs(args) {
    for (const [variableName, fileName] of assignedFiles.entries()) {
      const variablePattern = new RegExp(`\\b${variableName}\\b`);
      if (variablePattern.test(args)) {
        names.add(fileName);
      }
    }
  }

  const inputFunctionPattern =
    /\b(read_file_auto|read_pdf|read_pdf_smart|read_pdf_find|read_docx|read_xlsx|read_csv|pdf_build_reading_pack|docx_build_reading_pack|mineru_parse_pdf|ocr_pdf|pdf_to_images|image_to_pdf)\s*\(([^)]*)\)/gi;
  let match;
  while ((match = inputFunctionPattern.exec(code))) {
    for (const name of getReferencedFilenames(match[2])) {
      names.add(name);
    }
    addAssignedFilesFromArgs(match[2]);
  }

  const conversionPattern = /\b(convert_to_pdf|convert_office_to_pdf)\s*\(([^)]*)\)/gi;
  while ((match = conversionPattern.exec(code))) {
    const firstArg = String(match[2] || '').split(',')[0] || '';
    for (const name of getReferencedFilenames(firstArg)) {
      names.add(name);
    }
    addAssignedFilesFromArgs(firstArg);
  }

  const openReadPattern = /\bopen\s*\(([^)]*)\)/gi;
  while ((match = openReadPattern.exec(code))) {
    const args = String(match[1] || '');
    if (/['"]\s*[wax+]/i.test(args)) {
      continue;
    }
    const firstArg = args.split(',')[0] || '';
    for (const name of getReferencedFilenames(firstArg)) {
      names.add(name);
    }
    addAssignedFilesFromArgs(firstArg);
  }

  return names;
}

async function listStoredFilesByName(principal) {
  const root = storageDir();
  if (!fs.existsSync(root)) {
    return new Map();
  }

  const byName = new Map();
  const sessions = await fsp.readdir(root, { withFileTypes: true });
  for (const session of sessions) {
    if (!session.isDirectory()) {
      continue;
    }
    const sessionId = session.name;
    const dir = storageDir(sessionId);
    try {
      const metadata = await codeApiSecurity.readSessionMetadata(sessionId);
      const expected = codeApiSecurity.sessionKey(
        principal,
        codeApiSecurity.userSessionIdentity(principal),
      );
      if (metadata.sessionKey !== expected) continue;
    } catch {
      continue;
    }
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }
      const fileId = entry.name.slice(0, -5);
      const filePath = path.join(dir, fileId);
      if (!fs.existsSync(filePath)) {
        continue;
      }
      try {
        const meta = JSON.parse(await fsp.readFile(path.join(dir, entry.name), 'utf8'));
        const name = safeName(meta.name || meta.filename || fileId);
        const stat = await fsp.stat(filePath);
        const current = byName.get(name);
        if (!current || stat.mtimeMs > current.mtimeMs) {
          byName.set(name, { sessionId, fileId, filePath, mtimeMs: stat.mtimeMs });
        }
      } catch {
        // Ignore malformed metadata.
      }
    }
  }
  return byName;
}

async function copyReferencedFiles(workdir, code, alreadyCopied = new Set(), principal) {
  if (!ENABLE_FILENAME_AUTOMOUNT) {
    return [];
  }

  const names = getAutoMountFilenames(code);
  if (!names.size) {
    return [];
  }

  const stored = await listStoredFilesByName(principal);
  const mounted = [];
  for (const name of names) {
    if (alreadyCopied.has(name)) {
      continue;
    }
    const hit = stored.get(name);
    if (!hit) {
      continue;
    }
    const dest = ensureInside(workdir, path.join(workdir, name));
    if (fs.existsSync(dest)) {
      continue;
    }
    await fsp.copyFile(hit.filePath, dest);
    alreadyCopied.add(name);
    const internalArtifact = isInternalReadingArtifact(name) ? classifyInternalArtifact(name) : {};
    mounted.push({
      name,
      source: 'history',
      storage_session_id: hit.sessionId,
      file_id: hit.fileId,
      ...internalArtifact,
    });
  }
  return mounted;
}

async function writeAvailableFilesManifest(workdir, copied, autoMounted) {
  const files = [];
  const seen = new Set();
  const addFile = (file) => {
    const name = safeName(file?.name);
    if (!name || seen.has(name) || isHiddenSandboxSupportFile(name)) {
      return;
    }
    seen.add(name);
    files.push({
      name,
      path: `/mnt/data/${name}`,
      source: file.source || 'unknown',
      storage_session_id: file.storage_session_id,
      file_id: file.file_id,
      hidden: file.hidden === true || file.visibility === 'tool' || isInternalReadingArtifact(name),
      intermediate: file.intermediate === true || isInternalReadingArtifact(name),
      reusable: file.reusable !== false,
      artifact_kind:
        file.artifact_kind ||
        (isInternalReadingArtifact(name)
          ? classifyInternalArtifact(name).artifact_kind
          : undefined),
      recommended_reader:
        file.recommended_reader ||
        (isInternalReadingArtifact(name)
          ? classifyInternalArtifact(name).recommended_reader
          : 'read_file_auto'),
    });
  };

  for (const file of copied?.mounted || []) {
    addFile(file);
  }
  for (const file of autoMounted || []) {
    addFile(file);
  }

  const manifest = {
    note: [
      'These are real files currently mounted into this sandbox run.',
      'Use the exact name/path listed here. Do not say a file is missing before checking this manifest.',
      'The /mnt/data copy is temporary; persistent storage can remount files by exact filename in later runs.',
    ].join(' '),
    files,
  };
  await fsp.writeFile(
    path.join(workdir, AVAILABLE_FILES_MANIFEST),
    JSON.stringify(manifest, null, 2),
    'utf8',
  );
}

async function writeSandboxBootstrap(workdir) {
  const bootstrap = String.raw`
import os
import re

_CJK_RE = re.compile(r'[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]')
_SONGTI_PATH = os.environ.get('SANSUO_FONT_SONGTI')
_TIMES_PATH = os.environ.get('SANSUO_FONT_TIMES')
_CJK_FALLBACKS = [
    '/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/arphic/uming.ttc',
]
_LATIN_FALLBACKS = [
    '/usr/share/fonts/truetype/msttcorefonts/Times_New_Roman.ttf',
    '/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf',
]

def _has_cjk(value):
    return isinstance(value, str) and bool(_CJK_RE.search(value))

def _office_font_name(value=''):
    return '宋体' if _has_cjk(str(value or '')) else 'Times New Roman'

try:
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.pdfgen import canvas as _rl_canvas
    from reportlab.lib import styles as _rl_styles

    _CJK_FONT_NAME = 'Songti'

    _SONGTI_PATH = next((p for p in [_SONGTI_PATH, *_CJK_FALLBACKS] if p and os.path.exists(p)), None)
    _TIMES_PATH = next((p for p in [_TIMES_PATH, *_LATIN_FALLBACKS] if p and os.path.exists(p)), None)

    if _SONGTI_PATH:
        try:
            pdfmetrics.registerFont(TTFont('Songti', _SONGTI_PATH, subfontIndex=0))
        except Exception:
            pass
    if 'Songti' not in pdfmetrics.getRegisteredFontNames():
        try:
            pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
            _CJK_FONT_NAME = 'STSong-Light'
        except Exception:
            _CJK_FONT_NAME = 'Helvetica'

    if _TIMES_PATH:
        try:
            pdfmetrics.registerFont(TTFont('TimesNewRoman', _TIMES_PATH))
        except Exception:
            pass

    _ORIG_SET_FONT = _rl_canvas.Canvas.setFont
    _ORIG_DRAW_STRING = _rl_canvas.Canvas.drawString
    _ORIG_DRAW_CENTRED_STRING = _rl_canvas.Canvas.drawCentredString
    _ORIG_DRAW_RIGHT_STRING = _rl_canvas.Canvas.drawRightString
    _ORIG_STRING_WIDTH = _rl_canvas.Canvas.stringWidth
    _ORIG_GET_SAMPLE_STYLE_SHEET = _rl_styles.getSampleStyleSheet
    _ORIG_PARAGRAPH_STYLE_INIT = _rl_styles.ParagraphStyle.__init__

    def _normalize_font_name(name):
        lowered = str(name or '').lower().replace(' ', '').replace('-', '')
        if lowered in {'helvetica', 'helveticabold', 'courier', 'courierbold'} and _CJK_FONT_NAME in pdfmetrics.getRegisteredFontNames():
            return _CJK_FONT_NAME
        if lowered in {'timesnewroman', 'timesroman', 'times'} and 'TimesNewRoman' in pdfmetrics.getRegisteredFontNames():
            return 'TimesNewRoman'
        if lowered in {'simsun', 'songti', 'sonti', 'stsong', 'stsonglight'} and _CJK_FONT_NAME in pdfmetrics.getRegisteredFontNames():
            return _CJK_FONT_NAME
        return name

    def _setFont(self, psfontname, size, leading=None):
        return _ORIG_SET_FONT(self, _normalize_font_name(psfontname), size, leading)

    def _font_for_text(self, text):
        if _has_cjk(text) and _CJK_FONT_NAME in pdfmetrics.getRegisteredFontNames():
            return _CJK_FONT_NAME
        return _normalize_font_name(getattr(self, '_fontname', 'TimesNewRoman'))

    def _draw_with_font(draw_fn, self, x, y, text, *args, **kwargs):
        current_name = getattr(self, '_fontname', None)
        current_size = getattr(self, '_fontsize', 12)
        target_name = _font_for_text(self, text)
        changed = current_name and target_name != current_name
        if changed:
            _ORIG_SET_FONT(self, target_name, current_size)
        try:
            return draw_fn(self, x, y, text, *args, **kwargs)
        finally:
            if changed:
                _ORIG_SET_FONT(self, current_name, current_size)

    def _drawString(self, x, y, text, *args, **kwargs):
        return _draw_with_font(_ORIG_DRAW_STRING, self, x, y, text, *args, **kwargs)

    def _drawCentredString(self, x, y, text, *args, **kwargs):
        return _draw_with_font(_ORIG_DRAW_CENTRED_STRING, self, x, y, text, *args, **kwargs)

    def _drawRightString(self, x, y, text, *args, **kwargs):
        return _draw_with_font(_ORIG_DRAW_RIGHT_STRING, self, x, y, text, *args, **kwargs)

    def _stringWidth(self, text, fontName=None, fontSize=None):
        if _has_cjk(text) and _CJK_FONT_NAME in pdfmetrics.getRegisteredFontNames():
            fontName = _CJK_FONT_NAME
        elif fontName:
            fontName = _normalize_font_name(fontName)
        return _ORIG_STRING_WIDTH(self, text, fontName, fontSize)

    def _patch_style(style):
        if not style:
            return style
        if _CJK_FONT_NAME in pdfmetrics.getRegisteredFontNames():
            style.fontName = _CJK_FONT_NAME
        return style

    def _getSampleStyleSheet():
        sheet = _ORIG_GET_SAMPLE_STYLE_SHEET()
        for style in list(getattr(sheet, 'byName', {}).values()):
            _patch_style(style)
        return sheet

    def _paragraphStyleInit(self, name, parent=None, **kw):
        _ORIG_PARAGRAPH_STYLE_INIT(self, name, parent, **kw)
        _patch_style(self)

    _rl_canvas.Canvas.setFont = _setFont
    _rl_canvas.Canvas.drawString = _drawString
    _rl_canvas.Canvas.drawCentredString = _drawCentredString
    _rl_canvas.Canvas.drawRightString = _drawRightString
    _rl_canvas.Canvas.stringWidth = _stringWidth
    _rl_styles.getSampleStyleSheet = _getSampleStyleSheet
    _rl_styles.ParagraphStyle.__init__ = _paragraphStyleInit
except Exception:
    pass

def _apply_docx_default_fonts(doc):
    try:
        from docx.oxml import OxmlElement
        from docx.oxml.ns import qn
        from docx.shared import RGBColor
        from docx.shared import Pt

        def _patch_font_target(target, default_size=None):
            try:
                r_pr = target._element.get_or_add_rPr()
                r_fonts = r_pr.get_or_add_rFonts()
                font_defaults = {
                    'w:ascii': ('Times New Roman', 'w:asciiTheme'),
                    'w:hAnsi': ('Times New Roman', 'w:hAnsiTheme'),
                    'w:eastAsia': ('宋体', 'w:eastAsiaTheme'),
                }
                for value_attr, (default_value, theme_attr) in font_defaults.items():
                    if not r_fonts.get(qn(value_attr)):
                        r_fonts.set(qn(value_attr), default_value)
                    r_fonts.attrib.pop(qn(theme_attr), None)

                color = r_pr.find(qn('w:color'))
                if color is None:
                    target.font.color.rgb = RGBColor(0, 0, 0)
                elif color.get(qn('w:themeColor')):
                    color.set(qn('w:val'), '000000')
                    color.attrib.pop(qn('w:themeColor'), None)
                    color.attrib.pop(qn('w:themeTint'), None)
                    color.attrib.pop(qn('w:themeShade'), None)

                if default_size is not None and r_pr.find(qn('w:sz')) is None:
                    target.font.size = Pt(default_size)
            except Exception:
                pass

        def _remove_default_title_border(style):
            try:
                p_pr = style._element.get_or_add_pPr()
                p_bdr = p_pr.find(qn('w:pBdr'))
                if p_bdr is None:
                    return
                has_theme_border = any(
                    child.get(qn('w:themeColor')) for child in list(p_bdr)
                )
                if has_theme_border:
                    p_pr.remove(p_bdr)
            except Exception:
                pass

        def _ensure_default_title_alignment(style):
            try:
                p_pr = style._element.get_or_add_pPr()
                if p_pr.find(qn('w:jc')) is not None:
                    return
                alignment = OxmlElement('w:jc')
                alignment.set(qn('w:val'), 'center')
                p_pr.append(alignment)
            except Exception:
                pass

        for style_name in ['Normal', 'Title', 'Heading 1', 'Heading 2', 'Heading 3']:
            try:
                style = doc.styles[style_name]
                _patch_font_target(style, 12 if style_name == 'Normal' else 16)
                if style_name == 'Title':
                    _remove_default_title_border(style)
                    _ensure_default_title_alignment(style)
            except Exception:
                pass

        for paragraph in list(doc.paragraphs):
            for run in paragraph.runs:
                _patch_font_target(run)

        for table in list(doc.tables):
            for row in table.rows:
                for cell in row.cells:
                    for paragraph in cell.paragraphs:
                        for run in paragraph.runs:
                            _patch_font_target(run)
    except Exception:
        pass
    return doc

try:
    import docx.api as _docx_api
    import docx as _docx_module

    _ORIG_DOCX_DOCUMENT = _docx_api.Document

    def _document(*args, **kwargs):
        doc = _ORIG_DOCX_DOCUMENT(*args, **kwargs)
        _apply_docx_default_fonts(doc)
        if not getattr(doc, '_sansuo_font_save_patched', False):
            _orig_save = doc.save

            def _save(path_or_stream):
                _apply_docx_default_fonts(doc)
                return _orig_save(path_or_stream)

            doc.save = _save
            doc._sansuo_font_save_patched = True
        return doc

    _docx_api.Document = _document
    _docx_module.Document = _document
except Exception:
    pass

try:
    import openpyxl.workbook.workbook as _opx_wb
    from openpyxl.styles import Font as _OpenpyxlFont

    _ORIG_OPENPYXL_SAVE = _opx_wb.Workbook.save

    def _workbook_save(self, filename):
        try:
            for ws in self.worksheets:
                for row in ws.iter_rows():
                    for cell in row:
                        if cell.value is not None:
                            current = cell.font.copy() if cell.font else _OpenpyxlFont()
                            cell.font = current.copy(name=_office_font_name(cell.value))
        except Exception:
            pass
        return _ORIG_OPENPYXL_SAVE(self, filename)

    _opx_wb.Workbook.save = _workbook_save
except Exception:
    pass

try:
    import pptx.api as _pptx_api
    import pptx as _pptx_module

    _ORIG_PPTX_PRESENTATION = _pptx_api.Presentation

    def _apply_pptx_default_fonts(prs):
        try:
            for slide in prs.slides:
                for shape in slide.shapes:
                    if not hasattr(shape, 'text_frame'):
                        continue
                    for paragraph in shape.text_frame.paragraphs:
                        for run in paragraph.runs:
                            run.font.name = _office_font_name(run.text)
        except Exception:
            pass
        return prs

    def _presentation(*args, **kwargs):
        prs = _ORIG_PPTX_PRESENTATION(*args, **kwargs)
        if not getattr(prs, '_sansuo_font_save_patched', False):
            _orig_save = prs.save

            def _save(file):
                _apply_pptx_default_fonts(prs)
                return _orig_save(file)

            prs.save = _save
            prs._sansuo_font_save_patched = True
        return prs

    _pptx_api.Presentation = _presentation
    _pptx_module.Presentation = _presentation
except Exception:
    pass

try:
    import matplotlib
    from matplotlib import font_manager

    _plot_font_candidates = [
        _SONGTI_PATH,
        os.environ.get('SANSUO_FONT_SONGTI'),
        '/mnt/data/fonts/Songti.ttc',
        *_CJK_FALLBACKS,
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    ]
    _plot_family = None
    for _font_path in _plot_font_candidates:
        if _font_path and os.path.exists(_font_path):
            try:
                font_manager.fontManager.addfont(_font_path)
                _plot_family = font_manager.FontProperties(fname=_font_path).get_name()
                break
            except Exception:
                continue
    if _plot_family:
        matplotlib.rcParams['font.family'] = [_plot_family, 'DejaVu Sans']
        matplotlib.rcParams['axes.unicode_minus'] = False
except Exception:
    pass
`;

  await fsp.writeFile(path.join(workdir, 'sitecustomize.py'), bootstrap);
}

async function writeSandboxHelpers(workdir) {
  const helperPath = path.join(__dirname, 'sansuo_tools.py');
  if (fs.existsSync(helperPath)) {
    await fsp.copyFile(helperPath, path.join(workdir, 'sansuo_tools.py'));
  }
  const toolReferencePath = path.join(__dirname, 'TOOL_REFERENCE.md');
  if (fs.existsSync(toolReferencePath)) {
    await fsp.copyFile(toolReferencePath, path.join(workdir, 'TOOL_REFERENCE.md'));
  }
  const fontsDir = path.join(workdir, 'fonts');
  await ensureDir(fontsDir);
  if (fs.existsSync(HOST_SONGTI)) {
    await fsp.copyFile(HOST_SONGTI, path.join(fontsDir, 'Songti.ttc'));
  }
  if (fs.existsSync(HOST_TIMES)) {
    await fsp.copyFile(HOST_TIMES, path.join(fontsDir, 'TimesNewRoman.ttf'));
  }
}

function runDocker(workdir, lang, scriptFile) {
  const commands = {
    py: `python /mnt/data/${scriptFile}`,
    python: `python /mnt/data/${scriptFile}`,
    bash: `bash /mnt/data/${scriptFile}`,
    sh: `bash /mnt/data/${scriptFile}`,
  };
  const command = commands[lang];
  if (!command) {
    return Promise.resolve({
      stdout: '',
      stderr: `Unsupported sandbox language: ${lang}. Use py or bash.`,
      code: 2,
    });
  }

  const args = [
    'run',
    '--rm',
    '--network',
    'none',
    '--cpus',
    CPUS,
    '--memory',
    MEMORY,
    '-v',
    `${workdir}:/mnt/data`,
  ];

  if (fs.existsSync(HOST_SONGTI)) {
    args.push('-v', `${HOST_SONGTI}:${CONTAINER_SONGTI}:ro`);
  }
  if (fs.existsSync(HOST_TIMES)) {
    args.push('-v', `${HOST_TIMES}:${CONTAINER_TIMES}:ro`);
  }

  args.push(
    '-e',
    `SANSUO_FONT_SONGTI=${CONTAINER_SONGTI}`,
    '-e',
    `SANSUO_FONT_TIMES=${CONTAINER_TIMES}`,
    '-e',
    'SANSUO_DEFAULT_CJK_FONT=Songti',
    '-e',
    'SANSUO_DEFAULT_LATIN_FONT=Times New Roman',
    '-e',
    'PYTHONPATH=/mnt/data',
  );
  for (const [key, value] of Object.entries(mineruEnv())) {
    args.push('-e', `${key}=${value}`);
  }
  args.push('-w', '/mnt/data', IMAGE, 'bash', '-lc', command);

  return new Promise((resolve) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      stderr += `\nExecution timed out after ${TIMEOUT_MS}ms`;
      child.kill('SIGKILL');
    }, TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: `${stderr}${error.message}`, code: 1 });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}

function openSandboxHeaders(extra = {}) {
  return {
    ...(OPENSANDBOX_API_KEY ? { 'OPEN-SANDBOX-API-KEY': OPENSANDBOX_API_KEY } : {}),
    ...extra,
  };
}

function execdBaseUrl(endpoint) {
  const raw = String(endpoint || '').replace(/\/$/, '');
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw;
  }
  return `http://${raw}`;
}

function shellSingleQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function openSandboxPythonCommand(scriptPath) {
  const setup =
    'source /opt/opensandbox/code-interpreter-env.sh python 3.11 >/dev/null 2>&1 || ' +
    'source /opt/opensandbox/code-interpreter-env.sh python >/dev/null 2>&1';
  return `bash -lc ${shellSingleQuote(`${setup}; python ${scriptPath}`)}`;
}

async function openSandboxRequest(method, url, options = {}) {
  return axios({
    method,
    url,
    timeout: options.timeout ?? 30000,
    ...options,
    headers: {
      ...openSandboxHeaders(),
      ...(options.headers || {}),
    },
  });
}

async function createOpenSandbox() {
  const response = await openSandboxRequest('post', `${OPENSANDBOX_BASE_URL}/sandboxes`, {
    data: {
      image: { uri: OPENSANDBOX_IMAGE },
      entrypoint: ['/opt/opensandbox/code-interpreter.sh'],
      timeout: OPENSANDBOX_TIMEOUT_SECONDS,
      resourceLimits: {
        cpu: CPUS,
        memory: MEMORY.endsWith('i') ? MEMORY : MEMORY.replace(/m$/i, 'Mi').replace(/g$/i, 'Gi'),
      },
      env: {
        SANSUO_DEFAULT_CJK_FONT: 'Songti',
        SANSUO_DEFAULT_LATIN_FONT: 'Times New Roman',
        SANSUO_FONT_SONGTI: '/mnt/data/fonts/Songti.ttc',
        SANSUO_FONT_TIMES: '/mnt/data/fonts/TimesNewRoman.ttf',
        PYTHONPATH: '/mnt/data',
        ...mineruEnv(),
      },
      metadata: {
        owner: 'sansuo-code-api',
      },
    },
  });
  return response.data.id;
}

async function waitForOpenSandboxEndpoint(sandboxId) {
  const started = Date.now();
  let lastError = '';
  while (Date.now() - started < OPENSANDBOX_READY_TIMEOUT_MS) {
    try {
      const info = await openSandboxRequest(
        'get',
        `${OPENSANDBOX_BASE_URL}/sandboxes/${encodeURIComponent(sandboxId)}`,
        { timeout: 10000 },
      );
      const state = info.data?.status?.state;
      if (state === 'Failed' || state === 'Terminated') {
        throw new Error(`OpenSandbox entered ${state}: ${info.data?.status?.message || ''}`);
      }
      if (state === 'Running') {
        const endpoint = await openSandboxRequest(
          'get',
          `${OPENSANDBOX_BASE_URL}/sandboxes/${encodeURIComponent(
            sandboxId,
          )}/endpoints/44772?use_server_proxy=${OPENSANDBOX_USE_SERVER_PROXY ? 'true' : 'false'}`,
          { timeout: 10000 },
        );
        const baseUrl = execdBaseUrl(endpoint.data?.endpoint);
        const headers = endpoint.data?.headers || {};
        await axios.get(`${baseUrl}/ping`, { headers, timeout: 10000 });
        return { baseUrl, headers };
      }
      lastError = `state=${state || 'unknown'}`;
    } catch (error) {
      lastError = error.message || String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  throw new Error(`OpenSandbox did not become ready in time (${lastError})`);
}

async function deleteOpenSandbox(sandboxId) {
  if (!sandboxId) {
    return;
  }
  try {
    await openSandboxRequest(
      'delete',
      `${OPENSANDBOX_BASE_URL}/sandboxes/${encodeURIComponent(sandboxId)}`,
      { timeout: 10000 },
    );
  } catch {
    // Best-effort cleanup; preserve the original execution result/error.
  }
}

async function parseSSEStream(stream) {
  let stdout = '';
  let stderr = '';
  let code = 0;
  let buffer = '';

  const handleEvent = (raw) => {
    const dataLines = raw
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());
    const text = dataLines.length ? dataLines.join('\n').trim() : raw.trim();
    if (!text) {
      return;
    }
    if (text === '[DONE]') {
      return;
    }
    let event;
    try {
      event = JSON.parse(text);
    } catch {
      return;
    }
    if (event.type === 'stdout') {
      stdout += event.text || '';
    } else if (event.type === 'stderr') {
      stderr += event.text || '';
    } else if (event.type === 'error') {
      code = 1;
      if (event.error?.evalue) {
        stderr += `${event.error.evalue}\n`;
      } else if (event.text) {
        stderr += `${event.text}\n`;
      }
    }
  };

  return await new Promise((resolve, reject) => {
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      let index;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const raw = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        handleEvent(raw);
      }
    });
    stream.on('error', reject);
    stream.on('end', () => {
      if (buffer.trim()) {
        handleEvent(buffer);
      }
      resolve({ stdout, stderr, code });
    });
  });
}

async function runOpenSandboxCommand(execd, command, cwd = '/mnt/data') {
  const response = await axios.post(
    `${execd.baseUrl}/command`,
    {
      command,
      cwd,
      background: false,
      timeout: TIMEOUT_MS,
      envs: {
        PYTHONPATH: '/mnt/data',
        SANSUO_FONT_SONGTI: '/mnt/data/fonts/Songti.ttc',
        SANSUO_FONT_TIMES: '/mnt/data/fonts/TimesNewRoman.ttf',
        SANSUO_DEFAULT_CJK_FONT: 'Songti',
        SANSUO_DEFAULT_LATIN_FONT: 'Times New Roman',
        ...mineruEnv(),
      },
    },
    {
      responseType: 'stream',
      timeout: TIMEOUT_MS + 15000,
      headers: {
        accept: 'text/event-stream',
        'content-type': 'application/json',
        ...execd.headers,
      },
    },
  );
  return parseSSEStream(response.data);
}

async function uploadOpenSandboxFile(execd, sourcePath, targetPath) {
  const form = new FormData();
  form.append('metadata', Buffer.from(JSON.stringify({ path: targetPath, mode: 0o644 })), {
    filename: 'metadata',
    contentType: 'application/json',
  });
  form.append('file', fs.createReadStream(sourcePath), {
    filename: path.posix.basename(targetPath),
    contentType: 'application/octet-stream',
  });
  try {
    await axios.post(`${execd.baseUrl}/files/upload`, form, {
      timeout: 120000,
      maxContentLength: MAX_UPLOAD_FILE_SIZE,
      maxBodyLength: MAX_UPLOAD_FILE_SIZE,
      headers: {
        ...form.getHeaders(),
        ...execd.headers,
      },
    });
  } catch (error) {
    const details = error.response?.data
      ? typeof error.response.data === 'string'
        ? error.response.data
        : JSON.stringify(error.response.data)
      : error.message;
    throw new Error(`OpenSandbox upload failed for ${targetPath}: ${details}`);
  }
}

async function uploadOpenSandboxWorkdir(execd, workdir) {
  const stack = [''];
  while (stack.length) {
    const relDir = stack.pop();
    const absDir = path.join(workdir, relDir);
    const entries = await fsp.readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = path.join(relDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(relPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const targetPath = `/mnt/data/${relPath.split(path.sep).join('/')}`;
      await uploadOpenSandboxFile(execd, path.join(workdir, relPath), targetPath);
    }
  }
}

async function listOpenSandboxOutputs(execd, scriptFile) {
  const payload = JSON.stringify({
    scriptFile,
    internal: Array.from(INTERNAL_OUTPUT_NAMES),
  });
  const command = openSandboxPythonCommand(
    `- <<'PY'\nimport hashlib, json, os\ncfg = json.loads(${JSON.stringify(payload)})\nroot = '/mnt/data'\ninternal = set(cfg['internal'])\nscript = cfg['scriptFile']\nout = []\ndef sha256_file(path):\n    h = hashlib.sha256()\n    with open(path, 'rb') as f:\n        for chunk in iter(lambda: f.read(1024 * 1024), b''):\n            h.update(chunk)\n    return h.hexdigest()\nfor base, dirs, files in os.walk(root):\n    dirs[:] = [d for d in dirs if d not in {'__pycache__', 'fonts'}]\n    for name in files:\n        rel = os.path.relpath(os.path.join(base, name), root).replace(os.sep, '/')\n        display = rel.replace('/', '__')\n        if rel.startswith('fonts/') or name == script or name in internal:\n            continue\n        p = os.path.join(base, name)\n        try:\n            st = os.stat(p)\n            digest = sha256_file(p)\n        except OSError:\n            continue\n        out.append({'path': '/mnt/data/' + rel, 'name': display, 'size': st.st_size, 'sha256': digest})\nprint(json.dumps(out, ensure_ascii=False))\nPY`,
  );
  const result = await runOpenSandboxCommand(execd, command);
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  const lastLine = lines[lines.length - 1] || '[]';
  try {
    return JSON.parse(lastLine);
  } catch {
    throw new Error(`Unable to parse OpenSandbox output list: ${result.stdout}${result.stderr}`);
  }
}

async function persistOpenSandboxOutputs(sessionId, execd, outputs) {
  const sessionDir = storageDir(sessionId);
  await ensureDir(sessionDir);

  const files = [];
  const warnings = [];
  const seenOutputHashes = new Map();
  let totalBytes = 0;
  for (const output of outputs) {
    const name = safeName(output.name || path.posix.basename(output.path || 'output'));
    const size = Number(output.size || 0);
    if (files.length >= MAX_OUTPUT_FILES) {
      warnings.push(`Skipped ${name}: output file count limit reached.`);
      continue;
    }
    if (size > MAX_OUTPUT_FILE_SIZE) {
      warnings.push(`Skipped ${name}: file is larger than the configured per-file limit.`);
      continue;
    }
    const response = await axios.get(`${execd.baseUrl}/files/download`, {
      responseType: 'stream',
      timeout: 120000,
      params: { path: output.path },
      headers: execd.headers,
    });
    const fileId = id('file');
    const dest = path.join(sessionDir, fileId);
    await new Promise((resolve, reject) => {
      const stream = fs.createWriteStream(dest);
      response.data.pipe(stream);
      response.data.on('error', reject);
      stream.on('error', reject);
      stream.on('finish', resolve);
    });
    const contentHash = await hashFile(dest);
    const duplicateOf = seenOutputHashes.get(contentHash);
    if (duplicateOf) {
      await fsp.unlink(dest).catch(() => {});
      warnings.push(`Skipped duplicate output ${name}: same content as ${duplicateOf}.`);
      continue;
    }
    if (totalBytes + size > MAX_TOTAL_OUTPUT_SIZE) {
      await fsp.unlink(dest).catch(() => {});
      warnings.push(`Skipped ${name}: total output size limit reached.`);
      continue;
    }
    seenOutputHashes.set(contentHash, name);
    totalBytes += size;
    await fsp.writeFile(
      path.join(sessionDir, `${fileId}.json`),
      JSON.stringify({ name, createdAt: new Date().toISOString(), size }),
    );
    files.push({
      id: fileId,
      name,
      storage_session_id: sessionId,
      session_id: sessionId,
      kind: 'user',
      resource_id: 'opensandbox-user',
    });
  }
  return { files, warnings };
}

async function runOpenSandbox(workdir, lang, scriptFile, excludedNames, inputSnapshots) {
  const commands = {
    py: openSandboxPythonCommand(`/mnt/data/${scriptFile}`),
    python: openSandboxPythonCommand(`/mnt/data/${scriptFile}`),
    bash: `bash /mnt/data/${scriptFile}`,
    sh: `bash /mnt/data/${scriptFile}`,
  };
  const command = commands[lang];
  if (!command) {
    return {
      result: {
        stdout: '',
        stderr: `Unsupported sandbox language: ${lang}. Use py or bash.`,
        code: 2,
      },
      files: [],
      warnings: [],
    };
  }

  let sandboxId;
  try {
    sandboxId = await createOpenSandbox();
    const execd = await waitForOpenSandboxEndpoint(sandboxId);
    await runOpenSandboxCommand(execd, 'mkdir -p /mnt/data', '/');
    await uploadOpenSandboxWorkdir(execd, workdir);
    const result = await runOpenSandboxCommand(execd, command);
    const outputWarnings = [];
    const outputs = filterUnchangedMountedOutputs(
      await listOpenSandboxOutputs(execd, scriptFile),
      excludedNames,
      inputSnapshots,
      outputWarnings,
    );
    const persisted = await persistOpenSandboxOutputs(
      path.basename(path.dirname(workdir)),
      execd,
      outputs,
    );
    return {
      result,
      files: persisted.files,
      warnings: [...outputWarnings, ...(persisted.warnings || [])],
    };
  } finally {
    await deleteOpenSandbox(sandboxId);
  }
}

async function persistOutputs(
  sessionId,
  workdir,
  scriptFile,
  excludedNames = new Set(),
  inputSnapshots = new Map(),
) {
  const sessionDir = storageDir(sessionId);
  await ensureDir(sessionDir);

  const files = [];
  const warnings = [];
  const seenOutputHashes = new Map();
  let totalBytes = 0;
  const stack = [''];
  while (stack.length) {
    const relDir = stack.pop();
    const absDir = path.join(workdir, relDir);
    const entries = await fsp.readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = path.join(relDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__pycache__' && entry.name !== 'fonts') {
          stack.push(relPath);
        }
        continue;
      }
      if (!entry.isFile() || entry.name === scriptFile || INTERNAL_OUTPUT_NAMES.has(entry.name)) {
        continue;
      }
      const normalizedRelPath = relPath.split(path.sep).join('/');
      const displayName = relPath.split(path.sep).join('__');
      const src = path.join(workdir, relPath);
      const stat = await fsp.stat(src);
      const isMountedInput =
        excludedNames.has(entry.name) ||
        excludedNames.has(normalizedRelPath) ||
        excludedNames.has(displayName);
      if (isMountedInput) {
        const match =
          inputSnapshots.get(entry.name) ||
          inputSnapshots.get(normalizedRelPath) ||
          inputSnapshots.get(displayName);
        if (!match) {
          continue;
        }
        const contentHash = await hashFile(src);
        if (contentHash === match.sha256 && stat.size === match.size) {
          continue;
        }
        warnings.push(`Modified mounted input returned as output: ${displayName}.`);
      }
      if (files.length >= MAX_OUTPUT_FILES) {
        warnings.push(`Skipped ${relPath}: output file count limit reached.`);
        continue;
      }
      if (stat.size > MAX_OUTPUT_FILE_SIZE) {
        warnings.push(`Skipped ${relPath}: file is larger than the configured per-file limit.`);
        continue;
      }
      const contentHash = await hashFile(src);
      const duplicateOf = seenOutputHashes.get(contentHash);
      if (duplicateOf) {
        warnings.push(`Skipped duplicate output ${displayName}: same content as ${duplicateOf}.`);
        continue;
      }
      if (totalBytes + stat.size > MAX_TOTAL_OUTPUT_SIZE) {
        warnings.push(`Skipped ${relPath}: total output size limit reached.`);
        continue;
      }
      seenOutputHashes.set(contentHash, displayName);
      totalBytes += stat.size;
      const fileId = id('file');
      await fsp.copyFile(src, path.join(sessionDir, fileId));
      await fsp.writeFile(
        path.join(sessionDir, `${fileId}.json`),
        JSON.stringify({ name: displayName, createdAt: new Date().toISOString(), size: stat.size }),
      );
      files.push({
        id: fileId,
        name: displayName,
        storage_session_id: sessionId,
        session_id: sessionId,
        kind: 'user',
        resource_id: 'local-user',
      });
    }
  }
  return { files, warnings };
}

app.get('/health', (_req, res) => {
  let auth;
  try {
    const config = codeApiSecurity.readConfig();
    auth = { provider: config.provider, configured: config.provider !== 'unconfigured' };
  } catch {
    auth = { provider: 'invalid', configured: false };
  }
  res.json({
    ok: true,
    backend: BACKEND,
    image: BACKEND === 'opensandbox' ? OPENSANDBOX_IMAGE : IMAGE,
    opensandboxBaseURL: OPENSANDBOX_BASE_URL,
    auth,
  });
});

app.post('/v1/exec', async (req, res) => {
  let sessionId;
  const lang = String(req.body.lang || 'py');
  const code = String(req.body.code || '');
  const scriptFile = lang === 'bash' || lang === 'sh' ? '.sandbox_exec.sh' : '.sandbox_exec.py';

  try {
    sessionId = codeApiSecurity.validateOpaqueId(req.body.session_id || id('exec'), 'session id');
    const outputIdentity = codeApiSecurity.userSessionIdentity(req.codeApiPrincipal);
    await codeApiSecurity.authorizeSession(req.codeApiPrincipal, sessionId, outputIdentity, {
      create: true,
    });
    const workdir = ensureInside(
      path.join(ROOT, 'runs'),
      path.join(ROOT, 'runs', sessionId, crypto.randomBytes(5).toString('hex')),
    );
    logDebug('exec.start', {
      sessionId,
      lang,
      backend: BACKEND,
      workdir,
      codeChars: code.length,
      codePreview: LOG_CODE ? code.slice(0, 1200) : undefined,
      requestedFiles: (req.body.files || []).map((file) => ({
        id: file.id || file.file_id,
        name: file.name || file.filename,
        storage_session_id: file.storage_session_id || file.session_id,
      })),
      referencedFilenames: Array.from(getReferencedFilenames(code)),
      autoMountCandidates: Array.from(getAutoMountFilenames(code)),
      mineruConfigured: Boolean(MINERU_PDF_PARSE_URL || MINERU_BASE_URL),
      timeoutMs: TIMEOUT_MS,
    });
    logPdfChain('exec.start', {
      sessionId,
      requestedFiles: (req.body.files || []).map((file) => file.name || file.filename),
      referencedFilenames: Array.from(getReferencedFilenames(code)),
      autoMountCandidates: Array.from(getAutoMountFilenames(code)),
      usesReadPdfSmart: /\bread_pdf_smart\s*\(/.test(String(code || '')),
      usesReadPdfFind: /\bread_pdf_find\s*\(/.test(String(code || '')),
      usesMineruParsePdf: /\bmineru_parse_pdf\s*\(/.test(String(code || '')),
      mineruConfigured: Boolean(MINERU_PDF_PARSE_URL || MINERU_BASE_URL),
    });
    validateSandboxCode(code, req.body.intent || {});
    await ensureDir(workdir);
    const copied = await copyInputFiles(workdir, req.body.files || [], req.codeApiPrincipal);
    const autoMounted = await copyReferencedFiles(workdir, code, copied, req.codeApiPrincipal);
    await writeAvailableFilesManifest(workdir, copied, autoMounted);
    const inputSnapshots = await collectInputSnapshots(workdir, copied);
    logDebug('exec.inputs', {
      sessionId,
      copied: Array.from(copied),
      autoMounted,
      availableFilesManifest: AVAILABLE_FILES_MANIFEST,
    });
    logPdfChain('exec.inputs', {
      sessionId,
      copied: Array.from(copied),
      autoMounted: autoMounted.map((file) => file?.name || file?.filename),
      availableFilesManifest: AVAILABLE_FILES_MANIFEST,
    });
    await writeSandboxBootstrap(workdir);
    await writeSandboxHelpers(workdir);
    await fsp.writeFile(path.join(workdir, scriptFile), code, { mode: 0o700 });
    let result;
    let files;
    let warnings;
    if (BACKEND === 'opensandbox') {
      const openSandboxResult = await runOpenSandbox(
        workdir,
        lang,
        scriptFile,
        copied,
        inputSnapshots,
      );
      result = openSandboxResult.result;
      files = openSandboxResult.files;
      warnings = openSandboxResult.warnings;
    } else {
      result = await runDocker(workdir, lang, scriptFile);
      ({ files, warnings } = await persistOutputs(
        sessionId,
        workdir,
        scriptFile,
        copied,
        inputSnapshots,
      ));
    }
    const filePartition = partitionGeneratedFilesForIntent(
      files,
      code,
      result.stdout || '',
      warnings,
      req.body.intent || {},
    );
    const artifactFiles = filePartition.artifactFiles;
    const visibleFiles = filePartition.visibleFiles;
    const internalFiles = filePartition.internalFiles;
    const hiddenIntermediateFiles = filePartition.hiddenIntermediateFiles || internalFiles;
    logDebug('exec.result', {
      sessionId,
      stdoutChars: String(result.stdout || '').length,
      stderrChars: String(result.stderr || '').length,
      files: artifactFiles.map((file) => file.name),
      visibleFiles: visibleFiles.map((file) => file.name),
      internalFiles: internalFiles.map((file) => file.name),
      hiddenIntermediateFiles: hiddenIntermediateFiles.map((file) => ({
        name: file.name,
        kind: file.artifact_kind,
        reader: file.recommended_reader,
      })),
      warnings,
    });
    logPdfChain('exec.result', {
      sessionId,
      stdoutChars: String(result.stdout || '').length,
      stderrChars: String(result.stderr || '').length,
      visibleFiles: visibleFiles.map((file) => file.name),
      internalFiles: internalFiles.map((file) => file.name),
      hiddenIntermediateFiles: hiddenIntermediateFiles.map((file) => ({
        name: file.name,
        kind: file.artifact_kind,
        reader: file.recommended_reader,
      })),
      warnings,
    });
    const autoMountText = autoMounted.length
      ? `\nAuto-mounted input files:\n${autoMounted
          .map(
            (file) =>
              `${file.name} (${file.source || 'history'}:${file.storage_session_id}/${file.file_id})`,
          )
          .join('\n')}`
      : '';
    const warningText = warnings.length ? `\nSandbox output warnings:\n${warnings.join('\n')}` : '';
    res.json({
      session_id: sessionId,
      stdout: result.stdout || '',
      stderr: `${result.stderr || ''}${autoMountText}${warningText}`,
      files: artifactFiles,
      outputFiles: visibleFiles,
      generatedFiles: visibleFiles,
      internalFiles,
      hidden_intermediate_files: hiddenIntermediateFiles,
      inputFiles: Array.from(copied),
    });
  } catch (error) {
    logDebug('exec.error', {
      sessionId,
      error: error.message || String(error),
    });
    const status = error instanceof CodeApiSecurityError ? error.status : 500;
    res.status(status).json({
      ...(error instanceof CodeApiSecurityError ? { error: error.code } : {}),
      session_id: sessionId,
      stdout: '',
      stderr: error.message || String(error),
      files: [],
      outputFiles: [],
      generatedFiles: [],
      inputFiles: [],
    });
  }
});

app.post('/v1/upload', upload.single('file'), async (req, res) => {
  try {
    const sessionId = id('upload');
    const identity = codeApiSecurity.parseIdentity(req.body, req.codeApiPrincipal);
    await codeApiSecurity.authorizeSession(req.codeApiPrincipal, sessionId, identity, {
      create: true,
    });
    const sessionDir = codeApiSecurity.sessionDir(sessionId);
    const fileId = id('file');
    const name = safeName(req.file?.originalname || 'file');
    await fsp.rename(req.file.path, codeApiSecurity.filePath(sessionId, fileId));
    await fsp.writeFile(
      ensureInside(sessionDir, path.join(sessionDir, `${fileId}.json`)),
      JSON.stringify({ name }),
    );
    res.json({
      message: 'success',
      storage_session_id: sessionId,
      files: [{ fileId, filename: name }],
    });
  } catch (error) {
    if (req.file?.path) await fsp.rm(req.file.path, { force: true }).catch(() => {});
    const status = error instanceof CodeApiSecurityError ? error.status : 500;
    res.status(status).json({
      message: 'error',
      error: error instanceof CodeApiSecurityError ? error.code : 'upload_failed',
    });
  }
});

app.post('/v1/upload/batch', upload.array('file'), async (req, res) => {
  try {
    const sessionId = id('upload');
    const identity = codeApiSecurity.parseIdentity(req.body, req.codeApiPrincipal);
    await codeApiSecurity.authorizeSession(req.codeApiPrincipal, sessionId, identity, {
      create: true,
    });
    const sessionDir = codeApiSecurity.sessionDir(sessionId);
    const files = [];
    for (const uploaded of req.files || []) {
      const fileId = id('file');
      const name = safeName(uploaded.originalname || 'file');
      await fsp.rename(uploaded.path, codeApiSecurity.filePath(sessionId, fileId));
      await fsp.writeFile(
        ensureInside(sessionDir, path.join(sessionDir, `${fileId}.json`)),
        JSON.stringify({ name }),
      );
      files.push({ status: 'success', fileId, filename: name });
    }
    res.json({
      message: 'success',
      storage_session_id: sessionId,
      files,
      succeeded: files.length,
      failed: 0,
    });
  } catch (error) {
    await Promise.all(
      (req.files || []).map((file) => fsp.rm(file.path, { force: true }).catch(() => {})),
    );
    const status = error instanceof CodeApiSecurityError ? error.status : 500;
    res.status(status).json({
      message: 'error',
      files: [],
      succeeded: 0,
      failed: 1,
      error: error instanceof CodeApiSecurityError ? error.code : 'upload_failed',
    });
  }
});

app.get('/v1/download/:sessionId/:fileId', async (req, res) => {
  try {
    const identity = codeApiSecurity.parseIdentity(req.query, req.codeApiPrincipal);
    await codeApiSecurity.authorizeSession(req.codeApiPrincipal, req.params.sessionId, identity);
    const filePath = codeApiSecurity.filePath(req.params.sessionId, req.params.fileId);
    const stat = await codeApiSecurity.assertNoSymlink(filePath, true);
    if (!stat?.isFile()) {
      res.status(404).json({ error: 'file_not_found' });
      return;
    }
    const sessionDir = codeApiSecurity.sessionDir(req.params.sessionId);
    const metaPath = ensureInside(sessionDir, path.join(sessionDir, `${req.params.fileId}.json`));
    let name = req.params.fileId;
    try {
      name = JSON.parse(await fsp.readFile(metaPath, 'utf8')).name || name;
    } catch {
      // Keep the id fallback.
    }
    res.setHeader('Content-Disposition', getContentDisposition(name));
    res.setHeader('Content-Type', 'application/octet-stream');
    res.sendFile(filePath);
  } catch (error) {
    const status = error instanceof CodeApiSecurityError ? error.status : 500;
    res.status(status).json({ error: error.code || 'download_failed' });
  }
});

app.get('/v1/files/:sessionId', async (req, res) => {
  try {
    const identity = codeApiSecurity.parseIdentity(req.query, req.codeApiPrincipal);
    await codeApiSecurity.authorizeSession(req.codeApiPrincipal, req.params.sessionId, identity);
    const sessionDir = codeApiSecurity.sessionDir(req.params.sessionId);
    const entries = await fsp.readdir(sessionDir);
    const files = [];
    for (const entry of entries) {
      if (entry.startsWith('.') || entry.endsWith('.json')) continue;
      codeApiSecurity.validateOpaqueId(entry, 'file id');
      const fileStat = await codeApiSecurity.assertNoSymlink(path.join(sessionDir, entry), true);
      if (!fileStat?.isFile()) continue;
      let name = entry;
      try {
        name =
          JSON.parse(await fsp.readFile(path.join(sessionDir, `${entry}.json`), 'utf8')).name ||
          name;
      } catch {
        // Keep the id fallback.
      }
      files.push({
        id: entry,
        name,
        storage_session_id: req.params.sessionId,
        session_id: req.params.sessionId,
      });
    }
    res.json(files);
  } catch (error) {
    const status = error instanceof CodeApiSecurityError ? error.status : 500;
    res.status(status).json({ error: error.code || 'list_failed' });
  }
});

app.get('/v1/sessions/:sessionId/objects/:fileId', async (req, res) => {
  try {
    const identity = codeApiSecurity.parseIdentity(req.query, req.codeApiPrincipal);
    await codeApiSecurity.authorizeSession(req.codeApiPrincipal, req.params.sessionId, identity);
    const filePath = codeApiSecurity.filePath(req.params.sessionId, req.params.fileId);
    const stat = await codeApiSecurity.assertNoSymlink(filePath, true);
    if (!stat?.isFile()) {
      res.status(404).json({ error: 'file_not_found' });
      return;
    }
    res.json({ lastModified: stat.mtime.toISOString() });
  } catch (error) {
    const status = error instanceof CodeApiSecurityError ? error.status : 500;
    res.status(status).json({ error: error.code || 'object_lookup_failed' });
  }
});

function startServer() {
  return ensureDir(path.join(ROOT, 'tmp'))
    .then(() => {
      scheduleSandboxCleanup();
      const HOST = process.env.SANSUO_CODE_API_HOST || '127.0.0.1';
      return app.listen(PORT, HOST, () => {
        console.log(`SanSuo Code API listening on http://${HOST}:${PORT}/v1`);
      });
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer, codeApiSecurity };
