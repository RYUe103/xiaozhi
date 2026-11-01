const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const { promisify } = require('util');
const { execFile } = require('child_process');
const { Readable } = require('stream');
const { v4 } = require('uuid');
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const iconv = require('iconv-lite');
const { logger } = require('@librechat/data-schemas');
const { getCodeBaseURL } = require('@librechat/agents');
const {
  withTimeout,
  getBasePath,
  logAxiosError,
  hasOfficeHtmlPath,
  sanitizeArtifactPath,
  flattenArtifactPath,
  createAxiosInstance,
  getCodeApiAuthHeaders,
  classifyCodeArtifact,
  codeServerHttpAgent,
  codeServerHttpsAgent,
  extractCodeArtifactText,
  getExtractedTextFormat,
  getStorageMetadata,
  buildCodeEnvDownloadQuery,
} = require('@librechat/api');
const {
  Tools,
  megabyte,
  fileConfig,
  FileContext,
  FileSources,
  imageExtRegex,
  inferMimeType,
  EToolResources,
  EModelEndpoint,
  mergeFileConfig,
  getEndpointFileConfig,
} = require('librechat-data-provider');
const { filterFilesByAgentAccess } = require('~/server/services/Files/permissions');
const {
  createFile,
  getFiles,
  updateFile,
  claimCodeFile,
  upsertSanSuoFileRecord,
  getSanSuoFileParseJobs,
  upsertSanSuoFileParseJob,
  claimSanSuoFileParseJob,
  finishSanSuoFileParseJob,
} = require('~/models');
const { getStrategyFunctions } = require('~/server/services/Files/strategies');
const { convertImage } = require('~/server/services/Files/images/convert');
const { determineFileType } = require('~/server/utils');

const axios = createAxiosInstance();
const execFileAsync = promisify(execFile);

const DOCX_PREPARSE_ARTIFACT_RE =
  /(?:_docx_blocks\.jsonl|_docx_manifest\.json|_docx_reading_pack\.md|_docx_image_\d+\.(?:png|jpe?g|gif|webp|bmp|tiff?|svg))$/i;
const TABULAR_PREPARSE_ARTIFACT_RE =
  /(?:_tabular_rows\.jsonl|_tabular_manifest\.json|_tabular_reading_pack\.md)$/i;
const TEXT_PREPARSE_ARTIFACT_RE =
  /(?:_text_blocks\.jsonl|_text_manifest\.json|_text_reading_pack\.md)$/i;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const DOC_MIMES = new Set(['application/msword', 'application/vnd.ms-word']);
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLS_MIME = 'application/vnd.ms-excel';
const CSV_MIMES = new Set(['text/csv', 'application/csv', 'text/comma-separated-values']);
const MARKDOWN_MIMES = new Set(['text/markdown', 'text/x-markdown']);
const TEXT_MIMES = new Set(['text/plain', ...MARKDOWN_MIMES]);
const SANSUO_DOCUMENT_PARSE_VERSION = 'document-preparse-v1';
const SANSUO_DOCUMENT_PARSE_TIMEOUT_MS = Number(
  process.env.SANSUO_DOCUMENT_PARSE_TIMEOUT_MS || 180000,
);
const SANSUO_DOCUMENT_PARSE_MAX_ATTEMPTS = Number(
  process.env.SANSUO_DOCUMENT_PARSE_MAX_ATTEMPTS || 3,
);
const isSanSuoPdfMineruFirst = () =>
  String(process.env.SANSUO_PDF_MINERU_FIRST || 'true').toLowerCase() !== 'false';
const isSanSuoPdfVisionFallbackEnabled = () =>
  String(process.env.SANSUO_PDF_VISION_FALLBACK_ENABLED || 'true').toLowerCase() !== 'false';
const SANSUO_PDF_VISION_FALLBACK_DPI = Math.min(
  240,
  Math.max(96, Number(process.env.SANSUO_PDF_VISION_FALLBACK_DPI || 180)),
);
const getSanSuoPdfVisionRenderScript = () =>
  process.env.SANSUO_PDF_VISION_RENDER_SCRIPT ||
  path.join(__dirname, '..', 'Pdf', 'render_pages.py');
const activeDocumentParses = new Map();

function logSanSuoFileTiming(details, level = 'info') {
  const payload = {
    timestamp: new Date().toISOString(),
    ...details,
  };
  logger[level](`[SanSuoFileTiming] ${JSON.stringify(payload)}`);
}

function getSanSuoFileTraceId(sourceFile = {}, fallback = '') {
  const fileId = sourceFile.libreFileId || sourceFile.file_id;
  return fileId ? `file-${String(fileId)}` : fallback || `file-${Date.now()}`;
}

function getSanSuoMineruUploadFilename(sourceFile = {}) {
  const identifier =
    String(sourceFile.file_id || sourceFile.libreFileId || 'document')
      .replace(/[^A-Za-z0-9_-]+/g, '_')
      .slice(0, 96) || 'document';
  return `sansuo_${identifier}.pdf`;
}

