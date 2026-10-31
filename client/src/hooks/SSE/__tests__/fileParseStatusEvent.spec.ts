import type { TMessage } from 'librechat-data-provider';
import { applySanSuoFileParseStatus } from '../useEventHandlers';

const assistant = {
  messageId: 'response-1',
  parentMessageId: 'user-1',
  isCreatedByUser: false,
  sender: 'Assistant',
  text: '',
  content: [
    { type: 'think', think: '独立思考内容' },
    { type: 'text', text: '最终正文' },
  ],
  metadata: { sansuoClientRequestId: 'request-1' },
} as unknown as TMessage;

describe('applySanSuoFileParseStatus', () => {
  it('updates parse metadata without changing native THINK and TEXT parts', () => {
    const messages = [assistant];
    const result = applySanSuoFileParseStatus(messages, {
      messageId: 'response-1',
      parentMessageId: 'user-1',
      sansuoFileParse: { status: 'completed', files: 1, artifacts: 3 },
    });

    expect(result).not.toBe(messages);
    expect(result[0].metadata).toEqual(
      expect.objectContaining({
        sansuoClientRequestId: 'request-1',
        sansuoFileParse: { status: 'completed', files: 1, artifacts: 3 },
      }),
    );
    expect(result[0].content).toEqual(assistant.content);
  });

  it('does not mutate unrelated messages when the target is absent', () => {
    const messages = [assistant];
    const result = applySanSuoFileParseStatus(messages, {
      messageId: 'missing-response',
      sansuoFileParse: { status: 'failed', error: 'parse failed' },
    });

    expect(result).toBe(messages);
  });
});
