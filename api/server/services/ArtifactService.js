const {
  getSanSuoFiles,
  getSanSuoFileParseJobs,
  updateSanSuoArtifactGovernance,
  createSanSuoArtifactAudit,
} = require('~/models');
const mongoose = require('mongoose');

const ARTIFACT_TYPES = Object.freeze({
  SOURCE: 'source',
  DERIVED: 'derived',
  WORKING: 'working',
  CACHE: 'cache',
  DELIVERABLE: 'deliverable',
});

const DEFAULT_RETENTION = Object.freeze({
  source: 'user_managed',
  derived: 'retain_with_source',
  working: 'task_ttl',
  cache: 'cache_ttl',
  deliverable: 'retain',
});

const DERIVED_KIND_PATTERN =
  /(?:preparse|parsed|mineru|chunk|manifest|content_list|extracted|reading_pack|document_visual|page_review)/i;
const CACHE_KIND_PATTERN = /(?:cache|thumbnail|preview_cache)/i;
const DELIVERABLE_KIND_PATTERN = /(?:deliverable|final_output|generated_file|user_output)/i;

function getArtifactId(record = {}) {
  return String(record.libreFileId || record._id || '');
}

function classifyArtifact(record = {}) {
  if (Object.values(ARTIFACT_TYPES).includes(record.artifactType)) return record.artifactType;
  const metadata = record.metadata || {};
  const declared = String(metadata.artifactType || metadata.lifecycleType || '').toLowerCase();
  if (Object.values(ARTIFACT_TYPES).includes(declared)) return declared;
  if (record.role === 'input' || record.source === 'upload') return ARTIFACT_TYPES.SOURCE;
  const kind = String(metadata.artifactKind || '');
  if (CACHE_KIND_PATTERN.test(kind)) return ARTIFACT_TYPES.CACHE;
  if (DELIVERABLE_KIND_PATTERN.test(kind) || metadata.isDeliverable === true) {
    return ARTIFACT_TYPES.DELIVERABLE;
  }
  if (
    metadata.isIntermediate === true ||
    metadata.rootSourceLibreFileId ||
    DERIVED_KIND_PATTERN.test(kind)
  ) {
    return ARTIFACT_TYPES.DERIVED;
  }
  if (record.role === 'output' && metadata.visibility !== 'tool') {
    return ARTIFACT_TYPES.DELIVERABLE;
  }
  return ARTIFACT_TYPES.WORKING;
}

function resolveLineage(record = {}) {
  const metadata = record.metadata || {};
  const artifactId = getArtifactId(record);
  const rootArtifactId = String(
    record.rootArtifactId ||
      metadata.rootSourceLibreFileId ||
      metadata.rootSourceFileId ||
      artifactId,
  );
  const derivedFrom = Array.isArray(metadata.derivedFrom) ? metadata.derivedFrom : [];
  const firstParent = derivedFrom.find((entry) => entry?.file_id || entry?.libreFileId);
  const parentArtifactId = String(
    record.parentArtifactId ||
      firstParent?.file_id ||
      firstParent?.libreFileId ||
      (rootArtifactId !== artifactId ? rootArtifactId : ''),
  );
  return { artifactId, rootArtifactId, parentArtifactId: parentArtifactId || null };
}

function buildReferenceSnapshot(
  record,
  { records = [], parseJobs = [], messageReferences = [] } = {},
) {
  const lineage = resolveLineage(record);
  const rootIds = new Set([lineage.artifactId, lineage.rootArtifactId].filter(Boolean));
  const conversations = new Set();
  const messages = new Set();
  const parseJobIds = new Set();
  const artifactIds = new Set();

  for (const candidate of records) {
    const candidateLineage = resolveLineage(candidate);
    if (!rootIds.has(candidateLineage.artifactId) && !rootIds.has(candidateLineage.rootArtifactId))
      continue;
    artifactIds.add(candidateLineage.artifactId);
    if (candidate.conversationId && candidate.conversationId !== 'new')
      conversations.add(candidate.conversationId);
    if (candidate.messageId) messages.add(candidate.messageId);
  }
  for (const job of parseJobs) {
    if (!rootIds.has(String(job.libreFileId || ''))) continue;
    parseJobIds.add(String(job._id || `${job.libreFileId}:${job.parserVersion || ''}`));
    if (job.conversationId && job.conversationId !== 'new') conversations.add(job.conversationId);
    if (job.messageId) messages.add(job.messageId);
  }
  for (const reference of messageReferences) {
    if (!rootIds.has(String(reference.fileId || reference.rootArtifactId || ''))) continue;
    if (reference.conversationId) conversations.add(reference.conversationId);
    if (reference.messageId) messages.add(reference.messageId);
  }

  return {
    conversations: Array.from(conversations).sort(),
    messages: Array.from(messages).sort(),
    parseJobs: Array.from(parseJobIds).sort(),
    relatedArtifacts: Array.from(artifactIds).sort(),
    activeReferenceCount: conversations.size + messages.size + parseJobIds.size,
  };
}

