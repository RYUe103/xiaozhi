import { buildRapidAskKey, clearRapidAskDedupForTests, shouldBlockRapidAsk } from '../askDedup';

const NO_PARENT = '00000000-0000-0000-0000-000000000000';

describe('askDedup', () => {
  beforeEach(() => {
    clearRapidAskDedupForTests();
  });

  it('uses the same key when a fresh root message moves from new to a real conversation id', () => {
    const base = {
      index: 0,
      parentMessageId: NO_PARENT,
      text: '生成一份报告',
    };

    const beforeNavigation = buildRapidAskKey({ ...base, conversationId: 'new' });
    const afterNavigation = buildRapidAskKey({
      ...base,
      conversationId: 'generated-conversation-id',
    });

    expect(afterNavigation).toBe(beforeNavigation);
    expect(shouldBlockRapidAsk(beforeNavigation, 1000)).toBe(false);
    expect(shouldBlockRapidAsk(afterNavigation, 1200)).toBe(true);
  });

  it('keeps normal follow-up messages scoped to their conversation', () => {
    const base = {
      index: 0,
      parentMessageId: 'assistant-message-id',
      text: '继续',
    };

    expect(buildRapidAskKey({ ...base, conversationId: 'conversation-a' })).not.toBe(
      buildRapidAskKey({ ...base, conversationId: 'conversation-b' }),
    );
  });

  it('does not merge regenerate and fresh-send intents', () => {
    const base = {
      index: 0,
      conversationId: 'conversation-a',
      parentMessageId: NO_PARENT,
      text: '重新回答',
    };

    expect(buildRapidAskKey(base)).not.toBe(buildRapidAskKey({ ...base, isRegenerate: true }));
  });
});
