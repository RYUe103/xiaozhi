const mongoose = require('mongoose');

const SanSuoFileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
      required: true,
    },
    tenantId: {
      type: String,
      index: true,
    },
    conversationId: {
      type: String,
      index: true,
    },
    messageId: {
      type: String,
      index: true,
    },
    toolCallId: {
      type: String,
      index: true,
    },
    role: {
      type: String,
      enum: ['input', 'output'],
      required: true,
      index: true,
    },
    source: {
      type: String,
      enum: ['upload', 'sandbox', 'backend'],
      required: true,
      index: true,
    },
    originalFilename: {
      type: String,
      required: true,
    },
    displayFilename: {
      type: String,
      required: true,
    },
    mimeType: {
      type: String,
    },
    size: {
      type: Number,
    },
    libreFileId: {
      type: String,
      index: true,
      required: true,
    },
    libreFilepath: {
      type: String,
    },
    sandboxSessionId: {
      type: String,
      index: true,
    },
    sandboxFileId: {
      type: String,
      index: true,
    },
    sandboxPath: {
      type: String,
    },
    status: {
      type: String,
      enum: ['ready', 'failed', 'deleted'],
      default: 'ready',
      index: true,
    },
    artifactType: {
      type: String,
      enum: ['source', 'derived', 'working', 'cache', 'deliverable'],
      index: true,
    },
    parentArtifactId: { type: String, index: true },
    rootArtifactId: { type: String, index: true },
    retentionPolicy: {
      type: String,
      enum: ['retain', 'retain_with_source', 'task_ttl', 'cache_ttl', 'user_managed'],
      index: true,
    },
    lastAccessedAt: { type: Date, index: true },
    gcState: {
      type: String,
      enum: ['active', 'candidate', 'quarantined'],
      default: 'active',
      index: true,
    },
    quarantineUntil: { type: Date, default: null, index: true },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: undefined,
    },
  },
  { timestamps: true },
);

const SanSuoFileParseJobSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tenantId: { type: String, index: true },
    libreFileId: { type: String, required: true, index: true },
    parserVersion: { type: String, required: true, default: 'document-preparse-v1' },
    conversationId: { type: String, index: true },
    messageId: { type: String, index: true },
    filename: { type: String, required: true },
    mimeType: { type: String, required: true },
    sourceRef: {
      storage_session_id: { type: String, required: true },
      file_id: { type: String, required: true },
    },
    status: {
      type: String,
      enum: ['pending', 'running', 'ready', 'failed'],
      default: 'pending',
      index: true,
    },
    attempts: { type: Number, default: 0 },
    leaseUntil: { type: Date, default: null, index: true },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    artifactCount: { type: Number, default: 0 },
    artifacts: { type: [String], default: undefined },
    errorCode: { type: String },
    errorMessage: { type: String },
  },
  { timestamps: true },
);

const SanSuoArtifactAuditSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tenantId: { type: String, index: true },
    artifactId: { type: String, required: true, index: true },
    action: {
      type: String,
      enum: ['dry_run', 'quarantine', 'restore'],
      required: true,
      index: true,
    },
    actorType: { type: String, enum: ['user', 'admin', 'system'], default: 'system' },
    actorId: { type: String },
    reason: { type: String },
    referenceSnapshot: { type: mongoose.Schema.Types.Mixed },
    result: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true },
);

SanSuoFileParseJobSchema.index({ userId: 1, libreFileId: 1, parserVersion: 1 }, { unique: true });

SanSuoFileSchema.index({ libreFileId: 1, role: 1 }, { unique: true });
SanSuoFileSchema.index({ userId: 1, conversationId: 1, role: 1, createdAt: -1 });
SanSuoFileSchema.index({ sandboxSessionId: 1, sandboxFileId: 1 });

const getSanSuoFileModel = () =>
  mongoose.models.SanSuoFile || mongoose.model('SanSuoFile', SanSuoFileSchema);

const getSanSuoFileParseJobModel = () =>
  mongoose.models.SanSuoFileParseJob ||
  mongoose.model('SanSuoFileParseJob', SanSuoFileParseJobSchema);

const getSanSuoArtifactAuditModel = () =>
  mongoose.models.SanSuoArtifactAudit ||
  mongoose.model('SanSuoArtifactAudit', SanSuoArtifactAuditSchema);