async function renderSanSuoPdfPages(sourceBuffer, requestedPages = [], { textOnly = false, signal, region, dpi = SANSUO_PDF_VISION_FALLBACK_DPI } = {}) {
  signal?.throwIfAborted();
  const tempDir = path.join('/tmp', `sansuo-pdf-render-${crypto.randomUUID()}`);
  const inputPath = path.join(tempDir, 'source.pdf');
  const outputDir = path.join(tempDir, 'pages');
  const resultPath = path.join(tempDir, 'result.json');
  await fsp.mkdir(outputDir, { recursive: true });
  await fsp.writeFile(inputPath, sourceBuffer);
  const normalizedPages = Array.from(
    new Set(requestedPages.map(Number).filter((page) => Number.isInteger(page) && page > 0)),
  ).sort((left, right) => left - right);
  try {
    const args = [
      getSanSuoPdfVisionRenderScript(),
      '--input',
      inputPath,
      '--output-dir',
      outputDir,
      '--result-json',
      resultPath,
      '--dpi',
      String(dpi),
    ];
    if (textOnly) args.push('--text-only', '--layout');
    if (region) args.push('--region', ['x0', 'y0', 'x1', 'y1'].map(k => region[k]).join(','));
    if (normalizedPages.length) {
      args.push('--pages', normalizedPages.join(','));
    }
    const { stdout } = await execFileAsync(
      process.env.SANSUO_PDF_RENDER_PYTHON || 'python3',
      args,
      { timeout: SANSUO_DOCUMENT_PARSE_TIMEOUT_MS, maxBuffer: 1024 * 1024, ...(signal ? { signal } : {}) },
    );
    // Layout for long PDFs exceeds execFile's stdout budget. Keep diagnostics bounded
    // and read the private result file with a separate explicit size limit.
    const stat = await fsp.stat(resultPath).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (stat && stat.size > 64 * 1024 * 1024) throw new Error('pdf_layout_result_budget_exceeded');
    const result = JSON.parse(stat ? await fsp.readFile(resultPath, 'utf8') : String(stdout || '{}').trim());
    const pages = Array.isArray(result.pages) ? result.pages : [];
    if (!pages.length) throw new Error('pdf_page_render_empty');
    return {
      tempDir,
      outputDir,
      pages,
      documentPageCount: Number(result.document_page_count) || pages.length,
      cleanup: () => fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {}),
    };
  } catch (error) {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function buildSanSuoPdfVisionFallbackArtifacts(sourceBuffer, sourceName, prefixName, fallbackReason = 'mineru_failed_or_disabled') {
  const rendered = await renderSanSuoPdfPages(sourceBuffer, [], { textOnly: true });
  try {
    const pages = rendered.pages;
    const artifacts = [];
    for (const page of pages.filter(page => page.image_name)) {
      const imagePath = path.join(rendered.outputDir, page.image_name);
      artifacts.push({
        name: `${prefixName}_visual_page_${String(page.page).padStart(4, '0')}.png`,
        filePath: imagePath,
        artifactKind: 'pdf_extracted_image',
      });
    }
    const pagesName = `${prefixName}_visual_pages.jsonl`;
    const chunksName = `${prefixName}_visual_chunks.jsonl`;
    const manifestName = `${prefixName}_visual_manifest.json`;
    const chunks = pages.flatMap(page => {
      const blocks = page.layout_blocks?.length ? page.layout_blocks.map((block, index) => ({
        text: block.lines.map(line => line.spans.map(span => span.text).join('')).join('\n'),
        block_id: `fitz-p${page.page}-b${index + 1}`, bbox: block.bbox, coordinate_system: 'pdf_points',
        page_rect: page.page_rect, layout_lines: block.lines, geometry_verified: true,
      })) : [{ text: page.text }];
      return blocks.filter(block => block.text).map((block, index) => ({ ...block,
        chunk_id: `visual-p${page.page}-${index + 1}`, page_start: page.page, page_end: page.page,
        text_chars: block.text.length, source: sourceName, reader: 'fitz_text',
      }));
    });
    artifacts.push({
      name: pagesName,
      buffer: Buffer.from(pages.map((page) => JSON.stringify(page)).join('\n') + '\n'),
      artifactKind: 'pdf_preparse_artifact',
    });
    artifacts.push({
      name: chunksName,
      buffer: Buffer.from(chunks.map((chunk) => JSON.stringify(chunk)).join('\n') + '\n'),
      artifactKind: 'pdf_preparse_artifact',
    });
    artifacts.push({
      name: manifestName,
      buffer: Buffer.from(
        JSON.stringify(
          {
            source: sourceName,
            route: 'vision_fallback',
            fallback_reason: /^[a-z_0-9:-]{1,120}$/.test(fallbackReason) ? fallbackReason : 'mineru_parse_failed',
            parser_engine: 'fitz',
            document_page_count: rendered.documentPageCount,
            page_count: rendered.documentPageCount,
            quality: pages.filter(p => p.text).length === rendered.documentPageCount ? 'text_available' : 'partial_text',
            indexed_pages: pages.length,
            text_pages: pages.filter(p => p.text).length,
            visual_batch_size: 20,
            logical_batch_pages: 20,
            dpi: SANSUO_PDF_VISION_FALLBACK_DPI,
            status: 'ready',
            visual_preparation: 'on_demand',
            pages: pagesName,
            chunks: chunksName,
          },
          null,
          2,
        ),
      ),
      artifactKind: 'pdf_preparse_artifact',
    });
    return {
      artifacts,
      pages: pages.length,
      images: pages.filter(page => page.image_name).length,
      chunks: chunks.length,
      cleanup: rendered.cleanup,
    };
  } catch (error) {
    await rendered.cleanup();
    throw error;
  }
}

async function persistSanSuoPdfArtifacts({
  req,
  artifacts,
  sourceFiles,
  conversationId,
  messageId,
  toolCallId,
}) {
  const strategy = getStrategyFunctions(FileSources.execute_code);
  if (!strategy?.handleFileUpload)
    throw new Error('code environment storage strategy is unavailable');
  const saved = [];
  for (const artifact of artifacts) {
    try {
      const uploaded = await strategy.handleFileUpload({
        req,
        stream: artifact.filePath
          ? fs.createReadStream(artifact.filePath)
          : Readable.from(artifact.buffer),
        filename: artifact.name,
        kind: 'user',
        id: req.user.id,
      });
      const record = await recordSanSuoHiddenCodeOutput({
        req,
        id: uploaded.file_id,
        name: artifact.name,
        toolCallId: toolCallId || 'sansuo-pdf-preparse-' + Date.now(),
        conversationId,
        messageId,
        session_id: uploaded.storage_session_id,
        sourceFiles,
        artifactKind: artifact.artifactKind,
        recommendedReader: artifact.artifactKind === 'pdf_extracted_image' ? 'vision' : 'backend',
        reusable: true,
        visibility: 'tool',
      });
      if (record) saved.push(artifact.name);
    } catch (error) {
      logger.warn('[SanSuoPdfPreparse] artifact persistence failed', {
        filename: artifact.name,
        error: error?.message || String(error),
      });
    }
  }
  return saved;
}

async function ensureSanSuoPdfPageArtifacts({
  req,
  sourceFile,
  conversationId,
  messageId,
  pages = [],
  region,
}) {
  const signal = req?._sansuoModelSignal;
  signal?.throwIfAborted();
  const requestedPages = Array.from(
    new Set(pages.map(Number).filter((page) => Number.isInteger(page) && page > 0)),
  )
    .sort((left, right) => left - right)
    .slice(0, 20);
  const sourceRef = sourceFile?.metadata?.codeEnvRef || sourceFile?.codeEnvRef || {};
  const storageSessionId = sourceRef.storage_session_id || sourceFile?.storage_session_id;
  const storageFileId = sourceRef.file_id || sourceFile?.storage_file_id;
  const rootFileId = sourceFile?.file_id || sourceFile?.libreFileId;
  if (
    !req?.user?.id ||
    !conversationId ||
    !rootFileId ||
    !storageSessionId ||
    !storageFileId ||
    !requestedPages.length
  ) {
    return [];
  }
  const strategy = getStrategyFunctions(FileSources.execute_code);
  if (!strategy?.getDownloadStream || !strategy?.handleFileUpload) {
    throw new Error('code environment storage strategy is unavailable');
  }
  const startedAt = Date.now();
  const downloaded = await strategy.getDownloadStream(
    `${storageSessionId}/${storageFileId}`,
    { kind: 'user', id: req.user.id },
    req,
  );
  const sourceBuffer = await streamToBuffer(downloaded?.data || downloaded);
  const expectedSourceHash = sourceFile?.metadata?.sha256 || sourceFile?.metadata?.contentHash;
  const actualSourceHash = crypto.createHash('sha256').update(sourceBuffer).digest('hex');
  if (expectedSourceHash && actualSourceHash !== expectedSourceHash) {
    throw new Error('DOCUMENT_VERSION_MISMATCH');
  }
  signal?.throwIfAborted();
  const rendered = await renderSanSuoPdfPages(sourceBuffer, requestedPages, { signal, region,
    dpi: region ? 240 : SANSUO_PDF_VISION_FALLBACK_DPI });
  const sourceName = String(sourceFile.filename || sourceFile.name || 'document.pdf').replace(
    /[^\w.\-\u3400-\u9fff ]+/g,
    '_',
  );
  const prefixName = `${sourceName.replace(/\.pdf$/i, '')}_preparse`;
  const sourceFiles = [
    {
      file_id: rootFileId,
      filename: sourceName,
      metadata: {
        sha256: actualSourceHash,
        codeEnvRef: {
          kind: sourceRef.kind || 'user',
          storage_session_id: storageSessionId,
          file_id: storageFileId,
        },
      },
    },
  ];
  const records = [];
  try {
    for (const page of rendered.pages) {
      signal?.throwIfAborted();
      const regionId = region ? `_region_${crypto.createHash('sha256').update(JSON.stringify(region)).digest('hex').slice(0, 12)}` : '';
      const name = `${prefixName}${regionId}_review_page_${String(page.page).padStart(4, '0')}.png`;
      const pageBuffer = await fsp.readFile(path.join(rendered.outputDir, page.image_name));
      const imageSha256 = crypto.createHash('sha256').update(pageBuffer).digest('hex');
      const uploaded = await strategy.handleFileUpload({
        req,
        stream: Readable.from(pageBuffer),
        filename: name,
        kind: 'user',
        id: req.user.id,
      });
      const record = await recordSanSuoHiddenCodeOutput({
        req,
        id: uploaded.file_id,
        name,
        toolCallId: `sansuo-pdf-page-review-${rootFileId}-${page.page}`,
        artifactMetadata: { imageSha256, physicalPage: page.page, renderer: 'fitz', dpi: page.dpi,
          rendererVersion: page.renderer_version, region: region || null,
          resolutionLimited: page.resolution_limited, imageWidth: page.width, imageHeight: page.height },
        conversationId,
        messageId,
        session_id: uploaded.storage_session_id,
        sourceFiles,
        artifactKind: 'pdf_extracted_image',
        recommendedReader: 'vision',
        reusable: true,
        visibility: 'tool',
      });
      if (record) records.push(record);
    }
  } finally {
    await rendered.cleanup();
  }
  logSanSuoFileTiming({
    traceId: `pdf-page-review-${String(rootFileId)}`,
    fileType: 'pdf',
    stage: 'page_render_on_demand',
    status: records.length === requestedPages.length ? 'success' : 'partial',
    elapsedMs: Date.now() - startedAt,
    requestedPages,
    renderedPages: records.length,
    sourceBytes: sourceBuffer.length,
  });
  return records;
}

async function ensureSanSuoPdfVisualFallback({ req, sourceFile, conversationId, messageId }) {
  const sourceRef = sourceFile?.metadata?.codeEnvRef || sourceFile?.codeEnvRef || {};
  const storageSessionId = sourceRef.storage_session_id || sourceFile?.storage_session_id;
  const storageFileId = sourceRef.file_id || sourceFile?.storage_file_id;
  const rootFileId = sourceFile?.file_id || sourceFile?.libreFileId;
  if (!req?.user?.id || !conversationId || !rootFileId || !storageSessionId || !storageFileId) {
    throw new Error('pdf_visual_fallback_source_unavailable');
  }
  const strategy = getStrategyFunctions(FileSources.execute_code);
  if (!strategy?.getDownloadStream) {
    throw new Error('code environment storage strategy is unavailable');
  }
  const startedAt = Date.now();
  const downloaded = await strategy.getDownloadStream(
    `${storageSessionId}/${storageFileId}`,
    { kind: 'user', id: req.user.id },
    req,
  );
  const sourceBuffer = await streamToBuffer(downloaded?.data || downloaded);
  const sourceName = String(sourceFile.filename || sourceFile.name || 'document.pdf').replace(
    /[^\w.\-\u3400-\u9fff ]+/g,
    '_',
  );
  const prefixName = `${sourceName.replace(/\.pdf$/i, '')}_preparse`;
  const sourceFiles = [
    {
      file_id: rootFileId,
      filename: sourceName,
      metadata: {
        codeEnvRef: {
          kind: sourceRef.kind || 'user',
          storage_session_id: storageSessionId,
          file_id: storageFileId,
        },
      },
    },
  ];
  const fallback = await buildSanSuoPdfVisionFallbackArtifacts(
    sourceBuffer,
    sourceName,
    prefixName,
  );
  try {
    const saved = await persistSanSuoPdfArtifacts({
      req,
      artifacts: fallback.artifacts,
      sourceFiles,
      conversationId,
      messageId,
      toolCallId: `sansuo-pdf-server-fallback-${rootFileId}`,
    });
    logSanSuoFileTiming({
      traceId: `pdf-server-fallback-${String(rootFileId)}`,
      fileType: 'pdf',
      stage: 'server_visual_fallback',
      status: saved.length > 0 ? 'success' : 'failed',
      elapsedMs: Date.now() - startedAt,
      sourceBytes: sourceBuffer.length,
      pages: fallback.pages,
      chunks: fallback.chunks,
      artifacts: saved.length,
    });
    return { saved, pages: fallback.pages, chunks: fallback.chunks };
  } finally {
    await fallback.cleanup();
  }
}

function streamToBuffer(stream) {
  if (Buffer.isBuffer(stream)) {
    return Promise.resolve(stream);
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

function getMammothElementText(element) {
  if (!element) {
    return '';
  }
  if (element.type === 'text') {
    return String(element.value || '');
  }
  if (element.type === 'tab') {
    return '\t';
  }
  return (element.children || []).map(getMammothElementText).join('');
}

function getMammothDescendants(element, type, output = []) {
  if (!element) {
    return output;
  }
  if (element.type === type) {
    output.push(element);
  }
  for (const child of element.children || []) {
    getMammothDescendants(child, type, output);
  }
  return output;
}

function getDocxImageExtension(contentType = '') {
  const normalized = String(contentType).toLowerCase();
  const known = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/bmp': '.bmp',
    'image/tiff': '.tiff',
    'image/svg+xml': '.svg',
  };
  return known[normalized] || '.bin';
}

function findNearestDocxText(blocks, index, direction) {
  const step = direction === 'before' ? -1 : 1;
  for (let cursor = index + step; cursor >= 0 && cursor < blocks.length; cursor += step) {
    const block = blocks[cursor];
    if (block?.type === 'text' && block.text) {
      return block.text;
    }
  }
  return null;
}

async function buildSanSuoDocxArtifacts(docxBuffer, sourceName, prefixName) {
  const blocks = [];
  const extractedImages = [];
  let paragraphIndex = 0;
  let textChars = 0;
  let imageIndex = 0;
  let tableIndex = 0;

  const transformDocument = (document) => {
    const visit = (element, tableContext = null) => {
      if (element?.type === 'paragraph') {
        paragraphIndex += 1;
        const text = getMammothElementText(element);
        if (text) {
          blocks.push({
            type: 'text',
            paragraph_index: paragraphIndex,
            style_id: element.styleId || null,
            style_name: element.styleName || null,
            heading_level: (() => {
              const match = String(element.styleName || element.styleId || '').match(
                /(?:heading|标题)\s*([1-6])/i,
              );
              return match ? Number(match[1]) : null;
            })(),
            ...(tableContext || {}),
            text,
            text_chars: text.length,
          });
          textChars += text.length;
        }
        for (const image of getMammothDescendants(element, 'image')) {
          imageIndex += 1;
          image.__sansuoImageInfo = {
            image_index: imageIndex,
            paragraph_index: paragraphIndex,
            ...(tableContext || {}),
            content_type: image.contentType || 'application/octet-stream',
          };
          blocks.push({
            type: 'image',
            image_index: imageIndex,
            paragraph_index: paragraphIndex,
            ...(tableContext || {}),
            content_type: image.contentType || 'application/octet-stream',
          });
        }
        return;
      }
      if (element?.type === 'table') {
        tableIndex += 1;
        for (const [rowIndex, row] of (element.children || []).entries()) {
          for (const [cellIndex, cell] of (row.children || []).entries()) {
            for (const child of cell.children || []) {
              visit(child, {
                table_index: tableIndex,
                row_index: rowIndex + 1,
                cell_index: cellIndex + 1,
              });
            }
          }
        }
        return;
      }
      for (const child of element?.children || []) {
        visit(child, tableContext);
      }
    };
    visit(document);
    return document;
  };

  await mammoth.convertToHtml(
    { buffer: docxBuffer },
    {
      transformDocument,
      convertImage: mammoth.images.imgElement(async (image) => {
        const info = image.__sansuoImageInfo || {
          image_index: extractedImages.length + 1,
          paragraph_index: null,
          content_type: image.contentType || 'application/octet-stream',
        };
        const buffer = await image.readAsBuffer();
        extractedImages.push({ ...info, buffer });
        return { src: `sansuo-docx-image-${info.image_index}` };
      }),
    },
  );

  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (block.type !== 'image') {
      continue;
    }
    const image = extractedImages.find((entry) => entry.image_index === block.image_index);
    const extension = getDocxImageExtension(image?.content_type || block.content_type);
    const outputName = `${prefixName}_docx_image_${String(block.image_index).padStart(4, '0')}${extension}`;
    block.original_name = outputName;
    block.extracted_path = outputName;
    block.persistent_export = outputName;
    block.size = image?.buffer?.length || 0;
    block.before_text = findNearestDocxText(blocks, index, 'before');
    block.after_text = findNearestDocxText(blocks, index, 'after');
    if (image) {
      image.name = outputName;
    }
  }

  const blocksName = `${prefixName}_docx_blocks.jsonl`;
  const manifestName = `${prefixName}_docx_manifest.json`;
  const readingPackName = `${prefixName}_docx_reading_pack.md`;
  const imageBlocks = blocks.filter((block) => block.type === 'image');
  const manifest = {
    source: sourceName,
    text_chars: textChars,
    text_complete: true,
    image_count: imageBlocks.length,
    blocks: blocksName,
    assets_dir: `${prefixName}_docx_assets`,
    images: imageBlocks,
    usage: [
      'Use text blocks for normal summary and Q&A.',
      'Use extracted image files with the VL model only when the user asks about visual content.',
      'Image positions are paragraph-level anchors with before_text and after_text context.',
    ],
  };
  const readingLines = [
    `# DOCX Reading Pack: ${sourceName}`,
    '',
    `- Text chars: ${manifest.text_chars}`,
    `- Embedded images: ${manifest.image_count}`,
    `- Blocks: \`${blocksName}\``,
    `- Manifest: \`${manifestName}\``,
    '',
    '## Reading Order Preview',
  ];
  let textSeen = 0;
  for (const block of blocks) {
    if (block.type === 'text' && block.text && textSeen < 40) {
      textSeen += 1;
      readingLines.push('', `### Paragraph ${block.paragraph_index}`, block.text);
    } else if (block.type === 'image') {
      readingLines.push(
        '',
        `### Image ${block.image_index} near paragraph ${block.paragraph_index}`,
        `- Extracted: \`${block.persistent_export}\``,
        `- Before: ${block.before_text || '(none)'}`,
        `- After: ${block.after_text || '(none)'}`,
      );
    }
  }

  return [
    {
      name: blocksName,
      buffer: Buffer.from(
        blocks.map((block) => JSON.stringify(block)).join('\n') + (blocks.length ? '\n' : ''),
        'utf8',
      ),
      artifactKind: 'docx_preparse_artifact',
      recommendedReader: 'read_file_auto',
    },
    {
      name: manifestName,
      buffer: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
      artifactKind: 'docx_preparse_artifact',
      recommendedReader: 'read_file_auto',
    },
    {
      name: readingPackName,
      buffer: Buffer.from(readingLines.join('\n'), 'utf8'),
      artifactKind: 'docx_preparse_artifact',
      recommendedReader: 'read_file_auto',
    },
    ...extractedImages
      .filter((image) => image.name && image.buffer?.length)
      .map((image) => ({
        name: image.name,
        buffer: image.buffer,
        artifactKind: 'docx_extracted_image',
        recommendedReader: 'vision',
      })),
  ];
}

function normalizeSanSuoParseExtension(filename = '') {
  return path.extname(String(filename || '')).toLowerCase();
}

function getSanSuoParseKind(mimeType = '', filename = '') {
  const mime = String(mimeType || '').toLowerCase();
  const ext = normalizeSanSuoParseExtension(filename);
  if (mime === 'application/pdf' || ext === '.pdf') {
    return 'pdf';
  }
  if (mime === DOCX_MIME || ext === '.docx') {
    return 'docx';
  }
  if (DOC_MIMES.has(mime) || ext === '.doc') {
    return 'doc';
  }
  if (mime === XLSX_MIME || mime === XLS_MIME || ['.xlsx', '.xls'].includes(ext)) {
    return 'spreadsheet';
  }
  if (CSV_MIMES.has(mime) || ext === '.csv') {
    return 'csv';
  }
  if (TEXT_MIMES.has(mime) || ['.md', '.markdown', '.txt'].includes(ext)) {
    return ext === '.md' || ext === '.markdown' || MARKDOWN_MIMES.has(mime) ? 'markdown' : 'text';
  }
  return null;
}

function isSanSuoPreparseMime(mimeType = '', filename = '') {
  return getSanSuoParseKind(mimeType, filename) != null;
}

function decodeSanSuoTextBuffer(buffer) {
  const withoutBom =
    buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf
      ? buffer.subarray(3)
      : buffer;
  const utf8 = withoutBom.toString('utf8');
  const replacementCount = (utf8.match(/\uFFFD/g) || []).length;
  if (replacementCount <= Math.max(1, Math.floor(utf8.length * 0.002))) {
    return { text: utf8, encoding: 'utf8' };
  }
  return { text: iconv.decode(withoutBom, 'gb18030'), encoding: 'gb18030' };
}

function buildSanSuoTextArtifacts(buffer, sourceName, prefixName, maxChars = 200000) {
  const decoded = decodeSanSuoTextBuffer(buffer);
  const normalized = decoded.text.replace(/\r\n?/g, '\n').slice(0, maxChars);
  const chunks = [];
  const chunkSize = 4000;
  for (let start = 0; start < normalized.length; start += chunkSize) {
    chunks.push({
      type: 'text',
      chunk_index: chunks.length + 1,
      start,
      end: Math.min(start + chunkSize, normalized.length),
      text: normalized.slice(start, start + chunkSize),
    });
  }
  const blocksName = `${prefixName}_text_blocks.jsonl`;
  const manifestName = `${prefixName}_text_manifest.json`;
  const readingPackName = `${prefixName}_text_reading_pack.md`;
  const manifest = {
    source: sourceName,
    encoding: decoded.encoding,
    original_bytes: buffer.length,
    text_chars: normalized.length,
    truncated: decoded.text.length > normalized.length,
    chunks: chunks.length,
    blocks: blocksName,
  };
  return [
    {
      name: blocksName,
      buffer: Buffer.from(chunks.map((chunk) => JSON.stringify(chunk)).join('\n') + '\n'),
    },
    { name: manifestName, buffer: Buffer.from(JSON.stringify(manifest, null, 2)) },
    {
      name: readingPackName,
      buffer: Buffer.from(`# Text Reading Pack: ${sourceName}\n\n${normalized}`, 'utf8'),
    },
  ].map((artifact) => ({
    ...artifact,
    artifactKind: 'text_preparse_artifact',
    recommendedReader: 'read_file_auto',
  }));
}

function buildSanSuoTabularArtifacts(buffer, sourceName, prefixName, parseKind) {
  const workbook = XLSX.read(parseKind === 'csv' ? buffer.toString('utf8') : buffer, {
    type: parseKind === 'csv' ? 'string' : 'buffer',
    cellDates: true,
    cellFormula: true,
    dense: false,
  });
  const rows = [];
  const sheets = [];
  const readingLines = [`# Tabular Reading Pack: ${sourceName}`, ''];
  let textChars = 0;
  const maxChars = 160000;
  const maxRowsPerSheet = 1000;
  const maxColumns = 100;
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const range = sheet?.['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;
    const totalRows = range ? range.e.r - range.s.r + 1 : 0;
    const totalColumns = range ? range.e.c - range.s.c + 1 : 0;
    const limitedRange = range
      ? {
          s: range.s,
          e: {
            r: Math.min(range.e.r, range.s.r + maxRowsPerSheet - 1),
            c: Math.min(range.e.c, range.s.c + maxColumns - 1),
          },
        }
      : undefined;
    const values = limitedRange
      ? XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          defval: null,
          raw: false,
          blankrows: false,
          range: XLSX.utils.encode_range(limitedRange),
        })
      : [];
    let formulaCount = 0;
    if (range) {
      for (let row = limitedRange.s.r; row <= limitedRange.e.r; row++) {
        for (let column = limitedRange.s.c; column <= limitedRange.e.c; column++) {
          if (sheet[XLSX.utils.encode_cell({ r: row, c: column })]?.f) {
            formulaCount += 1;
          }
        }
      }
    }
    const sheetSummary = {
      name: sheetName,
      rows: totalRows,
      columns: totalColumns,
      parsed_rows: values.length,
      parsed_columns: Math.min(totalColumns, maxColumns),
      formula_count_in_parsed_range: formulaCount,
      truncated: totalRows > maxRowsPerSheet || totalColumns > maxColumns,
    };
    sheets.push(sheetSummary);
    readingLines.push(
      `## Sheet: ${sheetName}`,
      `- Rows: ${totalRows}`,
      `- Columns: ${totalColumns}`,
      `- Parsed rows: ${values.length}`,
      '',
    );
    for (let index = 0; index < values.length && textChars < maxChars; index++) {
      const cells = values[index].slice(0, maxColumns);
      const row = { sheet: sheetName, row: index + 1, cells };
      const serialized = JSON.stringify(row);
      if (textChars + serialized.length > maxChars) {
        break;
      }
      rows.push(row);
      textChars += serialized.length;
      if (index < 80) {
        readingLines.push(
          `- Row ${index + 1}: ${cells.map((cell) => String(cell ?? '')).join(' | ')}`,
        );
      }
    }
    readingLines.push('');
  }
  const rowsName = `${prefixName}_tabular_rows.jsonl`;
  const manifestName = `${prefixName}_tabular_manifest.json`;
  const readingPackName = `${prefixName}_tabular_reading_pack.md`;
  const manifest = {
    source: sourceName,
    format: parseKind,
    sheet_count: workbook.SheetNames.length,
    sheets,
    persisted_rows: rows.length,
    rows_file: rowsName,
  };
  return [
    {
      name: rowsName,
      buffer: Buffer.from(rows.map((row) => JSON.stringify(row)).join('\n') + '\n'),
    },
    { name: manifestName, buffer: Buffer.from(JSON.stringify(manifest, null, 2)) },
    { name: readingPackName, buffer: Buffer.from(readingLines.join('\n'), 'utf8') },
  ].map((artifact) => ({
    ...artifact,
    artifactKind: 'tabular_preparse_artifact',
    recommendedReader: 'read_file_auto',
  }));
}

