import React from 'react';
import { render, screen } from '@testing-library/react';
import type { TMessage } from 'librechat-data-provider';
import type { TMessageChatContext } from '~/common';
import ContentRender from '../ContentRender';

jest.mock('recoil', () => ({ useRecoilValue: () => false }));
jest.mock('~/store', () => ({ __esModule: true, default: { maximizeChatSpace: {} } }));
jest.mock('~/hooks', () => ({
  useAttachments: () => ({}),
  useLocalize: () => (key: string) => key,
  useContentMetadata: () => ({ hasParallelContent: false }),
  useMessageActions: () => ({
    conversation: { conversationId: 'chat-a' },
    latestMessageId: 'assistant',
    latestMessageDepth: 1,
  }),
}));
jest.mock('~/utils', () => ({
  cn: (...values: unknown[]) => values.filter((value) => typeof value === 'string').join(' '),
  getHeaderPrefixForScreenReader: () => '',
  getMessageAriaLabel: () => '',
}));
jest.mock('~/components/Chat/Messages/Content/ContentParts', () => ({
  __esModule: true,
  default: (props: {
    processStartedAt?: string;
    processElapsedMs?: number;
    fileParseStatus?: string;
  }) => (
    <div
      data-testid="parts"
      data-start={props.processStartedAt}
      data-elapsed={props.processElapsedMs}
      data-parse={props.fileParseStatus}
    />
  ),
}));
jest.mock('~/components/Chat/Messages/ui/PlaceholderRow', () => () => null);
jest.mock('~/components/Chat/Messages/SiblingSwitch', () => () => null);
jest.mock('~/components/Chat/Messages/HoverButtons', () => () => null);
jest.mock('~/components/Chat/Messages/MessageIcon', () => () => null);

it('passes persisted timing through the normal message path and reacts to metadata-only completion', () => {
  const start = '2026-10-29T00:00:00Z';
  const message = {
    messageId: 'assistant',
    conversationId: 'chat-a',
    text: '',
    content: [],
    depth: 1,
    isCreatedByUser: false,
    metadata: { sansuoProcessTiming: { startedAt: start }, sansuoFileParse: { status: 'parsing' } },
  } as unknown as TMessage;
  const chatContext = {} as TMessageChatContext;
  const { rerender } = render(
    <ContentRender message={message} chatContext={chatContext} currentEditId={null} isSubmitting />,
  );
  expect(screen.getByTestId('parts')).toHaveAttribute('data-start', start);
  expect(screen.getByTestId('parts')).toHaveAttribute('data-parse', 'parsing');
  rerender(
    <ContentRender
      message={{
        ...message,
        metadata: {
          sansuoProcessTiming: { startedAt: start, elapsedMs: 35000 },
          sansuoFileParse: { status: 'completed' },
        },
      }}
      chatContext={chatContext}
      currentEditId={null}
      isSubmitting
    />,
  );
  expect(screen.getByTestId('parts')).toHaveAttribute('data-elapsed', '35000');
  expect(screen.getByTestId('parts')).toHaveAttribute('data-parse', 'completed');
});
