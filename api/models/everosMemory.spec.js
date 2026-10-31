const { createEverOSMemoryMethods } = require('./everosMemory');

describe('everosMemory', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('reports failure when EverOS and local fallback both fail to store explicit memory', async () => {
    process.env.EVEROS_MEMORY_ENABLED = 'true';
    process.env.MEMORY_BACKEND = 'everos';
    global.fetch = jest.fn().mockRejectedValue(new Error('everos unavailable'));

    const methods = createEverOSMemoryMethods({
      setMemory: jest.fn().mockRejectedValue(new Error('local unavailable')),
    });

    const result = await methods.setMemory({
      userId: '6a10297ed87abd01ad7982ef',
      key: 'personal_info',
      value: '我叫测试用户。',
      userMessage: '记住我叫测试用户',
      source: 'explicit_user_request',
    });

    expect(result).toMatchObject({
      ok: false,
      everosOk: false,
      localOk: false,
      key: 'personal_info',
      reason: 'failed_to_store_memory',
    });
    expect(result.errors).toEqual(['everos unavailable', 'local unavailable']);
  });

  it('reports local fallback success when EverOS is unavailable but local store succeeds', async () => {
    process.env.EVEROS_MEMORY_ENABLED = 'true';
    process.env.MEMORY_BACKEND = 'everos';
    global.fetch = jest.fn().mockRejectedValue(new Error('everos unavailable'));

    const methods = createEverOSMemoryMethods({
      setMemory: jest.fn().mockResolvedValue({ ok: true }),
    });

    const result = await methods.setMemory({
      userId: '6a10297ed87abd01ad7982ef',
      key: 'personal_info',
      value: '我叫测试用户。',
      userMessage: '记住我叫测试用户',
      source: 'explicit_user_request',
    });

    expect(result).toMatchObject({
      ok: true,
      everosOk: false,
      localOk: true,
      key: 'personal_info',
      reason: 'stored_local_fallback',
    });
  });
});