function buildSanSuoMineruArtifacts(payload, sourceName, identity = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('invalid_mineru_response');
  }
  const prefix = sourceName.replace(/\.pdf$/i, '') + '_preparse';
  const md =
    [payload.md_content, payload.markdown, payload.md].find((value) => typeof value === 'string') ||
    '';
  let contentList = payload.content_list || [];
  if (typeof contentList === 'string') {
    try {
      contentList = JSON.parse(contentList);
    } catch {
      throw new Error('invalid_mineru_content_list');
    }
  }
  if (!Array.isArray(contentList)) throw new Error('invalid_mineru_content_list');
  // A known local mock placeholder is a failed parse, never document evidence.
  // Let the existing real FITZ fallback run; this does not change the MinerU service.
  if (contentList.some((item) => item?.note === 'local_mineru_mock_no_ocr')) {
    throw new Error('mineru_placeholder_content');
  }

  const textOf = (item) => {
    if (typeof item === 'string') return item.trim();
    if (!item || typeof item !== 'object') return '';
    const values = [
      'text',
      'content',
      'md',
      'markdown',
      'table_body',
      'html',
      'captions',
      'image_caption',
      'footnotes',
    ]
      .flatMap((key) => (Array.isArray(item[key]) ? item[key] : [item[key]]))
      .filter((value) => typeof value === 'string' && value.trim());
    return [...new Set(values)].join('\n\n');
  };
  const pageOf = (item) => {
    const page =
      item?.page ??
      item?.page_no ??
      item?.page_number ??
      (item?.page_idx != null ? Number(item.page_idx) + 1 : null);
    return page != null && Number.isInteger(Number(page)) && Number(page) > 0 ? Number(page) : null;
  };
  const chunks = [];
  const appendChunks = (text, page = null) => {
    for (let start = 0; start < text.length; ) {
      const end = Math.min(text.length, start + 4500);
      const part = text.slice(start, end).trim();
      if (part)
        chunks.push({
          chunk_id: 'mineru-' + (chunks.length + 1),
          text: part,
          text_chars: part.length,
          source: sourceName,
          ...(page != null ? { page_start: page, page_end: page } : {}),
        });
      if (end === text.length) break;
      start = end - 350;
    }
  };
  const structure = require('./mineruStructure').buildMineruStructure(payload, contentList, sourceName, identity);
  chunks.push(...structure.chunks);
  const contentText = contentList.map(textOf).filter(Boolean).join('\n\n');
  const markdown = md.trim() || contentText;
  if (!markdown.trim()) throw new Error('empty_mineru_content');
  if (!chunks.length || chunks.reduce((sum, c) => sum + c.text.length, 0) < markdown.length * 0.5) {
    // Legacy sparse lists cannot provide trustworthy page locations for all Markdown.
    // Retain blocks separately, and index the authoritative text once with unknown pages.
    chunks.length = 0;
    appendChunks(markdown);
    structure.warnings = ['SPARSE_CONTENT_LIST_MARKDOWN_FALLBACK'];
  }
  const artifacts = [];
  const add = (name, value) =>
    artifacts.push({
      name,
      buffer: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value), 'utf8'),
      artifactKind: 'pdf_preparse_artifact',
    });
  add(prefix + '_mineru.md', markdown);
  add(
    prefix + '_mineru_chunks.jsonl',
    chunks.map((chunk) => JSON.stringify(chunk)).join('\n') + '\n',
  );
  add(prefix + '_mineru_content_list.json', contentList);
  add(prefix + '_mineru_result.json', payload);
  add(prefix + '_mineru_blocks.json', { ...structure, chunks: undefined });
  if (payload.rawArchive) artifacts.push({ name: prefix + '_mineru_original.zip', buffer: payload.rawArchive, artifactKind: 'pdf_parse_original_archive' });
  add(prefix + '_mineru_provenance.json', { ...payload.provenance, source_sha256: structure.source_sha256, output_files: payload.output_files || [], main_artifacts: payload.main_artifacts || null });
  const missingImages = [];
  const images = Array.isArray(payload.images)
    ? payload.images.map((image, index) => [
        image?.name || image?.filename || 'image_' + (index + 1) + '.png',
        image,
      ])
    : Object.entries(payload.images || {});
  for (const [originalName, value] of images) {
    const name = path.basename(String(originalName).replace(/\\/g, '/'));
    const encoded =
      typeof value === 'string' ? value : value?.base64 || value?.data || value?.content;
    const base64 =
      typeof encoded === 'string'
        ? encoded.replace(/^data:image\/[^;]+;base64,/, '').replace(/\s/g, '')
        : '';
    if (
      !/\.(png|jpe?g|webp|gif)$/i.test(name) ||
      !base64 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
    ) {
      missingImages.push(name);
      continue;
    }
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length) {
      missingImages.push(name);
      continue;
    }
    artifacts.push({
      name: prefix + '_mineru_images__' + structure.images.find(image => image.original_path === originalName)?.image_id + path.extname(name),
      artifactMetadata: { mineruImage: structure.images.find(image => image.original_path === originalName) },
      buffer,
      artifactKind: 'pdf_extracted_image',
    });
  }
  const pages = contentList.map(pageOf).filter((page) => page != null);
  const profile = {
    source: sourceName,
    parser: 'backend_mineru',
    is_mock: contentList.some((item) => /^local_mineru_mock_/.test(item?.note || '')),
    provider: contentList.some((item) => /^local_mineru_mock_/.test(item?.note || '')) ? 'local_pdftotext_mock' : 'mineru',
    page_count:
      Number(payload.page_count) ||
      (pages.length ? pages.reduce((max, page) => Math.max(max, page), 0) : null),
    page_count_source: payload.page_count ? (payload.page_count_source || 'mineru') : 'content_list_max_page',
  };
  add(prefix + '_profile.json', profile);
  add(prefix + '_smart_manifest.json', {
    source: sourceName,
    route: 'backend_mineru',
    profile,
    primary_result: {
      md_path: prefix + '_mineru.md',
      chunks_path: prefix + '_mineru_chunks.jsonl',
      content_list_path: prefix + '_mineru_content_list.json',
    },
    image_count: artifacts.filter((artifact) => artifact.artifactKind === 'pdf_extracted_image')
      .length,
    missing_images: missingImages,
    next_step:
      'The backend automatically retrieves persisted text and visual evidence for each question; do not expose a PDF read tool, execute code, or reparse.',
  });
  return { artifacts, missingImages };
}

async function preparseSanSuoPdfOnUpload({
  req,
  sourceFile,
  conversationId,
  messageId,
  toolCallId,
  traceId = getSanSuoFileTraceId(sourceFile),
}) {
  if (!sourceFile?.storage_session_id || !sourceFile?.file_id || !sourceFile?.filename) {
    return { status: 'skipped', reason: 'missing_code_env_ref', artifacts: [] };
  }
  const sourceName = String(sourceFile.filename).replace(/[^\w.\-\u3400-\u9fff ]+/g, '_');
  const totalStartedAt = Date.now();
  const sourceFiles = [
    {
      file_id: sourceFile.libreFileId || sourceFile.file_id,
      filename: sourceFile.filename,
      metadata: {
        codeEnvRef: {
          kind: 'user',
          storage_session_id: sourceFile.storage_session_id,
          file_id: sourceFile.file_id,
        },
      },
    },
  ];
  let sourceBuffer;
  try {
    const strategy = getStrategyFunctions(FileSources.execute_code);
    if (!strategy?.getDownloadStream || !strategy?.handleFileUpload) {
      throw new Error('code environment storage strategy is unavailable');
    }
    const downloadStartedAt = Date.now();
    const downloaded = await strategy.getDownloadStream(
      sourceFile.storage_session_id + '/' + sourceFile.file_id,
      { kind: 'user', id: req.user.id },
      req,
    );
    sourceBuffer = await streamToBuffer(downloaded?.data || downloaded);
    const sourceHash = crypto.createHash('sha256').update(sourceBuffer).digest('hex');
    sourceFiles[0].metadata.sha256 = sourceHash;
    // Bind derived records to the exact PDF bytes without changing either parser's execution.
    await updateFile({ file_id: sourceFile.libreFileId || sourceFile.file_id,
      'metadata.sha256': sourceHash }, { user: req.user.id });

    logSanSuoFileTiming({
      traceId,
      fileType: 'pdf',
      stage: 'source_download',
      status: 'success',
      elapsedMs: Date.now() - downloadStartedAt,
      sourceBytes: sourceBuffer.length,
    });
    const url =
      process.env.SANSUO_MINERU_PDF_PARSE_URL ||
      (process.env.SANSUO_MINERU_BASE_URL
        ? process.env.SANSUO_MINERU_BASE_URL.replace(/\/+$/, '') + '/pdf_parse'
        : '');
    const cloudMode = String(process.env.SANSUO_MINERU_MODE || '').toLowerCase() === 'cloud';
    if (isSanSuoPdfMineruFirst() && !url && !cloudMode) throw new Error('mineru_not_configured');
    if (isSanSuoPdfMineruFirst() && !cloudMode && !/^https?:$/.test(new URL(url).protocol)) {
      throw new Error('invalid_mineru_url');
    }
    if (!isSanSuoPdfMineruFirst()) throw new Error('mineru_disabled_by_config');
    const FormData = require('form-data');
    const form = new FormData();
    form.append('return_content_list', 'true');
    form.append('return_images', 'true');
    form.append('pdf_file', sourceBuffer, {
      filename: getSanSuoMineruUploadFilename(sourceFile),
      contentType: 'application/pdf',
    });
    const mineruStartedAt = Date.now();
    const timeoutMs = Math.max(1000, Math.min(SANSUO_DOCUMENT_PARSE_TIMEOUT_MS,
      Number(process.env.SANSUO_MINERU_TIMEOUT_MS) || SANSUO_DOCUMENT_PARSE_TIMEOUT_MS));
    const response = cloudMode ? { status: 200, data: await require('./mineruCloud').parseMineruCloud({
      axios, baseURL: process.env.SANSUO_MINERU_CLOUD_URL, apiKey: process.env.SANSUO_MINERU_CLOUD_API_KEY,
      sourceBuffer, filename: getSanSuoMineruUploadFilename(sourceFile), timeoutMs, signal: req._sansuoDocumentParseSignal,
    }) } : await axios({
      method: 'post',
      url,
      data: form,
      headers: { ...form.getHeaders(), Accept: 'application/json' },
      timeout: Math.max(
        1000,
        Math.min(
          SANSUO_DOCUMENT_PARSE_TIMEOUT_MS,
          Number(process.env.SANSUO_MINERU_TIMEOUT_MS) || SANSUO_DOCUMENT_PARSE_TIMEOUT_MS,
        ),
      ),
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      signal: req._sansuoDocumentParseSignal,
    });
    logSanSuoFileTiming({
      traceId,
      fileType: 'pdf',
      stage: 'mineru_request',
      status: 'success',
      elapsedMs: Date.now() - mineruStartedAt,
      httpStatus: response?.status || null,
    });
    if (!response?.data || typeof response.data !== 'object' || Array.isArray(response.data)) throw new Error('invalid_mineru_response');
    // Count physical pages independently; content_list maximum cannot prove completeness.
    const metadataDir = await fsp.mkdtemp('/tmp/sansuo-pdf-metadata-');
    try {
      const input = path.join(metadataDir, 'source.pdf');
      await fsp.writeFile(input, sourceBuffer);
      const { stdout } = await execFileAsync(process.env.SANSUO_PDF_RENDER_PYTHON || 'python3',
        [getSanSuoPdfVisionRenderScript(), '--input', input, '--output-dir', metadataDir, '--metadata-only'],
        { timeout: 30000, maxBuffer: 1024 * 1024 });
      response.data.page_count = JSON.parse(stdout).document_page_count;
      response.data.page_count_source = 'fitz_source_pdf';
    } catch {
      // Unknown completeness remains explicit; parsed evidence is still useful.
      response.data.page_count_warning = 'PHYSICAL_PAGE_COUNT_UNAVAILABLE';
    } finally { await fsp.rm(metadataDir, { recursive: true, force: true }); }
    const artifactBuildStartedAt = Date.now();
    const { artifacts, missingImages } = buildSanSuoMineruArtifacts(response?.data, sourceName, { sourceHash, documentId: sourceFiles[0].file_id });
    logSanSuoFileTiming({
      traceId,
      fileType: 'pdf',
      stage: 'artifact_build',
      status: 'success',
      elapsedMs: Date.now() - artifactBuildStartedAt,
      artifacts: artifacts.length,
      missingImages: missingImages.length,
    });
    // Persist sequentially to avoid buffering concurrent copies of a large response.
    const saved = [];
    const parseGeneration = crypto.randomUUID();
    const persistedImageMapping = [];
    const persistStartedAt = Date.now();
    for (const artifact of artifacts) {
      const commitManifest = /_smart_manifest\.json$/.test(artifact.name);
      if (commitManifest && (saved.length !== artifacts.length - 1 || missingImages.length)) continue;
      if (commitManifest) artifact.buffer = Buffer.from(JSON.stringify({ ...JSON.parse(artifact.buffer.toString('utf8')),
        parse_generation: parseGeneration, source_sha256: sourceHash, artifact_set_status: 'complete', image_artifacts: persistedImageMapping }));
      try {
        const uploaded = await strategy.handleFileUpload({
          req,
          stream: Readable.from(artifact.buffer),
          filename: artifact.name,
          kind: 'user',
          id: req.user.id,
        });
        const record = await recordSanSuoHiddenCodeOutput({
          req,
          id: uploaded.file_id,
          name: artifact.name,
          toolCallId: toolCallId || 'sansuo-pdf-preparse-' + Date.now(),
          conversationId,
          messageId,
          session_id: uploaded.storage_session_id,
          sourceFiles,
          artifactKind: artifact.artifactKind,
          artifactMetadata: { ...artifact.artifactMetadata, parseGeneration, ...(commitManifest ? { artifactSetStatus: 'complete' } : {}) },
          recommendedReader: artifact.artifactKind === 'pdf_extracted_image' ? 'vision' : 'backend',
          reusable: true,
          visibility: 'tool',
        });
        if (record) {
          saved.push(artifact.name);
          if (artifact.artifactMetadata?.mineruImage) persistedImageMapping.push({ ...artifact.artifactMetadata.mineruImage,
            image_artifact_id: record.libreFileId, storage_filename: artifact.name });
        }
      } catch {
        logger.warn('[SanSuoPdfPreparse] artifact persistence failed', { filename: artifact.name });
      }
    }
    logSanSuoFileTiming({
      traceId,
      fileType: 'pdf',
      stage: 'artifact_persist',
      status: saved.length === artifacts.length ? 'success' : 'partial',
      elapsedMs: Date.now() - persistStartedAt,
      artifacts: artifacts.length,
      saved: saved.length,
    });
    const readableArtifacts = saved.filter((name) => /_mineru(?:\.md|_chunks\.jsonl)$/.test(name));
    logger.info('[SanSuoPdfPreparse] upload preparse completed', {
      conversationId: conversationId || null,
      sourceFilename: sourceName,
      parser: 'backend_mineru',
      sourceBytes: sourceBuffer.length,
      artifacts: artifacts.length,
      saved: saved.length,
      readableArtifacts: readableArtifacts.length,
      missingImages: missingImages.length,
    });
    logSanSuoFileTiming({
      traceId,
      fileType: 'pdf',
      stage: 'preparse_total',
      status: readableArtifacts.length ? 'success' : 'failed',
      elapsedMs: Date.now() - totalStartedAt,
      artifacts: artifacts.length,
      saved: saved.length,
    });
    return {
      status: readableArtifacts.length && saved.length === artifacts.length && !missingImages.length ? 'ready' : 'failed',
      partial: readableArtifacts.length > 0 && (saved.length !== artifacts.length || missingImages.length > 0),
      ...(readableArtifacts.length ? (saved.length === artifacts.length && !missingImages.length ? {} : { reason: 'partial_artifact_persistence' }) : { reason: 'missing_readable_pdf_artifact' }),
      artifacts: saved,
      saved: saved.length,
      readableArtifacts,
      missingImages,
    };
  } catch (error) {
    const reason =
      error?.code === 'ECONNABORTED'
        ? 'mineru_timeout'
        : error?.response?.status
          ? 'mineru_http_' + error.response.status
          : error?.message || 'mineru_parse_failed';
    if (error?.diagnostics) logSanSuoFileTiming({ traceId, fileType: 'pdf', stage: 'mineru_failure', status: 'failed', ...error.diagnostics }, 'warn');
    if (isSanSuoPdfVisionFallbackEnabled() && sourceBuffer?.length) {
      try {
        const fallbackStartedAt = Date.now();
        const prefixName = `${sourceName.replace(/\.pdf$/i, '')}_preparse`;
        const fallback = await buildSanSuoPdfVisionFallbackArtifacts(
          sourceBuffer,
          sourceName,
          prefixName,
          reason,
        );
        let saved;
        try {
          saved = await persistSanSuoPdfArtifacts({
            req,
            artifacts: fallback.artifacts,
            sourceFiles,
            conversationId,
            messageId,
            toolCallId,
          });
        } finally {
          await fallback.cleanup();
        }
        const readableArtifacts = saved.filter((name) =>
          /_visual_(?:chunks\.jsonl|manifest\.json)$/.test(name),
        );
        const savedImages = saved.filter((name) => /_visual_page_\d+\.png$/i.test(name));
        const ready =
          readableArtifacts.some((name) => /_visual_manifest\.json$/i.test(name)) &&
          savedImages.length === fallback.images;
        logSanSuoFileTiming({
          traceId,
          fileType: 'pdf',
          stage: 'pdf_vision_fallback_total',
          status: ready ? 'success' : 'failed',
          elapsedMs: Date.now() - fallbackStartedAt,
          reason,
          pages: fallback.pages,
          chunks: fallback.chunks,
          artifacts: fallback.artifacts.length,
          saved: saved.length,
          savedImages: savedImages.length,
        });
        logger.info('[SanSuoPdfPreparse] vision fallback completed', {
          sourceFilename: sourceName,
          reason,
          pages: fallback.pages,
          chunks: fallback.chunks,
          artifacts: fallback.artifacts.length,
          saved: saved.length,
        });
        return {
          status: ready ? 'ready' : 'failed',
          reason: ready ? undefined : 'missing_visual_pdf_artifact',
          artifacts: saved,
          saved: saved.length,
          readableArtifacts,
          parser: 'backend_fitz_vision_fallback',
          fallbackReason: /^[a-z_0-9:-]{1,120}$/.test(reason) ? reason : 'mineru_parse_failed',
        };
      } catch (fallbackError) {
        logger.warn('[SanSuoPdfPreparse] vision fallback failed', {
          reason,
          error: fallbackError?.message || String(fallbackError),
        });
        return {
          status: 'failed',
          reason: `pdf_vision_fallback_failed:${fallbackError?.message || String(fallbackError)}`,
          artifacts: [],
        };
      }
    }
    logger.warn('[SanSuoPdfPreparse] upload preparse failed', { parser: 'backend_mineru', reason });
    logSanSuoFileTiming(
      {
        traceId,
        fileType: 'pdf',
        stage: 'preparse_total',
        status: 'failed',
        elapsedMs: Date.now() - totalStartedAt,
        error: reason,
      },
      'warn',
    );
    return { status: 'failed', reason, artifacts: [] };
  }
}