let indexesReady;
let parseIndexesReady;

function ensureSanSuoFileIndexes() {
  if (!indexesReady) {
    const SanSuoFile = getSanSuoFileModel();
    indexesReady = Promise.all([
      SanSuoFile.collection.createIndex({ tenantId: 1 }),
      SanSuoFile.collection.createIndex({ conversationId: 1 }),
      SanSuoFile.collection.createIndex({ messageId: 1 }),
      SanSuoFile.collection.createIndex({ toolCallId: 1 }),
      SanSuoFile.collection.createIndex({ role: 1 }),
      SanSuoFile.collection.createIndex({ source: 1 }),
      SanSuoFile.collection.createIndex({ libreFileId: 1 }),
      SanSuoFile.collection.createIndex({ sandboxSessionId: 1 }),
      SanSuoFile.collection.createIndex({ sandboxFileId: 1 }),
      SanSuoFile.collection.createIndex({ status: 1 }),
      SanSuoFile.collection.createIndex({ artifactType: 1, gcState: 1, lastAccessedAt: 1 }),
      SanSuoFile.collection.createIndex({ rootArtifactId: 1, artifactType: 1 }),
      SanSuoFile.collection.createIndex({ libreFileId: 1, role: 1 }, { unique: true }),
      SanSuoFile.collection.createIndex({ userId: 1, conversationId: 1, role: 1, createdAt: -1 }),
      SanSuoFile.collection.createIndex({ sandboxSessionId: 1, sandboxFileId: 1 }),
    ]).catch((error) => {
      indexesReady = undefined;
      throw error;
    });
  }
  return indexesReady;
}

function ensureSanSuoFileParseJobIndexes() {
  if (!parseIndexesReady) {
    const ParseJob = getSanSuoFileParseJobModel();
    parseIndexesReady = Promise.all([
      ParseJob.collection.createIndex(
        { userId: 1, libreFileId: 1, parserVersion: 1 },
        { unique: true },
      ),
      ParseJob.collection.createIndex({ userId: 1, status: 1, updatedAt: -1 }),
      ParseJob.collection.createIndex({ status: 1, leaseUntil: 1 }),
    ]).catch((error) => {
      parseIndexesReady = undefined;
      throw error;
    });
  }
  return parseIndexesReady;
}

function cleanUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