function getAgeDays(record, now) {
  const timestamp = record.lastAccessedAt || record.updatedAt || record.createdAt;
  const millis = timestamp ? new Date(timestamp).getTime() : Number.NaN;
  return Number.isFinite(millis) ? Math.max(0, (now.getTime() - millis) / 86400000) : 0;
}

function evaluateGcCandidate(record, context = {}) {
  const now = context.now || new Date();
  const artifactType = classifyArtifact(record);
  const lineage = resolveLineage(record);
  const references = buildReferenceSnapshot(record, context);
  const retentionPolicy = record.retentionPolicy || DEFAULT_RETENTION[artifactType];
  const ageDays = getAgeDays(record, now);
  const reasons = [];
  const blockers = [];
  const rootExists = (context.records || []).some(
    (candidate) => getArtifactId(candidate) === lineage.rootArtifactId,
  );

  if (record.status === 'deleted') reasons.push('registry_tombstone');
  if (record.status === 'failed') reasons.push('failed_artifact');
  if (lineage.rootArtifactId !== lineage.artifactId && !rootExists)
    reasons.push('orphaned_lineage');
  if (artifactType === ARTIFACT_TYPES.WORKING && ageDays >= (context.workingTtlDays ?? 7)) {
    reasons.push('working_ttl_expired');
  }
  if (artifactType === ARTIFACT_TYPES.CACHE && ageDays >= (context.cacheTtlDays ?? 3)) {
    reasons.push('cache_ttl_expired');
  }
  if (references.activeReferenceCount > 0) blockers.push('active_references');
  if (artifactType === ARTIFACT_TYPES.SOURCE) blockers.push('source_requires_explicit_delete');
  if (artifactType === ARTIFACT_TYPES.DERIVED) blockers.push('derived_retained_with_source');
  if (artifactType === ARTIFACT_TYPES.DELIVERABLE) blockers.push('deliverable_retained');
  if (retentionPolicy === 'retain' || retentionPolicy === 'user_managed')
    blockers.push('retention_policy');
  if (record.gcState === 'quarantined') blockers.push('already_quarantined');
  if (!record.sandboxSessionId || !record.sandboxFileId) blockers.push('storage_ref_unconfirmed');

  return {
    ...lineage,
    artifactType,
    retentionPolicy,
    size: Number(record.size || 0),
    ageDays: Number(ageDays.toFixed(2)),
    references,
    reasons,
    blockers: Array.from(new Set(blockers)),
    eligible: reasons.length > 0 && blockers.length === 0,
  };
}

function buildArtifactReport({
  records = [],
  parseJobs = [],
  messageReferences = [],
  now = new Date(),
} = {}) {
  const byType = {};
  const byStatus = {};
  const byStorage = {};
  const evaluations = records.map((record) =>
    evaluateGcCandidate(record, { records, parseJobs, messageReferences, now }),
  );
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const evaluation = evaluations[index];
    let storage = 'unresolved';
    if (record.sandboxFileId) storage = 'codeapi';
    else if (record.libreFilepath) storage = 'librechat';
    for (const [bucket, key] of [
      [byType, evaluation.artifactType],
      [byStatus, record.status || 'ready'],
      [byStorage, storage],
    ]) {
      bucket[key] ||= { count: 0, bytes: 0 };
      bucket[key].count += 1;
      bucket[key].bytes += evaluation.size;
    }
  }
  return {
    generatedAt: now.toISOString(),
    totals: {
      count: records.length,
      bytes: records.reduce((sum, record) => sum + Number(record.size || 0), 0),
      eligibleCandidates: evaluations.filter((item) => item.eligible).length,
    },
    byType,
    byStatus,
    byStorage,
    candidates: evaluations.filter((item) => item.reasons.length > 0),
  };
}

