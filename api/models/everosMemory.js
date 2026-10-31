const DEFAULT_BASE_URLS = [
  'http://127.0.0.1:1995/api/v1',
  'http://localhost:1995/api/v1',
  'http://0.0.0.0:1995/api/v1',
];

const enabledValues = new Set(['1', 'true', 'yes', 'everos']);
const MERGEABLE_MEMORY_KEYS = new Set(['interests', 'skills', 'work_info', 'context']);
const {
  compact,
  deletionQueryFromText,
  filterAndRankMemories,
  isExplicitMemoryRequest,
  shouldDeleteMemory,
  shouldPersistMemory,
  shouldRetrieveMemory,
} = require('./memoryGateway');

function isEverOSMemoryEnabled() {
  return (
    enabledValues.has(String(process.env.EVEROS_MEMORY_ENABLED || '').toLowerCase()) ||
    String(process.env.MEMORY_BACKEND || '').toLowerCase() === 'everos'
  );
}

function getBaseUrls() {
  const configured = process.env.EVEROS_MEMORY_BASE_URLS || process.env.EVEROS_MEMORY_BASE_URL;
  const urls = configured ? configured.split(',') : DEFAULT_BASE_URLS;
  const seen = new Set();

  return urls
    .map((url) => url.trim().replace(/\/$/, ''))
    .filter(Boolean)
    .filter((url) => {
      if (seen.has(url)) {
        return false;
      }
      seen.add(url);
      return true;
    });
}

function getApiStyle() {
  const style = String(process.env.EVEROS_MEMORY_API_STYLE || 'auto').toLowerCase();
  return ['auto', 'legacy', 'official'].includes(style) ? style : 'auto';
}

function getAuthHeaders() {
  const token = process.env.EVEROS_MEMORY_API_KEY || process.env.EVEROS_API_KEY;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function groupIdForUser(userId) {
  return `account:${userId}`;
}

function messageIdForMemory({ userId, key }) {
  return `librechat_${String(userId).replace(/[^a-zA-Z0-9_-]/g, '_')}_${toMemoryKey(key)}`;
}

function toMemoryKey(value) {
  const source = String(value || 'memory')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/[0-9]/g, '');
  return source && /^[a-z_]+$/.test(source) ? source.slice(0, 80) : 'memory';
}

function formatEverOSContent({ key, value }) {
  return [`[LibreChat账号记忆]`, `key: ${toMemoryKey(key)}`, '', String(value || '').trim()].join(
    '\n',
  );
}

function isLibreStableMemory(record = {}) {
  const content =
    record?.content ||
    record?.summary ||
    record?.memory ||
    record?.text ||
    record?.description ||
    '';
  const metadata = record?.metadata || record?.meta || {};
  return (
    /^\[LibreChat账号记忆\]/.test(String(content || '').trim()) ||
    metadata?.source === 'explicit_user_request'
  );
}

function extractValue(content = '') {
  const raw = String(content || '').trim();
  const parts = raw.split(/\n\s*\n/);
  if (parts.length > 1 && /^\[LibreChat账号记忆\]/.test(parts[0])) {
    return parts.slice(1).join('\n\n').trim();
  }
  return raw;
}

function extractKey(content = '', fallback = 'memory') {
  const match = String(content).match(/^key:\s*(.+)$/m);
  return toMemoryKey(match?.[1] || fallback);
}

function normalizeMemory(record, userId) {
  const content =
    record?.content ||
    record?.summary ||
    record?.memory ||
    record?.text ||
    record?.description ||
    '';
  const key = extractKey(content, record?.event_id || record?.message_id || record?.id);
  return {
    _id: record?.event_id || record?.message_id || record?.id || key,
    userId,
    key,
    value: extractValue(content),
    tokenCount: 0,
    metadata: record?.metadata || record?.meta || {},
    source: record?.metadata?.source || record?.source,
    status: record?.metadata?.status || record?.status,
    updated_at:
      record?.timestamp || record?.created_at
        ? new Date(record.timestamp || record.created_at)
        : new Date(),
  };
}

function splitMemoryItems(value = '') {
  return String(value || '')
    .split(/\n+|[；;]+/)
    .map((item) => item.trim().replace(/[。.!！]+$/g, ''))
    .filter(Boolean);
}

