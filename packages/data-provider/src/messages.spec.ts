import type { TMessage } from './types';
import { buildTree } from './messages';

const message = (overrides: Partial<TMessage>): TMessage =>
  ({
    messageId: 'message',
    conversationId: 'conversation',
    parentMessageId: '00000000-0000-0000-0000-000000000000',
    sender: 'User',
    text: '',
    isCreatedByUser: true,
    ...overrides,
  }) as TMessage;

describe('buildTree', () => {
  it('links a response that appears before its parent user message', () => {
    const response = message({
      messageId: 'response',
      parentMessageId: 'user',
      sender: 'Assistant',
      isCreatedByUser: false,
      text: '最终回答',
    });
    const user = message({
      messageId: 'user',
      text: '主要说的啥',
    });

    const tree = buildTree({ messages: [response, user] });

    expect(tree).toHaveLength(1);
    expect(tree?.[0]).toMatchObject({
      messageId: 'user',
      depth: 0,
      children: [
        expect.objectContaining({
          messageId: 'response',
          parentMessageId: 'user',
          depth: 1,
        }),
      ],
    });
  });

  it('preserves sibling order while linking parent-first messages', () => {
    const root = message({ messageId: 'root' });
    const first = message({ messageId: 'first', parentMessageId: 'root' });
    const second = message({ messageId: 'second', parentMessageId: 'root' });

    const tree = buildTree({ messages: [root, first, second] });

    expect(tree?.[0].children?.map((child) => child.messageId)).toEqual(['first', 'second']);
    expect(tree?.[0].children?.map((child) => child.siblingIndex)).toEqual([0, 1]);
  });
});
