const LONG_TERM_PATTERNS = [
  /记住/,
  /保存我的/,
  /保存.*偏好/,
  /别忘/,
  /以后(回答|默认|叫我|都|每次|长期|写|代码|COMSOL|comsol)/,
  /每次都/,
  /长期希望/,
  /我叫[\s\S]{1,40}/,
  /叫我[\s\S]{1,40}/,
  /正在做[\s\S]{1,80}(项目|模型|研究|课题)/,
  /研究方向是/,
  /论文写作偏好/,
];

const BLOCK_PATTERNS = [
  /pdf|docx|pptx|excel|xlsx|zip/i,
  /下载|导出|打包|压缩|上传|附件|生成文件|文件名|summary\.txt/i,
  /当前对话|这次|本次|当前|这个文件|这张图|这页PPT|临时|先这样/,
  /当前回答.{0,12}短一点|这次.{0,12}蓝色/,
  /帮我生成|帮我修改这个|把这段话|给我代码|检查这个文件/,
  /API\s*key|token|password|cookie|secret|sk-[a-zA-Z0-9_-]+/i,
  /身份证|银行卡|精确地址/,
];

const MEMORY_CONTEXT_BLOCK_PATTERNS = [
  /系统已读取到当前账号的长期记忆/,
  /当前账号的长期记忆/,
  /我有什么记忆/,
  /我现在有哪些记忆/,
  /你有什么记忆/,
  /DOCX visual context/i,
  /PDF visual context/i,
  /Attached DOCX image understanding context/i,
  /Attached PDF visual understanding context/i,
  /Vision summary/i,
  /任务路由结果 JSON/,
  /sandbox 执行上下文/,
  /Generated files:/i,
  /\/mnt\/data\//,
];

const DELETE_MATCH_TOKENS = [
  '图片',
  '图像',
  '截图',
  '视觉',
  '查看',
  '展开',
  '细节',
  '偏好',
  '饮食',
  '吃',
  '牛肉',
  '鸡胸肉',
  '姓名',
  '名字',
];

const RETRIEVE_PATTERNS = [
  /继续|上次|之前|还记得|按照我的习惯|按我之前的风格|我的项目|我的论文|我的模型/,
  /我之前说过|结合我之前|仍然按照/,
  /我是谁|你记得我吗|你知道我是谁吗|我有什么记忆|我现在有哪些记忆|你有什么记忆|我的记忆/,
];

const NO_RETRIEVE_PATTERNS = [
  /pdf|docx|pptx|xlsx|excel|zip/i,
  /下载|导出|打包|压缩|上传|生成文件|当前对话/,
  /翻译|是什么|解释一下|定义/,
  /这张图|当前图片|红框|局部修改/,
];

const DOMAIN_RULES = [
  ['academic_writing', /论文|写作|AI味|学术/],
  ['comsol', /COMSOL|comsol|U-?10Zr|气泡肿胀|模型/],
  ['coding', /代码|脚本|Python|JavaScript|debug|报错/],
  ['image_editing', /图片|图像|照片|红框/],
  ['project', /项目|课题|研究方向/],
];

function compact(value, limit = 120) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function textOf(...values) {
  return values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('\n');
}