async function preparseSanSuoDocxOnUpload({
  req,
  sourceFile,
  conversationId,
  messageId,
  toolCallId,
  traceId = getSanSuoFileTraceId(sourceFile),
  sourceBufferOverride,
  sourceNameOverride,
}) {
  if (!sourceFile?.storage_session_id || !sourceFile?.file_id || !sourceFile?.filename) {
    return { status: 'skipped', reason: 'missing_code_env_ref', artifacts: [] };
  }

  const sourceName = String(sourceNameOverride || sourceFile.filename).replace(
    /[^\w.\-\u3400-\u9fff ]+/g,
    '_',
  );
  const totalStartedAt = Date.now();
  const prefixName = `${sourceName.replace(/\.docx$/i, '')}_preparse`;
  const sourceFiles = [
    {
      file_id: sourceFile.libreFileId || sourceFile.file_id,
      filename: sourceFile.filename,
      name: sourceFile.filename,
      type: DOCX_MIME,
      metadata: {
        codeEnvRef: {
          kind: 'user',
          storage_session_id: sourceFile.storage_session_id,
          file_id: sourceFile.file_id,
        },
      },
    },
  ];

  try {
    const strategy = getStrategyFunctions(FileSources.execute_code);
    if (!strategy?.getDownloadStream || !strategy?.handleFileUpload) {
      throw new Error('code environment storage strategy is unavailable');
    }
    const downloadStartedAt = Date.now();
    let sourceBuffer = sourceBufferOverride;
    if (!sourceBuffer) {
      const sourceResponse = await strategy.getDownloadStream(
        `${sourceFile.storage_session_id}/${sourceFile.file_id}`,
        { kind: 'user', id: req.user.id },
        req,
      );
      sourceBuffer = await streamToBuffer(sourceResponse?.data || sourceResponse);
    }
    logSanSuoFileTiming({
      traceId,
      fileType: 'docx',
      stage: 'source_download',
      status: 'success',
      elapsedMs: Date.now() - downloadStartedAt,
      sourceBytes: sourceBuffer.length,
    });
    const mammothStartedAt = Date.now();
    const artifacts = await buildSanSuoDocxArtifacts(sourceBuffer, sourceName, prefixName);
    logSanSuoFileTiming({
      traceId,
      fileType: 'docx',
      stage: 'mammoth_parse',
      status: 'success',
      elapsedMs: Date.now() - mammothStartedAt,
      artifacts: artifacts.length,
    });
    const persistStartedAt = Date.now();
    const persisted = await Promise.allSettled(
      artifacts.map(async (artifact) => {
        if (!DOCX_PREPARSE_ARTIFACT_RE.test(artifact.name)) {
          throw new Error(`unexpected DOCX preparse artifact: ${artifact.name}`);
        }
        const uploaded = await strategy.handleFileUpload({
          req,
          stream: Readable.from(artifact.buffer),
          filename: artifact.name,
          kind: 'user',
          id: req.user.id,
        });
        const recorded = await recordSanSuoHiddenCodeOutput({
          req,
          id: uploaded.file_id,
          name: artifact.name,
          toolCallId: toolCallId || `sansuo-docx-preparse-${Date.now()}`,
          conversationId,
          messageId,
          session_id: uploaded.storage_session_id,
          sourceFiles,
          artifactKind: artifact.artifactKind,
          artifactMetadata: artifact.artifactMetadata,
          recommendedReader: artifact.recommendedReader,
          reusable: true,
          visibility: 'tool',
        });
        if (!recorded) {
          throw new Error(`failed to record DOCX preparse artifact: ${artifact.name}`);
        }
        return artifact.name;
      }),
    );
    const artifactNames = persisted
      .filter((entry) => entry.status === 'fulfilled')
      .map((entry) => entry.value);
    const saved = artifactNames.length;
    logSanSuoFileTiming({
      traceId,
      fileType: 'docx',
      stage: 'artifact_persist',
      status: saved === artifacts.length ? 'success' : 'partial',
      elapsedMs: Date.now() - persistStartedAt,
      artifacts: artifacts.length,
      saved,
    });
    const requiredArtifactsReady = [
      `${prefixName}_docx_blocks.jsonl`,
      `${prefixName}_docx_manifest.json`,
      `${prefixName}_docx_reading_pack.md`,
    ].every((name) => artifactNames.includes(name));
    const missingArtifacts = artifacts
      .map((artifact) => artifact.name)
      .filter((name) => !artifactNames.includes(name));
    logger.info('[SanSuoDocxPreparse] upload preparse completed', {
      conversationId: conversationId || null,
      sourceFilename: sourceName,
      parser: 'backend_mammoth',
      sourceBytes: sourceBuffer.length,
      artifacts: artifacts.length,
      saved,
      missingArtifacts,
    });
    logSanSuoFileTiming({
      traceId,
      fileType: 'docx',
      stage: 'preparse_total',
      status: requiredArtifactsReady ? 'success' : 'failed',
      elapsedMs: Date.now() - totalStartedAt,
      artifacts: artifacts.length,
      saved,
    });
    if (missingArtifacts.length > 0) {
      logger.warn('[SanSuoDocxPreparse] optional DOCX image artifacts were not persisted', {
        conversationId: conversationId || null,
        sourceFilename: sourceName,
        missingArtifacts,
      });
    }
    return {
      // Text reading remains usable when an embedded OLE/Visio or other
      // unsupported image cannot be exported. Only the core reading pack is
      // required to gate the document request.
      status: requiredArtifactsReady ? 'ready' : 'failed',
      artifacts: artifactNames,
      saved,
      reason: requiredArtifactsReady ? undefined : 'missing_docx_reading_pack_or_image',
    };
  } catch (error) {
    logger.warn('[SanSuoDocxPreparse] upload preparse failed', {
      conversationId: conversationId || null,
      sourceFilename: sourceName,
      error: error?.message || String(error),
    });
    logSanSuoFileTiming(
      {
        traceId,
        fileType: 'docx',
        stage: 'preparse_total',
        status: 'failed',
        elapsedMs: Date.now() - totalStartedAt,
        error: error?.message || String(error),
      },
      'warn',
    );
    return { status: 'failed', reason: error?.message || String(error), artifacts: [] };
  }
}

async function convertSanSuoLegacyDocViaCodeApi({ req, sourceFile }) {
  const baseURL = getCodeBaseURL();
  if (!baseURL) {
    throw new Error('code environment is unavailable for legacy .doc conversion');
  }
  const inputName = String(sourceFile.filename || 'input.doc').replace(
    /[^\w.\-\u3400-\u9fff ]+/g,
    '_',
  );
  const outputName = `${path.basename(inputName, path.extname(inputName))}.docx`;
  const code = [
    'import pathlib, subprocess',
    `source = pathlib.Path('/mnt/data/${inputName}')`,
    `out = pathlib.Path('/mnt/data/${outputName}')`,
    "subprocess.run(['soffice', '--headless', '--convert-to', 'docx', '--outdir', '/mnt/data', str(source)], check=True, capture_output=True, text=True)",
    'print(out.name)',
  ].join('\n');
  const authHeaders = await getSafeCodeApiAuthHeaders(req);
  const response = await axios({
    method: 'post',
    url: `${baseURL}/exec`,
    data: {
      lang: 'py',
      code,
      files: [
        {
          id: sourceFile.file_id,
          file_id: sourceFile.file_id,
          name: inputName,
          filename: inputName,
          storage_session_id: sourceFile.storage_session_id,
          session_id: sourceFile.storage_session_id,
        },
      ],
      intent: { kind: 'file_conversion', allowGeneratedFiles: true },
    },
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'LibreChat/1.0', ...authHeaders },
    httpAgent: codeServerHttpAgent,
    httpsAgent: codeServerHttpsAgent,
    timeout: SANSUO_DOCUMENT_PARSE_TIMEOUT_MS,
  });
  const result = response?.data || {};
  if (result.stderr && !result.files?.length && !result.outputFiles?.length) {
    throw new Error(String(result.stderr).slice(0, 1000));
  }
  const converted = [
    ...(result.files || []),
    ...(result.outputFiles || []),
    ...(result.generatedFiles || []),
  ].find((file) => /\.docx$/i.test(String(file?.name || file?.filename || '')));
  if (!converted?.id && !converted?.file_id) {
    throw new Error('LibreOffice did not produce a converted .docx file');
  }
  const strategy = getStrategyFunctions(FileSources.execute_code);
  const convertedId = converted.id || converted.file_id;
  const convertedSession =
    converted.storage_session_id || converted.session_id || result.session_id;
  const convertedResponse = await strategy.getDownloadStream(
    `${convertedSession}/${convertedId}`,
    { kind: 'user', id: req.user.id },
    req,
  );
  return {
    buffer: await streamToBuffer(convertedResponse?.data || convertedResponse),
    filename: outputName,
  };
}

async function preparseSanSuoStructuredFileOnUpload({
  req,
  sourceFile,
  mimeType,
  conversationId,
  messageId,
  toolCallId,
}) {
  if (!sourceFile?.storage_session_id || !sourceFile?.file_id || !sourceFile?.filename) {
    return { status: 'skipped', reason: 'missing_code_env_ref', artifacts: [] };
  }
  const parseKind = getSanSuoParseKind(mimeType, sourceFile.filename);
  if (!['spreadsheet', 'csv', 'markdown', 'text'].includes(parseKind)) {
    return { status: 'skipped', reason: 'unsupported_parse_kind', artifacts: [] };
  }
  const sourceName = String(sourceFile.filename).replace(/[^\w.\-\u3400-\u9fff ]+/g, '_');
  const prefixName = `${sourceName.replace(/\.[^.]+$/i, '')}_preparse`;
  const sourceFiles = [
    {
      file_id: sourceFile.libreFileId || sourceFile.file_id,
      filename: sourceFile.filename,
      name: sourceFile.filename,
      type: mimeType,
      metadata: {
        codeEnvRef: {
          kind: 'user',
          storage_session_id: sourceFile.storage_session_id,
          file_id: sourceFile.file_id,
        },
      },
    },
  ];
  try {
    const strategy = getStrategyFunctions(FileSources.execute_code);
    if (!strategy?.getDownloadStream || !strategy?.handleFileUpload) {
      throw new Error('code environment storage strategy is unavailable');
    }
    const sourceResponse = await strategy.getDownloadStream(
      `${sourceFile.storage_session_id}/${sourceFile.file_id}`,
      { kind: 'user', id: req.user.id },
      req,
    );
    const sourceBuffer = await streamToBuffer(sourceResponse?.data || sourceResponse);
    const tabular = parseKind === 'spreadsheet' || parseKind === 'csv';
    const parseBuffer =
      parseKind === 'csv'
        ? Buffer.from(decodeSanSuoTextBuffer(sourceBuffer).text, 'utf8')
        : sourceBuffer;
    const artifacts = tabular
      ? buildSanSuoTabularArtifacts(parseBuffer, sourceName, prefixName, parseKind)
      : buildSanSuoTextArtifacts(sourceBuffer, sourceName, prefixName);
    const expectedPattern = tabular ? TABULAR_PREPARSE_ARTIFACT_RE : TEXT_PREPARSE_ARTIFACT_RE;
    const persisted = await Promise.allSettled(
      artifacts.map(async (artifact) => {
        if (!expectedPattern.test(artifact.name)) {
          throw new Error(`unexpected ${parseKind} preparse artifact: ${artifact.name}`);
        }
        const uploaded = await strategy.handleFileUpload({
          req,
          stream: Readable.from(artifact.buffer),
          filename: artifact.name,
          kind: 'user',
          id: req.user.id,
        });
        const recorded = await recordSanSuoHiddenCodeOutput({
          req,
          id: uploaded.file_id,
          name: artifact.name,
          toolCallId: toolCallId || `sansuo-${parseKind}-preparse-${Date.now()}`,
          conversationId,
          messageId,
          session_id: uploaded.storage_session_id,
          sourceFiles,
          artifactKind: artifact.artifactKind,
          artifactMetadata: artifact.artifactMetadata,
          recommendedReader: artifact.recommendedReader,
          reusable: true,
          visibility: 'tool',
        });
        if (!recorded) {
          throw new Error(`failed to record ${parseKind} preparse artifact: ${artifact.name}`);
        }
        return artifact.name;
      }),
    );
    const artifactNames = persisted
      .filter((entry) => entry.status === 'fulfilled')
      .map((entry) => entry.value);
    const ready = artifactNames.length === artifacts.length && artifacts.length === 3;
    logger.info('[SanSuoStructuredPreparse] upload preparse completed', {
      conversationId: conversationId || null,
      sourceFilename: sourceName,
      parser: tabular ? 'backend_sheetjs' : 'backend_text',
      parseKind,
      sourceBytes: sourceBuffer.length,
      artifacts: artifacts.length,
      saved: artifactNames.length,
    });
    return {
      status: ready ? 'ready' : 'failed',
      artifacts: artifactNames,
      saved: artifactNames.length,
      reason: ready ? undefined : `missing_${parseKind}_reading_artifact`,
    };
  } catch (error) {
    logger.warn('[SanSuoStructuredPreparse] upload preparse failed', {
      conversationId: conversationId || null,
      sourceFilename: sourceName,
      parseKind,
      error: error?.message || String(error),
    });
    return { status: 'failed', reason: error?.message || String(error), artifacts: [] };
  }
}

