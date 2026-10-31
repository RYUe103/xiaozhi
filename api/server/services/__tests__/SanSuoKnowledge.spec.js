jest.mock('node-fetch', () => jest.fn());

const fetch = require('node-fetch');
const mongoose = require('mongoose');
const {
  ANSWER_MODES,
  ANSWER_BASE_PROMPT,
  askRemoteKnowledge,
  answerKnowledge,
  buildConversationId,
  createKnowledgeTextCompletion,
  formatKnowledgeAnswer,
  generateKnowledgeAnswer,
  KNOWLEDGE_SEARCH_TOOL,
  requestJson,
  sanitizeAgentId,
  sanitizeAnswerMode,
  sanitizeConnectionInput,
  sanitizeHistory,
  sanitizeKnowledgeEvidences,
  sanitizeRetrievalResult,
  serializeConnection,
  saveKnowledgeConnection,
  stripRawHtml,
  testKnowledgeConnection,
  validateBaseUrl,
} = require('../SanSuoKnowledge');

function jsonResponse(data, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    headers: { get: jest.fn(() => null) },
    text: jest.fn(async () => (typeof data === 'string' ? data : JSON.stringify(data))),
  };
}

describe('SanSuoKnowledge', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    fetch.mockReset();
    process.env.SANSUO_KNOWLEDGE_ANSWER_BASE_URL = 'http://answer.internal/v1';
    process.env.SANSUO_KNOWLEDGE_ANSWER_API_KEY = 'answer-secret';
    process.env.SANSUO_KNOWLEDGE_ANSWER_MODEL = 'answer-model';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  afterEach(() => jest.restoreAllMocks());

  function mockConnection(answerMode) {
    jest.spyOn(mongoose.connection, 'collection').mockReturnValue({
      countDocuments: jest.fn().mockResolvedValue(1),
      findOne: jest.fn().mockResolvedValue({
        knowledgeBaseId: 'meeting-kb',
        name: '会议资料',
        baseUrl: 'http://knowledge.internal:8765',
        agentId: 'default',
        enabled: true,
        answerMode,
      }),
    });
  }

  test('routes Ask mode without a retrieve or local Answer request', async () => {
    mockConnection('agentic_ask');
    delete process.env.SANSUO_KNOWLEDGE_ANSWER_MODEL;
    fetch.mockResolvedValue(jsonResponse({ answer: 'Ask 答案', evidences: [], sources: [] }));
    await expect(
      answerKnowledge({ knowledgeBaseId: 'meeting-kb', question: '问题' }),
    ).resolves.toMatchObject({ answer: 'Ask 答案' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('http://knowledge.internal:8765/api/agents/default/ask');
  });

  test('does not fall back to the local Answer model after Ask fails', async () => {
    mockConnection('agentic_ask');
    fetch.mockResolvedValue(jsonResponse({ detail: 'denied' }, { ok: false, status: 401 }));
    await expect(
      answerKnowledge({ knowledgeBaseId: 'meeting-kb', question: '问题' }),
    ).rejects.toMatchObject({ code: 'authentication' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test.each([false, true])(
    'keeps Ask answers over 5 MiB (content-length present: %s)',
    async (declared) => {
      mockConnection('agentic_ask');
      const answer = 'A'.repeat(5 * 1024 * 1024 + 1) + '\nEND_OF_ANSWER';
      const response = jsonResponse({ answer, evidences: [], sources: [] });
      response.headers.get.mockReturnValue(declared ? String(answer.length + 1000) : null);
      fetch.mockResolvedValue(response);
      const result = await answerKnowledge({ knowledgeBaseId: 'meeting-kb', question: '问题' });
      expect(result.answer).toBe(answer);
    },
  );

  test('preserves Ask evidence text and sources beyond local model budgets while rejecting unsafe URLs', async () => {
    mockConnection('agentic_ask');
    const evidences = Array.from({ length: 65 }, (_, index) => ({
      evidence_id: `ev_${index}`,
      source_id: `src_${index}`,
      content: '证'.repeat(13000),
    }));
    const sources = evidences.map((item) => ({
      source_id: item.source_id,
      filename: `${item.source_id}.pdf`,
      url: `https://kb.example/${item.source_id}`,
      pages: Array.from({ length: 120 }, (_, index) => index + 1),
    }));
    fetch.mockResolvedValue(
      jsonResponse({
        answer: '最后一个来源 [ev_64]',
        evidences,
        sources: [...sources, { source_id: 'unsafe', url: 'javascript:alert(1)' }],
      }),
    );
    const result = await answerKnowledge({ knowledgeBaseId: 'meeting-kb', question: '问题' });
    expect(result.evidences).toHaveLength(65);
    expect(result.evidences[64].content).toHaveLength(13000);
    expect(result.sources).toHaveLength(65);
    expect(result.sources[64].pages).toHaveLength(120);
    expect(result.answer).toContain('https://kb.example/src_64');
    expect(result.answer).not.toContain('javascript:');
    const retrieval = sanitizeRetrievalResult(
      { evidences, sources },
      { agentId: 'default' },
      '问题',
    );
    expect(retrieval.evidences[0].content).toHaveLength(12000);
    expect(retrieval.evidences.length).toBeLessThanOrEqual(30);
    expect(retrieval.sources).toHaveLength(60);
  });

  test('keeps legacy connections on retrieve followed by the local model', async () => {
    mockConnection(undefined);
    fetch
      .mockResolvedValueOnce(
        jsonResponse({
          evidences: [{ evidence_id: 'ev_001', source_id: 'src_001', content: '证据' }],
          sources: [],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '本地答案' } }] }));
    await expect(
      answerKnowledge({ knowledgeBaseId: 'meeting-kb', question: '问题' }),
    ).resolves.toMatchObject({ answer: '本地答案' });
    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      'http://knowledge.internal:8765/api/agents/default/retrieve',
      'http://answer.internal/v1/chat/completions',
    ]);
  });

  test('accepts older Ask responses without sources and removes model-generated links', async () => {
    mockConnection('agentic_ask');
    fetch.mockResolvedValue(
      jsonResponse({
        answer: '正文 [伪造来源](https://fake.example/pdf)\n\n### 引用来源\n旧来源',
        evidences: [],
      }),
    );
    const result = await answerKnowledge({ knowledgeBaseId: 'meeting-kb', question: '问题' });
    expect(result.answer).toBe('正文 伪造来源');
    expect(result.sources).toEqual([]);
  });

  test('uses structured Ask sources when the upstream removed internal evidence markers', () => {
    expect(
      formatKnowledgeAnswer(
        {
          answer: '结论',
          evidences: [{ evidence_id: 'ev_001', source_id: 'src_001' }],
          sources: [{ source_id: 'src_001', filename: '原文.pdf', url: 'https://kb.example/pdf' }],
        },
        { includeUnmarkedSources: true },
      ),
    ).toContain('[原文.pdf](<https://kb.example/pdf> "sansuo-knowledge-source")');
  });

  test('keeps validated numeric Ask citations clickable', () => {
    const answer = formatKnowledgeAnswer(
      {
        answer: '结论 [\\[1\\]](<https://kb.example/files/source-b>)。',
        evidences: [{ evidence_id: 'ev_001', source_id: 'source-a' }],
        sources: [
          { source_id: 'source-a', filename: '甲.pdf', url: 'https://kb.example/files/source-a' },
          { source_id: 'source-b', filename: '乙.pdf', url: 'https://kb.example/files/source-b' },
        ],
      },
      { includeUnmarkedSources: true },
    );

    expect(answer).toContain(
      '结论 [\\[1\\]](<https://kb.example/files/source-b> "sansuo-knowledge-citation")。',
    );
    expect(answer).toContain(
      '[乙.pdf](<https://kb.example/files/source-b> "sansuo-knowledge-source")',
    );
    expect(answer).not.toContain('[甲.pdf]');
  });

  test('maps numeric citations by their validated URL instead of evidence order', () => {
    const answer = formatKnowledgeAnswer({
      answer:
        '先引用乙 [1](https://kb.example/files/source-b)，再引用甲 [2](https://kb.example/files/source-a)。',
      evidences: [
        { evidence_id: 'ev_a', source_id: 'source-a' },
        { evidence_id: 'ev_b', source_id: 'source-b' },
      ],
      sources: [
        { source_id: 'source-a', filename: '甲.pdf', url: 'https://kb.example/files/source-a' },
        { source_id: 'source-b', filename: '乙.pdf', url: 'https://kb.example/files/source-b' },
      ],
    });

    expect(answer).toContain(
      '先引用乙 [\\[1\\]](<https://kb.example/files/source-b> "sansuo-knowledge-citation")',
    );
    expect(answer).toContain(
      '再引用甲 [\\[2\\]](<https://kb.example/files/source-a> "sansuo-knowledge-citation")',
    );
  });

  test('repairs empty numeric Ask links from the explicit structured source order', () => {
    const answer = formatKnowledgeAnswer(
      {
        answer: '先引用乙 [\\[1\\]]()，再引用甲 [\\[2\\]]()。',
        evidences: [
          { evidence_id: 'ev_a', source_id: 'source-a' },
          { evidence_id: 'ev_b', source_id: 'source-b' },
        ],
        sources: [
          { source_id: 'source-b', filename: '乙.pdf', url: 'https://kb.example/files/source-b' },
          { source_id: 'source-a', filename: '甲.pdf', url: 'https://kb.example/files/source-a' },
        ],
      },
      { includeUnmarkedSources: true },
    );

    expect(answer).toContain(
      '先引用乙 [\\[1\\]](<https://kb.example/files/source-b> "sansuo-knowledge-citation")',
    );
    expect(answer).toContain(
      '再引用甲 [\\[2\\]](<https://kb.example/files/source-a> "sansuo-knowledge-citation")',
    );
    expect(answer).not.toContain(']()');
  });

  test('uses one number for multiple evidences from the same source', () => {
    const answer = formatKnowledgeAnswer({
      answer: '第一处 [ev_002]，第二处 [ev_001]。',
      evidences: [
        { evidence_id: 'ev_001', source_id: 'source-a' },
        { evidence_id: 'ev_002', source_id: 'source-a' },
      ],
      sources: [
        { source_id: 'source-a', filename: '同一文件.pdf', url: 'https://kb.example/source-a' },
      ],
    });

    expect(answer.match(/https:\/\/kb\.example\/source-a/g)).toHaveLength(4);
    expect(answer).not.toContain('[[2]]');
  });

  test('collapses only adjacent citations that point to the same source', () => {
    const answer = formatKnowledgeAnswer({
      answer: '同源连续 [ev_a1][ev_a2][ev_a3]，异源连续 [ev_a1][ev_b1]。同源稍后再次引用 [ev_a2]。',
      evidences: [
        { evidence_id: 'ev_a1', source_id: 'source-a' },
        { evidence_id: 'ev_a2', source_id: 'source-a' },
        { evidence_id: 'ev_a3', source_id: 'source-a' },
        { evidence_id: 'ev_b1', source_id: 'source-b' },
      ],
      sources: [
        { source_id: 'source-a', filename: '甲.pdf', url: 'https://kb.example/source-a' },
        { source_id: 'source-b', filename: '乙.pdf', url: 'https://kb.example/source-b' },
      ],
    });

    const citation1 = '[\\[1\\]](<https://kb.example/source-a> "sansuo-knowledge-citation")';
    const citation2 = '[\\[2\\]](<https://kb.example/source-b> "sansuo-knowledge-citation")';
    expect(answer).toContain(`同源连续 ${citation1}，异源连续 ${citation1}${citation2}。`);
    expect(answer).toContain(`同源稍后再次引用 ${citation1}。`);
    expect(answer).not.toContain(`${citation1}${citation1}`);
  });

  test('numbers ten distinct sources without merging multi-digit citations', () => {
    const evidences = Array.from({ length: 10 }, (_, index) => ({
      evidence_id: `ev_${index + 1}`,
      source_id: `source-${index + 1}`,
    }));
    const sources = evidences.map((evidence, index) => ({
      source_id: evidence.source_id,
      filename: `测试文件-${index + 1}.md`,
      url: `https://kb.example/source-${index + 1}`,
    }));
    const answer = formatKnowledgeAnswer({
      answer: evidences.map((evidence) => `[${evidence.evidence_id}]`).join(''),
      evidences,
      sources,
    });

    for (let number = 1; number <= 10; number += 1) {
      expect(answer).toContain(
        `[\\[${number}\\]](<https://kb.example/source-${number}> "sansuo-knowledge-citation")`,
      );
    }
    expect(answer).not.toContain('[111]');
    expect(answer).not.toContain('[object Object]');
  });

  test('removes numeric links whose URL was not returned as a safe structured source', () => {
    const answer = formatKnowledgeAnswer({
      answer:
        '伪造 [1](https://fake.example/file) 和危险 [2](javascript:alert(1))，可信 [ev_001]。',
      evidences: [{ evidence_id: 'ev_001', source_id: 'source-a' }],
      sources: [
        { source_id: 'source-a', filename: '可信.pdf', url: 'https://kb.example/source-a' },
      ],
    });

    expect(answer).not.toContain('fake.example');
    expect(answer).not.toContain('javascript:');
    expect(answer).toContain(
      '[\\[1\\]](<https://kb.example/source-a> "sansuo-knowledge-citation")',
    );
  });

  test('accepts only safe knowledge agent identifiers', () => {
    expect(sanitizeAgentId('standards.v2_internal')).toBe('standards.v2_internal');
    expect(sanitizeAgentId('../standards')).toBe('');
    expect(sanitizeAgentId('含中文')).toBe('');
  });

  test('keeps existing connections on the local Answer model unless Agentic Ask is explicit', () => {
    expect(sanitizeAnswerMode()).toBe(ANSWER_MODES.LOCAL_MODEL);
    expect(sanitizeAnswerMode('unknown')).toBe(ANSWER_MODES.LOCAL_MODEL);
    expect(sanitizeAnswerMode('agentic_ask')).toBe(ANSWER_MODES.AGENTIC_ASK);
  });

  test('persists mode changes while preserving an existing encrypted API key', async () => {
    let doc = {
      knowledgeBaseId: 'meeting-kb',
      answerMode: 'local_model',
      encryptedApiKey: 'existing-ciphertext',
    };
    const updateOne = jest.fn(async (_filter, update) => {
      doc = { ...doc, ...update.$set };
    });
    jest.spyOn(mongoose.connection, 'collection').mockReturnValue({
      findOne: jest.fn(async () => doc),
      updateOne,
    });
    const saved = await saveKnowledgeConnection(
      {
        knowledgeBaseId: 'meeting-kb',
        name: '会议资料',
        agentId: 'default',
        baseUrl: 'http://knowledge.internal:8765',
        answerMode: 'agentic_ask',
        apiKey: '',
      },
      'meeting-kb',
    );
    expect(saved.answerMode).toBe('agentic_ask');
    expect(doc.encryptedApiKey).toBe('existing-ciphertext');
    expect(updateOne.mock.calls[0][1].$set).not.toHaveProperty('encryptedApiKey');
    const legacySaved = await saveKnowledgeConnection(
      {
        knowledgeBaseId: 'meeting-kb',
        name: '会议资料',
        agentId: 'default',
        baseUrl: 'http://knowledge.internal:8765',
      },
      'meeting-kb',
    );
    expect(legacySaved.answerMode).toBe('agentic_ask');
  });

  test('tests the selected Ask endpoint with the saved key even without a local Answer model', async () => {
    delete process.env.SANSUO_KNOWLEDGE_ANSWER_MODEL;
    process.env.SANSUO_KNOWLEDGE_SERVICE_TOKEN = 'saved-test-key';
    jest.spyOn(mongoose.connection, 'collection').mockReturnValue({
      findOne: jest.fn().mockResolvedValue({ usesLegacyToken: true }),
    });
    fetch
      .mockResolvedValueOnce(jsonResponse([{ agent_id: 'default', name: '知识库' }]))
      .mockResolvedValueOnce(jsonResponse({ answer: '测试通过', evidences: [] }));
    const result = await testKnowledgeConnection({
      knowledgeBaseId: 'meeting-kb',
      name: '会议资料',
      agentId: 'default',
      baseUrl: 'http://knowledge.internal:8765',
      answerMode: 'agentic_ask',
    });
    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toBe('http://knowledge.internal:8765/api/agents/default/ask');
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer saved-test-key');
    delete process.env.SANSUO_KNOWLEDGE_SERVICE_TOKEN;
  });

  test('isolates upstream conversations by user, conversation, and knowledge base', () => {
    const first = buildConversationId('user-a', 'conversation-a', 'kb-a');

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(buildConversationId('user-a', 'conversation-a', 'kb-a')).toBe(first);
    expect(buildConversationId('user-b', 'conversation-a', 'kb-a')).not.toBe(first);
    expect(buildConversationId('user-a', 'conversation-b', 'kb-a')).not.toBe(first);
    expect(buildConversationId('user-a', 'conversation-a', 'kb-b')).not.toBe(first);
  });

  test('uses only validated source URLs from retrieval and deduplicates cited sources', () => {
    const result = {
      answer:
        '<strong>结论</strong> [ev_001]，补充 [ev_002]，伪造 [ev_999]\n\n### 引用来源\n- upstream link',
      evidences: [
        { evidence_id: 'ev_001', source_id: 'file-1', filename: '标准[终版].pdf', page: 2 },
        { evidence_id: 'ev_002', source_id: 'file-1', filename: '重复.pdf', page: 3 },
      ],
      sources: [
        {
          source_id: 'file-1',
          filename: '标准[终版].pdf',
          url: 'http://knowledge.internal/kb/api/files/file-1',
          pages: [2],
          locations: [],
        },
        { source_id: 'fake', filename: '伪造.pdf', url: 'javascript:alert(1)' },
      ],
    };

    expect(formatKnowledgeAnswer(result)).toBe(
      '结论 [\\[1\\]](<http://knowledge.internal/kb/api/files/file-1> "sansuo-knowledge-citation")，补充 [\\[1\\]](<http://knowledge.internal/kb/api/files/file-1> "sansuo-knowledge-citation")，伪造 [ev_999]\n\n### 引用来源\n- [1](<http://knowledge.internal/kb/api/files/file-1> "sansuo-knowledge-number") [标准终版.pdf（第 2 页）](<http://knowledge.internal/kb/api/files/file-1> "sansuo-knowledge-source")',
    );
  });

  test('does not create a source list for uncited or unsafe sources', () => {
    expect(
      formatKnowledgeAnswer({
        answer: '没有有效引用 [ev_fake]',
        evidences: [{ evidence_id: 'ev_001', source_id: 'source-1' }],
        sources: [{ source_id: 'source-1', url: 'javascript:alert(1)' }],
      }),
    ).toBe('没有有效引用 [ev_fake]');
  });

  test('bounds history by role, turn count, item size, and total size', () => {
    const history = [
      { role: 'system', content: 'never send this' },
      ...Array.from({ length: 10 }, (_, index) => ({
        role: index % 2 ? 'assistant' : 'user',
        content: `${index}:${'x'.repeat(7000)}`,
      })),
    ];
    const sanitized = sanitizeHistory(history);

    expect(sanitized).toHaveLength(4);
    expect(sanitized[0].content.startsWith('6:')).toBe(true);
    expect(sanitized.every((item) => item.content.length <= 6000)).toBe(true);
    expect(sanitized.reduce((sum, item) => sum + item.content.length, 0)).toBeLessThanOrEqual(
      24000,
    );
  });

  test('validates and serializes connection configuration without exposing API keys', () => {
    expect(validateBaseUrl('http://knowledge.internal:8765/root')).toBe(
      'http://knowledge.internal:8765/root',
    );
    expect(() => validateBaseUrl('http://knowledge.internal/api')).toThrow('末尾不要包含');
    expect(() => validateBaseUrl('file:///tmp/knowledge')).toThrow('只支持 HTTP');

    const input = sanitizeConnectionInput({
      knowledge_base_id: 'meeting-kb',
      name: '会议资料',
      base_url: 'http://knowledge.internal:8765',
      agent_id: 'meeting-agent',
      answer_prompt: '使用正式、简洁的中文。',
      answer_mode: 'agentic_ask',
      api_key: 'secret-value',
    });
    expect(input).toMatchObject({
      knowledgeBaseId: 'meeting-kb',
      agentId: 'meeting-agent',
      answerMode: 'agentic_ask',
      answerPrompt: '使用正式、简洁的中文。',
      apiKey: 'secret-value',
    });
    expect(
      serializeConnection({ ...input, encryptedApiKey: 'ciphertext', updatedAt: null }),
    ).toEqual({
      knowledgeBaseId: 'meeting-kb',
      name: '会议资料',
      baseUrl: 'http://knowledge.internal:8765',
      agentId: 'meeting-agent',
      answerMode: 'agentic_ask',
      answerPrompt: '使用正式、简洁的中文。',
      enabled: true,
      archived: false,
      apiKeyConfigured: true,
      updatedAt: null,
    });
  });

  test('calls Agentic Ask directly and keeps only normalized evidence and source data', async () => {
    fetch.mockResolvedValue(
      jsonResponse({
        answer: '<p>直接答案 [ev_001]</p>',
        evidences: [
          {
            evidence_id: 'ev_001',
            source_id: 'src_001',
            filename: '会议纪要.pdf',
            content: '会议结论',
          },
        ],
        sources: [
          {
            source_id: 'src_001',
            filename: '会议纪要.pdf',
            url: 'https://knowledge.internal/files/src_001',
          },
        ],
      }),
    );

    const result = await askRemoteKnowledge({
      connection: {
        knowledgeBaseId: 'meeting-kb',
        baseUrl: 'http://knowledge.internal:8765',
        agentId: 'meeting-agent',
        apiKey: 'knowledge-secret',
      },
      question: '会议结论是什么？',
      conversationId: 'conversation-a',
      userId: 'user-a',
      history: [{ role: 'user', content: '上一问' }],
    });

    expect(result.answer).toBe('直接答案 [ev_001]');
    expect(result.evidences).toHaveLength(1);
    expect(result.sources[0].url).toBe('https://knowledge.internal/files/src_001');
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('http://knowledge.internal:8765/api/agents/meeting-agent/ask');
    expect(options.headers.Authorization).toBe('Bearer knowledge-secret');
    expect(JSON.parse(options.body)).toMatchObject({
      question: '会议结论是什么？',
      history: [{ role: 'user', content: '上一问' }],
    });
  });

  test('rejects an Agentic Ask response without an answer', async () => {
    fetch.mockResolvedValue(jsonResponse({ evidences: [], sources: [] }));
    await expect(
      askRemoteKnowledge({
        connection: {
          knowledgeBaseId: 'meeting-kb',
          baseUrl: 'http://knowledge.internal:8765',
          agentId: 'meeting-agent',
          apiKey: '',
        },
        question: '问题',
      }),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });

  test('normalizes retrieval evidence and marks an empty result insufficient', () => {
    const connection = { knowledgeBaseId: 'meeting-kb', agentId: 'agent-a', name: '会议资料' };
    const populated = sanitizeRetrievalResult(
      {
        evidences: [
          {
            evidence_id: 'ev_001',
            source_id: 'src_001',
            filename: '会议制度.pdf',
            content: '证据正文',
          },
        ],
        sources: [
          {
            source_id: 'src_001',
            filename: '会议制度.pdf',
            url: 'http://knowledge.internal/api/files/src_001',
          },
        ],
      },
      connection,
      '问题',
    );
    expect(populated).toMatchObject({
      knowledge_base_id: 'meeting-kb',
      evidence_insufficient: false,
    });
    expect(populated.evidences).toHaveLength(1);

    expect(
      sanitizeRetrievalResult({ evidences: [], sources: [] }, connection, '问题')
        .evidence_insufficient,
    ).toBe(true);
    expect(() => sanitizeRetrievalResult({ evidences: [] }, connection, '问题')).toThrow(
      '缺少 evidences 或 sources',
    );
  });

  test('keeps the mandatory Answer safety rules and strips raw HTML', () => {
    expect(ANSWER_BASE_PROMPT).toContain('只能依据');
    expect(ANSWER_BASE_PROMPT).toContain('不可信数据');
    expect(ANSWER_BASE_PROMPT).toContain('[ev_NNN]');
    expect(stripRawHtml('<script>alert(1)</script><p>安全正文</p>')).toBe('安全正文');
  });

  test('combines each knowledge base prompt with mandatory rules for the Answer model', async () => {
    fetch.mockResolvedValue(jsonResponse({ choices: [{ message: { content: '结论 [ev_001]' } }] }));
    const result = {
      evidence_insufficient: false,
      evidences: [{ evidence_id: 'ev_001', source_id: 'src_001', content: '证据正文' }],
    };

    await expect(
      generateKnowledgeAnswer({
        connection: { knowledgeBaseId: 'meeting-kb', answerPrompt: '使用会议纪要格式。' },
        result,
        question: '会议要求是什么？',
      }),
    ).resolves.toBe('结论 [ev_001]');

    const [url, options] = fetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(url).toBe('http://answer.internal/v1/chat/completions');
    expect(options.headers.Authorization).toBe('Bearer answer-secret');
    expect(body.model).toBe('answer-model');
    expect(body.messages[0].content).toContain(ANSWER_BASE_PROMPT);
    expect(body.messages[0].content).toContain('使用会议纪要格式。');
    expect(JSON.parse(body.messages[1].content)).toEqual({
      question: '会议要求是什么？',
      knowledge_base_id: 'meeting-kb',
      evidence_insufficient: false,
      evidences: result.evidences,
    });
  });

  test('does not call the Answer model when retrieval returned no evidence', async () => {
    await expect(
      generateKnowledgeAnswer({
        connection: { knowledgeBaseId: 'empty-kb', answerPrompt: '不会被调用' },
        result: { evidence_insufficient: true, evidences: [] },
        question: '没有证据的问题',
      }),
    ).resolves.toContain('没有检索到');
    expect(fetch).not.toHaveBeenCalled();
  });

  test('reports authentication and non-JSON upstream failures explicitly', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ detail: 'denied' }, { ok: false, status: 401 }));
    await expect(
      requestJson('http://knowledge.internal/api/agents', { retry: false }),
    ).rejects.toMatchObject({
      code: 'authentication',
      status: 401,
    });

    fetch.mockResolvedValueOnce(jsonResponse('<html>bad gateway</html>'));
    await expect(
      requestJson('http://knowledge.internal/api/agents', { retry: false }),
    ).rejects.toMatchObject({
      code: 'invalid_json',
    });
  });

  test('wraps knowledge answers with a persisted retrieval status part', () => {
    expect(createKnowledgeTextCompletion('知识库回答', { toolCallId: 'knowledge-1' })).toEqual([
      {
        type: 'tool_call',
        tool_call: {
          id: 'knowledge-1',
          name: KNOWLEDGE_SEARCH_TOOL,
          args: '{}',
          type: 'tool_call',
          progress: 1,
          status: 'completed',
        },
      },
      { type: 'text', text: '知识库回答' },
    ]);
  });

  test('marks unavailable knowledge responses as failed', () => {
    const [statusPart] = createKnowledgeTextCompletion('知识库暂时不可用', { status: 'failed' });
    expect(statusPart.tool_call).toMatchObject({
      name: KNOWLEDGE_SEARCH_TOOL,
      progress: 1,
      status: 'failed',
    });
  });

  test('limits and normalizes evidence metadata before saving it', () => {
    const evidences = Array.from({ length: 31 }, (_, index) => ({
      evidence_id: `ev_${index}`,
      source_id: `source_${index}`,
      filename: 'a.pdf',
      page: index + 1,
      content: 'evidence',
      score: '0.8',
    }));

    const sanitized = sanitizeKnowledgeEvidences({ evidences });

    expect(sanitized).toHaveLength(30);
    expect(sanitized[0]).toMatchObject({
      evidenceId: 'ev_0',
      sourceId: 'source_0',
      page: 1,
      score: 0.8,
    });
  });
});
