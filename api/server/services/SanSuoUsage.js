const mongoose = require('mongoose');
const SanSuoUsageEvent = require('~/models/sansuoUsageEvent');

const EVENT_TYPES = new Set([
  'login_success',
  'chat_request',
  'chat_completed',
  'chat_error',
  'sidebar_app_click',
  'knowledge_query',
  'file_upload',
  'file_generate',
  'page_view',
]);
const MODES = new Set(['fast', 'deep', 'knowledge']);
const KNOWLEDGE_ANSWER_MODES = new Set(['agentic_ask', 'local_model']);
const OUTCOMES = new Set(['pending', 'success', 'error', 'timeout', 'insufficient']);
const SOURCE_TYPES = new Set(['knowledge_base', 'industry_materials']);
const USAGE_TIMEZONE = process.env.SANSUO_USAGE_TIMEZONE || 'Asia/Shanghai';

function monthOf(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: USAGE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date(date));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}`;
}

function normalizeUserId(userId) {
  return mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : null;
}

function cleanStringArray(value, limit = 5) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))]
        .slice(0, limit)
        .map((item) => item.slice(0, 160))
    : [];
}

function parseDateRange(input = {}) {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(input.from || '')) ? String(input.from) : '';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(input.to || '')) ? String(input.to) : '';
  const start = from ? new Date(`${from}T00:00:00+08:00`) : null;
  const end = to ? new Date(`${to}T00:00:00+08:00`) : null;
  if (end) end.setUTCDate(end.getUTCDate() + 1);
  if ((start && Number.isNaN(start.getTime())) || (end && Number.isNaN(end.getTime()))) {
    throw Object.assign(new Error('日期范围无效'), { status: 400 });
  }
  if (start && end && start >= end) {
    throw Object.assign(new Error('开始日期不能晚于结束日期'), { status: 400 });
  }
  const occurredAt = {};
  if (start) occurredAt.$gte = start;
  if (end) occurredAt.$lt = end;
  return {
    from: from || null,
    to: to || null,
    dateMatch: Object.keys(occurredAt).length ? { occurredAt } : {},
    createdAtMatch: Object.keys(occurredAt).length ? { createdAt: occurredAt } : {},
  };
}

async function recordUsageEvent(input = {}) {
  const userId = normalizeUserId(input.userId);
  const eventType = String(input.eventType || '');
  if (!userId || !EVENT_TYPES.has(eventType)) {
    return { ok: false, skipped: true, reason: 'invalid_event' };
  }
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  const doc = {
    userId,
    eventType,
    occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
    month: monthOf(occurredAt),
    ...(input.requestId ? { requestId: String(input.requestId).slice(0, 160) } : {}),
    ...(input.conversationId ? { conversationId: String(input.conversationId).slice(0, 160) } : {}),
    ...(MODES.has(input.mode) ? { mode: input.mode } : {}),
    ...(input.knowledgeBaseId
      ? { knowledgeBaseId: String(input.knowledgeBaseId).slice(0, 160) }
      : {}),
    ...(input.knowledgeBaseName
      ? { knowledgeBaseName: String(input.knowledgeBaseName).slice(0, 160) }
      : {}),
    ...(SOURCE_TYPES.has(input.sourceType) ? { sourceType: input.sourceType } : {}),
    ...(cleanStringArray(input.industryMaterialIds).length
      ? { industryMaterialIds: cleanStringArray(input.industryMaterialIds) }
      : {}),
    ...(cleanStringArray(input.industryMaterialNames).length
      ? { industryMaterialNames: cleanStringArray(input.industryMaterialNames) }
      : {}),
    ...(KNOWLEDGE_ANSWER_MODES.has(input.knowledgeAnswerMode)
      ? { knowledgeAnswerMode: input.knowledgeAnswerMode }
      : {}),
    ...(OUTCOMES.has(input.outcome) ? { outcome: input.outcome } : {}),
    ...(Number.isFinite(input.evidenceCount)
      ? { evidenceCount: Math.max(0, Math.round(input.evidenceCount)) }
      : {}),
    ...(Number.isFinite(input.toolCalls)
      ? { toolCalls: Math.max(0, Math.round(input.toolCalls)) }
      : {}),
    ...(input.errorCode ? { errorCode: String(input.errorCode).slice(0, 80) } : {}),
    ...(input.appLinkId ? { appLinkId: String(input.appLinkId).slice(0, 160) } : {}),
    ...(input.pagePath ? { pagePath: String(input.pagePath).slice(0, 240) } : {}),
    ...(input.sessionId ? { sessionId: String(input.sessionId).slice(0, 160) } : {}),
    ...(typeof input.success === 'boolean' ? { success: input.success } : {}),
    ...(Number.isFinite(input.durationMs)
      ? { durationMs: Math.max(0, Math.round(input.durationMs)) }
      : {}),
  };
  try {
    await SanSuoUsageEvent.create(doc);
    return { ok: true, duplicate: false };
  } catch (error) {
    if (error?.code === 11000 && doc.requestId) {
      return { ok: true, duplicate: true };
    }
    throw error;
  }
}

async function completeKnowledgeUsageEvent(input = {}) {
  const userId = normalizeUserId(input.userId);
  const requestId = String(input.requestId || '').slice(0, 160);
  if (!userId || !requestId || !OUTCOMES.has(input.outcome) || input.outcome === 'pending') {
    return { ok: false, skipped: true, reason: 'invalid_completion' };
  }
  const update = {
    outcome: input.outcome,
    success: input.outcome === 'success',
    ...(input.knowledgeBaseName
      ? { knowledgeBaseName: String(input.knowledgeBaseName).slice(0, 160) }
      : {}),
    ...(cleanStringArray(input.industryMaterialNames).length
      ? { industryMaterialNames: cleanStringArray(input.industryMaterialNames) }
      : {}),
    ...(KNOWLEDGE_ANSWER_MODES.has(input.knowledgeAnswerMode)
      ? { knowledgeAnswerMode: input.knowledgeAnswerMode }
      : {}),
    ...(Number.isFinite(input.evidenceCount)
      ? { evidenceCount: Math.max(0, Math.round(input.evidenceCount)) }
      : {}),
    ...(Number.isFinite(input.toolCalls)
      ? { toolCalls: Math.max(0, Math.round(input.toolCalls)) }
      : {}),
    ...(Number.isFinite(input.durationMs)
      ? { durationMs: Math.max(0, Math.round(input.durationMs)) }
      : {}),
    ...(input.errorCode ? { errorCode: String(input.errorCode).slice(0, 80) } : {}),
  };
  const result = await SanSuoUsageEvent.updateOne(
    { userId, eventType: 'knowledge_query', requestId },
    { $set: update },
  );
  return { ok: true, matched: result.matchedCount || result.n || 0 };
}

function monthMatch(month) {
  return month && /^\d{4}-\d{2}$/.test(month) ? { month } : {};
}

async function getLegacyDeepRows(input = '', userIds) {
  try {
    const firstEvent = await SanSuoUsageEvent.findOne({})
      .select('occurredAt')
      .sort({ occurredAt: 1 })
      .lean();
    const messageCollection = mongoose.connection.collection('messages');
    if (!messageCollection || typeof messageCollection.aggregate !== 'function') return [];
    const normalizedUserIds = Array.isArray(userIds)
      ? [...userIds.map(normalizeUserId).filter(Boolean), ...userIds.map(String)]
      : userIds
        ? [normalizeUserId(userIds), String(userIds)].filter(Boolean)
        : [];
    const legacyMonth = typeof input === 'string' ? input : '';
    const range = typeof input === 'string' ? parseDateRange({}) : parseDateRange(input);
    const createdAt = { ...(range.createdAtMatch.createdAt || {}) };
    if (firstEvent)
      createdAt.$lt =
        createdAt.$lt && createdAt.$lt < firstEvent.occurredAt
          ? createdAt.$lt
          : firstEvent.occurredAt;
    const match = {
      isCreatedByUser: true,
      ...(Object.keys(createdAt).length ? { createdAt } : {}),
      ...(normalizedUserIds.length ? { user: { $in: normalizedUserIds } } : {}),
    };
    const rows = await messageCollection
      .aggregate([
        { $match: match },
        {
          $group: {
            _id: {
              userId: '$user',
              month: {
                $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: USAGE_TIMEZONE },
              },
            },
            count: { $sum: 1 },
            activeDays: {
              $addToSet: {
                $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: USAGE_TIMEZONE },
              },
            },
          },
        },
        ...(legacyMonth ? [{ $match: { '_id.month': legacyMonth } }] : []),
      ])
      .toArray();
    return rows.map((row) => ({
      userId: row._id.userId,
      month: row._id.month,
      count: row.count || 0,
      activeDays: row.activeDays || [],
      mode: 'deep',
      eventType: 'chat_request',
    }));
  } catch (_error) {
    return [];
  }
}

function mergeUsageRows(rows, legacyRows) {
  const merged = rows.map((row) => ({ ...row, userIds: row.userIds || [] }));
  for (const row of legacyRows) {
    const existing = merged.find((item) => item._id === 'deep');
    if (existing) {
      existing.count += row.count;
      existing.userIds = [...new Set([...(existing.userIds || []), String(row.userId)])];
      existing.users = existing.userIds.length;
    } else {
      merged.push({
        _id: 'deep',
        count: row.count,
        users: 1,
        userIds: [String(row.userId)],
      });
    }
  }
  return merged.map(({ userIds, ...row }) => row);
}

async function getUsageOverview(input = '') {
  const legacyMonth = typeof input === 'string' ? input : '';
  const range = typeof input === 'string' ? parseDateRange({}) : parseDateRange(input);
  const match = legacyMonth ? monthMatch(legacyMonth) : range.dateMatch;
  const [
    totals,
    modes,
    knowledgeBases,
    apps,
    industryMaterials,
    pageViews,
    trend,
    legacyRows,
    globalTotals,
  ] = await Promise.all([
    SanSuoUsageEvent.aggregate([
      { $match: match },
      { $group: { _id: '$eventType', count: { $sum: 1 }, users: { $addToSet: '$userId' } } },
      { $project: { _id: 1, count: 1, userIds: '$users', users: { $size: '$users' } } },
    ]),
    SanSuoUsageEvent.aggregate([
      { $match: { ...match, eventType: { $in: ['chat_request', 'knowledge_query'] } } },
      { $group: { _id: '$mode', count: { $sum: 1 }, users: { $addToSet: '$userId' } } },
      { $project: { _id: 1, count: 1, userIds: '$users', users: { $size: '$users' } } },
    ]),
    SanSuoUsageEvent.aggregate([
      {
        $match: {
          ...match,
          eventType: 'knowledge_query',
          sourceType: { $ne: 'industry_materials' },
          knowledgeBaseId: { $not: /^industry:/ },
        },
      },
      {
        $group: {
          _id: '$knowledgeBaseId',
          name: { $max: '$knowledgeBaseName' },
          count: { $sum: 1 },
          users: { $addToSet: '$userId' },
          success: { $sum: { $cond: [{ $eq: ['$outcome', 'success'] }, 1, 0] } },
          errors: { $sum: { $cond: [{ $eq: ['$outcome', 'error'] }, 1, 0] } },
          timeouts: { $sum: { $cond: [{ $eq: ['$outcome', 'timeout'] }, 1, 0] } },
          insufficient: { $sum: { $cond: [{ $eq: ['$outcome', 'insufficient'] }, 1, 0] } },
          pending: {
            $sum: { $cond: [{ $eq: [{ $ifNull: ['$outcome', 'pending'] }, 'pending'] }, 1, 0] },
          },
          averageDurationMs: { $avg: '$durationMs' },
        },
      },
      {
        $project: {
          _id: 1,
          name: 1,
          count: 1,
          users: { $size: '$users' },
          success: 1,
          errors: 1,
          timeouts: 1,
          insufficient: 1,
          pending: 1,
          averageDurationMs: { $round: [{ $ifNull: ['$averageDurationMs', 0] }, 0] },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]),
    SanSuoUsageEvent.aggregate([
      { $match: { ...match, eventType: 'sidebar_app_click' } },
      {
        $group: {
          _id: '$appLinkId',
          count: { $sum: 1 },
          users: { $addToSet: '$userId' },
          lastClickedAt: { $max: '$occurredAt' },
        },
      },
      { $project: { _id: 1, count: 1, users: { $size: '$users' }, lastClickedAt: 1 } },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]),
    SanSuoUsageEvent.aggregate([
      {
        $match: {
          ...match,
          eventType: 'knowledge_query',
          $or: [{ sourceType: 'industry_materials' }, { knowledgeBaseId: /^industry:/ }],
        },
      },
      {
        $project: {
          userId: 1,
          occurredAt: 1,
          materialPairs: {
            $zip: {
              inputs: [
                { $ifNull: ['$industryMaterialIds', []] },
                { $ifNull: ['$industryMaterialNames', []] },
              ],
              useLongestLength: true,
            },
          },
          legacyIds: {
            $split: [
              {
                $replaceOne: {
                  input: { $ifNull: ['$knowledgeBaseId', ''] },
                  find: 'industry:',
                  replacement: '',
                },
              },
              ',',
            ],
          },
        },
      },
      {
        $project: {
          userId: 1,
          occurredAt: 1,
          pairs: {
            $cond: [
              { $gt: [{ $size: '$materialPairs' }, 0] },
              '$materialPairs',
              { $map: { input: '$legacyIds', as: 'id', in: ['$$id', ''] } },
            ],
          },
        },
      },
      { $unwind: '$pairs' },
      {
        $group: {
          _id: { $arrayElemAt: ['$pairs', 0] },
          name: { $max: { $arrayElemAt: ['$pairs', 1] } },
          count: { $sum: 1 },
          users: { $addToSet: '$userId' },
          lastUsedAt: { $max: '$occurredAt' },
        },
      },
      { $project: { _id: 1, name: 1, count: 1, users: { $size: '$users' }, lastUsedAt: 1 } },
      { $sort: { count: -1 } },
      { $limit: 50 },
    ]),
    SanSuoUsageEvent.aggregate([
      { $match: { ...match, eventType: 'page_view' } },
      {
        $group: {
          _id: '$pagePath',
          views: { $sum: 1 },
          users: { $addToSet: '$userId' },
          lastViewedAt: { $max: '$occurredAt' },
        },
      },
      { $project: { _id: 1, views: 1, users: { $size: '$users' }, lastViewedAt: 1 } },
      { $sort: { views: -1 } },
      { $limit: 50 },
    ]),
    SanSuoUsageEvent.aggregate([
      { $match: { ...match, eventType: { $in: ['chat_request', 'knowledge_query'] } } },
      { $group: { _id: '$month', count: { $sum: 1 }, users: { $addToSet: '$userId' } } },
      {
        $project: {
          month: '$_id',
          _id: 0,
          count: 1,
          userIds: '$users',
          users: { $size: '$users' },
        },
      },
      { $sort: { month: -1 } },
      { $limit: 12 },
    ]),
    getLegacyDeepRows(legacyMonth || input),
    getGlobalTotals(range),
  ]);
  const byType = Object.fromEntries(totals.map((row) => [row._id, { ...row }]));
  const legacyCount = legacyRows.reduce((sum, row) => sum + row.count, 0);
  if (legacyCount) {
    byType.chat_request = byType.chat_request || { _id: 'chat_request', count: 0, users: 0 };
    byType.chat_request.count += legacyCount;
    byType.chat_request.userIds = [
      ...new Set([
        ...(byType.chat_request.userIds || []).map(String),
        ...legacyRows.map((row) => String(row.userId)),
      ]),
    ];
    byType.chat_request.users = byType.chat_request.userIds.length;
  }
  const mergedModes = mergeUsageRows(modes, legacyRows);
  const trendMap = new Map(
    (trend || []).map((row) => [row.month, { ...row, userIds: row.userIds || [] }]),
  );
  for (const row of legacyRows) {
    const item = trendMap.get(row.month) || { month: row.month, count: 0, users: 0, userIds: [] };
    item.count += row.count;
    item.userIds = [...new Set([...item.userIds.map(String), String(row.userId)])];
    item.users = item.userIds.length;
    trendMap.set(row.month, item);
  }
  const mergedTrend = [...trendMap.values()]
    .sort((a, b) => b.month.localeCompare(a.month))
    .slice(0, 12)
    .reverse()
    .map(({ userIds, ...row }) => row);
  for (const value of Object.values(byType)) delete value.userIds;
  return {
    month: legacyMonth || null,
    range: { from: range.from, to: range.to, timezone: USAGE_TIMEZONE },
    totals: byType,
    modes: Object.fromEntries(mergedModes.map((row) => [row._id || 'unknown', row])),
    knowledgeBases,
    apps,
    industryMaterials,
    pageViews,
    globalTotals,
    trend: mergedTrend,
  };
}

async function getGlobalTotals(range = parseDateRange({})) {
  const db = mongoose.connection;
  const createdAtMatch = range.createdAtMatch;
  const [users, conversations, messages, files, fileBytes, activeUsers] = await Promise.all([
    db.collection('users').countDocuments({}),
    db.collection('conversations').countDocuments(createdAtMatch),
    db.collection('messages').countDocuments(createdAtMatch),
    db.collection('files').countDocuments(createdAtMatch),
    db
      .collection('files')
      .aggregate([
        { $match: createdAtMatch },
        { $group: { _id: null, bytes: { $sum: { $ifNull: ['$bytes', 0] } } } },
      ])
      .toArray(),
    db.collection('sansuo_usage_events').distinct('userId', {
      eventType: { $in: ['chat_request', 'knowledge_query', 'page_view'] },
      ...range.dateMatch,
    }),
  ]);
  const bytes = Number(fileBytes[0]?.bytes || 0);
  return {
    users,
    activeUsers: activeUsers.length,
    conversations,
    messages,
    files,
    uploadBytes: bytes,
    uploadMB: +(bytes / 1024 / 1024).toFixed(2),
  };
}

async function getUserUsage(userId, input = '') {
  const objectId = normalizeUserId(userId);
  if (!objectId) return null;
  const legacyMonth = typeof input === 'string' ? input : '';
  const range = typeof input === 'string' ? parseDateRange({}) : parseDateRange(input);
  const match = { userId: objectId, ...(legacyMonth ? monthMatch(legacyMonth) : range.dateMatch) };
  const [events, months, knowledgeBases, apps, industryMaterials, legacyRows] = await Promise.all([
    SanSuoUsageEvent.aggregate([
      { $match: match },
      { $group: { _id: { type: '$eventType', mode: '$mode' }, count: { $sum: 1 } } },
    ]),
    SanSuoUsageEvent.aggregate([
      { $match: { ...match, eventType: { $in: ['chat_request', 'knowledge_query'] } } },
      { $group: { _id: '$month', count: { $sum: 1 } } },
      { $sort: { _id: -1 } },
      { $limit: 12 },
    ]),
    SanSuoUsageEvent.aggregate([
      {
        $match: {
          ...match,
          eventType: 'knowledge_query',
          sourceType: { $ne: 'industry_materials' },
          knowledgeBaseId: { $not: /^industry:/ },
        },
      },
      {
        $group: {
          _id: '$knowledgeBaseId',
          name: { $max: '$knowledgeBaseName' },
          count: { $sum: 1 },
          success: { $sum: { $cond: [{ $eq: ['$outcome', 'success'] }, 1, 0] } },
          errors: { $sum: { $cond: [{ $eq: ['$outcome', 'error'] }, 1, 0] } },
          timeouts: { $sum: { $cond: [{ $eq: ['$outcome', 'timeout'] }, 1, 0] } },
          insufficient: { $sum: { $cond: [{ $eq: ['$outcome', 'insufficient'] }, 1, 0] } },
          averageDurationMs: { $avg: '$durationMs' },
        },
      },
      { $sort: { count: -1 } },
    ]),
    SanSuoUsageEvent.aggregate([
      { $match: { ...match, eventType: 'sidebar_app_click' } },
      { $group: { _id: '$appLinkId', count: { $sum: 1 }, lastUsedAt: { $max: '$occurredAt' } } },
      { $sort: { count: -1 } },
    ]),
    SanSuoUsageEvent.aggregate([
      {
        $match: {
          ...match,
          eventType: 'knowledge_query',
          $or: [{ sourceType: 'industry_materials' }, { knowledgeBaseId: /^industry:/ }],
        },
      },
      {
        $project: {
          occurredAt: 1,
          ids: {
            $cond: [
              { $gt: [{ $size: { $ifNull: ['$industryMaterialIds', []] } }, 0] },
              '$industryMaterialIds',
              {
                $split: [
                  {
                    $replaceOne: {
                      input: { $ifNull: ['$knowledgeBaseId', ''] },
                      find: 'industry:',
                      replacement: '',
                    },
                  },
                  ',',
                ],
              },
            ],
          },
        },
      },
      { $unwind: '$ids' },
      { $group: { _id: '$ids', count: { $sum: 1 }, lastUsedAt: { $max: '$occurredAt' } } },
      { $sort: { count: -1 } },
    ]),
    getLegacyDeepRows(legacyMonth || input, userId),
  ]);
  const counts = {};
  for (const row of events) counts[row._id.type] = (counts[row._id.type] || 0) + row.count;
  const legacyCount = legacyRows.reduce((sum, row) => sum + row.count, 0);
  if (legacyCount) counts.chat_request = (counts.chat_request || 0) + legacyCount;
  const monthlyMap = new Map(months.map((row) => [row._id, { ...row }]));
  for (const row of legacyRows) {
    const item = monthlyMap.get(row.month) || { _id: row.month, count: 0 };
    item.count += row.count;
    monthlyMap.set(row.month, item);
  }
  return {
    month: legacyMonth || null,
    range: { from: range.from, to: range.to, timezone: USAGE_TIMEZONE },
    counts,
    modes: {
      deep:
        events.filter((row) => row._id.mode === 'deep').reduce((sum, row) => sum + row.count, 0) +
        legacyCount,
      fast: events
        .filter((row) => row._id.mode === 'fast')
        .reduce((sum, row) => sum + row.count, 0),
      knowledge: events
        .filter((row) => row._id.mode === 'knowledge')
        .reduce((sum, row) => sum + row.count, 0),
    },
    monthly: [...monthlyMap.values()]
      .sort((a, b) => String(b._id).localeCompare(String(a._id)))
      .slice(0, 12),
    knowledgeBases,
    apps,
    industryMaterials,
  };
}

async function getUsageExport({ from, to } = {}) {
  const range = parseDateRange({ from, to });
  const match = range.dateMatch;
  const firstEvent = await SanSuoUsageEvent.findOne({})
    .select('occurredAt')
    .sort({ occurredAt: 1 })
    .lean();
  const [groups, historicalGroups, users] = await Promise.all([
    SanSuoUsageEvent.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            userId: '$userId',
            month: '$month',
            eventType: '$eventType',
            mode: '$mode',
            knowledgeBaseId: '$knowledgeBaseId',
            knowledgeBaseName: '$knowledgeBaseName',
            outcome: '$outcome',
            appLinkId: '$appLinkId',
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.month': 1, '_id.userId': 1 } },
    ]),
    mongoose.connection.collection('messages')
      ? mongoose.connection
          .collection('messages')
          .aggregate([
            {
              $match: {
                isCreatedByUser: true,
                'metadata.sansuoMode': { $in: ['fast', 'deep', 'knowledge'] },
                ...(firstEvent
                  ? {
                      createdAt: {
                        $lt: firstEvent.occurredAt,
                        ...(range.createdAtMatch.createdAt || {}),
                      },
                    }
                  : range.createdAtMatch),
              },
            },
            {
              $group: {
                _id: {
                  userId: '$user',
                  month: {
                    $dateToString: {
                      format: '%Y-%m',
                      date: '$createdAt',
                      timezone: USAGE_TIMEZONE,
                    },
                  },
                  eventType: 'chat_request',
                  mode: '$metadata.sansuoMode',
                  knowledgeBaseId: '$metadata.sansuoKnowledgeBaseId',
                  appLinkId: null,
                },
                count: { $sum: 1 },
              },
            },
          ])
          .toArray()
      : [],
    mongoose.connection
      .collection('users')
      .find({})
      .project({ _id: 1, name: 1, username: 1, email: 1, provider: 1, role: 1 })
      .toArray(),
  ]);
  const userMap = new Map(users.map((user) => [String(user._id), user]));
  const rows = new Map();
  for (const group of [...groups, ...historicalGroups]) {
    const key = `${String(group._id.userId)}:${group._id.month}`;
    const user = userMap.get(String(group._id.userId));
    const row = rows.get(key) || {
      userId: String(group._id.userId),
      name: user?.name || '',
      username: user?.username || '',
      email: user?.email || '',
      month: group._id.month,
      total: 0,
      login: 0,
      requests: 0,
      fast: 0,
      deep: 0,
      knowledge: 0,
      sidebarClicks: 0,
      fileUploads: 0,
      fileGenerations: 0,
      knowledgeBases: {},
      knowledgeBaseResults: {},
      sidebarApps: {},
    };
    const count = group.count || 0;
    row.total += count;
    if (group._id.eventType === 'login_success') row.login += count;
    if (['chat_request', 'knowledge_query'].includes(group._id.eventType)) row.requests += count;
    if (group._id.mode === 'fast') row.fast += count;
    if (group._id.mode === 'deep') row.deep += count;
    if (group._id.mode === 'knowledge') row.knowledge += count;
    if (group._id.eventType === 'sidebar_app_click') {
      row.sidebarClicks += count;
      if (group._id.appLinkId)
        row.sidebarApps[group._id.appLinkId] = (row.sidebarApps[group._id.appLinkId] || 0) + count;
    }
    if (group._id.eventType === 'file_upload') row.fileUploads += count;
    if (group._id.eventType === 'file_generate') row.fileGenerations += count;
    if (group._id.eventType === 'knowledge_query' && group._id.knowledgeBaseId) {
      const knowledgeKey = group._id.knowledgeBaseName || group._id.knowledgeBaseId;
      row.knowledgeBases[knowledgeKey] = (row.knowledgeBases[knowledgeKey] || 0) + count;
      const resultKey = group._id.outcome || 'pending';
      row.knowledgeBaseResults[knowledgeKey] ||= {};
      row.knowledgeBaseResults[knowledgeKey][resultKey] =
        (row.knowledgeBaseResults[knowledgeKey][resultKey] || 0) + count;
    }
    rows.set(key, row);
  }
  return { timezone: USAGE_TIMEZONE, from: range.from, to: range.to, rows: [...rows.values()] };
}

module.exports = {
  recordUsageEvent,
  completeKnowledgeUsageEvent,
  getUsageOverview,
  getUserUsage,
  getUsageExport,
  getLegacyDeepRows,
  monthOf,
};
