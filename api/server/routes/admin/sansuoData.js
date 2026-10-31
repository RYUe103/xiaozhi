const fs = require('fs/promises');
const path = require('path');
const multer = require('multer');
const express = require('express');
const mongoose = require('mongoose');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const { getAppConfig } = require('~/server/services/Config');
const db = require('~/models');
const { getSanSuoFileModel } = require('~/models/sansuoFile');
const SanSuoUsageEvent = require('~/models/sansuoUsageEvent');
const {
  getUsageOverview,
  getUserUsage,
  getUsageExport,
  getLegacyDeepRows,
} = require('~/server/services/SanSuoUsage');
const { readConfig: readSanSuoUiConfig, writeConfig: writeSanSuoUiConfig } = require('../sansuoUi');
const {
  archiveKnowledgeConnection,
  listKnowledgeConnections,
  saveKnowledgeConnection,
  testKnowledgeConnection,
} = require('~/server/services/SanSuoKnowledge');
const {
  addResource,
  archiveMaterial,
  deleteResource,
  getMaterialMarkdown,
  listMaterials,
  saveMaterial,
} = require('~/server/services/SanSuoIndustryMaterials');

const router = express.Router();
const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const CONFIRM_DELETE = 'DELETE_USER_DATA';
const CONFIRM_CLEANUP_OUTPUTS = 'CLEANUP_EXPIRED_OUTPUTS';
const OUTPUT_RETENTION_DAYS = new Set([30, 90, 180]);

router.use(requireJwtAuth, requireAdminAccess);
const materialUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

function getModels() {
  return {
    User: mongoose.models.User,
    Conversation: mongoose.models.Conversation,
    Message: mongoose.models.Message,
    File: mongoose.models.File,
    MemoryEntry: mongoose.models.MemoryEntry,
    Session: mongoose.models.Session,
    Transaction: mongoose.models.Transaction,
    SharedLink: mongoose.models.SharedLink,
    ConversationTag: mongoose.models.ConversationTag,
    ToolCall: mongoose.models.ToolCall,
    SanSuoFile: getSanSuoFileModel(),
  };
}

function oid(userId) {
  return mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
}

async function getUserOr404(userId, res) {
  const { User } = getModels();
  const user = await User.findById(userId).select('-password').lean();
  if (!user) {
    res.status(404).json({ message: 'User not found' });
    return null;
  }
  return user;
}

async function countUserData(userId) {
  const userObjectId = oid(userId);
  const {
    Conversation,
    Message,
    File,
    MemoryEntry,
    Session,
    Transaction,
    SharedLink,
    ConversationTag,
    ToolCall,
    SanSuoFile,
  } = getModels();

  const [
    files,
    conversations,
    messages,
    memoryEntries,
    sessions,
    transactions,
    sharedLinks,
    tags,
    toolCalls,
    sanSuoFiles,
  ] = await Promise.all([
    File.find({ user: userObjectId })
      .select('bytes filepath filename file_id context source metadata createdAt')
      .lean(),
    Conversation.countDocuments({ user: String(userId) }),
    Message.countDocuments({ user: String(userId) }),
    MemoryEntry.countDocuments({ userId: String(userId) }),
    Session.countDocuments({ userId: String(userId) }),
    Transaction.countDocuments({ user: String(userId) }),
    SharedLink.countDocuments({ user: String(userId) }),
    ConversationTag.countDocuments({ user: String(userId) }),
    ToolCall.countDocuments({ user: String(userId) }),
    SanSuoFile.countDocuments({ userId: userObjectId }),
  ]);

  const uploadBytes = files.reduce((sum, file) => sum + Number(file.bytes || 0), 0);
  const inputFiles = files.filter((file) => file.context !== 'execute_code');
  const outputFiles = files.filter((file) => file.context === 'execute_code');

  return {
    counts: {
      conversations,
      messages,
      files: files.length,
      inputFiles: inputFiles.length,
      outputFiles: outputFiles.length,
      memoryEntries,
      sessions,
      transactions,
      sharedLinks,
      conversationTags: tags,
      toolCalls,
      sanSuoFiles,
    },
    bytes: {
      uploadBytes,
      uploadMB: +(uploadBytes / 1024 / 1024).toFixed(2),
    },
  };
}