function stripMemorySystemContext(text = '') {
  return String(text || '')
    .replace(/\s*\[系统已在模型回复前完成本次记忆(?:保存|删除\/清理)。\][\s\S]*$/g, '')
    .replace(/\s*\[系统已读取到当前账号的长期记忆[\s\S]*$/g, '')
    .replace(/\s*#\s*(?:DOCX|PDF) visual context:[\s\S]*$/gi, '')
    .trim();
}

function inferDomain(text) {
  for (const [domain, pattern] of DOMAIN_RULES) {
    if (pattern.test(text)) {
      return domain;
    }
  }
  return 'general';
}

function inferScope(text) {
  if (/这个文件|这张图|这页PPT|当前|本次|这次|临时/.test(text)) {
    return 'session';
  }
  if (/项目|课题|模型|研究方向/.test(text)) {
    return 'project';
  }
  return 'user';
}

function isExplicitMemoryRequest(text) {
  return LONG_TERM_PATTERNS.some((pattern) => pattern.test(text)) || /忘记|删除.*记忆/.test(text);
}

function sentence(value) {
  const text = String(value || '').trim().replace(/[。.!！]+$/g, '');
  return text ? `${text}。` : '';
}

function cleanMemorySubject(text = '') {
  return String(text || '')
    .trim()
    .replace(/^(请你|请|帮我|麻烦你)?(记住|保存|别忘了?|以后记住|以后默认|以后都|以后|每次都)/, '')
    .replace(/^[:：,，\s]+/, '')
    .trim();
}

function inferMemoryKey(text = '') {
  if (/我叫|我是|叫我|姓名|名字/.test(text)) {
    return 'personal_info';
  }
  if (/论文|写作|回答|默认|偏好|风格|简洁|代码|每次|以后/.test(text)) {
    return 'preferences';
  }
  if (/正在做|项目|课题|模型|研究方向|部门|岗位|工作/.test(text)) {
    return 'work_info';
  }
  if (/会|擅长|技能|能力/.test(text)) {
    return 'skills';
  }
  if (/喜欢|兴趣|爱好|热爱|爱打|爱吃|爱看|爱喝|爱玩/.test(text)) {
    return 'interests';
  }
  return 'context';
}

function buildExplicitMemoryValue(text = '') {
  const raw = String(text || '').trim();

  const name =
    raw.match(/(?:记住|保存|别忘了?|请记住)?\s*我(?:叫|是)\s*([^，。,.!！?\s]{1,40})/)?.[1] ||
    raw.match(/(?:以后)?叫我\s*([^，。,.!！?\s]{1,40})/)?.[1];
  if (name) {
    return sentence(`我叫${name}`);
  }

  const preference = raw.match(/(?:以后|每次|默认)([\s\S]{1,120})/)?.[1];
  if (preference) {
    return sentence(`用户偏好${preference.trim()}`);
  }

  const writingPreference = raw.match(/(?:保存|记住).{0,12}偏好[:：]\s*([\s\S]{1,120})/)?.[1];
  if (writingPreference) {
    return sentence(`用户偏好${writingPreference.trim()}`);
  }

  const work = raw.match(/(?:记住|保存|别忘了?)?\s*我(正在做|的研究方向是|研究方向是)([\s\S]{1,120})/)?.[0];
  if (work) {
    return sentence(work.replace(/^(记住|保存|别忘了?)/, '').trim());
  }

  const subject = cleanMemorySubject(raw);
  if (/^我/.test(subject)) {
    return sentence(subject);
  }
  return sentence(`用户希望长期记住：${subject}`);
}

function parseExplicitMemoryAction(text = '') {
  const raw = stripMemorySystemContext(text);
  if (!raw) {
    return { type: 'none' };
  }

  if (/忘记|删除|删掉|不要再记/.test(raw)) {
    return {
      type: 'delete',
      key: inferMemoryKey(raw),
      query: deletionQueryFromText(raw),
    };
  }

  if (!isExplicitMemoryRequest(raw)) {
    return { type: 'none' };
  }

  return {
    type: 'set',
    key: inferMemoryKey(raw),
    value: buildExplicitMemoryValue(raw),
  };
}

function shouldPersistMemory({ key, value, userMessage, source, metadata } = {}) {
  const combined = textOf(userMessage, value);
  const normalizedValue = String(value || '').trim().replace(/\s+/g, ' ');

  if (!normalizedValue) {
    return { allow: false, reason: 'empty_memory_value' };
  }

  if (/忘记|删除.*记忆|删除我的|删掉|不要再记/.test(combined)) {
    return {
      allow: false,
      reason: 'delete_intent_must_not_persist',
      normalizedValue,
    };
  }

  const pollutedValue = MEMORY_CONTEXT_BLOCK_PATTERNS.find((pattern) => pattern.test(normalizedValue));
  if (pollutedValue) {
    return {
      allow: false,
      reason: `blocked_memory_context_pollution:${pollutedValue.toString()}`,
      normalizedValue,
    };
  }

  const allowByExplicitLongTerm = LONG_TERM_PATTERNS.some((pattern) => pattern.test(combined));
  const blocked = BLOCK_PATTERNS.find((pattern) => pattern.test(combined));

  if (blocked && !allowByExplicitLongTerm) {
    return {
      allow: false,
      reason: `blocked_transient_or_sensitive_content:${blocked.toString()}`,
      normalizedValue,
    };
  }

  if (!allowByExplicitLongTerm && source !== 'system_import') {
    return {
      allow: false,
      reason: 'missing_explicit_long_term_memory_intent',
      normalizedValue,
    };
  }

  const domain = metadata?.domain || inferDomain(combined);
  const scope = metadata?.scope || inferScope(combined);
  return {
    allow: true,
    reason: 'explicit_long_term_memory',
    normalizedValue,
    memoryType: key,
    domain,
    scope,
  };
}

function shouldRetrieveMemory({ userMessage, conversationContext } = {}) {
  const combined = textOf(userMessage, conversationContext);
  const explicitNeed = RETRIEVE_PATTERNS.some((pattern) => pattern.test(combined));
  const blocked = NO_RETRIEVE_PATTERNS.some((pattern) => pattern.test(combined));

  if (explicitNeed) {
    return { allow: true, reason: 'history_or_personalization_requested' };
  }
  if (blocked) {
    return { allow: false, reason: 'transient_or_general_task' };
  }
  return { allow: false, reason: 'no_memory_signal' };
}

function scoreMemory(memory = {}) {
  let score = 0;
  const source = memory.metadata?.source || memory.source;
  if (source === 'explicit_user_request') score += 4;
  if (memory.metadata?.scope === 'user' || memory.scope === 'user') score += 2;
  if (memory.metadata?.status === 'active' || memory.status === 'active') score += 1;
  score += Number(memory.metadata?.confidence || memory.confidence || 0);
  score += new Date(memory.updated_at || memory.updatedAt || 0).getTime() / 10 ** 13;
  return score;
}

function normalizeForSimilarity(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。、“”‘’：:；;,.!?！？]/g, '');
}

