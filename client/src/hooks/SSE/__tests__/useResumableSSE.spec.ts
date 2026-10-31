import { renderHook, act } from '@testing-library/react';
import { Constants, LocalStorageKeys } from 'librechat-data-provider';
import type { TSubmission } from 'librechat-data-provider';

type SSEEventListener = (e: Partial<MessageEvent> & { responseCode?: number }) => void;

interface MockSSEInstance {
  addEventListener: jest.Mock;
  stream: jest.Mock;
  close: jest.Mock;
  headers: Record<string, string>;
  _listeners: Record<string, SSEEventListener>;
  _emit: (event: string, data?: Partial<MessageEvent> & { responseCode?: number }) => void;
}

const mockSSEInstances: MockSSEInstance[] = [];
const mockNavigate = jest.fn();
const mockAddConvoToAllQueries = jest.fn();
const mockClearAllDrafts = jest.fn();
const mockQueryData = new Map<string, unknown>();

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

jest.mock('~/utils', () => {
  const actual = jest.requireActual('~/utils');
  return {
    ...actual,
    addConvoToAllQueries: (...args: unknown[]) => mockAddConvoToAllQueries(...args),
    clearAllDrafts: (...args: unknown[]) => {
      mockClearAllDrafts(...args);
      const dataProvider = jest.requireActual('librechat-data-provider');
      const conversationId = String(args[0] || dataProvider.Constants.NEW_CONVO);
      globalThis.localStorage.removeItem(
        `${dataProvider.LocalStorageKeys.TEXT_DRAFT}${conversationId}`,
      );
      globalThis.localStorage.removeItem(
        `${dataProvider.LocalStorageKeys.FILES_DRAFT}${conversationId}`,
      );
    },
  };
});

jest.mock('sse.js', () => ({
  SSE: jest.fn().mockImplementation(() => {
    const listeners: Record<string, SSEEventListener> = {};
    const instance: MockSSEInstance = {
      addEventListener: jest.fn((event: string, cb: SSEEventListener) => {
        listeners[event] = cb;
      }),
      stream: jest.fn(),
      close: jest.fn(),
      headers: {},
      _listeners: listeners,
      _emit: (event, data = {}) => listeners[event]?.(data as MessageEvent),
    };
    mockSSEInstances.push(instance);
    return instance;
  }),
}));

const mockSetQueryData = jest.fn();
const mockInvalidateQueries = jest.fn();
const mockRemoveQueries = jest.fn();
const mockQueryClient = {
  setQueryData: mockSetQueryData,
  getQueryData: jest.fn((queryKey: unknown[]) => mockQueryData.get(JSON.stringify(queryKey))),
  invalidateQueries: mockInvalidateQueries,
  removeQueries: mockRemoveQueries,
};

jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => mockQueryClient,
}));

jest.mock('recoil', () => ({
  ...jest.requireActual('recoil'),
  useSetRecoilState: () => jest.fn(),
}));

jest.mock('~/store', () => ({
  __esModule: true,
  default: {
    activeRunFamily: jest.fn(),
    abortScrollFamily: jest.fn(),
    showStopButtonByIndex: jest.fn(),
  },
}));

jest.mock('~/hooks/AuthContext', () => ({
  useAuthContext: () => ({ token: 'test-token', isAuthenticated: true }),
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: { balance: { enabled: false } } }),
  useGetUserBalance: () => ({ refetch: jest.fn() }),
  queueTitleGeneration: jest.fn(),
  streamStatusQueryKey: (conversationId: string) => ['streamStatus', conversationId],
}));

const mockErrorHandler = jest.fn();
const mockSetIsSubmitting = jest.fn();
const mockClearStepMaps = jest.fn();
const mockStepHandler = jest.fn();
const mockSyncRunSteps = jest.fn();
const mockFileParseStatusHandler = jest.fn();
const mockContentHandler = jest.fn();

