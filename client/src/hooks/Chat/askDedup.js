export const RAPID_ASK_WINDOW_MS = 4000;

const recentAskTimestamps = new Map();

const normalizeAskText = (text) => text?.trim().replace(/\s+/g, ' ') ?? '';

const pruneExpiredRapidAsks = (now) => {
  for (const [key, timestamp] of recentAskTimestamps.entries()) {
    if (now - timestamp >= RAPID_ASK_WINDOW_MS) {
      recentAskTimestamps.delete(key);
    }
  }
};

export const buildRapidAskKey = ({
  index = 0,
  conversationId,
  editedMessageId,
  isContinued = false,
  isEdited = false,
  isRegenerate = false,
  parentMessageId,
  text,
}) => {
  const normalizedText = normalizeAskText(text);
  if (normalizedText.length === 0) {
    return null;
  }

  const isFreshRootMessage =
    !isRegenerate &&
    !isContinued &&
    !isEdited &&
    (parentMessageId == null || parentMessageId === '00000000-0000-0000-0000-000000000000');
  const stableConversationId = isFreshRootMessage
    ? 'fresh-root-message'
    : (conversationId ?? 'new');

  return [
    index,
    stableConversationId,
    parentMessageId ?? 'no-parent',
    editedMessageId ?? 'no-edit',
    isRegenerate ? 'regen' : 'ask',
    isContinued ? 'continue' : 'fresh',
    isEdited ? 'edited' : 'plain',
    normalizedText,
  ].join('|');
};

export const shouldBlockRapidAsk = (key, now = Date.now()) => {
  pruneExpiredRapidAsks(now);
  const lastTimestamp = recentAskTimestamps.get(key);
  if (lastTimestamp != null && now - lastTimestamp < RAPID_ASK_WINDOW_MS) {
    return true;
  }

  recentAskTimestamps.set(key, now);
  return false;
};

export const clearRapidAskDedupForTests = () => {
  recentAskTimestamps.clear();
};
