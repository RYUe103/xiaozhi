const { logger } = require('@librechat/data-schemas');
const { EToolResources } = require('librechat-data-provider');
const db = require('~/models');

function isSanSuoMainToolResourceRequest(req, endpointOption, primaryAgent) {
  return [
    req?.body?.endpoint,
    req?.body?.endpointOption?.endpoint,
    endpointOption?.agent?.provider,
    primaryAgent?.provider,
  ].includes('SanSuoMain');
}

function isSanSuoIntermediateFilename(filename = '') {
  const name = String(filename || '').replace(/\\/g, '/');
  const normalized = name.replace(/\//g, '__');
  return (
    /(^|__|\/)[^/]+_(profile\.json|pages\.jsonl|chunks\.jsonl|reading_pack\.md)$/i.test(
      normalized,
    ) ||
    /(^|__|\/)[^/]+_mineru(\.md|_result\.json|_content_list\.json|_chunks\.jsonl)$/i.test(
      normalized,
    ) ||
    /(^|__|\/)[^/]+_smart_manifest\.json$/i.test(normalized) ||
    /(^|__|\/)[^/]+_docx_(blocks\.jsonl|manifest\.json|reading_pack\.md)$/i.test(normalized) ||
    /(^|__|\/)[^/]+_tabular_(rows\.jsonl|manifest\.json|reading_pack\.md)$/i.test(normalized) ||
    /(^|__|\/)[^/]+_text_(blocks\.jsonl|manifest\.json|reading_pack\.md)$/i.test(normalized) ||
    normalized.toLowerCase().includes('_docx_assets__') ||
    normalized.toLowerCase().includes('_docx_assets/') ||
    /(^|__|\/)[^/]+_raw_response\.txt$/i.test(normalized)
  );
}

function hasCompleteCodeEnvRef(ref) {
  return Boolean(
    ref?.storage_session_id && ref?.file_id && !String(ref.file_id).startsWith('sansuo_hidden__'),
  );
}

function normalizeSanSuoCodeResourceFile(file = {}, userId) {
  const existingRef = file?.metadata?.codeEnvRef || {};
  const storageSessionId =
    existingRef.storage_session_id ||
    file?.sandbox_session_id ||
    file?.sandboxSessionId ||
    file?.storage_session_id;
  const sandboxFileId =
    existingRef.file_id || file?.sandbox_file_id || file?.sandboxFileId || file?.id;
  const codeEnvRef = {
    kind: existingRef.kind || file?.kind || 'user',
    id: existingRef.id || file?.resource_id || String(userId),
    storage_session_id: storageSessionId,
    file_id: sandboxFileId,
    ...(existingRef.version != null ? { version: existingRef.version } : {}),
    ...(file?.version != null && existingRef.version == null ? { version: file.version } : {}),
  };
  if (!hasCompleteCodeEnvRef(codeEnvRef)) {
    return null;
  }
  return {
    ...file,
    filename:
      file?.filename ||
      file?.name ||
      file?.displayName ||
      file?.originalFilename ||
      `file_${codeEnvRef.file_id}`,
    metadata: {
      ...(file?.metadata || {}),
      codeEnvRef,
    },
  };
}

function normalizeSanSuoFilenameKey(filename = '') {
  return String(filename || '')
    .trim()
    .toLowerCase();
}

function getSanSuoResourceRootInfo(file = {}) {
  const metadata = file?.metadata || {};
  if (metadata.rootSourceFileId || metadata.rootSourceFilename) {
    return {
      file_id: metadata.rootSourceFileId || null,
      filename: metadata.rootSourceFilename || null,
    };
  }
  return {
    file_id: file?.file_id || file?.id || null,
    filename: file?.filename || file?.name || null,
  };
}

function isSanSuoPdfLikeFile(file = {}) {
  const filename = String(file?.filename || file?.name || '').toLowerCase();
  const mimeType = String(file?.mimeType || file?.type || '').toLowerCase();
  return filename.endsWith('.pdf') || mimeType === 'application/pdf';
}

function getSanSuoPdfArtifactPriority(file = {}) {
  const filename = String(file?.filename || file?.name || '');
  const kind = file?.metadata?.artifactKind || '';
  if (kind === 'pdf_smart_manifest' || /_smart_manifest\.json$/i.test(filename)) return 1;
  if (
    ['pdf_mineru_chunks', 'pdf_mineru_content_list'].includes(kind) ||
    /_mineru_chunks\.jsonl$|_mineru_content_list\.json$/i.test(filename)
  ) {
    return 2;
  }
  if (
    ['pdf_mineru_markdown', 'pdf_mineru_result'].includes(kind) ||
    /_mineru\.md$|_mineru_result\.json$/i.test(filename)
  ) {
    return 3;
  }
  if (/_chunks\.jsonl$|_pages\.jsonl$|_reading_pack\.md$|_profile\.json$/i.test(filename)) {
    return 4;
  }
  return 9;
}

function matchesSanSuoPdfRoot(file = {}, root = {}) {
  const metadata = file?.metadata || {};
  const rootId = root?.file_id || null;
  const rootNameKey = normalizeSanSuoFilenameKey(root?.filename);
  const fileId = file?.file_id || file?.id || null;
  const fileNameKey = normalizeSanSuoFilenameKey(file?.filename || file?.name);
  if (rootId && (metadata.rootSourceFileId === rootId || fileId === rootId)) return true;
  if (
    rootNameKey &&
    (normalizeSanSuoFilenameKey(metadata.rootSourceFilename) === rootNameKey ||
      fileNameKey === rootNameKey)
  ) {
    return true;
  }
  const derivedFrom = Array.isArray(metadata?.derivedFrom) ? metadata.derivedFrom : [];
  return derivedFrom.some((entry) => {
    const entryId = entry?.file_id || null;
    const entryNameKey = normalizeSanSuoFilenameKey(entry?.filename);
    return (rootId && entryId === rootId) || (rootNameKey && entryNameKey === rootNameKey);
  });
}

function selectSanSuoActivePdfState(files = [], requestFiles = []) {
  const safeFiles = Array.isArray(files) ? files.filter(Boolean) : [];
  const requestRoot = (Array.isArray(requestFiles) ? requestFiles : []).find((file) =>
    isSanSuoPdfLikeFile(file),
  );
  let root = requestRoot ? getSanSuoResourceRootInfo(requestRoot) : null;
  if (!root) {
    const visiblePdf = safeFiles.find(
      (file) =>
        !isSanSuoIntermediateFilename(file?.filename || file?.name) && isSanSuoPdfLikeFile(file),
    );
    root = visiblePdf ? getSanSuoResourceRootInfo(visiblePdf) : null;
  }
  if (!root) {
    const hiddenPdf = safeFiles.find((file) => getSanSuoPdfArtifactPriority(file) < 9);
    root = hiddenPdf ? getSanSuoResourceRootInfo(hiddenPdf) : null;
  }
  if (!root || (!root.file_id && !root.filename)) return null;

  const artifacts = safeFiles
    .filter((file) => isSanSuoIntermediateFilename(file?.filename || file?.name))
    .filter((file) => getSanSuoPdfArtifactPriority(file) < 9)
    .filter((file) => matchesSanSuoPdfRoot(file, root))
    .sort((a, b) => getSanSuoPdfArtifactPriority(a) - getSanSuoPdfArtifactPriority(b));
  return { root, preferred: artifacts[0] || null, artifacts };
}

function prioritizeSanSuoPdfResources(files = [], requestFiles = [], activePdfState = null) {
  const safeFiles = Array.isArray(files) ? files.filter(Boolean) : [];
  const ordered = [];
  const seen = new Set();
  const push = (file) => {
    const ref = file?.metadata?.codeEnvRef || {};
    const key = `${ref.storage_session_id || ''}:${ref.file_id || file?.file_id || file?.id || ''}:${file?.filename || file?.name || ''}`;
    if (!key || seen.has(key)) return;
    seen.add(key);
    ordered.push(file);
  };
  const pushMatching = (file) => {
    const match = safeFiles.find((candidate) => {
      const ref = candidate?.metadata?.codeEnvRef || {};
      const fileRef = file?.metadata?.codeEnvRef || {};
      return (
        (file?.file_id && candidate?.file_id === file.file_id) ||
        (fileRef.file_id && ref.file_id === fileRef.file_id) ||
        (file?.filename && candidate?.filename === file.filename)
      );
    });
    if (match) push(match);
  };

  for (const requestFile of Array.isArray(requestFiles) ? requestFiles : [])
    pushMatching(requestFile);
  for (const file of [activePdfState?.preferred, ...(activePdfState?.artifacts || [])]) {
    if (file) pushMatching(file);
  }
  for (const file of safeFiles) push(file);
  return ordered;
}

function createExecutionResourceService({ getSanSuoFiles = db.getSanSuoFiles, log = logger } = {}) {
  async function augmentExecuteCodeToolResources({
    req,
    endpointOption,
    primaryAgent,
    conversationId,
    requestFiles = [],
    tool_resources = {},
    force = false,
  }) {
    if (
      !isSanSuoMainToolResourceRequest(req, endpointOption, primaryAgent) ||
      !req?.user?.id ||
      !conversationId ||
      typeof getSanSuoFiles !== 'function' ||
      (!force && req?.body?.sansuoMode === 'deep')
    ) {
      return tool_resources;
    }

    const existingCodeResources = tool_resources?.[EToolResources.execute_code] ?? {};
    const existingFiles = Array.isArray(existingCodeResources.files)
      ? existingCodeResources.files
      : [];
    const existingFileIds = Array.isArray(existingCodeResources.file_ids)
      ? existingCodeResources.file_ids
      : [];
    const records = await getSanSuoFiles(
      {
        userId: req.user.id,
        conversationId,
        status: 'ready',
        $or: [
          { 'metadata.followupReadable': { $ne: false } },
          { 'metadata.followupReadable': { $exists: false } },
        ],
      },
      { sort: { createdAt: -1 } },
    );

    const mergedFiles = [];
    const seen = new Set();
    const pushFile = (file) => {
      const normalized = normalizeSanSuoCodeResourceFile(file, req.user.id);
      if (!normalized) return;
      const ref = normalized.metadata.codeEnvRef;
      const key = `${ref.storage_session_id}:${ref.file_id}:${normalized.filename}`;
      if (seen.has(key)) return;
      seen.add(key);
      mergedFiles.push(normalized);
    };

    for (const file of existingFiles) pushFile(file);
    for (const file of Array.isArray(requestFiles) ? requestFiles : []) pushFile(file);
    for (const record of Array.isArray(records) ? records : []) {
      pushFile({
        file_id: record?.libreFileId,
        filename: record?.displayFilename || record?.originalFilename,
        mimeType: record?.mimeType,
        metadata: record?.metadata || {},
        sandbox_session_id: record?.sandboxSessionId,
        sandbox_file_id: record?.sandboxFileId,
        sandboxSessionId: record?.sandboxSessionId,
        sandboxFileId: record?.sandboxFileId,
        originalFilename: record?.originalFilename,
      });
    }

    const activePdfState = selectSanSuoActivePdfState(mergedFiles, requestFiles);
    const prioritizedFiles = prioritizeSanSuoPdfResources(
      mergedFiles,
      requestFiles,
      activePdfState,
    );
    const hiddenIntermediateCount = prioritizedFiles.filter((file) =>
      isSanSuoIntermediateFilename(file?.filename),
    ).length;
    log.info('[SanSuoSandbox] execute_code tool_resources prepared', {
      conversationId,
      requestFiles: Array.isArray(requestFiles) ? requestFiles.length : 0,
      existingFiles: existingFiles.length,
      mergedFiles: prioritizedFiles.length,
      hiddenIntermediateCount,
      activePdfRoot: activePdfState?.root?.filename || null,
      activePdfPreferred: activePdfState?.preferred?.filename || null,
      filenames: prioritizedFiles
        .map((file) => file?.filename)
        .filter(Boolean)
        .slice(0, 20),
    });

    const nextToolResources = {
      ...tool_resources,
      [EToolResources.execute_code]: {
        ...existingCodeResources,
        file_ids: existingFileIds,
        files: prioritizedFiles,
      },
    };
    if (req?.body) req.body.tool_resources = nextToolResources;
    return nextToolResources;
  }

  return { augmentExecuteCodeToolResources };
}

const executionResourceService = createExecutionResourceService();

module.exports = {
  createExecutionResourceService,
  isSanSuoMainToolResourceRequest,
  augmentSanSuoExecuteCodeToolResources: executionResourceService.augmentExecuteCodeToolResources,
};
