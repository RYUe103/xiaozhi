const mockCreate = jest.fn();
const mockUpdateOne = jest.fn();
const mockAggregate = jest.fn();
const mockFindOne = jest.fn();
const mockCollection = jest.fn();

jest.mock('~/models/sansuoUsageEvent', () => ({
  create: mockCreate,
  updateOne: mockUpdateOne,
  aggregate: mockAggregate,
  findOne: mockFindOne,
}));
jest.mock('mongoose', () => {
  class FakeObjectId {
    constructor(value) {
      this.value = String(value);
    }
    toString() {
      return this.value;
    }
  }
  return {
    Types: { ObjectId: Object.assign(FakeObjectId, { isValid: () => true }) },
    connection: { collection: mockCollection },
  };
});

const {
  completeKnowledgeUsageEvent,
  getUsageOverview,
  recordUsageEvent,
} = require('../SanSuoUsage');

describe('SanSuoUsage knowledge metadata', () => {
  const userId = '507f1f77bcf86cd799439011';

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockResolvedValue({});
    mockUpdateOne.mockResolvedValue({ matchedCount: 1 });
    mockAggregate.mockResolvedValue([]);
    mockCollection.mockImplementation((name) => ({
      countDocuments: jest.fn().mockResolvedValue(name === 'users' ? 1 : 0),
      aggregate: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
      distinct: jest.fn().mockResolvedValue([]),
    }));
  });

  test('records a pending knowledge query without chat content', async () => {
    await recordUsageEvent({
      userId,
      eventType: 'knowledge_query',
      requestId: 'request-1',
      conversationId: 'conversation-1',
      mode: 'knowledge',
      knowledgeBaseId: 'meeting-kb',
      outcome: 'pending',
      question: 'must not be stored',
      answer: 'must not be stored',
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'request-1',
        knowledgeBaseId: 'meeting-kb',
        outcome: 'pending',
      }),
    );
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty('question');
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty('answer');
  });

  test('completes the existing knowledge event instead of inserting a second event', async () => {
    const result = await completeKnowledgeUsageEvent({
      userId,
      requestId: 'request-1',
      knowledgeBaseName: '会议纪要',
      knowledgeAnswerMode: 'agentic_ask',
      outcome: 'insufficient',
      evidenceCount: 3,
      toolCalls: 2,
      durationMs: 1234.4,
    });

    expect(result).toEqual({ ok: true, matched: 1 });
    expect(mockUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'knowledge_query', requestId: 'request-1' }),
      {
        $set: expect.objectContaining({
          knowledgeBaseName: '会议纪要',
          knowledgeAnswerMode: 'agentic_ask',
          outcome: 'insufficient',
          success: false,
          evidenceCount: 3,
          toolCalls: 2,
          durationMs: 1234,
        }),
      },
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('returns per-knowledge-base result and duration aggregates', async () => {
    mockAggregate
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          _id: 'meeting-kb',
          name: '会议纪要',
          count: 4,
          users: 2,
          success: 2,
          errors: 1,
          timeouts: 0,
          insufficient: 1,
          pending: 0,
          averageDurationMs: 1200,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await getUsageOverview('2026-10');

    expect(result.knowledgeBases[0]).toMatchObject({
      _id: 'meeting-kb',
      name: '会议纪要',
      count: 4,
      success: 2,
      errors: 1,
      insufficient: 1,
      averageDurationMs: 1200,
    });
    const knowledgePipeline = mockAggregate.mock.calls[2][0];
    expect(JSON.stringify(knowledgePipeline)).toContain('averageDurationMs');
    expect(JSON.stringify(knowledgePipeline)).toContain('insufficient');
  });
});