function normalizeMemoryItemIdentity(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[。.!！,，、；;]/g, '');
}

function formatMemoryItems(items = []) {
  return items
    .map((item) => {
      const trimmed = String(item || '').trim();
      if (!trimmed) {
        return '';
      }
      return /[。.!！]$/.test(trimmed) ? trimmed : `${trimmed}。`;
    })
    .filter(Boolean)
    .join('\n');
}

async function mergeMemoryValue({ fallbackMethods, userId, key, nextValue }) {
  const memoryKey = toMemoryKey(key);
  if (!MERGEABLE_MEMORY_KEYS.has(memoryKey)) {
    return String(nextValue || '').trim();
  }

  const localMemories = await getLocalMemories(fallbackMethods, userId);
  const existing = localMemories.find((memory) => toMemoryKey(memory?.key) === memoryKey);
  const merged = [];
  const seen = new Set();

  for (const item of [...splitMemoryItems(existing?.value), ...splitMemoryItems(nextValue)]) {
    const identity = normalizeMemoryItemIdentity(item);
    if (!identity || seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    merged.push(item);
  }

  return formatMemoryItems(merged);
}

function normalizeProfileValue(value = '') {
  const raw = String(value || '').trim();
  const match = raw.match(/^\[([a-z_]+)\]\s*([\s\S]+)$/i);
  return {
    key: toMemoryKey(match?.[1] || 'profile'),
    value: (match?.[2] || raw).trim(),
  };
}

function getProfileMemories(response, userId) {
  const records = getMemoryList(response);
  const memories = [];

  for (const record of records) {
    const profile =
      record?.global_profile ||
      record?.globalProfile ||
      record?.profile_data ||
      record?.profile ||
      record;
    const initialProfile =
      profile?.custom_profile_data?.initial_profile ||
      profile?.customProfileData?.initial_profile ||
      [];

    if (!Array.isArray(initialProfile)) {
      continue;
    }

    for (const item of initialProfile) {
      const normalized = normalizeProfileValue(item);
      if (!normalized.value) {
        continue;
      }
      memories.push({
        _id: `${profile?.id || record?.id || 'global_profile'}:${normalized.key}:${normalized.value}`,
        userId,
        key: normalized.key,
        value: normalized.value,
        tokenCount: 0,
        metadata: {
          source: 'explicit_user_request',
          scope: 'user',
          status: 'active',
          everos_source: 'global_user_profile_custom',
        },
        source: 'explicit_user_request',
        status: 'active',
        updated_at: profile?.updated_at ? new Date(profile.updated_at) : new Date(),
      });
    }
  }

  return memories;
}

async function getLocalMemories(fallbackMethods, userId) {
  if (typeof fallbackMethods.getAllUserMemories !== 'function') {
    return [];
  }
  try {
    return await fallbackMethods.getAllUserMemories(userId);
  } catch (error) {
    console.warn('[MemoryGateway] Failed to read local MemoryEntry cache', {
      userId: String(userId),
      error: error.message,
    });
    return [];
  }
}

async function syncEverOSCustomProfile({ userId, fallbackMethods, nextMemory }) {
  const localMemories = await getLocalMemories(fallbackMethods, userId);
  const byKey = new Map();

  for (const memory of localMemories) {
    if (!memory?.key || !memory?.value) {
      continue;
    }
    byKey.set(toMemoryKey(memory.key), {
      key: toMemoryKey(memory.key),
      value: String(memory.value).trim(),
      updated_at: memory.updated_at,
    });
  }

  if (nextMemory?.key && nextMemory?.value) {
    byKey.set(toMemoryKey(nextMemory.key), {
      key: toMemoryKey(nextMemory.key),
      value: String(nextMemory.value).trim(),
      updated_at: new Date(),
    });
  }

  const initialProfile = Array.from(byKey.values())
    .filter((memory) => memory.value)
    .sort((a, b) => new Date(a.updated_at || 0).getTime() - new Date(b.updated_at || 0).getTime())
    .map((memory) => `[${memory.key}] ${memory.value}`);

  await requestEverOS('/global-user-profile/custom', {
    method: 'POST',
    body: JSON.stringify({
      user_id: String(userId),
      custom_profile_data: {
        initial_profile: initialProfile.length ? initialProfile : ['[memory] '],
      },
    }),
  });
}

function extractMessageText(message = {}) {
  if (typeof message.text === 'string' && message.text.trim()) {
    return message.text.trim();
  }

  if (typeof message.content === 'string' && message.content.trim()) {
    return message.content.trim();
  }

  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (!part) {
          return '';
        }
        if (typeof part === 'string') {
          return part;
        }
        if (typeof part.text === 'string') {
          return part.text;
        }
        if (typeof part.content === 'string') {
          return part.content;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  return '';
}

function getMemoryList(response) {
  const result = response?.result;
  if (Array.isArray(response?.memories)) {
    return response.memories;
  }
  if (Array.isArray(response?.memory_list)) {
    return response.memory_list;
  }
  if (Array.isArray(response?.items)) {
    return response.items;
  }
  if (Array.isArray(result?.memories)) {
    return result.memories;
  }
  if (Array.isArray(result?.memory_list)) {
    return result.memory_list;
  }
  if (Array.isArray(result?.items)) {
    return result.items;
  }
  if (Array.isArray(result)) {
    return result;
  }
  return [];
}

function getSearchList(response) {
  if (Array.isArray(response?.memories)) {
    return response.memories;
  }
  if (Array.isArray(response?.results)) {
    return response.results;
  }
  const result = response?.result;
  if (Array.isArray(result?.results)) {
    return result.results;
  }
  if (Array.isArray(result?.items)) {
    return result.items;
  }
  if (Array.isArray(result?.memory_list)) {
    return result.memory_list;
  }
  const groups = Array.isArray(result?.memories) ? result.memories : [];
  const flattened = [];
  for (const group of groups) {
    const memories = Array.isArray(group?.memories)
      ? group.memories
      : Array.isArray(group)
        ? group
        : [];
    flattened.push(...memories);
  }
  return flattened;
}

function toISODate(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

async function requestEverOS(path, init) {
  let lastError;

  for (const baseUrl of getBaseUrls()) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Number(process.env.EVEROS_MEMORY_TIMEOUT_MS || 12000),
    );

    try {
      const method = (init?.method || 'GET').toUpperCase();
      const headers =
        method === 'GET' || method === 'HEAD' ? {} : { 'Content-Type': 'application/json' };
      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          ...getAuthHeaders(),
          ...headers,
          ...(init?.headers || {}),
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`EverOS ${response.status}: ${await response.text()}`);
      }

      return response.json();
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error('EverOS request failed');
}

async function requestEverOSCompat({ legacy, official }) {
  const style = getApiStyle();
  if (style === 'legacy') {
    return requestEverOS(legacy.path, legacy.init);
  }
  if (style === 'official') {
    return requestEverOS(official.path, official.init);
  }

  try {
    return await requestEverOS(legacy.path, legacy.init);
  } catch (legacyError) {
    try {
      return await requestEverOS(official.path, official.init);
    } catch (officialError) {
      if (officialError.message && officialError.message !== legacyError.message) {
        officialError.message = `${officialError.message}; legacy fallback failed: ${legacyError.message}`;
        throw officialError;
      }
      throw legacyError;
    }
  }
}

function buildOfficialMessage({ userId, role = 'user', content, messageId, createdAt, metadata }) {
  return {
    id: messageId,
    message_id: messageId,
    role,
    content,
    timestamp: toISODate(createdAt),
    created_at: toISODate(createdAt),
    metadata,
  };
}

function officialAddPayload({ userId, messages, metadata }) {
  return {
    user_id: String(userId),
    group_id: groupIdForUser(userId),
    messages,
    metadata,
  };
}

function legacyGetPath(params) {
  return `/memories?${new URLSearchParams(params).toString()}`;
}

function officialGetInit(params) {
  return {
    method: 'POST',
    body: JSON.stringify(params),
  };
}

function createEverOSMemoryMethods(fallbackMethods) {
  async function withFallback(name, args, task) {
    if (!isEverOSMemoryEnabled()) {
      return fallbackMethods[name](...args);
    }

    try {
      return await task();
    } catch (error) {
      console.warn(`[EverOS memory] Falling back from ${name}:`, error.message);
      return fallbackMethods[name](...args);
    }
  }

  async function getAllUserMemories(userId) {
    return withFallback('getAllUserMemories', [userId], async () => {
      const params = {
        user_id: String(userId),
        group_id: groupIdForUser(userId),
        memory_type: 'episodic_memory',
        limit: '100',
      };
      const response = await requestEverOSCompat({
        legacy: { path: legacyGetPath(params) },
        official: { path: '/memories/get', init: officialGetInit(params) },
      });
      const memories = getMemoryList(response);
      const stableMemories = memories
        .filter(isLibreStableMemory)
        .map((record) => normalizeMemory(record, userId));

      const profileQuery = new URLSearchParams({
        user_id: String(userId),
        memory_type: 'profile',
        limit: '20',
      });
      const profileParams = Object.fromEntries(profileQuery.entries());
      const profileResponse = await requestEverOSCompat({
        legacy: { path: `/memories?${profileQuery.toString()}` },
        official: { path: '/memories/get', init: officialGetInit(profileParams) },
      });
      const profileMemories = getProfileMemories(profileResponse, userId);

      const everosMemories = filterAndRankMemories([...stableMemories, ...profileMemories], {
        limit: 100,
      });
      if (everosMemories.length > 0) {
        return everosMemories;
      }

      return getLocalMemories(fallbackMethods, userId);
    });
  }

  async function createMemory({ userId, key, value, userMessage, source, metadata, ...rest }) {
    const memoryKey = toMemoryKey(key);
    const decision = shouldPersistMemory({
      key: memoryKey,
      value,
      userMessage,
      source: source || metadata?.source || 'explicit_user_request',
      metadata,
    });

    if (!decision.allow) {
      console.warn('[MemoryGateway] Blocked memory persist', {
        userId: String(userId),
        key: memoryKey,
        reason: decision.reason,
        value: compact(value),
        conversationId: metadata?.conversationId || rest.conversationId,
        messageId: metadata?.messageId || rest.messageId,
        source,
      });
      return { ok: false, reason: decision.reason };
    }

    const now = new Date().toISOString();
    const memoryValue = await mergeMemoryValue({
      fallbackMethods,
      userId,
      key: memoryKey,
      nextValue: decision.normalizedValue,
    });
    let everosOk = false;
    let localOk = false;
    let everosError = null;
    let localError = null;
    const normalizedMetadata = {
      type: memoryKey,
      domain: decision.domain || metadata?.domain || 'general',
      scope: decision.scope || metadata?.scope || 'user',
      source: source || metadata?.source || 'explicit_user_request',
      confidence: metadata?.confidence ?? 0.9,
      userId: String(userId),
      agentId: metadata?.agentId,
      conversationId: metadata?.conversationId || rest.conversationId,
      messageId: metadata?.messageId || rest.messageId,
      created_at: metadata?.created_at || now,
      updated_at: now,
      expires_at: metadata?.expires_at,
      status: metadata?.status || 'active',
    };

    if (isEverOSMemoryEnabled()) {
      try {
        const content = formatEverOSContent({ key: memoryKey, value: memoryValue });
        const messageId = messageIdForMemory({ userId, key: memoryKey });
        const legacyPayload = {
            message_id: messageIdForMemory({ userId, key: memoryKey }),
            create_time: new Date().toISOString(),
            sender: String(userId),
            sender_name: String(userId),
            role: 'user',
            content,
            group_id: groupIdForUser(userId),
            group_name: 'LibreChat账号记忆',
            refer_list: [],
            raw_data_type: 'conversation',
            metadata: normalizedMetadata,
        };
        await requestEverOSCompat({
          legacy: {
            path: '/memories',
            init: {
              method: 'POST',
              body: JSON.stringify(legacyPayload),
            },
          },
          official: {
            path: '/memories',
            init: {
              method: 'POST',
              body: JSON.stringify(
                officialAddPayload({
                  userId,
                  metadata: normalizedMetadata,
                  messages: [
                    buildOfficialMessage({
                      userId,
                      role: 'user',
                      content,
                      messageId,
                      createdAt: now,
                      metadata: normalizedMetadata,
                    }),
                  ],
                }),
              ),
            },
          },
        });
        everosOk = true;
        if (getApiStyle() !== 'official') {
          try {
            await syncEverOSCustomProfile({
              userId,
              fallbackMethods,
              nextMemory: { key: memoryKey, value: memoryValue },
            });
          } catch (error) {
            console.warn('[MemoryGateway] EverOS profile sync skipped/failed after setMemory', {
              userId: String(userId),
              key: memoryKey,
              error: error.message,
            });
          }
        }
      } catch (error) {
        everosError = error;
        console.warn('[MemoryGateway] EverOS setMemory failed, writing local fallback cache', {
          userId: String(userId),
          key: memoryKey,
          error: error.message,
        });
      }
    }

    try {
      await fallbackMethods.setMemory({
        userId,
        key: memoryKey,
        value: memoryValue,
        tokenCount: rest.tokenCount,
        metadata: normalizedMetadata,
      });
      localOk = true;
    } catch (error) {
      localError = error;
      console.warn('[MemoryGateway] Local MemoryEntry setMemory failed', {
        userId: String(userId),
        key: memoryKey,
        error: error.message,
      });
      if (!isEverOSMemoryEnabled()) {
        return { ok: false, reason: error.message };
      }
    }

    return {
      ok: everosOk || localOk,
      everosOk,
      localOk,
      key: memoryKey,
      reason:
        everosOk && localOk
          ? 'stored_both'
          : localOk
            ? 'stored_local_fallback'
            : everosOk
              ? 'stored_everos'
              : 'failed_to_store_memory',
      errors: [everosError?.message, localError?.message].filter(Boolean),
    };
  }

  async function setMemory(params) {
    return createMemory(params);
  }

  async function deleteMemory({ userId, key, query, userMessage, metadata } = {}) {
    if (!isEverOSMemoryEnabled()) {
      return fallbackMethods.deleteMemory({ userId, key, query, userMessage });
    }

    const memoryKey = toMemoryKey(key);
    const deleteQuery = query || deletionQueryFromText(userMessage || '');
    let everosOk = false;
    let localOk = false;
    let matchedMemory = null;
    let everosError = null;
    let localError = null;

    try {
      const memories = await getAllUserMemories(userId);
      matchedMemory =
        memories.find((memory) => {
          const decision = shouldDeleteMemory({ memory, query: deleteQuery, key: memoryKey });
          return decision.allow;
        }) || memories.find((memory) => memory.key === memoryKey);

      const decision = shouldDeleteMemory({
        memory: matchedMemory,
        query: deleteQuery || matchedMemory?.value,
        key: memoryKey,
      });

      if (!decision.allow && deleteQuery) {
        console.warn('[MemoryGateway] Blocked conservative delete', {
          userId: String(userId),
          key: memoryKey,
          query: compact(deleteQuery),
          reason: decision.reason,
          conversationId: metadata?.conversationId,
          messageId: metadata?.messageId,
        });
        return { ok: false, reason: decision.reason, everosOk, localOk };
      }

      await requestEverOS('/memories', {
        method: 'DELETE',
        body: JSON.stringify({
          event_id: matchedMemory?._id || messageIdForMemory({ userId, key: memoryKey }),
          user_id: String(userId),
          group_id: groupIdForUser(userId),
        }),
      });
      everosOk = true;
    } catch (error) {
      everosError = error;
      console.warn('[MemoryGateway] EverOS delete failed', {
        userId: String(userId),
        key: memoryKey,
        query: compact(deleteQuery),
        error: error.message,
      });
    }

		    try {
		      const localResult = await fallbackMethods.deleteMemory({
            userId,
            key: memoryKey,
            query: deleteQuery,
            userMessage,
          });
	      localOk = !!localResult?.ok;
        if (localOk) {
          if (getApiStyle() !== 'official') {
            try {
              await syncEverOSCustomProfile({ userId, fallbackMethods });
            } catch (error) {
              console.warn('[MemoryGateway] EverOS profile resync after delete failed', {
                userId: String(userId),
                key: memoryKey,
                error: error.message,
              });
            }
          }
        }
	    } catch (error) {
      localError = error;
      console.warn('[MemoryGateway] Local MemoryEntry delete failed', {
        userId: String(userId),
        key: memoryKey,
        query: compact(deleteQuery),
        error: error.message,
      });
    }

    return {
      ok: everosOk || localOk,
      everosOk,
      localOk,
      key: memoryKey,
      query: deleteQuery,
      reason: everosOk && localOk ? 'deleted_both' : localOk ? 'deleted_local_fallback' : 'partial_or_failed_delete',
      errors: [everosError?.message, localError?.message].filter(Boolean),
    };
  }

  async function getFormattedMemories({ userId, userMessage, conversationContext, endpoint, agentId } = {}) {
    return withFallback('getFormattedMemories', [{ userId }], async () => {
      const retrieveDecision = shouldRetrieveMemory({
        userMessage,
        conversationContext,
        endpoint,
        agentId,
      });

      let memories = await getAllUserMemories(userId);
      if (memories.length === 0 && retrieveDecision.allow) {
        const searchParams = {
          query: userMessage || '用户个人信息 偏好 工作背景 账号记忆',
          user_id: String(userId),
          group_id: groupIdForUser(userId),
          retrieve_method: 'hybrid',
          memory_types: 'episodic_memory,profile',
          top_k: '20',
          include_metadata: 'true',
        };
        const query = new URLSearchParams(searchParams);
        const response = await requestEverOSCompat({
          legacy: { path: `/memories/search?${query.toString()}` },
          official: {
            path: '/memories/search',
            init: {
              method: 'POST',
              body: JSON.stringify(searchParams),
            },
          },
        });
        memories = getSearchList(response)
          .filter(isLibreStableMemory)
          .map((record) => normalizeMemory(record, userId));
      }

      const ranked = filterAndRankMemories(memories, {
        limit: retrieveDecision.allow ? 8 : 3,
      });
      const sorted = ranked.sort(
        (a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime(),
      );
      const withoutKeys = sorted
        .map((memory, index) => `${index + 1}. ${memory.value}`)
        .join('\n\n');
      const withKeys = sorted
        .map(
          (memory, index) => `${index + 1}. ["key": "${memory.key}"]. ["value": "${memory.value}"]`,
        )
        .join('\n\n');
      return { withKeys, withoutKeys, totalTokens: 0 };
    });
  }

  async function deleteAllUserMemories(userId) {
    return withFallback('deleteAllUserMemories', [userId], async () => {
      await requestEverOS('/memories', {
        method: 'DELETE',
        body: JSON.stringify({
          user_id: String(userId),
          group_id: groupIdForUser(userId),
        }),
      });
      return fallbackMethods.deleteAllUserMemories(userId);
    });
  }

  async function queueEverOSMessage({ userId, message, endpoint }) {
    if (!isEverOSMemoryEnabled() || !userId || !message) {
      return { ok: false };
    }

    const content = extractMessageText(message);
    if (!content) {
      return { ok: false };
    }

    if (message.isCreatedByUser && isExplicitMemoryRequest(content)) {
      return { ok: false, skipped: true, reason: 'explicit_memory_request' };
    }

    const createdAt = message.createdAt || message.created_at;
    const messageId = message.messageId || message.id;
    const metadata = {
      source: 'auto_summary',
      scope: 'session',
      status: 'active',
      memory_action: 'ordinary_conversation',
      skip_stable_prompt_injection: true,
    };

    await requestEverOSCompat({
      legacy: {
        path: '/memories',
        init: {
          method: 'POST',
          body: JSON.stringify({
            message_id: messageId,
            create_time: toISODate(createdAt),
            sender: String(userId),
            sender_name: message.isCreatedByUser
              ? String(userId)
              : endpoint || message.sender || 'assistant',
            role: message.isCreatedByUser ? 'user' : 'assistant',
            content,
            group_id: groupIdForUser(userId),
            group_name: 'LibreChat账号记忆',
            refer_list:
              message.parentMessageId &&
              message.parentMessageId !== '00000000-0000-0000-0000-000000000000'
                ? [message.parentMessageId]
                : [],
            raw_data_type: 'conversation',
            metadata,
          }),
        },
      },
      official: {
        path: '/memories',
        init: {
          method: 'POST',
          body: JSON.stringify(
            officialAddPayload({
              userId,
              metadata,
              messages: [
                buildOfficialMessage({
                  userId,
                  role: message.isCreatedByUser ? 'user' : 'assistant',
                  content,
                  messageId,
                  createdAt,
                  metadata,
                }),
              ],
            }),
          ),
        },
      },
    });

    return { ok: true };
  }

  return {
    getAllUserMemories,
    createMemory,
    setMemory,
    deleteMemory,
    getFormattedMemories,
    deleteAllUserMemories,
    queueEverOSMessage,
  };
}

module.exports = {
  createEverOSMemoryMethods,
  isEverOSMemoryEnabled,
};
