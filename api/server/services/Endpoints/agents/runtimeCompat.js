const { logger } = require('@librechat/data-schemas');
const { isEphemeralAgentId } = require('librechat-data-provider');

const MAX_SKILL_NAME_LENGTH = 200;
const MAX_PRIMED_SKILLS_PER_TURN = 30;
const SKILL_MESSAGE_SOURCE = 'skill';
const SKILL_TRIGGER_MANUAL = 'manual';
const SKILL_TRIGGER_ALWAYS_APPLY = 'always-apply';

let CachedHumanMessage = null;
let HumanMessageLoadAttempted = false;

function resolveHumanMessage() {
  if (CachedHumanMessage) {
    return CachedHumanMessage;
  }
  if (HumanMessageLoadAttempted) {
    return null;
  }
  HumanMessageLoadAttempted = true;

  try {
    ({ HumanMessage: CachedHumanMessage } = require('@langchain/core/messages'));
    return CachedHumanMessage;
  } catch (error) {
    logger.warn(
      `[runtimeCompat] Unable to load HumanMessage from @langchain/core/messages: ${error.message}`,
    );
  }

  return null;
}

function createHumanMessage(payload) {
  const HumanMessage = resolveHumanMessage();
  if (typeof HumanMessage === 'function') {
    return new HumanMessage(payload);
  }

  const content =
    typeof payload === 'string' ? payload : payload?.content ?? '';
  const additional_kwargs =
    typeof payload === 'object' && payload?.additional_kwargs
      ? payload.additional_kwargs
      : {};

  return {
    content,
    additional_kwargs,
    lc_kwargs: { content, additional_kwargs },
    getType() {
      return 'human';
    },
    _getType() {
      return 'human';
    },
  };
}

function toSkillStatesRecord(raw) {
  if (raw instanceof Map) {
    return Object.fromEntries(raw);
  }
  if (raw && typeof raw === 'object') {
    return raw;
  }
  return {};
}

function resolveDefaultActiveOnShare(skillsConfig) {
  if (skillsConfig && typeof skillsConfig === 'object') {
    return skillsConfig.defaultActiveOnShare === true;
  }
  return false;
}

async function fallbackLoadSkillStates(params) {
  const { userId, appConfig, getUserById, accessibleSkillIds } = params;
  if (accessibleSkillIds !== undefined && accessibleSkillIds.length === 0) {
    return { skillStates: {}, defaultActiveOnShare: false };
  }
  const user = await getUserById(userId, 'skillStates');
  return {
    skillStates: toSkillStatesRecord(user?.skillStates),
    defaultActiveOnShare: resolveDefaultActiveOnShare(appConfig?.interfaceConfig?.skills),
  };
}

function scopeSkillIds(accessibleSkillIds, agentSkills) {
  if (agentSkills == null) {
    return accessibleSkillIds;
  }
  if (agentSkills.length === 0) {
    return [];
  }
  const agentSet = new Set(agentSkills);
  return accessibleSkillIds.filter((oid) => agentSet.has(oid.toString()));
}

function fallbackResolveAgentScopedSkillIds(params) {
  const { agent, accessibleSkillIds, skillsCapabilityEnabled, ephemeralSkillsToggle } = params;
  if (!skillsCapabilityEnabled || accessibleSkillIds.length === 0) {
    return [];
  }
  if (isEphemeralAgentId(agent.id)) {
    return ephemeralSkillsToggle ? scopeSkillIds(accessibleSkillIds, undefined) : [];
  }
  if (agent.skills_enabled !== true) {
    return [];
  }
  if (!Array.isArray(agent.skills) || agent.skills.length === 0) {
    return scopeSkillIds(accessibleSkillIds, undefined);
  }
  return scopeSkillIds(accessibleSkillIds, agent.skills);
}

function fallbackExtractManualSkills(body) {
  if (!body || typeof body !== 'object') {
    return undefined;
  }
  const raw = body.manualSkills;
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const filtered = raw.filter(
    (entry) => typeof entry === 'string' && entry.length > 0 && entry.length <= MAX_SKILL_NAME_LENGTH,
  );
  return filtered.length > 0 ? filtered : undefined;
}

function fallbackInjectSkillPrimes(params) {
  const {
    initialMessages,
    manualSkillPrimes = [],
    alwaysApplySkillPrimes = [],
    maxPrimesPerTurn = MAX_PRIMED_SKILLS_PER_TURN,
  } = params;
  let { indexTokenCountMap } = params;

  let alwaysApply = alwaysApplySkillPrimes;
  let alwaysApplyDedupedFromManual = 0;
  if (alwaysApply.length > 0 && manualSkillPrimes.length > 0) {
    const manualNames = new Set(manualSkillPrimes.map((p) => p.name));
    const deduped = alwaysApply.filter((p) => !manualNames.has(p.name));
    alwaysApplyDedupedFromManual = alwaysApply.length - deduped.length;
    if (alwaysApplyDedupedFromManual > 0) {
      logger.info(
        `[fallbackInjectSkillPrimes] Dropped ${alwaysApplyDedupedFromManual} always-apply prime(s) already present in the manual list.`,
      );
      alwaysApply = deduped;
    }
  }

  let alwaysApplyDropped = 0;
  const total = manualSkillPrimes.length + alwaysApply.length;
  if (total > maxPrimesPerTurn) {
    const budgetForAlwaysApply = Math.max(0, maxPrimesPerTurn - manualSkillPrimes.length);
    alwaysApplyDropped = alwaysApply.length - budgetForAlwaysApply;
    alwaysApply = alwaysApply.slice(0, budgetForAlwaysApply);
    logger.warn(
      `[fallbackInjectSkillPrimes] Combined primes ${total} exceeds cap ${maxPrimesPerTurn}; dropping ${alwaysApplyDropped} always-apply prime(s).`,
    );
  }

  const numPrimes = manualSkillPrimes.length + alwaysApply.length;
  if (numPrimes === 0 || initialMessages.length === 0) {
    return {
      initialMessages,
      indexTokenCountMap,
      inserted: 0,
      insertIdx: -1,
      alwaysApplyDropped,
      alwaysApplyDedupedFromManual,
    };
  }

  const insertIdx = initialMessages.length - 1;
  if (indexTokenCountMap) {
    const shifted = {};
    for (const [idxStr, count] of Object.entries(indexTokenCountMap)) {
      const idx = Number(idxStr);
      shifted[idx >= insertIdx ? idx + numPrimes : idx] = count;
    }
    indexTokenCountMap = shifted;
  }

  const buildPrime = (p, trigger) =>
    createHumanMessage({
      content: p.body,
      additional_kwargs: {
        isMeta: true,
        source: SKILL_MESSAGE_SOURCE,
        trigger,
        skillName: p.name,
      },
    });

  const primeMessages = [
    ...alwaysApply.map((p) => buildPrime(p, SKILL_TRIGGER_ALWAYS_APPLY)),
    ...manualSkillPrimes.map((p) => buildPrime(p, SKILL_TRIGGER_MANUAL)),
  ];
  initialMessages.splice(insertIdx, 0, ...primeMessages);

  return {
    initialMessages,
    indexTokenCountMap,
    inserted: numPrimes,
    insertIdx,
    alwaysApplyDropped,
    alwaysApplyDedupedFromManual,
  };
}

async function fallbackPrimeInvokedSkills() {
  return {};
}

module.exports = {
  fallbackLoadSkillStates,
  fallbackResolveAgentScopedSkillIds,
  fallbackExtractManualSkills,
  fallbackInjectSkillPrimes,
  fallbackPrimeInvokedSkills,
};
