import type { TMessage } from 'librechat-data-provider';
import { attachPendingResponse } from '../MessagesView';

const userMessage = {
  messageId: 'user-1',
  isCreatedByUser: true,
  children: [],
} as unknown as TMessage;

const pendingResponse = {
  messageId: 'assistant-pending',
  isCreatedByUser: false,
  content: [{ type: 'tool_call' }],
} as unknown as TMessage;

describe('attachPendingResponse', () => {
  it('restores the pending assistant below its user message after a route query replaces it', () => {
    const result = attachPendingResponse([userMessage], 'user-1', pendingResponse);

    expect(result?.[0].children).toHaveLength(1);
    expect(result?.[0].children?.[0]).toMatchObject({
      messageId: 'assistant-pending',
      parentMessageId: 'user-1',
      isCreatedByUser: false,
    });
  });

  it('does not add a second response when the real assistant message is already present', () => {
    const realResponse = {
      messageId: 'assistant-real',
      isCreatedByUser: false,
    } as unknown as TMessage;
    const tree = [{ ...userMessage, children: [realResponse] }];

    const result = attachPendingResponse(tree, 'user-1', pendingResponse);

    expect(result).toBe(tree);
    expect(result?.[0].children).toEqual([realResponse]);
  });

  it('does not duplicate a pending response already present in the tree', () => {
    const tree = [{ ...userMessage, children: [pendingResponse] }];

    const result = attachPendingResponse(tree, 'user-1', pendingResponse);

    expect(result).toBe(tree);
  });
});