async function loadArtifactInventory({ userId, tenantId } = {}) {
  if (!userId) throw new Error('Artifact inventory requires userId');
  const owner = { userId, ...(tenantId != null ? { tenantId } : {}) };
  const [records, parseJobs] = await Promise.all([
    getSanSuoFiles(owner, { sort: { createdAt: 1 } }),
    getSanSuoFileParseJobs(owner, { sort: { createdAt: 1 } }),
  ]);
  const rootIds = Array.from(
    new Set(
      records
        .flatMap((record) => {
          const lineage = resolveLineage(record);
          return [lineage.artifactId, lineage.rootArtifactId];
        })
        .filter(Boolean),
    ),
  );
  const Message = mongoose.models.Message;
  let messageReferences = [];
  if (Message && rootIds.length > 0) {
    const messages = await Message.find({
      user: String(userId),
      ...(tenantId != null ? { tenantId } : {}),
      'files.file_id': { $in: rootIds },
    })
      .select('conversationId messageId files.file_id')
      .lean();
    messageReferences = messages.flatMap((message) =>
      (message.files || [])
        .filter((file) => rootIds.includes(String(file?.file_id || '')))
        .map((file) => ({
          fileId: String(file.file_id),
          conversationId: message.conversationId,
          messageId: message.messageId,
        })),
    );
  }
  return { records, parseJobs, messageReferences };
}

async function dryRunArtifactGc({
  userId,
  tenantId,
  messageReferences = [],
  now = new Date(),
} = {}) {
  const inventory = await loadArtifactInventory({ userId, tenantId });
  const report = buildArtifactReport({
    ...inventory,
    messageReferences: [...inventory.messageReferences, ...messageReferences],
    now,
  });
  await createSanSuoArtifactAudit({
    userId,
    tenantId,
    artifactId: '*',
    action: 'dry_run',
    result: {
      totals: report.totals,
      candidateIds: report.candidates.map((item) => item.artifactId),
    },
  });
  return report;
}

async function setArtifactQuarantine({
  userId,
  tenantId,
  artifactId,
  action,
  actorType = 'system',
  actorId,
  reason,
  quarantineDays = 30,
  referenceSnapshot,
} = {}) {
  if (!['quarantine', 'restore'].includes(action)) throw new Error('Invalid artifact action');
  const inventory = await loadArtifactInventory({ userId, tenantId });
  const current = inventory.records.find((record) => getArtifactId(record) === String(artifactId));
  if (!current) return null;
  if (action === 'quarantine' && current.gcState === 'quarantined') return current;
  if (action === 'restore' && current.gcState !== 'quarantined') return current;
  const evaluated = evaluateGcCandidate(current, {
    ...inventory,
    messageReferences: [
      ...inventory.messageReferences,
      ...(referenceSnapshot?.messageReferences || []),
    ],
    now: new Date(),
  });
  if (action === 'quarantine' && !evaluated.eligible) {
    const error = new Error('Artifact is not eligible for quarantine');
    error.code = 'ARTIFACT_NOT_ELIGIBLE';
    error.evaluation = evaluated;
    throw error;
  }
  const update =
    action === 'quarantine'
      ? {
          gcState: 'quarantined',
          quarantineUntil: new Date(Date.now() + quarantineDays * 86400000),
        }
      : { gcState: 'active', quarantineUntil: null };
  const record = await updateSanSuoArtifactGovernance({ userId, tenantId, artifactId, update });
  if (!record) return null;
  await createSanSuoArtifactAudit({
    userId,
    tenantId,
    artifactId,
    action,
    actorType,
    actorId,
    reason,
    referenceSnapshot: referenceSnapshot || evaluated.references,
    result: { gcState: record.gcState, quarantineUntil: record.quarantineUntil },
  });
  return record;
}

module.exports = {
  ARTIFACT_TYPES,
  DEFAULT_RETENTION,
  classifyArtifact,
  resolveLineage,
  buildReferenceSnapshot,
  evaluateGcCandidate,
  buildArtifactReport,
  loadArtifactInventory,
  dryRunArtifactGc,
  setArtifactQuarantine,
};