jest.mock('~/hooks/SSE/useEventHandlers', () =>
  jest.fn(() => ({
    errorHandler: mockErrorHandler,
    finalHandler: jest.fn(),
    createdHandler: jest.fn(),
    attachmentHandler: jest.fn(),
    stepHandler: mockStepHandler,
    contentHandler: mockContentHandler,
    fileParseStatusHandler: mockFileParseStatusHandler,
    resetContentHandler: jest.fn(),
    syncStepMessage: jest.fn(),
    syncRunSteps: mockSyncRunSteps,
    clearStepMaps: mockClearStepMaps,
    messageHandler: jest.fn(),
    setIsSubmitting: mockSetIsSubmitting,
    setShowStopButton: jest.fn(),
  })),
);

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    createPayload: jest.fn((submission: TSubmission) => ({
      payload: { model: 'gpt-4o', clientRequestId: submission.clientRequestId },
      server: '/api/agents/chat',
    })),
    removeNullishValues: jest.fn((v: unknown) => v),
    apiBaseUrl: jest.fn(() => ''),
    request: {
      post: jest.fn().mockResolvedValue({ streamId: 'stream-123' }),
      refreshToken: jest.fn(),
      dispatchTokenUpdatedEvent: jest.fn(),
    },
  };
});

import useResumableSSE, { clearSubmissionLaunchCacheForTests } from '~/hooks/SSE/useResumableSSE';

const CONV_ID = 'conv-abc-123';

type PartialSubmission = {
  conversation: { conversationId?: string };
  userMessage: Record<string, unknown>;
  messages: never[];
  isTemporary: boolean;
  initialResponse: Record<string, unknown>;
  endpointOption: { endpoint: string };
};

const buildSubmission = (overrides: Partial<PartialSubmission> = {}): TSubmission => {
  const conversationId = overrides.conversation?.conversationId ?? CONV_ID;
  return {
    clientRequestId: '550e8400-e29b-41d4-a716-446655440000',
    conversation: { conversationId },
    userMessage: {
      messageId: 'msg-1',
      conversationId,
      text: 'Hello',
      isCreatedByUser: true,
      sender: 'User',
      parentMessageId: '00000000-0000-0000-0000-000000000000',
    },
    messages: [],
    isTemporary: false,
    initialResponse: {
      messageId: 'resp-1',
      conversationId,
      text: '',
      isCreatedByUser: false,
      sender: 'Assistant',
    },
    endpointOption: { endpoint: 'agents' },
    ...overrides,
  } as unknown as TSubmission;
};

const buildChatHelpers = () => ({
  setMessages: jest.fn(),
  getMessages: jest.fn(() => []),
  setConversation: jest.fn(),
  setSubmission: jest.fn(),
  clearSubmission: jest.fn(),
  setIsSubmitting: mockSetIsSubmitting,
  newConversation: jest.fn(),
  resetLatestMessage: jest.fn(),
});

const getLastSSE = (): MockSSEInstance => {
  const sse = mockSSEInstances[mockSSEInstances.length - 1];
  expect(sse).toBeDefined();
  return sse;
};

