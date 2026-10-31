const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
const mockCreateJob = jest.fn();
const mockCheckAndIncrement = jest.fn();

jest.mock('@librechat/data-schemas', () => ({ logger: mockLogger }));
jest.mock('librechat-data-provider', () => ({
  Constants: { NO_PARENT: '00000000-0000-0000-0000-000000000000' },
  ViolationTypes: { CONCURRENT: 'concurrent' },
}));
jest.mock('@librechat/api', () => ({
  GenerationJobManager: {
    createJob: (...args) => mockCreateJob(...args),
    updateMetadata: jest.fn(),
    setContentParts: jest.fn(),
    completeJob: jest.fn(),
    emitChunk: jest.fn(),
    emitDone: jest.fn(),
    emitError: jest.fn(),
    getJob: jest.fn(),
  },
  buildMessageFiles: jest.fn(() => []),
  checkAndIncrementPendingRequest: (...args) => mockCheckAndIncrement(...args),
  decrementPendingRequest: jest.fn(),
  getViolationInfo: jest.fn(),
  sanitizeMessageForTransmit: jest.fn((message) => message),
  sendEvent: jest.fn(),
}));
jest.mock('~/server/cleanup', () => ({
  disposeClient: jest.fn(),
  clientRegistry: new Map(),
  requestDataMap: new Map(),
}));
jest.mock('~/server/middleware', () => ({ handleAbortError: jest.fn() }));
jest.mock('~/cache', () => ({ logViolation: jest.fn() }));
jest.mock('~/models', () => ({ saveMessage: jest.fn() }));

const AgentController = require('../request');

const createResponse = () => ({
  headersSent: false,
  json: jest.fn(function json() {
    this.headersSent = true;
    return this;
  }),
  status: jest.fn(function status() {
    return this;
  }),
});

describe('ResumableAgentController request idempotency', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckAndIncrement.mockResolvedValue({ allowed: true, pendingRequests: 1, limit: 2 });
  });

  it('creates one job for concurrent POSTs with the same user and clientRequestId', async () => {
    let resolveCreateJob;
    mockCreateJob.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreateJob = resolve;
        }),
    );

    const body = {
      text: 'test',
      conversationId: 'new',
      clientRequestId: '550e8400-e29b-41d4-a716-446655440000',
      endpointOption: { endpoint: 'SanSuoMain' },
    };
    const req1 = { body: { ...body }, user: { id: 'user-1' } };
    const req2 = { body: { ...body }, user: { id: 'user-1' } };
    const res1 = createResponse();
    const res2 = createResponse();
    const initializeClient = jest.fn().mockResolvedValue({
      client: {
        contentParts: [],
        sendMessage: jest.fn(() => new Promise(() => {})),
      },
    });

    const first = AgentController(req1, res1, jest.fn(), initializeClient, null);
    const second = AgentController(req2, res2, jest.fn(), initializeClient, null);

    await Promise.resolve();
    expect(mockCreateJob).toHaveBeenCalledTimes(1);

    resolveCreateJob({
      createdAt: 1,
      readyPromise: Promise.resolve(),
      abortController: new AbortController(),
      emitter: { on: jest.fn() },
    });
    await Promise.all([first, second]);

    expect(mockCheckAndIncrement).toHaveBeenCalledTimes(1);
    expect(mockCreateJob).toHaveBeenCalledTimes(1);
    const firstStart = res1.json.mock.calls[0][0];
    expect(res2.json).toHaveBeenCalledWith({
      streamId: firstStart.streamId,
      conversationId: firstStart.conversationId,
      startedAt: firstStart.startedAt,
      status: 'reused',
    });
    expect(initializeClient).toHaveBeenCalledTimes(1);
  });
});