router.get('/users', async (req, res) => {
  const { User, File, Conversation, Message } = getModels();
  const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 50, 1), 100);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const query = String(req.query.query || '').trim();
  const filter = query
    ? {
        $or: [
          { name: new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
          { username: new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
          { email: new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
        ],
      }
    : {};
  const total = await User.countDocuments(filter);
  const sortField = ['createdAt', 'updatedAt', 'name', 'username'].includes(req.query.sort)
    ? req.query.sort
    : 'createdAt';
  const sortDirection = req.query.order === 'asc' ? 1 : -1;
  const users = await User.find(filter)
    .select('name username email provider role createdAt updatedAt')
    .sort({ [sortField]: sortDirection })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .lean();
  const userIds = users.map((user) => String(user._id));
  const objectIds = users.map((user) => user._id);
  const from = String(req.query.from || '');
  const to = String(req.query.to || '');
  const range = { from, to };
  const dateMatch = {};
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) dateMatch.$gte = new Date(`${from}T00:00:00+08:00`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    const end = new Date(`${to}T00:00:00+08:00`);
    end.setUTCDate(end.getUTCDate() + 1);
    dateMatch.$lt = end;
  }
  const createdAtFilter = Object.keys(dateMatch).length ? { createdAt: dateMatch } : {};
  const [conversationCounts, messageCounts, fileStats, usageStats] = await Promise.all([
    Conversation.aggregate([
      { $match: { user: { $in: userIds }, ...createdAtFilter } },
      { $group: { _id: '$user', count: { $sum: 1 } } },
    ]),
    Message.aggregate([
      { $match: { user: { $in: userIds }, ...createdAtFilter } },
      { $group: { _id: '$user', count: { $sum: 1 } } },
    ]),
    File.aggregate([
      { $match: { user: { $in: objectIds }, ...createdAtFilter } },
      { $group: { _id: '$user', count: { $sum: 1 }, bytes: { $sum: '$bytes' } } },
    ]),
    SanSuoUsageEvent.aggregate([
      {
        $match: {
          userId: { $in: objectIds },
          ...(Object.keys(dateMatch).length ? { occurredAt: dateMatch } : {}),
        },
      },
      {
        $group: {
          _id: { userId: '$userId', type: '$eventType', mode: '$mode' },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);
  const byUser = (rows) =>
    new Map(rows.map((row) => [String(row._id), { count: row.count || 0, bytes: row.bytes || 0 }]));
  const convos = byUser(conversationCounts);
  const messages = byUser(messageCounts);
  const files = byUser(fileStats);
  const usage = new Map();
  for (const row of usageStats) {
    const id = String(row._id.userId);
    const current = usage.get(id) || {
      total: 0,
      fast: 0,
      deep: 0,
      knowledge: 0,
      activeDays: new Set(),
    };
    if (['chat_request', 'knowledge_query'].includes(row._id.type)) {
      current.total += row.count;
    }
    if (row._id.mode && current[row._id.mode] != null) current[row._id.mode] += row.count;
    usage.set(id, current);
  }
  const usageEvents = await SanSuoUsageEvent.find({
    userId: { $in: objectIds },
    ...(Object.keys(dateMatch).length ? { occurredAt: dateMatch } : {}),
  })
    .select('userId occurredAt')
    .lean();
  usageEvents.forEach((event) =>
    usage
      .get(String(event.userId))
      ?.activeDays.add(new Date(event.occurredAt).toISOString().slice(0, 10)),
  );
  const legacyRows = await getLegacyDeepRows({ from, to }, userIds);
  for (const row of legacyRows) {
    const current = usage.get(String(row.userId)) || {
      total: 0,
      fast: 0,
      deep: 0,
      knowledge: 0,
      activeDays: new Set(),
    };
    current.total += row.count;
    current.deep += row.count;
    for (const day of row.activeDays || []) current.activeDays.add(day);
    usage.set(String(row.userId), current);
  }
  res.json({
    users: users.map((user) => {
      const id = String(user._id);
      const userFiles = files.get(id) || { count: 0, bytes: 0 };
      return {
        ...user,
        _id: id,
        counts: {
          conversations: convos.get(id)?.count || 0,
          messages: messages.get(id)?.count || 0,
          files: userFiles.count || 0,
        },
        bytes: {
          uploadBytes: userFiles.bytes || 0,
          uploadMB: +((userFiles.bytes || 0) / 1024 / 1024).toFixed(2),
        },
        usage: {
          from: from || null,
          to: to || null,
          requests: usage.get(id)?.total || 0,
          fast: usage.get(id)?.fast || 0,
          deep: usage.get(id)?.deep || 0,
          knowledge: usage.get(id)?.knowledge || 0,
          activeDays: usage.get(id)?.activeDays.size || 0,
        },
      };
    }),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      from: from || null,
      to: to || null,
    },
  });
});

router.get('/usage/overview', async (req, res) => {
  res.json(await getUsageOverview({ from: req.query.from, to: req.query.to }));
});

router.get('/usage/users/:userId', async (req, res) => {
  const usage = await getUserUsage(req.params.userId, { from: req.query.from, to: req.query.to });
  if (!usage) return res.status(404).json({ message: 'User not found' });
  res.json(usage);
});

router.get('/usage/export', async (req, res) => {
  try {
    const payload = await getUsageExport({ from: req.query.from, to: req.query.to });
    const filename = `sansuo-usage-${req.query.from || 'all'}-${req.query.to || 'all'}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          note: '仅包含使用统计元数据，不包含聊天记录、问题正文、回答正文或文件内容。',
          ...payload,
        },
        null,
        2,
      ),
    );
  } catch (_error) {
    res.status(500).json({ message: '使用数据导出失败' });
  }
});

async function buildUserExport(userId) {
  const userObjectId = oid(userId);
  const {
    User,
    Conversation,
    Message,
    File,
    MemoryEntry,
    Session,
    Transaction,
    SharedLink,
    ConversationTag,
    ToolCall,
    SanSuoFile,
  } = getModels();
  const user = await User.findById(userId).select('-password').lean();
  const [
    conversations,
    messages,
    files,
    memoryEntries,
    sessions,
    transactions,
    sharedLinks,
    tags,
    toolCalls,
    sanSuoFiles,
  ] = await Promise.all([
    Conversation.find({ user: String(userId) }).lean(),
    Message.find({ user: String(userId) }).lean(),
    File.find({ user: userObjectId }).select('-text').lean(),
    MemoryEntry.find({ userId: String(userId) }).lean(),
    Session.find({ userId: String(userId) }).lean(),
    Transaction.find({ user: String(userId) }).lean(),
    SharedLink.find({ user: String(userId) }).lean(),
    ConversationTag.find({ user: String(userId) }).lean(),
    ToolCall.find({ user: String(userId) }).lean(),
    SanSuoFile.find({ userId: userObjectId }).lean(),
  ]);
  const everosMemories = await readEverOSMemoriesForExport(userId);

  return {
    exportedAt: new Date().toISOString(),
    user,
    counts: {
      conversations: conversations.length,
      messages: messages.length,
      files: files.length,
      memoryEntries: memoryEntries.length,
      sessions: sessions.length,
      transactions: transactions.length,
      sharedLinks: sharedLinks.length,
      conversationTags: tags.length,
      toolCalls: toolCalls.length,
      sanSuoFiles: sanSuoFiles.length,
      everosMemories: everosMemories.memories.length,
    },
    data: {
      conversations,
      messages,
      files,
      sanSuoFiles,
      memoryEntries,
      everosMemories: everosMemories.memories,
      sessions,
      transactions,
      sharedLinks,
      conversationTags: tags,
      toolCalls,
    },
    everosExport: {
      ok: everosMemories.ok,
      error: everosMemories.error,
      note: 'EverOS memories are exported from getAllUserMemories. When EverOS is enabled this prefers EverOS stable memories; if EverOS has no records or is unavailable, it may return the local fallback cache.',
    },
    fileExportNote:
      'Binary files are stored under uploads/<userId>/ and should be copied with the exported JSON when migrating.',
  };
}

async function readEverOSMemoriesForExport(userId) {
  if (typeof db.getAllUserMemories !== 'function') {
    return { ok: false, memories: [], error: 'getAllUserMemories unavailable' };
  }
  try {
    const memories = await db.getAllUserMemories(userId);
    return { ok: true, memories: Array.isArray(memories) ? memories : [] };
  } catch (error) {
    return { ok: false, memories: [], error: error.message || String(error) };
  }
}

async function removeUserUploadDir(userId) {
  const appConfig = await getAppConfig();
  const uploadsDir = appConfig.paths.uploads;
  const target = path.join(uploadsDir, String(userId));
  const rel = path.relative(uploadsDir, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Refusing to delete unsafe upload path');
  }
  await fs.rm(target, { recursive: true, force: true });
  return target;
}

function parseOutputRetentionDays(value) {
  const days = Number(value || 90);
  if (!OUTPUT_RETENTION_DAYS.has(days)) {
    const allowed = Array.from(OUTPUT_RETENTION_DAYS).join(', ');
    throw new Error(`Invalid outputDays. Allowed values: ${allowed}`);
  }
  return days;
}

async function removeUploadFile(file) {
  if (!file?.filepath) {
    return { ok: false, reason: 'missing filepath' };
  }
  const appConfig = await getAppConfig();
  const uploadsDir = appConfig.paths.uploads;
  const cleanFilepath = String(file.filepath).split('?')[0];
  const marker = '/uploads/';
  const markerIndex = cleanFilepath.indexOf(marker);
  if (markerIndex < 0) {
    return { ok: false, reason: 'not local upload filepath' };
  }
  const relativeUploadPath = cleanFilepath.slice(markerIndex + marker.length);
  const target = path.join(uploadsDir, relativeUploadPath);
  const rel = path.relative(uploadsDir, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Refusing to delete unsafe file path: ${cleanFilepath}`);
  }
  await fs.rm(target, { force: true });
  return { ok: true, path: target };
}

async function getExpiredOutputFiles(days) {
  const { File } = getModels();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const files = await File.find({
    context: 'execute_code',
    createdAt: { $lt: cutoff },
  })
    .select('user bytes filepath filename file_id context createdAt')
    .lean();
  const bytes = files.reduce((sum, file) => sum + Number(file.bytes || 0), 0);
  return { cutoff, files, bytes };
}

async function cleanupExpiredOutputFiles(days) {
  const { File, SanSuoFile } = getModels();
  const { cutoff, files, bytes } = await getExpiredOutputFiles(days);
  const fileIds = files.map((file) => file.file_id).filter(Boolean);
  const fileDeletes = [];
  for (const file of files) {
    fileDeletes.push(await removeUploadFile(file));
  }
  const dbResult = fileIds.length
    ? await File.deleteMany({ file_id: { $in: fileIds }, context: 'execute_code' })
    : { deletedCount: 0 };
  const gatewayResult = fileIds.length
    ? await SanSuoFile.updateMany(
        { libreFileId: { $in: fileIds }, role: 'output' },
        { $set: { status: 'deleted' } },
      )
    : { modifiedCount: 0 };
  return {
    days,
    cutoff,
    files: files.length,
    bytes,
    bytesMB: +(bytes / 1024 / 1024).toFixed(2),
    dbDeleted: dbResult.deletedCount || 0,
    gatewayMarkedDeleted: gatewayResult.modifiedCount || 0,
    fileDeletes,
  };
}

async function deleteUserData(userId, options = {}) {
  const userObjectId = oid(userId);
  const {
    Conversation,
    Message,
    File,
    MemoryEntry,
    Session,
    Transaction,
    SharedLink,
    ConversationTag,
    ToolCall,
    SanSuoFile,
  } = getModels();
  const results = {};

  results.sanSuoFiles = await SanSuoFile.deleteMany({ userId: userObjectId });
  results.memoryEntries = await MemoryEntry.deleteMany({ userId: String(userId) });
  results.toolCalls = await ToolCall.deleteMany({ user: String(userId) });
  results.sharedLinks = await SharedLink.deleteMany({ user: String(userId) });
  results.conversationTags = await ConversationTag.deleteMany({ user: String(userId) });
  results.messages = await Message.deleteMany({ user: String(userId) });
  results.conversations = await Conversation.deleteMany({ user: String(userId) });
  results.files = await File.deleteMany({ user: userObjectId });
  results.sessions = await Session.deleteMany({ userId: String(userId) });
  results.transactions = await Transaction.deleteMany({ user: String(userId) });
  results.usageEvents = await SanSuoUsageEvent.deleteMany({ userId: userObjectId });

  if (options.deleteEverOS !== false && typeof db.deleteAllUserMemories === 'function') {
    try {
      results.everosMemories = await db.deleteAllUserMemories(userId);
    } catch (error) {
      results.everosMemories = { ok: false, error: error.message };
    }
  }

  if (options.deleteFiles !== false) {
    try {
      results.uploadDirectory = await removeUserUploadDir(userId);
    } catch (error) {
      results.uploadDirectory = { ok: false, error: error.message };
    }
  }

  if (options.deleteAccount === true) {
    results.user = await db.deleteUserById(userId);
  }

  return results;
}

router.get('/users/:userId/summary', async (req, res) => {
  const user = await getUserOr404(req.params.userId, res);
  if (!user) {
    return;
  }
  const summary = await countUserData(req.params.userId);
  const usage = await getUserUsage(req.params.userId, { from: req.query.from, to: req.query.to });
  res.json({ user, ...summary, usage });
});

router.get('/users/:userId/export', async (req, res) => {
  const user = await getUserOr404(req.params.userId, res);
  if (!user) {
    return;
  }
  const payload = await buildUserExport(req.params.userId);
  const filename = `sansuo-user-export-${req.params.userId}-${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')}.json`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(payload, null, 2));
});

router.post('/users/:userId/delete-preview', async (req, res) => {
  const user = await getUserOr404(req.params.userId, res);
  if (!user) {
    return;
  }
  const summary = await countUserData(req.params.userId);
  res.json({
    dryRun: true,
    user,
    ...summary,
    requiredConfirm: CONFIRM_DELETE,
    note: 'No data was deleted. Send DELETE with confirm=DELETE_USER_DATA to execute.',
  });
});

router.get('/retention/outputs-preview', async (req, res) => {
  try {
    const days = parseOutputRetentionDays(req.query.outputDays);
    const { cutoff, files, bytes } = await getExpiredOutputFiles(days);
    res.json({
      dryRun: true,
      policy: {
        inputUploads: 'permanent',
        assistantOutputs: `${days} days`,
      },
      cutoff,
      counts: {
        expiredOutputFiles: files.length,
      },
      bytes: {
        expiredOutputBytes: bytes,
        expiredOutputMB: +(bytes / 1024 / 1024).toFixed(2),
      },
      sample: files.slice(0, 20).map((file) => ({
        file_id: file.file_id,
        filename: file.filename,
        user: file.user,
        createdAt: file.createdAt,
        bytes: file.bytes,
      })),
      requiredConfirm: CONFIRM_CLEANUP_OUTPUTS,
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/retention/cleanup-outputs', async (req, res) => {
  try {
    const days = parseOutputRetentionDays(req.query.outputDays || req.body?.outputDays);
    const confirm = req.query.confirm || req.body?.confirm;
    if (confirm !== CONFIRM_CLEANUP_OUTPUTS) {
      return res.status(400).json({
        message: 'Cleanup not confirmed',
        requiredConfirm: CONFIRM_CLEANUP_OUTPUTS,
      });
    }
    const result = await cleanupExpiredOutputFiles(days);
    res.json({ cleaned: true, result });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.get('/ui-config', async (_req, res) => {
  res.json(await readSanSuoUiConfig());
});

router.put('/ui-config', async (req, res) => {
  const next = await writeSanSuoUiConfig(req.body || {});
  res.json(next);
});

function sendKnowledgeConfigError(res, error) {
  const statusByCode = {
    authentication: 401,
    disabled: 409,
    invalid_config: 400,
    not_found: 404,
    timeout: 504,
  };
  const status =
    statusByCode[error?.code] ||
    (['invalid_json', 'invalid_response', 'network', 'upstream_http'].includes(error?.code)
      ? 502
      : 500);
  res.status(status).json({
    message: error?.message || '知识库配置操作失败',
    errorType: error?.code || 'unknown',
  });
}

router.get('/knowledge-bases', async (_req, res) => {
  try {
    res.json(await listKnowledgeConnections());
  } catch (error) {
    sendKnowledgeConfigError(res, error);
  }
});

router.post('/knowledge-bases/test', async (req, res) => {
  try {
    res.json(await testKnowledgeConnection(req.body || {}, req.signal));
  } catch (error) {
    sendKnowledgeConfigError(res, error);
  }
});

router.post('/knowledge-bases', async (req, res) => {
  try {
    res.status(201).json(await saveKnowledgeConnection(req.body || {}));
  } catch (error) {
    sendKnowledgeConfigError(res, error);
  }
});

router.put('/knowledge-bases/:knowledgeBaseId', async (req, res) => {
  try {
    res.json(await saveKnowledgeConnection(req.body || {}, req.params.knowledgeBaseId));
  } catch (error) {
    sendKnowledgeConfigError(res, error);
  }
});

router.delete('/knowledge-bases/:knowledgeBaseId', async (req, res) => {
  try {
    await archiveKnowledgeConnection(req.params.knowledgeBaseId);
    res.status(204).end();
  } catch (error) {
    sendKnowledgeConfigError(res, error);
  }
});

function sendMaterialError(res, error) {
  res.status(error?.status || (error?.code === 'LIMIT_FILE_SIZE' ? 413 : 500)).json({
    message: error?.message || '行业资料操作失败',
  });
}

router.get('/industry-materials', async (_req, res) => {
  try {
    res.json(await listMaterials({ admin: true }));
  } catch (error) {
    sendMaterialError(res, error);
  }
});

router.get('/industry-materials/:materialId/markdown', async (req, res) => {
  try {
    const material = await getMaterialMarkdown(req.params.materialId);
    const filename = `${material.name || material.materialId}.md`;
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    res.send(material.markdown);
  } catch (error) {
    sendMaterialError(res, error);
  }
});

router.post('/industry-materials', async (req, res) => {
  try {
    res.status(201).json(await saveMaterial(req.body || {}));
  } catch (error) {
    sendMaterialError(res, error);
  }
});

router.put('/industry-materials/:materialId', async (req, res) => {
  try {
    res.json(await saveMaterial(req.body || {}, req.params.materialId));
  } catch (error) {
    sendMaterialError(res, error);
  }
});

router.delete('/industry-materials/:materialId', async (req, res) => {
  try {
    await archiveMaterial(req.params.materialId);
    res.status(204).end();
  } catch (error) {
    sendMaterialError(res, error);
  }
});

for (const [routeName, kind] of [
  ['assets', 'assets'],
  ['sources', 'sourceFiles'],
]) {
  router.post(
    `/industry-materials/:materialId/${routeName}`,
    materialUpload.single('file'),
    async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ message: '请选择文件' });
        }
        res.status(201).json(await addResource(req.params.materialId, kind, req.file));
      } catch (error) {
        sendMaterialError(res, error);
      }
    },
  );
  router.delete(`/industry-materials/:materialId/${routeName}/:resourceId`, async (req, res) => {
    try {
      await deleteResource(req.params.materialId, kind, req.params.resourceId);
      res.status(204).end();
    } catch (error) {
      sendMaterialError(res, error);
    }
  });
}

router.delete('/users/:userId', async (req, res) => {
  const user = await getUserOr404(req.params.userId, res);
  if (!user) {
    return;
  }
  const confirm = req.query.confirm || req.body?.confirm;
  if (confirm !== CONFIRM_DELETE) {
    return res.status(400).json({
      message: 'Deletion not confirmed',
      requiredConfirm: CONFIRM_DELETE,
    });
  }
  if (String(req.user.id) === String(req.params.userId) && req.query.deleteAccount === 'true') {
    return res
      .status(400)
      .json({ message: 'Refusing to delete the currently logged-in admin account' });
  }
  const before = await countUserData(req.params.userId);
  const result = await deleteUserData(req.params.userId, {
    deleteAccount: req.query.deleteAccount === 'true' || req.body?.deleteAccount === true,
    deleteFiles: req.query.deleteFiles !== 'false' && req.body?.deleteFiles !== false,
    deleteEverOS: req.query.deleteEverOS !== 'false' && req.body?.deleteEverOS !== false,
  });
  res.json({ deleted: true, user, before, result });
});

module.exports = router;
