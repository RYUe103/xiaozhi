const express = require('express');
const mongoose = require('mongoose');
const { requireJwtAuth } = require('~/server/middleware');
const {
  fetchSourceFile,
  listAgents,
  listKnowledgeConnections,
  sanitizeAgentId,
} = require('~/server/services/SanSuoKnowledge');
const {
  DEFAULT_MATERIAL_PROMPT_TEMPLATE,
  getResource,
  listMaterials,
} = require('~/server/services/SanSuoIndustryMaterials');

const router = express.Router();
const CONFIG_KEY = 'main';
const MAX_ALLOWED_USER_IDS = 5000;

const defaultConfig = {
  appLinks: [
    {
      id: 'mingdao',
      label: '明道云',
      url: process.env.SANSUO_MINGDAO_URL || '',
      icon: 'blocks',
      enabled: true,
    },
  ],
  announcement: {
    title: '公告',
    body: '暂无公告。',
    imageUrl: '',
    showOnLogin: false,
    updatedAt: null,
  },
  knowledgeSources: {
    knowledgeLabel: '大知识库',
    materialsLabel: '行业资料',
    materialPromptTemplate: DEFAULT_MATERIAL_PROMPT_TEMPLATE,
  },
};

function getCollection() {
  return mongoose.connection.collection('sansuo_ui_configs');
}

function getPreferencesCollection() {
  return mongoose.connection.collection('sansuo_user_preferences');
}

function sanitizePreferences(input = {}) {
  const answerMode = ['fast', 'deep', 'knowledge'].includes(input.answerMode)
    ? input.answerMode
    : 'fast';
  return {
    answerMode,
    knowledgeAgentId: sanitizeAgentId(input.knowledgeAgentId) || null,
  };
}

async function readPreferences(userId) {
  const doc = await getPreferencesCollection().findOne({ userId: String(userId) });
  return sanitizePreferences(doc?.value);
}

async function writePreferences(userId, value) {
  const next = sanitizePreferences(value);
  await getPreferencesCollection().updateOne(
    { userId: String(userId) },
    { $set: { userId: String(userId), value: next, updatedAt: new Date() } },
    { upsert: true },
  );
  return next;
}

function sanitizeLink(link, index) {
  const allowedUserIds = Array.isArray(link?.allowedUserIds)
    ? Array.from(
        new Set(link.allowedUserIds.map((userId) => String(userId || '').trim()).filter(Boolean)),
      ).slice(0, MAX_ALLOWED_USER_IDS)
    : undefined;

  const rawEntryNotice = link?.entryNotice;
  const entryNotice =
    rawEntryNotice && typeof rawEntryNotice === 'object'
      ? {
          title: String(rawEntryNotice.title || '')
            .trim()
            .slice(0, 100),
          body: String(rawEntryNotice.body || '').slice(0, 20000),
          imageUrl: String(rawEntryNotice.imageUrl || '')
            .trim()
            .slice(0, 1000),
          confirmLabel: String(rawEntryNotice.confirmLabel || '确认进入')
            .trim()
            .slice(0, 30),
        }
      : undefined;
  const hasEntryNoticeContent = Boolean(
    entryNotice?.title || entryNotice?.body || entryNotice?.imageUrl,
  );

  return {
    id: String(link?.id || `link-${index}`)
      .trim()
      .slice(0, 64),
    label: String(link?.label || '')
      .trim()
      .slice(0, 40),
    url: String(link?.url || '')
      .trim()
      .slice(0, 1000),
    icon: String(link?.icon || 'blocks')
      .trim()
      .slice(0, 40),
    enabled: link?.enabled !== false,
    ...(allowedUserIds ? { allowedUserIds } : {}),
    ...(hasEntryNoticeContent ? { entryNotice } : {}),
  };
}

function sanitizeConfig(input = {}) {
  const appLinks = Array.isArray(input.appLinks)
    ? input.appLinks.map(sanitizeLink).filter((link) => link.label)
    : defaultConfig.appLinks;
  const announcement = input.announcement || {};
  const knowledgeSources = input.knowledgeSources || {};
  return {
    appLinks: appLinks.length > 0 ? appLinks : defaultConfig.appLinks,
    announcement: {
      title: String(announcement.title || '公告')
        .trim()
        .slice(0, 80),
      body: String(announcement.body || '').slice(0, 20000),
      imageUrl: String(announcement.imageUrl || '')
        .trim()
        .slice(0, 1000),
      showOnLogin: announcement.showOnLogin === true,
      updatedAt: announcement.updatedAt || null,
    },
    knowledgeSources: {
      knowledgeLabel:
        String(knowledgeSources.knowledgeLabel || defaultConfig.knowledgeSources.knowledgeLabel)
          .trim()
          .slice(0, 30) || defaultConfig.knowledgeSources.knowledgeLabel,
      materialsLabel:
        String(knowledgeSources.materialsLabel || defaultConfig.knowledgeSources.materialsLabel)
          .trim()
          .slice(0, 30) || defaultConfig.knowledgeSources.materialsLabel,
      materialPromptTemplate: String(
        knowledgeSources.materialPromptTemplate || DEFAULT_MATERIAL_PROMPT_TEMPLATE,
      ).slice(0, 20000),
    },
  };
}

