export type SanSuoMode = 'fast' | 'deep' | 'knowledge';

export const SANSUO_MODE_STORAGE_KEY = 'sansuo.answerMode';
export const SANSUO_KNOWLEDGE_AGENT_STORAGE_KEY = 'sansuo.knowledgeAgentId';
export const SANSUO_INDUSTRY_MATERIALS_STORAGE_KEY = 'sansuo.industryMaterialIds';
export const SANSUO_MODE_EVENT = 'sansuo-mode-change';
export const SANSUO_KNOWLEDGE_SEARCH_TOOL = 'sansuo_knowledge_search';
export const SANSUO_FILE_PARSE_TOOL = 'sansuo_file_parse';

export type SanSuoKnowledgeStatus = 'searching' | 'completed' | 'failed';
export type SanSuoFileParseStatus = 'parsing' | 'completed' | 'failed';
export type SanSuoProcessTiming = {
  startedAt?: string;
  completedAt?: string;
  elapsedMs?: number;
};

export function isSanSuoPreparseFile(file: unknown): boolean {
  if (!file || typeof file !== 'object') {
    return false;
  }
  const value = file as {
    type?: unknown;
    mimeType?: unknown;
    filename?: unknown;
    name?: unknown;
    filepath?: unknown;
  };
  const mimeType = String(value.type || value.mimeType || '').toLowerCase();
  if (
    mimeType === 'application/pdf' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/vnd.ms-excel' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'text/csv' ||
    mimeType === 'text/markdown' ||
    mimeType === 'text/plain'
  ) {
    return true;
  }
  return /\.(?:pdf|docx|xlsx?|csv|md|markdown|txt)(?:$|[?#])/i.test(
    String(value.filename || value.name || value.filepath || ''),
  );
}

export function getSanSuoFileParseStatus(metadata: unknown): SanSuoFileParseStatus | undefined {
  if (!metadata || typeof metadata !== 'object') {
    return undefined;
  }
  const status = (metadata as { sansuoFileParse?: { status?: unknown } }).sansuoFileParse?.status;
  return status === 'parsing' || status === 'completed' || status === 'failed' ? status : undefined;
}

export function getSanSuoKnowledgeStatus(metadata: unknown): SanSuoKnowledgeStatus | undefined {
  if (!metadata || typeof metadata !== 'object') {
    return undefined;
  }
  const value = metadata as {
    sansuoMode?: unknown;
    sansuoKnowledge?: { unavailable?: unknown; status?: unknown };
  };
  if (value.sansuoMode !== 'knowledge') {
    return undefined;
  }
  if (value.sansuoKnowledge?.unavailable === true || value.sansuoKnowledge?.status === 'failed') {
    return 'failed';
  }
  return value.sansuoKnowledge?.status === 'searching' ? 'searching' : 'completed';
}

export function getSanSuoProcessTiming(metadata: unknown): SanSuoProcessTiming | undefined {
  if (!metadata || typeof metadata !== 'object') {
    return undefined;
  }
  const timing = (metadata as { sansuoProcessTiming?: unknown }).sansuoProcessTiming;
  if (!timing || typeof timing !== 'object') {
    return undefined;
  }
  const value = timing as Record<string, unknown>;
  const startedAt = typeof value.startedAt === 'string' ? value.startedAt : undefined;
  const completedAt = typeof value.completedAt === 'string' ? value.completedAt : undefined;
  const storedElapsedMs =
    typeof value.elapsedMs === 'number' && Number.isFinite(value.elapsedMs) && value.elapsedMs >= 0
      ? value.elapsedMs
      : undefined;
  const difference =
    startedAt && completedAt ? Date.parse(completedAt) - Date.parse(startedAt) : NaN;
  const elapsedMs =
    storedElapsedMs ?? (Number.isFinite(difference) && difference >= 0 ? difference : undefined);
  if (!startedAt && !completedAt && elapsedMs == null) {
    return undefined;
  }
  return { startedAt, completedAt, elapsedMs };
}

export function getSanSuoMode(): SanSuoMode {
  if (typeof window === 'undefined') {
    return 'fast';
  }
  const value = window.localStorage.getItem(SANSUO_MODE_STORAGE_KEY);
  return value === 'deep' || value === 'knowledge' ? value : 'fast';
}

export function getSanSuoKnowledgeAgentId(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  return window.localStorage.getItem(SANSUO_KNOWLEDGE_AGENT_STORAGE_KEY) ?? '';
}

function materialStorageKey(conversationId?: string | null) {
  return `${SANSUO_INDUSTRY_MATERIALS_STORAGE_KEY}.${conversationId || 'new'}`;
}

export function getSanSuoIndustryMaterialIds(conversationId?: string | null): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const value = JSON.parse(
      window.sessionStorage.getItem(materialStorageKey(conversationId)) || '[]',
    );
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string').slice(0, 5) : [];
  } catch {
    return [];
  }
}

export function setSanSuoSelection(
  mode: SanSuoMode,
  knowledgeAgentId?: string | null,
  industryMaterialIds?: string[] | null,
  conversationId?: string | null,
) {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(SANSUO_MODE_STORAGE_KEY, mode);
  if (knowledgeAgentId !== undefined) {
    if (knowledgeAgentId) {
      window.localStorage.setItem(SANSUO_KNOWLEDGE_AGENT_STORAGE_KEY, knowledgeAgentId);
    } else {
      window.localStorage.removeItem(SANSUO_KNOWLEDGE_AGENT_STORAGE_KEY);
    }
  }
  if (industryMaterialIds !== undefined) {
    const ids = Array.from(new Set(industryMaterialIds || [])).slice(0, 5);
    if (ids.length) {
      window.sessionStorage.setItem(materialStorageKey(conversationId), JSON.stringify(ids));
    } else {
      window.sessionStorage.removeItem(materialStorageKey(conversationId));
    }
  }
  window.dispatchEvent(new CustomEvent(SANSUO_MODE_EVENT));
}

export function setSanSuoIndustryMaterialIds(
  industryMaterialIds: string[],
  conversationId?: string | null,
) {
  if (typeof window === 'undefined') return;
  const ids = Array.from(new Set(industryMaterialIds)).slice(0, 5);
  if (ids.length) {
    window.sessionStorage.setItem(materialStorageKey(conversationId), JSON.stringify(ids));
  } else {
    window.sessionStorage.removeItem(materialStorageKey(conversationId));
  }
  window.dispatchEvent(new CustomEvent(SANSUO_MODE_EVENT));
}

export function moveSanSuoIndustryMaterials(fromConversationId: string, toConversationId: string) {
  if (typeof window === 'undefined' || fromConversationId === toConversationId) return;
  const ids = getSanSuoIndustryMaterialIds(fromConversationId);
  if (!ids.length) return;
  window.sessionStorage.setItem(materialStorageKey(toConversationId), JSON.stringify(ids));
  window.sessionStorage.removeItem(materialStorageKey(fromConversationId));
  window.dispatchEvent(new CustomEvent(SANSUO_MODE_EVENT));
}

export function isSanSuoAttachmentRestricted(mode = getSanSuoMode()) {
  return mode === 'fast' || mode === 'knowledge';
}