describe('useResumableSSE - 404 error path', () => {
  beforeEach(() => {
    clearSubmissionLaunchCacheForTests();
    mockSSEInstances.length = 0;
    localStorage.clear();
    mockErrorHandler.mockClear();
    mockClearStepMaps.mockClear();
    mockSetIsSubmitting.mockClear();
    mockStepHandler.mockClear();
    mockSyncRunSteps.mockClear();
    mockFileParseStatusHandler.mockClear();
    mockContentHandler.mockClear();
    mockNavigate.mockClear();
    mockAddConvoToAllQueries.mockClear();
    mockClearAllDrafts.mockClear();
    mockQueryData.clear();
    mockSetQueryData.mockReset();
    mockSetQueryData.mockImplementation((queryKey: unknown[], updater: unknown) => {
      const key = JSON.stringify(queryKey);
      const current = mockQueryData.get(key);
      const next = typeof updater === 'function' ? updater(current) : updater;
      mockQueryData.set(key, next);
      return next;
    });
    mockInvalidateQueries.mockClear();
    mockRemoveQueries.mockClear();
    const requestPost = jest.requireMock('librechat-data-provider').request.post as jest.Mock;
    requestPost.mockReset();
    requestPost.mockResolvedValue({ streamId: 'stream-123', conversationId: CONV_ID });
    window.history.replaceState({}, '', `/c/${CONV_ID}`);
  });

  const seedDraft = (conversationId: string) => {
    localStorage.setItem(`${LocalStorageKeys.TEXT_DRAFT}${conversationId}`, 'draft text');
    localStorage.setItem(`${LocalStorageKeys.FILES_DRAFT}${conversationId}`, '[]');
  };

  const render404Scenario = async (conversationId = CONV_ID) => {
    const submission = buildSubmission({ conversation: { conversationId } });
    const chatHelpers = buildChatHelpers();

    const { unmount } = renderHook(() => useResumableSSE(submission, chatHelpers));

    await act(async () => {
      await Promise.resolve();
    });

    const sse = getLastSSE();

    await act(async () => {
      sse._emit('error', { responseCode: 404 });
    });

    return { sse, unmount, chatHelpers };
  };

  it('routes file parse status events to metadata handling instead of content handling', async () => {
    const submission = buildSubmission();
    const chatHelpers = buildChatHelpers();
    const { unmount } = renderHook(() => useResumableSSE(submission, chatHelpers));

    await act(async () => {
      await Promise.resolve();
    });

    const sse = getLastSSE();
    act(() => {
      sse._emit('message', {
        data: JSON.stringify({
          messageId: 'resp-1',
          parentMessageId: 'msg-1',
          sansuoFileParse: { status: 'completed', files: 1, artifacts: 2 },
        }),
      });
    });

    expect(mockFileParseStatusHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'resp-1',
        sansuoFileParse: expect.objectContaining({ status: 'completed' }),
      }),
    );
    unmount();
  });

  it('clears the text and files draft from localStorage on 404', async () => {
    seedDraft(CONV_ID);
    expect(localStorage.getItem(`${LocalStorageKeys.TEXT_DRAFT}${CONV_ID}`)).not.toBeNull();
    expect(localStorage.getItem(`${LocalStorageKeys.FILES_DRAFT}${CONV_ID}`)).not.toBeNull();

    const { unmount } = await render404Scenario(CONV_ID);

    expect(localStorage.getItem(`${LocalStorageKeys.TEXT_DRAFT}${CONV_ID}`)).toBeNull();
    expect(localStorage.getItem(`${LocalStorageKeys.FILES_DRAFT}${CONV_ID}`)).toBeNull();
    unmount();
  });

  it('invalidates message cache and clears stream status on 404 instead of showing error', async () => {
    const { unmount } = await render404Scenario(CONV_ID);

    expect(mockErrorHandler).not.toHaveBeenCalled();
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ['messages', CONV_ID],
    });
    expect(mockSetQueryData).toHaveBeenCalledWith(['streamStatus', CONV_ID], expect.any(Function));
    expect(mockClearStepMaps).toHaveBeenCalled();
    expect(mockSetIsSubmitting).toHaveBeenCalledWith(false);
    unmount();
  });

  it('clears both TEXT and FILES drafts for new-convo when conversationId is absent', async () => {
    localStorage.setItem(`${LocalStorageKeys.TEXT_DRAFT}${Constants.NEW_CONVO}`, 'unsent message');
    localStorage.setItem(`${LocalStorageKeys.FILES_DRAFT}${Constants.NEW_CONVO}`, '[]');

    const submission = buildSubmission({ conversation: {} });
    const chatHelpers = buildChatHelpers();

    const { unmount } = renderHook(() => useResumableSSE(submission, chatHelpers));

    await act(async () => {
      await Promise.resolve();
    });

    const sse = getLastSSE();
    await act(async () => {
      sse._emit('error', { responseCode: 404 });
    });

    expect(mockClearAllDrafts).toHaveBeenCalledWith(Constants.NEW_CONVO);
    expect(localStorage.getItem(`${LocalStorageKeys.TEXT_DRAFT}${Constants.NEW_CONVO}`)).toBeNull();
    expect(
      localStorage.getItem(`${LocalStorageKeys.FILES_DRAFT}${Constants.NEW_CONVO}`),
    ).toBeNull();
    unmount();
  });

  it('closes the SSE connection on 404', async () => {
    const { sse, unmount } = await render404Scenario();

    expect(sse.close).toHaveBeenCalled();
    unmount();
  });

  it('keeps one SSE subscription when the hook rerenders with the same submission', async () => {
    const submission = buildSubmission();
    const chatHelpers = buildChatHelpers();
    const { rerender, unmount } = renderHook(
      ({ renderCount }: { renderCount: number }) => {
        void renderCount;
        return useResumableSSE(submission, chatHelpers);
      },
      { initialProps: { renderCount: 0 } },
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockSSEInstances).toHaveLength(1);

    rerender({ renderCount: 1 });
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockSSEInstances).toHaveLength(1);
    expect(mockSSEInstances[0].close).not.toHaveBeenCalled();
    unmount();
  });

  it('starts one generation when the same submission remounts during navigation', async () => {
    const submission = buildSubmission({ conversation: {} });
    const chatHelpers = buildChatHelpers();
    const requestPost = jest.requireMock('librechat-data-provider').request.post as jest.Mock;

    const first = renderHook(() => useResumableSSE(submission, chatHelpers));
    await act(async () => {
      await Promise.resolve();
    });
    first.unmount();

    const second = renderHook(() => useResumableSSE(submission, chatHelpers));
    await act(async () => {
      await Promise.resolve();
    });

    expect(requestPost).toHaveBeenCalledTimes(1);
    expect(requestPost).toHaveBeenCalledWith(
      '/api/agents/chat',
      expect.objectContaining({
        clientRequestId: '550e8400-e29b-41d4-a716-446655440000',
      }),
    );
    second.unmount();
  });

  it('promotes a new conversation as soon as generation start returns its real id', async () => {
    const realConversationId = 'conv-started-456';
    const submission = buildSubmission({
      conversation: { conversationId: 'new' },
    });
    const chatHelpers = buildChatHelpers();
    const messages = [submission.userMessage, submission.initialResponse];
    mockQueryData.set(JSON.stringify(['messages', Constants.NEW_CONVO]), messages);
    window.history.replaceState({}, '', `/c/${Constants.NEW_CONVO}`);
    jest.requireMock('librechat-data-provider').request.post.mockResolvedValueOnce({
      streamId: 'stream-started-456',
      conversationId: realConversationId,
    });

    const { unmount } = renderHook(() => useResumableSSE(submission, chatHelpers));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockQueryData.get(JSON.stringify(['messages', realConversationId]))).toEqual(
      messages.map((message) => ({ ...message, conversationId: realConversationId })),
    );
    expect(mockAddConvoToAllQueries).toHaveBeenCalledWith(
      mockQueryClient,
      expect.objectContaining({ conversationId: realConversationId, title: 'Hello' }),
    );
    expect(mockQueryData.get(JSON.stringify(['activeJobs']))).toEqual({
      activeJobIds: [realConversationId],
    });
    expect(chatHelpers.setConversation).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: realConversationId }),
    );
    expect(chatHelpers.setSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation: expect.objectContaining({ conversationId: realConversationId }),
      }),
    );
    expect(mockNavigate).toHaveBeenCalledWith(`/c/${realConversationId}`, { replace: true });
    expect(mockSSEInstances).toHaveLength(1);
    unmount();
  });

  it('keeps the optimistic conversation in the sidebar without pulling the user back', async () => {
    let resolveStart: ((value: { streamId: string; conversationId: string }) => void) | undefined;
    const startPromise = new Promise<{ streamId: string; conversationId: string }>((resolve) => {
      resolveStart = resolve;
    });
    const submission = buildSubmission({
      conversation: { conversationId: 'new' },
    });
    const chatHelpers = buildChatHelpers();
    window.history.replaceState({}, '', `/c/${Constants.NEW_CONVO}`);
    jest.requireMock('librechat-data-provider').request.post.mockReturnValueOnce(startPromise);

    const { unmount } = renderHook(() => useResumableSSE(submission, chatHelpers));
    await act(async () => {
      await Promise.resolve();
    });
    window.history.replaceState({}, '', '/c/another-conversation');
    await act(async () => {
      resolveStart?.({ streamId: 'stream-background', conversationId: 'conv-background' });
      await startPromise;
      await Promise.resolve();
    });

    expect(mockAddConvoToAllQueries).toHaveBeenCalledWith(
      mockQueryClient,
      expect.objectContaining({ conversationId: 'conv-background' }),
    );
    expect(mockQueryData.get(JSON.stringify(['activeJobs']))).toEqual({
      activeJobIds: ['conv-background'],
    });
    expect(chatHelpers.setConversation).not.toHaveBeenCalled();
    expect(chatHelpers.setSubmission).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    unmount();
  });

  it('does not remigrate an already established conversation', async () => {
    const submission = buildSubmission();
    const chatHelpers = buildChatHelpers();
    const { unmount } = renderHook(() => useResumableSSE(submission, chatHelpers));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockAddConvoToAllQueries).not.toHaveBeenCalled();
    expect(chatHelpers.setConversation).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockQueryData.get(JSON.stringify(['activeJobs']))).toEqual({
      activeJobIds: [CONV_ID],
    });
    unmount();
  });

  it('uses the latest conversation handlers after the optimistic route promotion', async () => {
    const realConversationId = 'conv-live-handlers';
    const oldHelpers = buildChatHelpers();
    const newHelpers = buildChatHelpers();
    const submission = buildSubmission({ conversation: { conversationId: 'new' } });
    window.history.replaceState({}, '', '/c/new');
    jest.requireMock('librechat-data-provider').request.post.mockResolvedValueOnce({
      streamId: realConversationId,
      conversationId: realConversationId,
    });

    const { rerender, unmount } = renderHook(
      ({ helpers }: { helpers: ReturnType<typeof buildChatHelpers> }) =>
        useResumableSSE(submission, helpers),
      { initialProps: { helpers: oldHelpers } },
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    rerender({ helpers: newHelpers });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      getLastSSE()._emit('message', {
        data: JSON.stringify({ type: 'text', text: 'continued', index: 1 }),
      });
    });

    expect(mockContentHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        submission: expect.objectContaining({
          conversation: expect.objectContaining({ conversationId: realConversationId }),
        }),
      }),
    );
    expect(mockSSEInstances).toHaveLength(1);
    unmount();
  });

  it.each([undefined, 500, 503])(
    'does not call errorHandler for responseCode %s (reconnect path)',
    async (responseCode) => {
      const submission = buildSubmission();
      const chatHelpers = buildChatHelpers();

      const { unmount } = renderHook(() => useResumableSSE(submission, chatHelpers));

      await act(async () => {
        await Promise.resolve();
      });

      const sse = getLastSSE();

      await act(async () => {
        sse._emit('error', { responseCode });
      });

      expect(mockErrorHandler).not.toHaveBeenCalled();
      unmount();
    },
  );

  it('treats responseCode === 0 with raw SSE buffer data as transport failure (reconnect path)', async () => {
    const submission = buildSubmission();
    const chatHelpers = buildChatHelpers();

    const { unmount } = renderHook(() => useResumableSSE(submission, chatHelpers));

    await act(async () => {
      await Promise.resolve();
    });

    const sse = getLastSSE();

    await act(async () => {
      sse._emit('error', {
        responseCode: 0,
        data: 'event: message\ndata: {"created":true,"message":{}}\n\n',
      });
    });

    expect(mockErrorHandler).not.toHaveBeenCalled();
    unmount();
  });

  it('schedules only one reconnect when one connection emits repeated errors', async () => {
    jest.useFakeTimers();
    const submission = buildSubmission();
    const chatHelpers = buildChatHelpers();
    const { unmount } = renderHook(() => useResumableSSE(submission, chatHelpers));

    await act(async () => {
      await Promise.resolve();
    });
    const first = getLastSSE();

    await act(async () => {
      first._emit('error', { responseCode: 503 });
      first._emit('error', { responseCode: 503 });
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(mockSSEInstances).toHaveLength(2);
    expect(first.close).toHaveBeenCalledTimes(1);
    unmount();
    jest.useRealTimers();
  });

  it('hydrates run-step maps without replaying steps over an aggregated resume snapshot', async () => {
    const submission = buildSubmission();
    const chatHelpers = buildChatHelpers();
    const { unmount } = renderHook(() => useResumableSSE(submission, chatHelpers));

    await act(async () => {
      await Promise.resolve();
    });
    getLastSSE()._emit('message', {
      data: JSON.stringify({
        sync: true,
        resumeState: {
          responseMessageId: 'resp-1',
          aggregatedContent: [{ type: 'text', text: '恢复内容' }],
          runSteps: [
            { id: 'step-1', runId: 'resp-1', index: 0, stepDetails: { type: 'message_creation' } },
          ],
        },
        pendingEvents: [],
      }),
    });

    expect(mockSyncRunSteps).toHaveBeenCalledTimes(1);
    expect(mockStepHandler).not.toHaveBeenCalled();
    unmount();
  });

  it('parses and surfaces server-sent error events (no responseCode, JSON data)', async () => {
    const submission = buildSubmission();
    const chatHelpers = buildChatHelpers();

    const { unmount } = renderHook(() => useResumableSSE(submission, chatHelpers));

    await act(async () => {
      await Promise.resolve();
    });

    const sse = getLastSSE();

    const errorPayload = JSON.stringify({
      error: JSON.stringify({ type: 'token_limit' }),
    });

    await act(async () => {
      sse._emit('error', { data: errorPayload });
    });

    expect(mockErrorHandler).toHaveBeenCalledTimes(1);
    unmount();
  });
});