async function runSanSuoDocumentParseJob(job, req) {
  const jobId = String(job?._id || '');
  if (!jobId) {
    return null;
  }
  if (activeDocumentParses.has(jobId)) {
    return activeDocumentParses.get(jobId);
  }

  const execution = (async () => {
    const claimStartedAt = Date.now();
    const claimed = await claimSanSuoFileParseJob({
      jobId,
      leaseMs: SANSUO_DOCUMENT_PARSE_TIMEOUT_MS + 30000,
      maxAttempts: SANSUO_DOCUMENT_PARSE_MAX_ATTEMPTS,
    });
    if (!claimed) {
      return null;
    }
    const traceId = getSanSuoFileTraceId({
      libreFileId: claimed.libreFileId,
      file_id: claimed.sourceRef?.file_id,
    });
    const parseKind = getSanSuoParseKind(claimed.mimeType, claimed.filename);
    const jobStartedAt = Date.now();
    const createdAtMs = new Date(claimed.createdAt || job?.createdAt || 0).getTime();
    logSanSuoFileTiming({
      traceId,
      fileType: parseKind,
      stage: 'job_claim',
      status: 'success',
      elapsedMs: Date.now() - claimStartedAt,
      queueWaitMs:
        Number.isFinite(createdAtMs) && createdAtMs > 0 ? Date.now() - createdAtMs : null,
      attempt: claimed.attempts,
    });
    const sourceFile = {
      libreFileId: claimed.libreFileId,
      filename: claimed.filename,
      file_id: claimed.sourceRef?.file_id,
      storage_session_id: claimed.sourceRef?.storage_session_id,
    };
    let result;
    try {
      if (parseKind === 'pdf') {
        result = await preparseSanSuoPdfOnUpload({
          req,
          sourceFile,
          conversationId: claimed.conversationId,
          messageId: claimed.messageId,
          toolCallId: `sansuo-file-preparse-${claimed.libreFileId}`,
          traceId,
        });
      } else if (parseKind === 'docx' || parseKind === 'doc') {
        let sourceBufferOverride;
        let sourceNameOverride;
        if (parseKind === 'doc') {
          const converted = await convertSanSuoLegacyDocViaCodeApi({ req, sourceFile });
          sourceBufferOverride = converted.buffer;
          sourceNameOverride = converted.filename;
        }
        result = await preparseSanSuoDocxOnUpload({
          req,
          sourceFile,
          conversationId: claimed.conversationId,
          messageId: claimed.messageId,
          toolCallId: `sansuo-file-preparse-${claimed.libreFileId}`,
          traceId,
          sourceBufferOverride,
          sourceNameOverride,
        });
      } else {
        result = await preparseSanSuoStructuredFileOnUpload({
          req,
          sourceFile,
          mimeType: claimed.mimeType,
          conversationId: claimed.conversationId,
          messageId: claimed.messageId,
          toolCallId: `sansuo-file-preparse-${claimed.libreFileId}`,
        });
      }
      const ready = result?.status === 'ready';
      const finished = await finishSanSuoFileParseJob({
        jobId,
        status: ready ? 'ready' : 'failed',
        artifacts: result?.artifacts || [],
        errorCode: ready ? undefined : 'parser_failed',
        errorMessage: ready ? undefined : result?.reason || '文件解析未生成完整阅读包',
      });
      logSanSuoFileTiming({
        traceId,
        fileType: parseKind,
        stage: 'parse_job_total',
        status: ready ? 'success' : 'failed',
        elapsedMs: Date.now() - jobStartedAt,
        artifacts: result?.artifacts?.length || 0,
        attempt: claimed.attempts,
      });
      return finished;
    } catch (error) {
      await finishSanSuoFileParseJob({
        jobId,
        status: 'failed',
        errorCode: error?.name === 'AbortError' ? 'aborted' : 'parser_error',
        errorMessage: error?.message || String(error),
      });
      logSanSuoFileTiming(
        {
          traceId,
          fileType: parseKind,
          stage: 'parse_job_total',
          status: 'failed',
          elapsedMs: Date.now() - jobStartedAt,
          attempt: claimed.attempts,
          error: error?.message || String(error),
        },
        'warn',
      );
      throw error;
    }
  })().finally(() => {
    activeDocumentParses.delete(jobId);
  });
  activeDocumentParses.set(jobId, execution);
  return execution;
}

async function enqueueSanSuoDocumentPreparse({
  req,
  sourceFile,
  mimeType,
  conversationId,
  messageId,
}) {
  if (!isSanSuoPreparseMime(mimeType, sourceFile?.filename)) {
    return { status: 'skipped', parserVersion: SANSUO_DOCUMENT_PARSE_VERSION };
  }
  const job = await upsertSanSuoFileParseJob({
    userId: req?.user?.id,
    tenantId: req?.user?.tenantId,
    libreFileId: sourceFile?.libreFileId,
    parserVersion: SANSUO_DOCUMENT_PARSE_VERSION,
    conversationId,
    messageId,
    filename: sourceFile?.filename,
    mimeType,
    sourceRef: {
      storage_session_id: sourceFile?.storage_session_id,
      file_id: sourceFile?.file_id,
    },
  });
  setImmediate(() => {
    runSanSuoDocumentParseJob(job, req).catch((error) => {
      logger.warn('[SanSuoDocumentPreparse] background parse failed', {
        fileId: job.libreFileId,
        filename: job.filename,
        error: error?.message || String(error),
      });
    });
  });
  return {
    status: job.status,
    parserVersion: job.parserVersion,
    attempts: job.attempts,
  };
}

async function ensureSanSuoDocumentParseJobs({ req, fileIds = [], conversationId, messageId }) {
  const safeFileIds = Array.from(new Set(fileIds.filter(Boolean).map(String))).slice(0, 20);
  if (!req?.user?.id || safeFileIds.length === 0) {
    return [];
  }
  const existing = await getSanSuoFileParseJobs({
    userId: req.user.id,
    libreFileId: { $in: safeFileIds },
    parserVersion: SANSUO_DOCUMENT_PARSE_VERSION,
  });
  const existingIds = new Set(existing.map((job) => job.libreFileId));
  const missingIds = safeFileIds.filter((fileId) => !existingIds.has(fileId));
  if (missingIds.length === 0) {
    return existing;
  }
  const files = await getFiles({ file_id: { $in: missingIds }, user: req.user.id }, null, {
    text: 0,
  });
  for (const file of files || []) {
    const ref = file?.metadata?.codeEnvRef;
    if (
      !isSanSuoPreparseMime(file?.type, file?.filename) ||
      !ref?.storage_session_id ||
      !ref?.file_id
    ) {
      continue;
    }
    const job = await upsertSanSuoFileParseJob({
      userId: req.user.id,
      tenantId: req.user.tenantId,
      libreFileId: file.file_id,
      parserVersion: SANSUO_DOCUMENT_PARSE_VERSION,
      conversationId,
      messageId,
      filename: file.filename,
      mimeType: file.type,
      sourceRef: ref,
    });
    existing.push(job);
  }
  return existing;
}

function waitForParsePoll(signal, delayMs = 300) {
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    if (!signal) {
      return;
    }
    function abort() {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      const error = new Error('文件解析等待已取消');
      error.name = 'AbortError';
      reject(error);
    }
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function waitForSanSuoDocumentPreparse({
  req,
  fileIds = [],
  conversationId,
  messageId,
  signal,
}) {
  const gateStartedAt = Date.now();
  const gateTraceId = messageId ? `message-${String(messageId)}` : `gate-${Date.now()}`;
  let jobs = await ensureSanSuoDocumentParseJobs({
    req,
    fileIds,
    conversationId,
    messageId,
  });
  if (jobs.length === 0) {
    logSanSuoFileTiming({
      traceId: gateTraceId,
      fileType: 'document',
      stage: 'deep_gate_wait',
      status: 'skipped',
      elapsedMs: Date.now() - gateStartedAt,
      files: 0,
    });
    return { required: false, status: 'skipped', files: 0, artifacts: 0 };
  }

  const deadline = Date.now() + SANSUO_DOCUMENT_PARSE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    for (const job of jobs) {
      if (job.status === 'pending' || job.status === 'failed') {
        runSanSuoDocumentParseJob(job, req).catch((error) => {
          logger.warn('[SanSuoDocumentPreparse] parse attempt failed while waiting', {
            fileId: job.libreFileId,
            error: error?.message || String(error),
          });
        });
      }
    }
    if (jobs.every((job) => job.status === 'ready')) {
      logSanSuoFileTiming({
        traceId: gateTraceId,
        fileType: 'document',
        stage: 'deep_gate_wait',
        status: 'success',
        elapsedMs: Date.now() - gateStartedAt,
        files: jobs.length,
        fileIds: jobs.map((job) => String(job.libreFileId || '')).filter(Boolean),
        artifacts: jobs.reduce((sum, job) => sum + Number(job.artifactCount || 0), 0),
      });
      return {
        required: true,
        status: 'ready',
        files: jobs.length,
        artifacts: jobs.reduce((sum, job) => sum + Number(job.artifactCount || 0), 0),
      };
    }
    const exhausted = jobs.find(
      (job) => job.status === 'failed' && job.attempts >= SANSUO_DOCUMENT_PARSE_MAX_ATTEMPTS,
    );
    if (exhausted) {
      logSanSuoFileTiming(
        {
          traceId: gateTraceId,
          fileType: getSanSuoParseKind(exhausted.mimeType, exhausted.filename),
          stage: 'deep_gate_wait',
          status: 'failed',
          elapsedMs: Date.now() - gateStartedAt,
          files: jobs.length,
          error: exhausted.errorMessage || '未生成可读取内容',
        },
        'warn',
      );
      throw new Error(
        `文件“${exhausted.filename}”解析失败：${exhausted.errorMessage || '未生成可读取内容'}`,
      );
    }
    await waitForParsePoll(signal);
    jobs = await getSanSuoFileParseJobs({
      userId: req.user.id,
      libreFileId: { $in: jobs.map((job) => job.libreFileId) },
      parserVersion: SANSUO_DOCUMENT_PARSE_VERSION,
    });
  }
  logSanSuoFileTiming(
    {
      traceId: gateTraceId,
      fileType: 'document',
      stage: 'deep_gate_wait',
      status: 'timeout',
      elapsedMs: Date.now() - gateStartedAt,
      files: jobs.length,
      fileIds: jobs.map((job) => String(job.libreFileId || '')).filter(Boolean),
    },
    'warn',
  );
  throw new Error('文件解析超时，请稍后重试');
}

async function getSafeCodeApiAuthHeaders(req) {
  if (typeof getCodeApiAuthHeaders === 'function') {
    return getCodeApiAuthHeaders(req);
  }
  const apiKey = process.env.LIBRECHAT_CODE_API_KEY || process.env.CODE_API_KEY;
  return {
    ...(apiKey ? { 'X-API-Key': apiKey } : {}),
    ...(req?.user?.id ? { 'User-Id': String(req.user.id) } : {}),
    ...(req?.user?.tenantId ? { 'X-Tenant-Id': String(req.user.tenantId) } : {}),
  };
}

function safeBuildCodeEnvDownloadQuery(identity = {}) {
  if (typeof buildCodeEnvDownloadQuery === 'function') {
    return buildCodeEnvDownloadQuery(identity);
  }
  const params = new URLSearchParams();
  if (identity.kind) {
    params.set('kind', identity.kind);
  }
  if (identity.id) {
    params.set('id', String(identity.id));
  }
  if (identity.version != null) {
    params.set('version', String(identity.version));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

function shortHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 8);
}