function filterAndRankMemories(memories = [], { limit = 8 } = {}) {
  const byIdentity = new Map();

  for (const memory of memories) {
    const status = memory.metadata?.status || memory.status;
    if (status === 'deleted' || status === 'inactive' || status === 'expired') {
      continue;
    }

    const textKey = normalizeForSimilarity(memory.value || memory.content || '');
    const key = [memory._id || memory.id || '', memory.key || '', textKey].filter(Boolean).join(':');
    const existing = byIdentity.get(memory.key || key);
    if (!existing || scoreMemory(memory) >= scoreMemory(existing)) {
      byIdentity.set(memory.key || key, memory);
    }
  }

  const seenText = new Set();
  return Array.from(byIdentity.values())
    .sort((a, b) => scoreMemory(b) - scoreMemory(a))
    .filter((memory) => {
      const textKey = normalizeForSimilarity(memory.value || memory.content || '');
      if (!textKey || seenText.has(textKey)) {
        return false;
      }
      seenText.add(textKey);
      return true;
    })
    .slice(0, limit);
}

function deletionQueryFromText(text = '') {
  const raw = stripMemorySystemContext(text);
  const quoted = raw.match(/[“"']([^“"']{1,80})[”"']/)?.[1];
  if (quoted) {
    return quoted;
  }
  const name = raw.match(/(?:忘记|删除).{0,12}(?:我叫|叫我|名字|姓名)([^，。,.!！?\s]{1,30})/)?.[1];
  if (name) {
    return name;
  }
  return raw
    .replace(
      /^(请你|请|帮我|麻烦你)?(我)?(想|要|需要|希望)?(把|将)?(忘记|删除|删掉|不要再记得?|不要再记|不要记住|移除|清除)(我的|我)?(关于|有关)?/,
      '',
    )
    .replace(/^(我的|我)/, '')
    .replace(/^[:：,，\s]+/, '')
    .trim();
}

function hasDeleteTokenOverlap(value = '', query = '') {
  const normalizedValue = normalizeForSimilarity(value);
  const normalizedQuery = normalizeForSimilarity(query);
  if (!normalizedValue || !normalizedQuery) {
    return false;
  }
  const sharedTokens = DELETE_MATCH_TOKENS.filter(
    (token) => normalizedQuery.includes(token) && normalizedValue.includes(token),
  );
  if (sharedTokens.length >= 2) {
    return true;
  }
  if (
    normalizedQuery.includes('图片查看偏好') &&
    normalizedValue.includes('图片') &&
    normalizedValue.includes('偏好')
  ) {
    return true;
  }
  if (
    normalizedQuery.includes('饮食偏好') &&
    (normalizedValue.includes('吃') || normalizedValue.includes('牛肉') || normalizedValue.includes('鸡胸肉'))
  ) {
    return true;
  }
  return false;
}

function shouldDeleteMemory({ memory, query, key } = {}) {
  const value = String(memory?.value || memory?.content || '');
  const queryText = String(query || '').trim();
  if (!memory) {
    return { allow: false, reason: 'memory_not_found' };
  }
  if (!queryText) {
    return { allow: false, reason: 'missing_delete_query' };
  }
  const normalizedValue = normalizeForSimilarity(value);
  const normalizedQuery = normalizeForSimilarity(queryText);
  const normalizedQueryWithoutSelf = normalizedQuery.replace(/^我/, '');
  const contentMatches =
    normalizedQuery &&
    (normalizedValue.includes(normalizedQuery) ||
      normalizedQuery.includes(normalizedValue) ||
      (normalizedQueryWithoutSelf.length >= 2 &&
        normalizedValue.includes(normalizedQueryWithoutSelf)));

  if (contentMatches) {
    return { allow: true, reason: 'content_match' };
  }
  if (key && memory.key && key === memory.key && hasDeleteTokenOverlap(value, queryText)) {
    return { allow: true, reason: 'key_token_overlap_match' };
  }
  if (value.includes(queryText) || queryText.includes(value)) {
    return { allow: true, reason: 'content_match' };
  }
  if (/名字|姓名|叫/.test(queryText) && memory.key === 'personal_info') {
    return { allow: true, reason: 'personal_info_name_match' };
  }
  if (key && memory.key && key !== memory.key) {
    return { allow: false, reason: 'key_mismatch' };
  }
  return { allow: false, reason: 'content_not_matched' };
}

module.exports = {
  compact,
  deletionQueryFromText,
  filterAndRankMemories,
  isExplicitMemoryRequest,
  parseExplicitMemoryAction,
  shouldDeleteMemory,
  shouldPersistMemory,
  shouldRetrieveMemory,
};