async function upsertSanSuoFileRecord(data = {}) {
  await ensureSanSuoFileIndexes();
  const SanSuoFile = getSanSuoFileModel();
  const record = cleanUndefined({
    userId: data.userId,
    tenantId: data.tenantId ?? null,
    conversationId: data.conversationId,
    messageId: data.messageId,
    toolCallId: data.toolCallId,
    role: data.role,
    source: data.source,
    originalFilename: data.originalFilename || data.displayFilename,
    displayFilename: data.displayFilename || data.originalFilename,
    mimeType: data.mimeType,
    size: data.size,
    libreFileId: data.libreFileId,
    libreFilepath: data.libreFilepath,
    sandboxSessionId: data.sandboxSessionId,
    sandboxFileId: data.sandboxFileId,
    sandboxPath: data.sandboxPath,
    status: data.status || 'ready',
    artifactType: data.artifactType,
    parentArtifactId: data.parentArtifactId,
    rootArtifactId: data.rootArtifactId,
    retentionPolicy: data.retentionPolicy,
    lastAccessedAt: data.lastAccessedAt,
    gcState: data.gcState,
    quarantineUntil: data.quarantineUntil,
    metadata: data.metadata,
  });

  if (!record.userId || !record.role || !record.source || !record.libreFileId) {
    throw new Error('Missing required SanSuo file gateway fields');
  }

  return SanSuoFile.findOneAndUpdate(
    { libreFileId: record.libreFileId, role: record.role },
    { $set: record },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
}

async function markSanSuoFilesDeletedByLibreIds(libreFileIds = []) {
  if (!Array.isArray(libreFileIds) || libreFileIds.length === 0) {
    return { modifiedCount: 0 };
  }
  await ensureSanSuoFileIndexes();
  const SanSuoFile = getSanSuoFileModel();
  return SanSuoFile.updateMany(
    { libreFileId: { $in: libreFileIds } },
    { $set: { status: 'deleted' } },
  );
}

async function getSanSuoFiles(filter = {}, options = {}) {
  await ensureSanSuoFileIndexes();
  const SanSuoFile = getSanSuoFileModel();
  const query = SanSuoFile.find(filter);
  if (options.select) {
    query.select(options.select);
  }
  return query.sort(options.sort || { createdAt: -1 }).lean();
}

async function touchSanSuoArtifacts({
  userId,
  tenantId,
  libreFileIds = [],
  accessedAt = new Date(),
} = {}) {
  const ids = Array.from(new Set(libreFileIds.filter(Boolean)));
  if (!userId || ids.length === 0) return { modifiedCount: 0 };
  await ensureSanSuoFileIndexes();
  return getSanSuoFileModel().updateMany(
    {
      userId,
      ...(tenantId != null ? { tenantId } : {}),
      libreFileId: { $in: ids },
      status: { $ne: 'deleted' },
    },
    { $max: { lastAccessedAt: accessedAt } },
  );
}

async function updateSanSuoArtifactGovernance({ userId, tenantId, artifactId, update = {} } = {}) {
  if (!userId || !artifactId) throw new Error('Missing artifact governance identity');
  const allowed = cleanUndefined({
    artifactType: update.artifactType,
    parentArtifactId: update.parentArtifactId,
    rootArtifactId: update.rootArtifactId,
    retentionPolicy: update.retentionPolicy,
    lastAccessedAt: update.lastAccessedAt,
    gcState: update.gcState,
    quarantineUntil: update.quarantineUntil,
  });
  await ensureSanSuoFileIndexes();
  return getSanSuoFileModel()
    .findOneAndUpdate(
      { userId, ...(tenantId != null ? { tenantId } : {}), libreFileId: artifactId },
      { $set: allowed },
      { new: true },
    )
    .lean();
}

async function createSanSuoArtifactAudit(data = {}) {
  if (!data.userId || !data.artifactId || !data.action) {
    throw new Error('Missing artifact audit fields');
  }
  return getSanSuoArtifactAuditModel().create({
    userId: data.userId,
    tenantId: data.tenantId ?? null,
    artifactId: data.artifactId,
    action: data.action,
    actorType: data.actorType || 'system',
    actorId: data.actorId,
    reason: data.reason,
    referenceSnapshot: data.referenceSnapshot,
    result: data.result,
  });
}

async function upsertSanSuoFileParseJob(data = {}) {
  await ensureSanSuoFileParseJobIndexes();
  const ParseJob = getSanSuoFileParseJobModel();
  const parserVersion = data.parserVersion || 'document-preparse-v1';
  const identity = {
    userId: data.userId,
    libreFileId: data.libreFileId,
    parserVersion,
  };
  if (!identity.userId || !identity.libreFileId) {
    throw new Error('Missing required SanSuo file parse identity');
  }
  const sourceRef = data.sourceRef || {};
  if (!sourceRef.storage_session_id || !sourceRef.file_id || !data.filename || !data.mimeType) {
    throw new Error('Missing required SanSuo file parse source fields');
  }
  return ParseJob.findOneAndUpdate(
    identity,
    {
      $set: cleanUndefined({
        tenantId: data.tenantId ?? null,
        conversationId: data.conversationId,
        messageId: data.messageId,
        filename: data.filename,
        mimeType: data.mimeType,
        sourceRef: {
          storage_session_id: sourceRef.storage_session_id,
          file_id: sourceRef.file_id,
        },
      }),
      $setOnInsert: {
        status: 'pending',
        attempts: 0,
        artifactCount: 0,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
}

async function getSanSuoFileParseJobs(filter = {}, options = {}) {
  await ensureSanSuoFileParseJobIndexes();
  const query = getSanSuoFileParseJobModel().find(filter);
  if (options.select) {
    query.select(options.select);
  }
  return query.sort(options.sort || { createdAt: 1 }).lean();
}

async function claimSanSuoFileParseJob({ jobId, leaseMs = 180000, maxAttempts = 3 } = {}) {
  await ensureSanSuoFileParseJobIndexes();
  const now = new Date();
  return getSanSuoFileParseJobModel()
    .findOneAndUpdate(
      {
        _id: jobId,
        attempts: { $lt: maxAttempts },
        $or: [
          { status: 'pending' },
          { status: 'failed' },
          { status: 'running', leaseUntil: { $lt: now } },
          { status: 'running', leaseUntil: null },
        ],
      },
      {
        $set: {
          status: 'running',
          startedAt: now,
          leaseUntil: new Date(now.getTime() + leaseMs),
          completedAt: null,
        },
        $unset: { errorCode: 1, errorMessage: 1 },
        $inc: { attempts: 1 },
      },
      { new: true },
    )
    .lean();
}

async function finishSanSuoFileParseJob({
  jobId,
  status,
  artifacts = [],
  errorCode,
  errorMessage,
}) {
  await ensureSanSuoFileParseJobIndexes();
  const terminalStatus = status === 'ready' ? 'ready' : 'failed';
  return getSanSuoFileParseJobModel()
    .findOneAndUpdate(
      { _id: jobId },
      {
        $set: cleanUndefined({
          status: terminalStatus,
          leaseUntil: null,
          completedAt: new Date(),
          artifactCount: Array.isArray(artifacts) ? artifacts.length : 0,
          artifacts: Array.isArray(artifacts) ? artifacts.slice(0, 500) : [],
          errorCode,
          errorMessage: errorMessage ? String(errorMessage).slice(0, 500) : undefined,
        }),
        ...(terminalStatus === 'ready' ? { $unset: { errorCode: 1, errorMessage: 1 } } : {}),
      },
      { new: true },
    )
    .lean();
}

async function syncSanSuoFileMessageRefs({ userId, message } = {}) {
  const fileIds = (message?.files || []).map((file) => file?.file_id).filter(Boolean);

  if (!userId || !message?.messageId || !message?.conversationId || fileIds.length === 0) {
    return { inputFiles: 0, derivedArtifacts: 0, parseJobs: 0 };
  }

  return rebindSanSuoFileConversationRefs({
    userId,
    fileIds,
    conversationId: message.conversationId,
    messageId: message.messageId,
  });
}

async function rebindSanSuoFileConversationRefs({
  userId,
  fileIds = [],
  conversationId,
  messageId,
} = {}) {
  const rootFileIds = Array.from(new Set(fileIds.filter(Boolean)));
  if (!userId || !conversationId || conversationId === 'new' || rootFileIds.length === 0) {
    return { inputFiles: 0, derivedArtifacts: 0, parseJobs: 0 };
  }

  await Promise.all([ensureSanSuoFileIndexes(), ensureSanSuoFileParseJobIndexes()]);
  const SanSuoFile = getSanSuoFileModel();
  const ParseJob = getSanSuoFileParseJobModel();
  const eligibleConversation = {
    $or: [{ conversationId: 'new' }, { conversationId: null }, { conversationId }],
  };
  const messageFields = cleanUndefined({ conversationId, messageId });

  const [inputResult, artifactResult, parseJobResult] = await Promise.all([
    SanSuoFile.updateMany(
      {
        userId,
        libreFileId: { $in: rootFileIds },
        role: 'input',
        ...eligibleConversation,
      },
      { $set: messageFields },
    ),
    SanSuoFile.updateMany(
      {
        userId,
        role: 'output',
        'metadata.rootSourceLibreFileId': { $in: rootFileIds },
        ...eligibleConversation,
      },
      { $set: messageFields },
    ),
    ParseJob.updateMany(
      {
        userId,
        libreFileId: { $in: rootFileIds },
        ...eligibleConversation,
      },
      { $set: messageFields },
    ),
  ]);

  return {
    inputFiles: inputResult.modifiedCount || 0,
    derivedArtifacts: artifactResult.modifiedCount || 0,
    parseJobs: parseJobResult.modifiedCount || 0,
  };
}

module.exports = {
  getSanSuoFileModel,
  getSanSuoFileParseJobModel,
  getSanSuoArtifactAuditModel,
  upsertSanSuoFileRecord,
  markSanSuoFilesDeletedByLibreIds,
  getSanSuoFiles,
  touchSanSuoArtifacts,
  updateSanSuoArtifactGovernance,
  createSanSuoArtifactAudit,
  upsertSanSuoFileParseJob,
  getSanSuoFileParseJobs,
  claimSanSuoFileParseJob,
  finishSanSuoFileParseJob,
  syncSanSuoFileMessageRefs,
  rebindSanSuoFileConversationRefs,
};