function sanitizeArtifactSegment(segment, rawPath) {
  const normalized = String(segment || '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, '_')
    .replace(/[<>:"\\|?*]/g, '_')
    .trim();
  const safe = normalized || '_';
  if (safe === '.' || safe === '..') {
    return `_${shortHash(rawPath)}`;
  }
  const maxSegmentLength = 120;
  if (safe.length <= maxSegmentLength) {
    return safe;
  }
  const ext = path.extname(safe);
  const stem = safe.slice(0, safe.length - ext.length);
  const suffix = `-${shortHash(safe)}`;
  return `${stem.slice(0, maxSegmentLength - ext.length - suffix.length)}${suffix}${ext}`;
}

function fallbackSanitizeArtifactPath(inputName = '') {
  const raw = String(inputName || '_').replace(/\\/g, '/');
  const parts = raw
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .map((part) => sanitizeArtifactSegment(part, raw));
  return parts.length > 0 ? parts.join('/') : '_';
}

function fallbackFlattenArtifactPath(safePath = '', maxLength) {
  const flat = String(safePath || '_').replace(/[\\/]+/g, '__');
  if (maxLength == null || flat.length <= maxLength) {
    return flat;
  }
  if (maxLength <= 0) {
    return '';
  }
  const ext = path.extname(flat);
  const suffix = `-${shortHash(flat)}`;
  const budget = Math.max(0, maxLength - suffix.length - ext.length);
  return `${flat.slice(0, budget)}${suffix}${ext}`.slice(0, maxLength);
}

function safeSanitizeArtifactPath(name) {
  if (typeof sanitizeArtifactPath === 'function') {
    return sanitizeArtifactPath(name);
  }
  return fallbackSanitizeArtifactPath(name);
}

function safeFlattenArtifactPath(safePath, maxLength) {
  if (typeof flattenArtifactPath === 'function') {
    return flattenArtifactPath(safePath, maxLength);
  }
  return fallbackFlattenArtifactPath(safePath, maxLength);
}

function safeClassifyCodeArtifact(name = '', mimeType = '') {
  if (typeof classifyCodeArtifact === 'function') {
    return classifyCodeArtifact(name, mimeType);
  }
  const lowerName = String(name).toLowerCase();
  const lowerMime = String(mimeType).toLowerCase();
  if (
    lowerMime.startsWith('text/') ||
    [
      '.txt',
      '.md',
      '.csv',
      '.json',
      '.log',
      '.py',
      '.js',
      '.ts',
      '.tsx',
      '.jsx',
      '.html',
      '.css',
      '.xml',
      '.yaml',
      '.yml',
    ].some((ext) => lowerName.endsWith(ext))
  ) {
    return 'utf8-text';
  }
  if (
    lowerMime === 'application/pdf' ||
    ['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.odt', '.ods'].some((ext) =>
      lowerName.endsWith(ext),
    )
  ) {
    return 'document';
  }
  return 'other';
}

async function safeExtractCodeArtifactText(buffer, name, mimeType, category) {
  if (typeof extractCodeArtifactText === 'function') {
    return extractCodeArtifactText(buffer, name, mimeType, category);
  }
  if (category !== 'utf8-text') {
    return null;
  }
  try {
    return buffer.toString('utf8');
  } catch {
    return null;
  }
}

function safeGetExtractedTextFormat(name, mimeType, text) {
  if (typeof getExtractedTextFormat === 'function') {
    return getExtractedTextFormat(name, mimeType, text);
  }
  return text == null ? null : 'text';
}

function safeGetStorageMetadata(params = {}) {
  if (typeof getStorageMetadata === 'function') {
    return getStorageMetadata(params);
  }
  const { source, storageKey, storageRegion } = params;
  if (source !== FileSources.s3 && source !== FileSources.cloudfront) {
    return {};
  }
  return {
    ...(storageKey ? { storageKey } : {}),
    ...(storageRegion ? { storageRegion } : {}),
  };
}

function safeHasOfficeHtmlPath(name, mimeType) {
  if (typeof hasOfficeHtmlPath === 'function') {
    return hasOfficeHtmlPath(name, mimeType);
  }
  const lowerName = String(name || '').toLowerCase();
  const lowerMime = String(mimeType || '').toLowerCase();
  return (
    ['.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.ods', '.odt'].some((ext) =>
      lowerName.endsWith(ext),
    ) ||
    lowerMime.includes('spreadsheet') ||
    lowerMime.includes('presentation') ||
    lowerMime.includes('wordprocessing')
  );
}

async function safeUpsertSanSuoOutputRecord({
  req,
  file,
  originalName,
  codeEnvRef,
  toolCallId,
  messageId,
}) {
  try {
    await upsertSanSuoFileRecord({
      userId: req.user.id,
      tenantId: req.user.tenantId,
      conversationId: file.conversationId,
      messageId,
      toolCallId,
      role: 'output',
      source: 'sandbox',
      originalFilename: originalName || file.filename,
      displayFilename: file.filename,
      mimeType: file.type,
      size: file.bytes,
      libreFileId: file.file_id,
      libreFilepath: file.filepath,
      sandboxSessionId: codeEnvRef?.storage_session_id,
      sandboxFileId: codeEnvRef?.file_id,
      sandboxPath: `/mnt/data/${file.filename}`,
      status: 'ready',
      artifactType: 'deliverable',
      retentionPolicy: 'retain',
      lastAccessedAt: new Date(),
      gcState: 'active',
      metadata: {
        context: file.context,
        source: file.source,
        codeEnvRef,
        visibility: 'user',
        reusable: true,
        followupReadable: true,
        artifactKind: 'deliverable',
      },
    });
  } catch (error) {
    logger.warn('[SanSuoFileGateway] Failed to upsert sandbox output mapping:', error);
  }
}

function buildSanSuoHiddenDerivedFrom(files = []) {
  return (Array.isArray(files) ? files : [])
    .map((file) => ({
      file_id: file?.file_id || file?.id || null,
      filename: file?.filename || file?.name || null,
      sandbox_file_id: file?.metadata?.codeEnvRef?.file_id || file?.sandbox_file_id || null,
      sandbox_session_id:
        file?.metadata?.codeEnvRef?.storage_session_id || file?.sandbox_session_id || null,
    }))
    .filter((file) => file.file_id || file.filename);
}

function inferSanSuoIntermediateKind(filename = '') {
  const normalized = String(filename || '')
    .replace(/\\/g, '/')
    .replace(/\//g, '__')
    .toLowerCase();
  if (/(^|__)[^/]+_smart_manifest\.json$/.test(normalized)) {
    return 'pdf_smart_manifest';
  }
  if (/(^|__)[^/]+_mineru_chunks\.jsonl$/.test(normalized)) {
    return 'pdf_mineru_chunks';
  }
  if (/(^|__)[^/]+_mineru_content_list\.json$/.test(normalized)) {
    return 'pdf_mineru_content_list';
  }
  if (/(^|__)[^/]+_mineru_result\.json$/.test(normalized)) {
    return 'pdf_mineru_result';
  }
  if (/(^|__)[^/]+_mineru\.md$/.test(normalized)) {
    return 'pdf_mineru_markdown';
  }
  if (/(^|__)[^/]+_chunks\.jsonl$/.test(normalized)) {
    return 'pdf_chunks';
  }
  if (/(^|__)[^/]+_pages\.jsonl$/.test(normalized)) {
    return 'pdf_pages';
  }
  if (/(^|__)[^/]+_profile\.json$/.test(normalized)) {
    return 'pdf_profile';
  }
  if (/(^|__)[^/]+_reading_pack\.md$/.test(normalized)) {
    return 'pdf_reading_pack';
  }
  if (/(^|__)[^/]+_docx_blocks\.jsonl$/.test(normalized)) {
    return 'docx_blocks';
  }
  if (/(^|__)[^/]+_docx_manifest\.json$/.test(normalized)) {
    return 'docx_manifest';
  }
  if (/(^|__)[^/]+_docx_reading_pack\.md$/.test(normalized)) {
    return 'docx_reading_pack';
  }
  if (normalized.includes('_docx_assets__')) {
    return 'docx_asset';
  }
  if (/(^|__)[^/]+_raw_response\.txt$/.test(normalized)) {
    return 'raw_response';
  }
  return 'internal_reading_artifact';
}

function inferSanSuoIntermediateReader(filename = '') {
  const kind = inferSanSuoIntermediateKind(filename);
  return [
    'pdf_smart_manifest',
    'pdf_mineru_chunks',
    'pdf_mineru_content_list',
    'pdf_chunks',
  ].includes(kind)
    ? 'backend'
    : 'read_file_auto';
}

function getSanSuoHiddenArtifactKind(filename = '') {
  const lowerName = String(filename || '').toLowerCase();
  if (/_smart_manifest\.json$/i.test(lowerName)) {
    return 'pdf_smart_manifest';
  }
  if (/_mineru_chunks\.jsonl$/i.test(lowerName)) {
    return 'pdf_mineru_chunks';
  }
  if (/_mineru_content_list\.json$/i.test(lowerName)) {
    return 'pdf_mineru_content_list';
  }
  if (/_mineru_result\.json$/i.test(lowerName)) {
    return 'pdf_mineru_result';
  }
  if (/_mineru\.md$/i.test(lowerName)) {
    return 'pdf_mineru_markdown';
  }
  if (/_chunks\.jsonl$/i.test(lowerName)) {
    return 'pdf_chunks';
  }
  if (/_pages\.jsonl$/i.test(lowerName)) {
    return 'pdf_pages';
  }
  if (/_profile\.json$/i.test(lowerName)) {
    return 'pdf_profile';
  }
  if (/_reading_pack\.md$/i.test(lowerName)) {
    return 'pdf_reading_pack';
  }
  if (/_docx_(blocks\.jsonl|manifest\.json|reading_pack\.md)$/i.test(lowerName)) {
    return 'docx_reading_pack';
  }
  if (/_raw_response\.txt$/i.test(lowerName)) {
    return 'raw_response';
  }
  return 'intermediate';
}

function getSanSuoHiddenArtifactPriority(kind = '') {
  switch (kind) {
    case 'pdf_smart_manifest':
      return 1;
    case 'pdf_mineru_chunks':
    case 'pdf_mineru_content_list':
    case 'pdf_chunks':
      return 2;
    case 'pdf_mineru_markdown':
    case 'pdf_mineru_result':
    case 'pdf_pages':
    case 'pdf_reading_pack':
      return 3;
    case 'pdf_profile':
      return 4;
    default:
      return 9;
  }
}

function isSanSuoPdfArtifactKind(kind = '') {
  return String(kind || '').startsWith('pdf_');
}

function isSanSuoPdfLikeFile(file = {}) {
  const name = String(file?.filename || file?.name || '').toLowerCase();
  const mimeType = String(file?.mimeType || file?.type || '').toLowerCase();
  return name.endsWith('.pdf') || mimeType === 'application/pdf';
}

function resolveSanSuoRootSourceInfo(file = {}) {
  const metadata = file?.metadata || {};
  if (metadata.rootSourceFileId || metadata.rootSourceFilename) {
    return {
      file_id: metadata.rootSourceFileId || null,
      filename: metadata.rootSourceFilename || null,
      sandbox_file_id: metadata.rootSourceSandboxFileId || null,
      sandbox_session_id: metadata.rootSourceSandboxSessionId || null,
      mime_type: metadata.rootSourceMimeType || null,
    };
  }
  return {
    file_id: file?.file_id || file?.id || null,
    filename: file?.filename || file?.name || null,
    sandbox_file_id: file?.metadata?.codeEnvRef?.file_id || file?.sandbox_file_id || null,
    sandbox_session_id:
      file?.metadata?.codeEnvRef?.storage_session_id || file?.sandbox_session_id || null,
    mime_type: file?.mimeType || file?.type || null,
  };
}

function getSanSuoPrimarySourceInfo(sourceFiles = [], artifactKind = '') {
  const files = Array.isArray(sourceFiles) ? sourceFiles : [];
  if (files.length === 0) {
    return null;
  }

  const preferredPdf = isSanSuoPdfArtifactKind(artifactKind)
    ? files.find((file) => isSanSuoPdfLikeFile(file)) || null
    : null;
  const candidate = preferredPdf || files[0];
  return candidate ? resolveSanSuoRootSourceInfo(candidate) : null;
}

async function recordSanSuoHiddenCodeOutput({
  req,
  id,
  name,
  toolCallId,
  conversationId,
  messageId,
  session_id,
  sourceFiles = [],
  artifactKind,
  artifactMetadata = {},
  recommendedReader,
  reusable = true,
  visibility = 'tool',
}) {
  if (!req?.user?.id || !id || !name || !session_id) {
    return null;
  }

  const safeName = safeSanitizeArtifactPath(name);
  const derivedFrom = buildSanSuoHiddenDerivedFrom(sourceFiles);
  const resolvedArtifactKind = artifactKind || getSanSuoHiddenArtifactKind(safeName);
  const followupPriority = getSanSuoHiddenArtifactPriority(resolvedArtifactKind);
  const rootSource = getSanSuoPrimarySourceInfo(sourceFiles, resolvedArtifactKind);
  const syntheticLibreFileId = `sansuo_hidden__${session_id}__${id}`;
  const codeEnvRef = {
    kind: 'user',
    id: req.user.id,
    storage_session_id: session_id,
    file_id: id,
  };

  try {
    await upsertSanSuoFileRecord({
      userId: req.user.id,
      tenantId: req.user.tenantId,
      conversationId,
      messageId,
      toolCallId,
      role: 'output',
      source: 'sandbox',
      originalFilename: name,
      displayFilename: safeName,
      mimeType: inferMimeType(safeName, '') || 'application/octet-stream',
      libreFileId: syntheticLibreFileId,
      sandboxSessionId: session_id,
      sandboxFileId: id,
      sandboxPath: `/mnt/data/${safeName}`,
      status: 'ready',
      artifactType: 'derived',
      parentArtifactId: rootSource?.file_id || undefined,
      rootArtifactId: sourceFiles.find((file) => file?.file_id)?.file_id || undefined,
      retentionPolicy: 'retain_with_source',
      lastAccessedAt: new Date(),
      gcState: 'active',
      metadata: {
        ...artifactMetadata,
        isIntermediate: true,
        visibility,
        reusable: reusable !== false,
        followupReadable: reusable !== false,
        recommendedReader: recommendedReader || inferSanSuoIntermediateReader(safeName),
        context: FileContext.execute_code,
        source: 'codeapi_hidden_intermediate',
        codeEnvRef,
        derivedFrom,
        artifactKind: resolvedArtifactKind,
        followupPriority,
        preferredForFollowup: followupPriority <= 2,
        rootSourceFileId: rootSource?.file_id || null,
        rootSourceLibreFileId: sourceFiles.find((file) => file?.file_id)?.file_id || null,
        sourceHash: sourceFiles.find((file) => file?.file_id)?.metadata?.sha256 || null,
        rootSourceFilename: rootSource?.filename || null,
        rootSourceSandboxFileId: rootSource?.sandbox_file_id || null,
        rootSourceSandboxSessionId: rootSource?.sandbox_session_id || null,
        rootSourceMimeType: rootSource?.mime_type || null,
        description:
          '内部 PDF/文档阅读缓存，可用于后续追问直接读取 manifest/json/chunks，不作为最终附件展示。',
      },
    });
    logger.info('[SanSuoPdfChain] recorded hidden intermediate code output', {
      conversationId,
      messageId,
      toolCallId,
      filename: safeName,
      artifactKind: resolvedArtifactKind,
      followupPriority,
      sandbox_session_id: session_id,
      sandbox_file_id: id,
      rootSourceFilename: rootSource?.filename || null,
      derivedFrom: derivedFrom
        .map((file) => file?.filename)
        .filter(Boolean)
        .slice(0, 10),
    });
    return {
      hidden: true,
      intermediate: true,
      libreFileId: syntheticLibreFileId,
      displayFilename: safeName,
      originalFilename: name,
      sandboxSessionId: session_id,
      sandboxFileId: id,
      metadata: { ...artifactMetadata, rootSourceLibreFileId: sourceFiles.find(file => file?.file_id)?.file_id || null,
        sourceHash: sourceFiles.find(file => file?.file_id)?.metadata?.sha256 || null, artifactKind: resolvedArtifactKind, codeEnvRef },
      filename: safeName,
      sandbox_session_id: session_id,
      sandbox_file_id: id,
      artifactKind: artifactKind || inferSanSuoIntermediateKind(safeName),
      recommendedReader: recommendedReader || inferSanSuoIntermediateReader(safeName),
    };
  } catch (error) {
    logger.warn('[SanSuoFileGateway] Failed to record hidden sandbox output mapping:', error);
    return null;
  }
}

/**
 * Creates a fallback download URL response when file cannot be processed locally.
 * Used when: file exceeds size limit, storage strategy unavailable, or download error occurs.
 * @param {Object} params - The parameters.
 * @param {string} params.name - The filename.
 * @param {string} params.session_id - The code execution session ID.
 * @param {string} params.id - The file ID from the code environment.
 * @param {string} params.conversationId - The current conversation ID.
 * @param {string} params.toolCallId - The tool call ID that generated the file.
 * @param {string} params.messageId - The current message ID.
 * @param {number} params.expiresAt - Expiration timestamp (24 hours from creation).
 * @returns {Object} Fallback response with download URL.
 */
const createDownloadFallback = ({
  id,
  name,
  messageId,
  expiresAt,
  session_id,
  toolCallId,
  conversationId,
}) => {
  const basePath = getBasePath();
  return {
    filename: name,
    filepath: `${basePath}/api/files/code/download/${session_id}/${id}`,
    expiresAt,
    conversationId,
    toolCallId,
    messageId,
  };
};

/**
 * Hard ceiling on the deferred preview rendering (HTML extraction + DB
 * update). The inner office-render path already has its own 12s timeout
 * and a concurrency-limited queue; this is the outer guard that catches
 * pathological cases where queue wait + render + DB write would
 * otherwise hang the file in `status: 'pending'` indefinitely.
 *
 * If the timeout fires the record is updated to `status: 'failed'`
 * with `previewError: 'timeout'` and the UI shows download-only.
 */
const PREVIEW_FINALIZE_TIMEOUT_MS = 60_000;

/**
 * Render the inline HTML preview for a code-execution file (or plain
 * text for non-office buckets that still benefit from caching), then
 * atomically transition the DB record to `status: 'ready'` (with
 * `text`/`textFormat`) or `status: 'failed'` (with `previewError`).
 *
 * Decoupled from `processCodeOutput` so the agent's final response is
 * not blocked on potentially slow office rendering. The caller fires
 * this without awaiting; promises continue running after the HTTP
 * response closes (Node doesn't kill them) and the frontend learns of
 * completion via the `attachment` update SSE event (if the stream is
 * still open) or via React Query polling otherwise. Process restart
 * is the only thing that can lose progress — covered by the boot-time
 * orphan sweep.
 *
 * @param {object} params
 * @param {Buffer} params.buffer - The full downloaded file contents,
 *   bounded by the server's `fileSizeLimit` config (defaults far above
 *   the 1MB extractor cap). The buffer is captured by the closure
 *   returned in `{ finalize }`, so when many office files queue behind
 *   the inner concurrency limiter (cap 2), all queued buffers stay
 *   resident until each one's slot frees. For a tool result emitting
 *   N office files, peak heap usage from this path is up to
 *   `N * fileSizeLimit`. Acceptable for typical agent runs (a handful
 *   of files at a few hundred KB each); pathological cases are bounded
 *   by the inner per-file 12s timeout and the outer 60s render cap.
 * @param {string} params.leafName - Basename for classification.
 * @param {string} params.mimeType - Detected/inferred MIME.
 * @param {string} params.category - Classifier output.
 * @param {string} params.file_id - The DB record key for the update.
 * @param {string} [params.previewRevision] - Generation marker stamped
 *   by the immediate persist step. The DB commit is conditional on
 *   this — if a newer emit (cross-turn filename reuse) has rotated
 *   the revision before this render finishes, `updateFile` returns
 *   null and the stale render is silently discarded rather than
 *   overwriting the newer record.
 * @returns {Promise<MongoFile | null>} The post-update record on
 *   success; `null` if the DB update itself failed (extraction failure
 *   is reflected as `status: 'failed'`, not a thrown error) or if the
 *   `previewRevision` guard rejected the write.
 */
const finalizePreview = async ({
  buffer,
  leafName,
  mimeType,
  category,
  file_id,
  previewRevision,
}) => {
  let text = null;
  let previewError;
  try {
    text = await withTimeout(
      safeExtractCodeArtifactText(buffer, leafName, mimeType, category),
      PREVIEW_FINALIZE_TIMEOUT_MS,
      `Preview extraction exceeded ${PREVIEW_FINALIZE_TIMEOUT_MS}ms`,
    );
  } catch (_error) {
    /* `extractCodeArtifactText` swallows its own errors and returns null,
     * so the only way to reach here is a `withTimeout` rejection — i.e.
     * the queue + render combined exceeded the outer 60s ceiling. */
    previewError = 'timeout';
    logger.warn(
      `[finalizePreview] ${file_id}: extraction timed out after ${PREVIEW_FINALIZE_TIMEOUT_MS}ms`,
    );
  }
  /* HTML-or-null contract (PR #12934): null result on an office file
   * must NOT fall back to plain text — surface as failed. Caller gates
   * on `hasOfficeHtmlPath`, so reaching here always means office. */
  const textFormat = safeGetExtractedTextFormat(leafName, mimeType, text);
  const failed = text == null;
  const status = failed ? 'failed' : 'ready';
  if (failed && !previewError) {
    previewError = 'parser-error';
  }
  try {
    /* Conditional update: commit only if `previewRevision` still
     * matches what the immediate persist step stamped. If a newer
     * emit has rotated the revision (cross-turn filename reuse),
     * `updateFile` returns null and the stale render is silently
     * discarded. (Codex P1 review on PR #12957.) */
    const updated = await updateFile(
      {
        file_id,
        text,
        textFormat,
        status,
        previewError: failed ? previewError : null,
      },
      previewRevision ? { previewRevision } : undefined,
    );
    if (!updated && previewRevision) {
      logger.debug(
        `[finalizePreview] ${file_id}: stale render skipped — newer emit has superseded revision ${previewRevision}`,
      );
    }
    return updated;
  } catch (error) {
    logger.error(
      `[finalizePreview] ${file_id}: failed to persist preview result: ${error?.message ?? error}`,
    );
    return null;
  }
};

/**
 * Run the background `finalize` thunk returned by `processCodeOutput`
 * and route the resolved record to the caller's emit logic. Shared
 * between `callbacks.js` (chat-completions + Open Responses) and
 * `tools.js` (direct tool endpoint) so the fire-and-forget pattern
 * doesn't drift across callsites.
 *
 * `onResolved` receives the post-update DB record and is the only piece
 * that varies — chat-completions writes the legacy `attachment` SSE
 * event, Open Responses writes the spec-shaped `librechat:attachment`
 * event with a sequence number, and the direct tool endpoint has no
 * stream to write to (caller passes a no-op).
 *
 * The catch path is the safety net for unexpected programming errors
 * inside `finalizePreview` ONLY. The function is designed to never
 * throw (extraction and DB failures are translated to `status: 'failed'`
 * inside it), but a ref error or future regression would otherwise
 * leave the DB record stuck at `'pending'` until the boot-time orphan
 * sweep — potentially hours away on a stable server. We attempt a
 * best-effort `updateFile` to mark the record `'failed'` with
 * `previewError: 'unexpected'` so the UI stops polling and the
 * next-turn LLM context surfaces the failure.
 *
 * `onResolved` errors are deliberately isolated in their own try/catch.
 * Without that isolation, a transient transport-side failure (SSE write
 * race after the stream closed, an emitter listener throwing) would
 * propagate into the finalize catch and downgrade an *already-resolved*
 * record to `failed` with `previewError: 'unexpected'` — surfacing
 * "preview unavailable" in the UI even though extraction succeeded
 * and the file is on disk. The emit failure is logged but the DB
 * record stays at whatever `finalizePreview` wrote (typically
 * `'ready'`), so the polling layer / next page load still sees the
 * resolved preview.
 *
 * @param {object} params
 * @param {(() => Promise<object | null>) | undefined} params.finalize - The
 *   thunk returned by `processCodeOutput`. No-op when undefined.
 * @param {string | undefined} params.fileId - DB key for the failure
 *   marker; if absent the catch only logs.
 * @param {string | undefined} [params.previewRevision] - Generation
 *   marker stamped by the immediate persist step. The defensive
 *   `updateFile` in the catch is conditional on this — if a newer
 *   emit has rotated the revision, the stale failure marker is
 *   silently discarded so a programming error from an older render
 *   doesn't override a newer turn's record.
 * @param {(updated: object) => void} [params.onResolved] - Called once
 *   on success with the post-update record.
 */
const runPreviewFinalize = ({ finalize, fileId, previewRevision, onResolved }) => {
  if (typeof finalize !== 'function') {
    return;
  }
  finalize()
    .then((updated) => {
      if (!updated || !onResolved) {
        return;
      }
      /* Isolated try/catch — a throw inside `onResolved` (transport-side
       * SSE write race, emitter listener error) MUST NOT propagate to
       * the outer `.catch`, which would downgrade an already-resolved
       * record to `failed` with `previewError: 'unexpected'`.
       * Extraction succeeded at this point and `finalizePreview` has
       * already persisted the terminal status; the polling layer / next
       * page load will surface the resolved preview even if this turn's
       * SSE emit didn't land. */
      try {
        onResolved(updated);
      } catch (emitError) {
        logger.error(
          `[runPreviewFinalize] onResolved threw for ${fileId}; record stays at the finalized status:`,
          emitError,
        );
      }
    })
    .catch((error) => {
      logger.error('Error rendering deferred preview:', error);
      if (!fileId) {
        return;
      }
      updateFile(
        {
          file_id: fileId,
          status: 'failed',
          previewError: 'unexpected',
        },
        previewRevision ? { previewRevision } : undefined,
      ).catch((updateErr) => {
        logger.error(
          `[runPreviewFinalize] also failed to mark ${fileId} as failed after error:`,
          updateErr,
        );
      });
    });
};

/**
 * Process code execution output files — downloads and saves both images
 * and non-image files. All files are saved to local storage with
 * `codeEnvRef` metadata for code env re-upload.
 *
 * Returns a two-part shape so callers can ship the attachment to the
 * client immediately and run preview extraction in the background:
 *   - `file`: persisted metadata (file is on disk, downloadable, and
 *     has `status: 'pending'` if a preview is still being rendered).
 *   - `finalize` (optional): a thunk returning the deferred preview
 *     result promise. Present only when an inline HTML preview is
 *     expected (office buckets — DOCX/XLSX/XLS/ODS/CSV/PPTX). Caller
 *     decides whether to await or fire-and-forget.
 *
 * Existing fallback paths (size limit, missing storage strategy, error
 * catch) return `{ file }` with no `finalize` — there's nothing to
 * extract.
 *
 * @param {ServerRequest} params.req - The Express request object.
 * @param {string} params.id - The file ID from the code environment.
 * @param {string} params.name - The filename.
 * @param {string} params.toolCallId - The tool call ID that generated the file.
 * @param {string} params.session_id - The code execution session ID.
 * @param {string} params.conversationId - The current conversation ID.
 * @param {string} params.messageId - The current message ID.
 * @returns {Promise<{ file: MongoFile & { messageId: string, toolCallId: string }, finalize?: () => Promise<MongoFile | null> }>}
 */
const processCodeOutput = async ({
  req,
  id,
  name,
  toolCallId,
  conversationId,
  messageId,
  session_id,
}) => {
  const appConfig = req.config;
  const currentDate = new Date();
  const baseURL = getCodeBaseURL();
  const fileExt = path.extname(name).toLowerCase();
  const isImage = fileExt && imageExtRegex.test(name);

  const mergedFileConfig = mergeFileConfig(appConfig.fileConfig);
  const endpointFileConfig = getEndpointFileConfig({
    fileConfig: mergedFileConfig,
    endpoint: EModelEndpoint.agents,
  });
  const fileSizeLimit = endpointFileConfig.fileSizeLimit ?? mergedFileConfig.serverFileSizeLimit;

  try {
    const formattedDate = currentDate.toISOString();
    const authHeaders = await getSafeCodeApiAuthHeaders(req);
    /* Code-output files are always user-private — no skill execution
     * produces a skill-scoped output bucket. The download URL must
     * carry `?kind=user&id=<userId>` so codeapi's `sessionAuth`
     * resolves the matching `<tenant>:user:<userId>` sessionKey. See
     * codeapi #1455 / Phase C. */
    const downloadQuery = safeBuildCodeEnvDownloadQuery({ kind: 'user', id: req.user.id });
    const response = await axios({
      method: 'get',
      url: `${baseURL}/download/${session_id}/${id}${downloadQuery}`,
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'LibreChat/1.0',
        ...authHeaders,
      },
      httpAgent: codeServerHttpAgent,
      httpsAgent: codeServerHttpsAgent,
      timeout: 15000,
    });

    const buffer = Buffer.from(response.data, 'binary');

    // Enforce file size limit
    if (buffer.length > fileSizeLimit) {
      logger.warn(
        `[processCodeOutput] File "${name}" (${(buffer.length / megabyte).toFixed(2)} MB) exceeds size limit of ${(fileSizeLimit / megabyte).toFixed(2)} MB, falling back to download URL`,
      );
      return {
        file: createDownloadFallback({
          id,
          name,
          messageId,
          toolCallId,
          session_id,
          conversationId,
          expiresAt: currentDate.getTime() + 86400000,
        }),
      };
    }

    /* Code-output files belong to the user who ran the execution.
     * SessionKey on codeapi will be `<tenant>:user:<userId>` for these,
     * so cache and access stay user-private. */
    const codeEnvRef = {
      kind: 'user',
      id: req.user.id,
      storage_session_id: session_id,
      file_id: id,
    };

    /* `safeName` keeps the directory structure (`a/b/file.txt` -> `a/b/file.txt`)
     * so the next prime() can place the file at the same nested path in the
     * sandbox; flattening would re-create the bug where every nested artifact
     * collapsed into the root and read_file calls 404'd. The flat-form
     * storage key is composed below once `file_id` is known so we can cap
     * the total length at filesystem NAME_MAX. */
    const safeName = safeSanitizeArtifactPath(name);
    if (safeName !== name) {
      logger.warn(
        `[processCodeOutput] Filename sanitized: "${name}" -> "${safeName}" | conv=${conversationId}`,
      );
    }

    /**
     * Atomically claim a file_id for this (filename, conversationId, context) tuple.
     * Uses $setOnInsert so concurrent calls for the same filename converge on
     * a single record instead of creating duplicates (TOCTOU race fix).
     *
     * Claim by `safeName` (not raw `name`) so the claim and the eventual
     * `createFile` agree on the filename column — otherwise weird inputs
     * (e.g. `"proj name/file@v1.txt"`) would claim under the raw name and
     * then write under the sanitized one, leaving the claim row orphaned.
     */
    const newFileId = v4();
    const claimed = await claimCodeFile({
      filename: safeName,
      conversationId,
      file_id: newFileId,
      user: req.user.id,
      tenantId: req.user.tenantId,
    });
    const file_id = claimed.file_id;
    const isUpdate = file_id !== newFileId;

    if (isUpdate) {
      logger.debug(
        `[processCodeOutput] Updating existing file "${safeName}" (${file_id}) instead of creating duplicate`,
      );
    }

    /**
     * Preserve the original `messageId` on update. Each `processCodeOutput`
     * call would otherwise overwrite it with the current run's run id, which
     * decouples the file from the assistant message that originally created
     * it. `getCodeGeneratedFiles` filters by `messageId IN <thread>`, so a
     * stale id (e.g. from a later regeneration / failed re-read attempt)
     * silently excludes the file from priming on subsequent turns.
     */
    const persistedMessageId = isUpdate ? (claimed.messageId ?? messageId) : messageId;

    if (isImage) {
      const usage = isUpdate ? (claimed.usage ?? 0) + 1 : 1;
      const _file = await convertImage(req, buffer, 'high', `${file_id}${fileExt}`);
      const filepath = usage > 1 ? `${_file.filepath}?v=${Date.now()}` : _file.filepath;
      const storageMetadata = safeGetStorageMetadata({
        filepath: _file.filepath,
        source: appConfig.fileStrategy,
        storageKey: _file.storageKey,
        storageRegion: _file.storageRegion,
      });
      const file = {
        ..._file,
        filepath,
        ...storageMetadata,
        file_id,
        messageId: persistedMessageId,
        usage,
        filename: safeName,
        conversationId,
        user: req.user.id,
        tenantId: req.user.tenantId,
        type: `image/${appConfig.imageOutputType}`,
        createdAt: isUpdate ? claimed.createdAt : formattedDate,
        updatedAt: formattedDate,
        source: appConfig.fileStrategy,
        context: FileContext.execute_code,
        metadata: { codeEnvRef },
      };
      await createFile(file, true);
      await safeUpsertSanSuoOutputRecord({
        req,
        file,
        originalName: name,
        codeEnvRef,
        toolCallId,
        messageId,
      });
      return { file: Object.assign(file, { messageId, toolCallId }) };
    }

    const { saveBuffer } = getStrategyFunctions(appConfig.fileStrategy);
    if (!saveBuffer) {
      logger.warn(
        `[processCodeOutput] saveBuffer not available for strategy ${appConfig.fileStrategy}, falling back to download URL`,
      );
      return {
        file: createDownloadFallback({
          id,
          name,
          messageId,
          toolCallId,
          session_id,
          conversationId,
          expiresAt: currentDate.getTime() + 86400000,
        }),
      };
    }

    const detectedType = await determineFileType(buffer, true);
    const mimeType = detectedType?.mime || inferMimeType(name, '') || 'application/octet-stream';

    /** Check MIME type support - for code-generated files, we're lenient but log unsupported types */
    const isSupportedMimeType = fileConfig.checkType(
      mimeType,
      endpointFileConfig.supportedMimeTypes,
    );
    if (!isSupportedMimeType) {
      logger.warn(
        `[processCodeOutput] File "${name}" has unsupported MIME type "${mimeType}", proceeding with storage but may not be usable as tool resource`,
      );
    }

    /* Compose the storage key here, after `file_id` is known, so the
     * `flattenArtifactPath` cap budget can be calculated against the
     * actual prefix length. The full key has to fit in one filesystem
     * path component (NAME_MAX = 255 on most filesystems); without this
     * cap, deeply-nested artifact paths whose individual segments were
     * within bounds can still produce a flat form that overflows once
     * `${file_id}__` is prepended, causing `ENAMETOOLONG` inside
     * saveBuffer and falling back to a download URL. The 255 figure is
     * the conservative cross-platform NAME_MAX (Linux ext4, NTFS, APFS).
     */
    const NAME_MAX = 255;
    const flatName = safeFlattenArtifactPath(safeName, NAME_MAX - file_id.length - 2);
    const fileName = `${file_id}__${flatName}`;
    const filepath = await saveBuffer({
      userId: req.user.id,
      buffer,
      fileName,
      basePath: 'uploads',
      tenantId: req.user.tenantId,
    });
    const storageMetadata = safeGetStorageMetadata({
      filepath,
      source: appConfig.fileStrategy,
    });

    /* `classifyCodeArtifact` and `extractCodeArtifactText` make
     * extension/bare-name decisions on the input string. With the
     * path-preserving sanitizer they can now receive a nested path like
     * `reports.v1/Makefile`, which the classifier's `extensionOf` reads
     * as `v1/Makefile` (the slice after the dot in the directory name)
     * and the bare-name branch rejects because it sees a `.` anywhere in
     * the string. Result: extensionless artifacts under dotted folders
     * (Makefile, Dockerfile, etc.) get misclassified as `other` and
     * skip text extraction. Pass the basename so classification matches
     * what it would have gotten with the old flat-name flow. */
    const leafName = path.basename(safeName);
    const category = safeClassifyCodeArtifact(leafName, mimeType);

    /* Office-bucket files (DOCX/XLSX/XLS/ODS/CSV/PPTX) route through
     * `bufferToOfficeHtml` which is CPU-heavy. Persist the record now
     * with `status: 'pending'` and `text: null` so the agent's response
     * isn't blocked, then return a `finalize` thunk the caller can run
     * in the background. Non-office files have cheap or no extraction
     * — run it inline so the caller gets a fully-resolved record
     * without juggling a finalize step. */
    const expectsPreview = safeHasOfficeHtmlPath(leafName, mimeType);

    const baseFile = {
      file_id,
      filepath,
      ...storageMetadata,
      messageId: persistedMessageId,
      object: 'file',
      filename: safeName,
      type: mimeType,
      conversationId,
      user: req.user.id,
      tenantId: req.user.tenantId,
      bytes: buffer.length,
      updatedAt: formattedDate,
      metadata: { codeEnvRef },
      source: appConfig.fileStrategy,
      context: FileContext.execute_code,
      usage: isUpdate ? (claimed.usage ?? 0) + 1 : 1,
      createdAt: isUpdate ? claimed.createdAt : formattedDate,
    };

    if (expectsPreview) {
      /* Persist with `status: 'pending'` and explicit
       * `text: null` / `textFormat: null` so an update that previously
       * had cached text gets cleared. The deferred finalize transitions
       * to 'ready' (with text/textFormat) or 'failed' (with
       * previewError).
       *
       * `previewRevision` is a fresh UUID stamped on every emit. The
       * deferred finalize's `updateFile` is conditional on this — if
       * a newer turn (cross-turn filename reuse) has rotated the
       * revision before this render finishes, the stale render is
       * silently discarded rather than overwriting the newer record.
       * (Codex P1 review on PR #12957.) */
      const previewRevision = v4();
      const file = {
        ...baseFile,
        text: null,
        textFormat: null,
        status: 'pending',
        previewError: null,
        previewRevision,
      };
      await createFile(file, true);
      await safeUpsertSanSuoOutputRecord({
        req,
        file,
        originalName: name,
        codeEnvRef,
        toolCallId,
        messageId,
      });
      return {
        file: Object.assign(file, { messageId, toolCallId }),
        finalize: () =>
          finalizePreview({ buffer, leafName, mimeType, category, file_id, previewRevision }),
        previewRevision,
      };
    }

    /* Non-office path: extraction is cheap (utf8 decode, parseDocument
     * for PDF/ODT, or null for binaries). Run inline and return a
     * fully-resolved record — no `finalize` needed. */
    const text = await safeExtractCodeArtifactText(buffer, leafName, mimeType, category);
    /* `textFormat` accompanies `text` so the client can gate
     * office-HTML-bucket routing on a trusted signal — clients MUST
     * NOT inject `text` into the iframe as HTML unless `textFormat ===
     * 'html'`. RAG-uploaded `.docx` etc. arrive with plain text from
     * mammoth.extractRawText and would otherwise be hijacked by the
     * extension-based office routing into the HTML-injection path
     * (Codex P1 review on PR #12934). null on extract failure — the
     * client treats absence as 'text' for safety. */
    const textFormat = safeGetExtractedTextFormat(leafName, mimeType, text);
    const file = {
      ...baseFile,
      // Always set explicitly so an update which produces a binary or
      // oversized artifact clears any previously cached text — createFile
      // uses findOneAndUpdate with $set semantics.
      text: text ?? null,
      textFormat: textFormat ?? null,
      // Clear deferred-preview lifecycle fields in case the prior emit
      // at this (filename, conversationId) was an office file —
      // otherwise stale `pending`/`failed` would persist and the client
      // would render the wrong state for the now non-office artifact.
      status: null,
      previewError: null,
      previewRevision: null,
    };

    await createFile(file, true);
    await safeUpsertSanSuoOutputRecord({
      req,
      file,
      originalName: name,
      codeEnvRef,
      toolCallId,
      messageId,
    });
    return { file: Object.assign(file, { messageId, toolCallId }) };
  } catch (error) {
    if (error?.message === 'Path traversal detected in filename') {
      logger.warn(
        `[processCodeOutput] Path traversal blocked for file "${name}" | conv=${conversationId}`,
      );
    }
    logAxiosError({
      message: 'Error downloading/processing code environment file',
      error,
    });
    logger.warn(
      `[processCodeOutput] Falling back to Code API download URL for strategy ${appConfig.fileStrategy}`,
    );

    // Fallback for download errors - return download URL so user can still manually download
    return {
      file: createDownloadFallback({
        id,
        name,
        messageId,
        toolCallId,
        session_id,
        conversationId,
        expiresAt: currentDate.getTime() + 86400000,
      }),
    };
  }
};

function checkIfActive(dateString) {
  const givenDate = new Date(dateString);
  const currentDate = new Date();
  const timeDifference = currentDate - givenDate;
  const hoursPassed = timeDifference / (1000 * 60 * 60);
  return hoursPassed < 23;
}

/**
 * Retrieves the `lastModified` time string for a specified file from Code Execution Server.
 *
 * @param {import('librechat-data-provider').CodeEnvRef} ref - Typed pointer
 *   into codeapi storage. Carries kind/id/storage_session_id/file_id;
 *   codeapi resolves the sessionKey from the request's auth context.
 * @param {ServerRequest} [req] - Current authenticated request, used to mint Code API auth.
 *
 * @returns {Promise<string|null>}
 *          A promise that resolves to the `lastModified` time string of the file if successful, or null if there is an
 *          error in initialization or fetching the info.
 */
async function getSessionInfo(ref, req) {
  try {
    const baseURL = getCodeBaseURL();
    const authHeaders = await getSafeCodeApiAuthHeaders(req);
    /* `/sessions/.../objects/...` is gated by codeapi's `sessionAuth`
     * middleware (post-Phase C). The middleware reconstructs the
     * sessionKey from the URL query (`kind`/`id`/`version?`) plus the
     * requester's auth context, then matches it against the cached
     * sessionKey on the storage bucket. We have the full `codeEnvRef`
     * here, so pass kind+id (+version when skill) directly. */
    const query = safeBuildCodeEnvDownloadQuery({
      kind: ref.kind,
      id: ref.id,
      ...(ref.kind === 'skill' ? { version: ref.version } : {}),
    });
    const response = await axios({
      method: 'get',
      url: `${baseURL}/sessions/${ref.storage_session_id}/objects/${ref.file_id}${query}`,
      headers: {
        'User-Agent': 'LibreChat/1.0',
        ...authHeaders,
      },
      httpAgent: codeServerHttpAgent,
      httpsAgent: codeServerHttpsAgent,
      timeout: 5000,
    });

    return response.data?.lastModified;
  } catch (error) {
    logger.debug(
      `[getSessionInfo] session lookup failed (treating as cache miss): ${error?.message ?? String(error)}`,
    );
    return null;
  }
}

const getPreviewContextSuffix = (file) => {
  if (file.status === 'pending') {
    return ' (preview not yet generated)';
  }

  if (file.status !== 'failed') {
    return '';
  }

  return file.previewError
    ? ` (preview unavailable: ${file.previewError})`
    : ' (preview unavailable)';
};

const getVisibleCodeFileContextLine = (file, agentResourceIds) => {
  if (file.context === FileContext.execute_code) {
    return '';
  }

  const fileSuffix = agentResourceIds.has(file.file_id) ? '' : ' (attached by user)';
  return `\n\t- /mnt/data/${file.filename}${fileSuffix}${getPreviewContextSuffix(file)}`;
};

const appendVisibleCodeFileContext = (toolContext, contextLine) => {
  if (!contextLine) {
    return toolContext;
  }

  if (toolContext) {
    return `${toolContext}${contextLine}`;
  }

  return `- Note: The following files are available in the "${Tools.execute_code}" tool environment:${contextLine}`;
};

/**
 *
 * @param {Object} options
 * @param {ServerRequest} options.req
 * @param {Agent['tool_resources']} options.tool_resources
 * @param {string} [options.agentId] - The agent ID for file access control
 * @returns {Promise<{
 * files: Array<{ id: string; session_id: string; name: string }>,
 * toolContext: string,
 * }>}
 */
const primeFiles = async (options) => {
  const { tool_resources, req, agentId } = options;
  const file_ids = tool_resources?.[EToolResources.execute_code]?.file_ids ?? [];
  const agentResourceIds = new Set(file_ids);
  const resourceFiles = tool_resources?.[EToolResources.execute_code]?.files ?? [];

  /* Step 1 of the priming trace: input volume. Pair with the
   * per-file `[primeCodeFiles] file=...` lines and the final
   * `[primeCodeFiles] returned=...` line below to locate which
   * layer drops a file the sandbox doesn't end up seeing. */
  logger.debug(
    `[primeCodeFiles] in: file_ids=${file_ids.length} resourceFiles=${resourceFiles.length}`,
    { agentId, file_ids, resourceFileIds: resourceFiles.map((f) => f?.file_id) },
  );

  // Get all files first
  const allFiles = (await getFiles({ file_id: { $in: file_ids } }, null, { text: 0 })) ?? [];

  // Filter by access if user and agent are provided
  let dbFiles;
  if (req?.user?.id && agentId) {
    dbFiles = await filterFilesByAgentAccess({
      files: allFiles,
      userId: req.user.id,
      role: req.user.role,
      agentId,
    });
  } else {
    dbFiles = allFiles;
  }

  dbFiles = dbFiles.concat(resourceFiles);

  const files = [];
  const sessions = new Map();
  let toolContext = '';

  /* Per-file path counters — emitted at the bottom so a single
   * grep on `[primeCodeFiles]` shows the input volume, the per-file
   * paths taken, and the final dispatch summary in one trace. */
  let skippedNoRef = 0;
  let reuploadFailures = 0;

  for (let i = 0; i < dbFiles.length; i++) {
    const file = dbFiles[i];
    if (!file) {
      continue;
    }

    const ref = file.metadata?.codeEnvRef;
    if (
      !ref?.storage_session_id ||
      !ref?.file_id ||
      String(ref.file_id).startsWith('sansuo_hidden__')
    ) {
      skippedNoRef += 1;
      logger.debug(
        `[primeCodeFiles] file=${file.file_id} path=skip reason=no-valid-codeenvref filename=${file.filename}`,
        {
          storage_session_id: ref?.storage_session_id || null,
          file_id: ref?.file_id || null,
          metadataSource: file?.metadata?.source || null,
        },
      );
      continue;
    }
    const session_id = ref.storage_session_id;
    const id = ref.file_id;

    /**
     * `pushFile` accepts optional overrides so the reupload path can
     * push the FRESH `(storage_session_id, file_id)` from the new
     * `codeEnvRef`. Without these overrides, the closure would
     * capture the stale pre-reupload refs from the outer loop and
     * the in-memory `files` array (now consumed by
     * `buildInitialToolSessions` to seed `Graph.sessions`) would
     * point at a sandbox object that no longer exists. The DB record
     * gets the new ref via `updateFile`, but the seed would still
     * inject the old one — bash_tool / read_file would 404 trying to
     * mount the file until the next turn re-reads metadata.
     *
     * `kind`, `id`, `version` are preserved on the in-memory ref so
     * codeapi can resolve sessionKey per-file (kind switch +
     * tenant prefix from auth context).
     */
    const pushFile = (overrideSessionId, overrideId) => {
      toolContext = appendVisibleCodeFileContext(
        toolContext,
        getVisibleCodeFileContextLine(file, agentResourceIds),
      );
      /* `id` is the storage file_id (drives codeapi's upload-key
       * existence check), `resource_id` is the entity that owns
       * the storage session (drives sessionKey re-derivation). For
       * code-output files this is `kind: 'user'` and `resource_id`
       * is informational (codeapi ignores it for user kind), but
       * we still send it for shape uniformity with shared kinds. */
      files.push({
        id: overrideId ?? id,
        resource_id: ref.id,
        storage_session_id: overrideSessionId ?? session_id,
        name: file.filename,
        kind: ref.kind,
        reusable: file?.metadata?.reusable !== false,
        hidden: file?.metadata?.isIntermediate === true || file?.metadata?.visibility === 'tool',
        artifact_kind: file?.metadata?.artifactKind,
        recommended_reader: file?.metadata?.recommendedReader,
        ...(ref.kind === 'skill' ? { version: ref.version } : {}),
      });
    };

    if (sessions.has(session_id)) {
      logger.debug(
        `[primeCodeFiles] file=${file.file_id} path=cache-hit-by-session storage_session_id=${session_id}`,
      );
      pushFile();
      continue;
    }

    const reuploadFile = async () => {
      try {
        const { getDownloadStream } = getStrategyFunctions(file.source);
        const { handleFileUpload: uploadCodeEnvFile } = getStrategyFunctions(
          FileSources.execute_code,
        );
        const stream = await getDownloadStream(options.req, file.filepath);
        /* Reupload preserves the resource identity from the existing
         * ref so codeapi re-buckets under the same sessionKey shape
         * (skill stays skill, user stays user). Without this, a
         * skill-cache-miss reupload would land in the user bucket
         * and never re-shareable cross-user. */
        const uploaded = await uploadCodeEnvFile({
          req: options.req,
          stream,
          filename: file.filename,
          kind: ref.kind,
          id: ref.id,
          ...(ref.kind === 'skill' ? { version: ref.version } : {}),
        });

        /**
         * Use the FRESH `(storage_session_id, file_id)` from the
         * reupload response and route it through the dedupe Map, the
         * persisted record, and the in-memory `files` list. The
         * original ref captured at the top of this iteration refers
         * to the old, expired/missing sandbox object — using it here
         * would silently re-introduce the bug `Graph.sessions`
         * seeding is supposed to fix.
         *
         * `kind`, `id`, `version` survive the round-trip: the
         * upload preserves the resource identity, only the storage
         * pointer changes.
         */
        const newRef = {
          kind: ref.kind,
          id: ref.id,
          storage_session_id: uploaded.storage_session_id,
          file_id: uploaded.file_id,
          ...(ref.kind === 'skill' ? { version: ref.version } : {}),
        };

        const updatedMetadata = {
          ...file.metadata,
          codeEnvRef: newRef,
        };

        await updateFile({
          file_id: file.file_id,
          metadata: updatedMetadata,
        });
        sessions.set(newRef.storage_session_id, true);
        pushFile(newRef.storage_session_id, newRef.file_id);
        logger.debug(
          `[primeCodeFiles] file=${file.file_id} path=reupload-success ` +
            `oldSession=${session_id} newSession=${newRef.storage_session_id} newFileId=${newRef.file_id}`,
        );
      } catch (error) {
        reuploadFailures += 1;
        logger.error(
          `[primeCodeFiles] file=${file.file_id} path=reupload-failed session=${session_id}: ${error.message}`,
          error,
        );
      }
    };
    const uploadTime = await getSessionInfo(ref, req);
    if (!uploadTime) {
      logger.debug(
        `[primeCodeFiles] file=${file.file_id} path=reupload reason=no-uploadtime ` +
          `storage_session_id=${session_id}`,
      );
      await reuploadFile();
      continue;
    }
    if (!checkIfActive(uploadTime)) {
      logger.debug(
        `[primeCodeFiles] file=${file.file_id} path=existing-persistent-object age=stale ` +
          `uploadTime=${uploadTime} storage_session_id=${session_id}`,
      );
    }
    sessions.set(session_id, true);
    logger.debug(
      `[primeCodeFiles] file=${file.file_id} path=fresh-active storage_session_id=${session_id}`,
    );
    pushFile();
  }

  /* Dispatch summary — emitted unconditionally so a single grep on
   * `[primeCodeFiles] out` always shows the final state, not only
   * the per-path trail leading up to it. */
  logger.debug(
    `[primeCodeFiles] out: returned=${files.length} ` +
      `skippedNoRef=${skippedNoRef} reuploadFailures=${reuploadFailures}`,
    {
      files: files.map((file) => ({
        name: file.name,
        storage_session_id: file.storage_session_id,
        file_id: file.id,
        hidden: file.hidden,
        kind: file.artifact_kind,
      })),
    },
  );

  return { files, toolContext };
};

/**
 * Reads a single file from the code-execution sandbox by shelling `cat`
 * through the sandbox `/exec` endpoint. Used by the `read_file` host
 * handler when the requested path is a code-env path (`/mnt/data/...`)
 * or otherwise not resolvable as a skill file. Resolves to
 * `{ content }` from stdout on success, or `null` when the codeapi base
 * URL isn't configured / the read returns no content (caller turns that
 * into a model-visible error). Throws axios-style errors on transport
 * failure so the caller can surface a meaningful error message.
 *
 * `session_id` and `files` come from the seeded `tc.codeSessionContext`
 * (emitted by the agents-side `ToolNode` for `read_file` calls in
 * v3.1.72+) so the read lands in the same sandbox session that holds
 * the agent's prior-turn artifacts.
 *
 * @param {Object} params
 * @param {string} params.file_path - Absolute path inside the sandbox (e.g. `/mnt/data/foo.txt`).
 * @param {string} [params.session_id] - Sandbox session id from the seeded context.
 * @param {Array<{id: string, name: string, session_id?: string}>} [params.files] - File refs to mount.
 * @param {ServerRequest} [params.req] - Current authenticated request, used to mint Code API auth.
 * @returns {Promise<{content: string} | null>}
 */
async function readSandboxFile({ file_path, session_id, files, req }) {
  const baseURL = getCodeBaseURL();
  if (!baseURL) {
    return null;
  }

  /** Single-quote `file_path` with embedded-quote escaping so a malicious
   *  filename can't break out of the `cat` command. The handler upstream
   *  has already established this is a code-env path the model
   *  legitimately asked to read; this just keeps the shell quoting safe. */
  const safePath = `'${file_path.replace(/'/g, `'\\''`)}'`;
  /** @type {Record<string, unknown>} */
  const postData = { lang: 'bash', code: `cat ${safePath}` };
  if (session_id) {
    postData.session_id = session_id;
  }
  if (files && files.length > 0) {
    postData.files = files;
  }

  try {
    const authHeaders = await getSafeCodeApiAuthHeaders(req);
    const response = await axios({
      method: 'post',
      url: `${baseURL}/exec`,
      data: postData,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'LibreChat/1.0',
        ...authHeaders,
      },
      httpAgent: codeServerHttpAgent,
      httpsAgent: codeServerHttpsAgent,
      timeout: 15000,
    });
    const result = response?.data ?? {};
    if (result.stderr && (result.stdout == null || result.stdout === '')) {
      throw new Error(String(result.stderr).trim());
    }
    if (result.stdout == null) {
      return null;
    }
    return { content: String(result.stdout) };
  } catch (error) {
    logAxiosError({
      message: `Error reading sandbox file "${file_path}"`,
      error,
    });
    throw error;
  }
}

module.exports = {
  primeFiles,
  checkIfActive,
  getSessionInfo,
  processCodeOutput,
  ensureSanSuoPdfPageArtifacts,
  ensureSanSuoPdfVisualFallback,
  preparseSanSuoPdfOnUpload,
  preparseSanSuoDocxOnUpload,
  preparseSanSuoStructuredFileOnUpload,
  getSanSuoParseKind,
  enqueueSanSuoDocumentPreparse,
  waitForSanSuoDocumentPreparse,
  isSanSuoPreparseMime,
  SANSUO_DOCUMENT_PARSE_VERSION,
  recordSanSuoHiddenCodeOutput,
  readSandboxFile,
  runPreviewFinalize,
};