async function readConfig() {
  const doc = await getCollection().findOne({ key: CONFIG_KEY });
  if (!doc) {
    return defaultConfig;
  }
  return sanitizeConfig({ ...defaultConfig, ...doc.value });
}

async function writeConfig(value) {
  const next = sanitizeConfig(value);
  next.announcement.updatedAt = new Date().toISOString();
  await getCollection().updateOne(
    { key: CONFIG_KEY },
    { $set: { key: CONFIG_KEY, value: next, updatedAt: new Date() } },
    { upsert: true },
  );
  return next;
}

function isLinkVisibleToUser(link, user) {
  if (!Array.isArray(link?.allowedUserIds) || link.allowedUserIds.length === 0) {
    return true;
  }

  const userId = user?.id || user?._id;
  return Boolean(userId && link.allowedUserIds.includes(String(userId)));
}

function serializePublicConfig(config, user) {
  return {
    ...config,
    appLinks: (config.appLinks || [])
      .filter((link) => link.enabled !== false && isLinkVisibleToUser(link, user))
      .map(({ allowedUserIds, ...link }) => link),
  };
}

router.get('/config', requireJwtAuth, async (req, res) => {
  const config = await readConfig();
  res.json(serializePublicConfig(config, req.user));
});

router.get('/preferences', requireJwtAuth, async (req, res) => {
  res.json(await readPreferences(req.user.id || req.user._id));
});

router.put('/preferences', requireJwtAuth, async (req, res) => {
  res.json(await writePreferences(req.user.id || req.user._id, req.body));
});

router.get('/knowledge/agents', requireJwtAuth, async (_req, res) => {
  try {
    const agents = await listAgents();
    res.json(
      agents.map((agent) => ({
        agentId: sanitizeAgentId(agent?.agent_id),
        name: String(agent?.name || agent?.agent_name || agent?.agent_id || '知识库').slice(0, 100),
        description: String(agent?.description || '').slice(0, 500),
        isDefault: agent?.is_default === true,
      })),
    );
  } catch (error) {
    res.status(502).json({ message: error?.message || '知识库服务暂时不可用' });
  }
});

router.get('/materials', requireJwtAuth, async (req, res) => {
  try {
    res.json(await listMaterials({ userId: req.user.id || req.user._id }));
  } catch (error) {
    res.status(error?.status || 500).json({ message: error?.message || '行业资料读取失败' });
  }
});

async function sendMaterialResource(req, res, kind) {
  try {
    const resource = await getResource(
      req.params.materialId,
      kind,
      req.params.resourceId,
      req.user.id || req.user._id,
    );
    res.setHeader('Content-Type', resource.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `${kind === 'assets' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(resource.filename)}`,
    );
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.sendFile(resource.absolutePath);
  } catch (error) {
    return res.status(error?.status || 500).send(error?.message || '资源读取失败');
  }
}

router.get('/materials/:materialId/assets/:resourceId', requireJwtAuth, (req, res) =>
  sendMaterialResource(req, res, 'assets'),
);

router.get('/materials/:materialId/sources/:resourceId', requireJwtAuth, (req, res) =>
  sendMaterialResource(req, res, 'sourceFiles'),
);

async function pipeKnowledgeFile(response, res) {
  if (!response.ok) {
    return false;
  }
  const contentType = response.headers.get('content-type');
  const disposition = response.headers.get('content-disposition');
  if (contentType) {
    res.setHeader('Content-Type', contentType);
  }
  if (disposition) {
    res.setHeader('Content-Disposition', disposition);
  }
  res.setHeader('Cache-Control', 'private, no-store');
  response.body.pipe(res);
  return true;
}

router.get('/knowledge/:knowledgeBaseId/files/:fileId', requireJwtAuth, async (req, res) => {
  try {
    const response = await fetchSourceFile(
      req.params.knowledgeBaseId,
      req.params.fileId,
      req.signal,
    );
    if (!(await pipeKnowledgeFile(response, res))) {
      return res.status(response.status).send('无法读取知识库原文');
    }
  } catch (error) {
    res.status(502).send(error?.message || '知识库原文暂时不可用');
  }
});

router.get('/knowledge/files/:fileId', requireJwtAuth, async (req, res) => {
  try {
    const connections = await listKnowledgeConnections({ includeArchived: true });
    for (const connection of connections.slice(0, 20)) {
      const response = await fetchSourceFile(
        connection.knowledgeBaseId,
        req.params.fileId,
        req.signal,
      );
      if (await pipeKnowledgeFile(response, res)) {
        return;
      }
      response.body?.destroy();
    }
    return res.status(404).send('无法读取知识库原文');
  } catch (error) {
    res.status(502).send(error?.message || '知识库原文暂时不可用');
  }
});

module.exports = {
  router,
  readConfig,
  writeConfig,
  readPreferences,
  writePreferences,
  sanitizeConfig,
  sanitizePreferences,
  serializePublicConfig,
};
