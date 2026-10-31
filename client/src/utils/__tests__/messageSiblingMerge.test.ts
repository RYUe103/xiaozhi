import { ContentTypes, type TMessage } from 'librechat-data-provider';
import {
  collapseTransientMessageSiblings,
  mergeStreamedMessageIntoFinal,
} from '../messageSiblingMerge';

const response = (overrides: Partial<TMessage>): TMessage =>
  ({
    messageId: 'response',
    parentMessageId: 'user-1',
    conversationId: 'conversation-1',
    sender: 'Assistant',
    isCreatedByUser: false,
    text: '',
    ...overrides,
  }) as TMessage;

it('keeps request timing when an empty optimistic message receives its final content', () => {
  const metadata = { sansuoProcessTiming: { startedAt: '2026-10-29T00:00:00Z' } };
  const result = mergeStreamedMessageIntoFinal(
    response({ content: [], metadata }),
    response({ text: '正文' }),
  );
  expect(result.metadata).toEqual(metadata);
});

describe('collapseTransientMessageSiblings', () => {
  it('collapses optimistic and final responses from the same client request', () => {
    const optimistic = response({
      messageId: 'user-1_',
      unfinished: true,
      metadata: { sansuoClientRequestId: 'request-1' },
    });
    const final = response({
      messageId: 'server-response-1',
      unfinished: false,
      text: '最终答案',
      metadata: { sansuoClientRequestId: 'request-1' },
    });

    expect(collapseTransientMessageSiblings([optimistic, final])).toEqual([final]);
  });

  it('preserves legitimate regeneration branches with different request ids', () => {
    const first = response({ metadata: { sansuoClientRequestId: 'request-1' } });
    const regenerated = response({
      messageId: 'response-2',
      metadata: { sansuoClientRequestId: 'request-2' },
    });

    expect(collapseTransientMessageSiblings([first, regenerated])).toHaveLength(2);
  });

  it('collapses optimistic and server-backed user messages and preserves their response child', () => {
    const answer = response({ messageId: 'answer-1', text: '最终答案' });
    const optimistic = response({
      messageId: 'optimistic-user',
      parentMessageId: 'root',
      isCreatedByUser: true,
      sender: 'User',
      text: '主要说的啥',
      metadata: { sansuoClientRequestId: 'request-1' },
    });
    const persisted = response({
      messageId: 'server-user',
      parentMessageId: 'root',
      isCreatedByUser: true,
      sender: 'User',
      text: '主要说的啥',
      children: [answer],
    });

    const result = collapseTransientMessageSiblings([optimistic, persisted]);

    expect(result).toHaveLength(1);
    expect(result[0].children).toEqual([answer]);
  });

  it('does not collapse identical completed branches from different requests', () => {
    const first = response({ text: '相同答案', metadata: { sansuoClientRequestId: 'request-1' } });
    const regenerated = response({
      messageId: 'response-2',
      text: '相同答案',
      metadata: { sansuoClientRequestId: 'request-2' },
    });

    expect(collapseTransientMessageSiblings([first, regenerated])).toHaveLength(2);
  });

  it('collapses a cached user placeholder even when attachment objects differ', () => {
    const answer = response({ messageId: 'answer-1', text: '最终答案' });
    const cached = response({
      messageId: 'cached-user',
      parentMessageId: 'root',
      isCreatedByUser: true,
      sender: 'User',
      text: '主要说的啥',
      files: [{ file_id: 'file-1', filename: '策划书.docx' }] as TMessage['files'],
    });
    const persisted = response({
      messageId: 'server-user',
      parentMessageId: 'root',
      isCreatedByUser: true,
      sender: 'User',
      text: '主要说的啥',
      attachments: [{ file_id: 'file-1', filename: '策划书.docx' }] as TMessage['attachments'],
      children: [answer],
    });

    expect(collapseTransientMessageSiblings([cached, persisted])).toEqual([
      expect.objectContaining({ children: [answer] }),
    ]);
  });

  it('preserves same-text user branches when both have completed answers', () => {
    const first = response({
      messageId: 'user-1',
      parentMessageId: 'root',
      isCreatedByUser: true,
      sender: 'User',
      text: '再回答一次',
      children: [response({ messageId: 'answer-1' })],
    });
    const regenerated = response({
      messageId: 'user-2',
      parentMessageId: 'root',
      isCreatedByUser: true,
      sender: 'User',
      text: '再回答一次',
      children: [response({ messageId: 'answer-2' })],
    });

    expect(collapseTransientMessageSiblings([first, regenerated])).toHaveLength(2);
  });
});

describe('mergeStreamedMessageIntoFinal', () => {
  it('keeps streamed reasoning when the final parse update omits that part', () => {
    const current = response({
      content: [
        {
          type: 'tool_call',
          tool_call: { id: 'parse-1', name: 'sansuo_file_parse', status: 'parsing' },
        },
        { type: ContentTypes.THINK, think: '已经流入的分析内容' },
      ] as TMessage['content'],
    });
    const final = response({
      content: [
        {
          type: 'tool_call',
          tool_call: {
            id: 'parse-1',
            name: 'sansuo_file_parse',
            status: 'completed',
            progress: 1,
          },
        },
        { type: ContentTypes.TEXT, text: '最终正文' },
      ] as TMessage['content'],
    });

    expect(mergeStreamedMessageIntoFinal(current, final).content).toEqual([
      expect.objectContaining({
        type: 'tool_call',
        tool_call: expect.objectContaining({ status: 'completed' }),
      }),
      { type: 'think', think: '已经流入的分析内容' },
      { type: 'text', text: '最终正文' },
    ]);
  });

  it('prefers the complete server reasoning and answer when both are present', () => {
    const current = response({
      content: [{ type: ContentTypes.THINK, think: '分析' }],
    });
    const final = response({
      content: [
        { type: ContentTypes.THINK, think: '完整分析' },
        { type: ContentTypes.TEXT, text: '完整答案' },
      ],
    });

    expect(mergeStreamedMessageIntoFinal(current, final).content).toEqual(final.content);
  });
});
