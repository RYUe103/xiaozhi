const mockCacheSet = jest.fn();
const mockSaveConvo = jest.fn();

jest.mock('@librechat/api', () => ({ isEnabled: jest.fn(() => true) }));
jest.mock('@librechat/data-schemas', () => ({
  logger: { debug: jest.fn(), error: jest.fn() },
}));
jest.mock('librechat-data-provider', () => ({ CacheKeys: { GEN_TITLE: 'GEN_TITLE' } }));
jest.mock('~/cache/getLogStores', () => jest.fn(() => ({ set: mockCacheSet })));
jest.mock('~/models', () => ({ saveConvo: mockSaveConvo }));

const addTitle = require('./title');

describe('SanSuo knowledge title generation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCacheSet.mockResolvedValue(undefined);
    mockSaveConvo.mockResolvedValue(undefined);
  });

  it('uses the fallback title without invoking an uninitialized Agent run', async () => {
    const client = {
      options: { endpoint: 'SanSuoMain' },
      titleConvo: jest.fn(() => Promise.reject(new Error('Run not initialized'))),
    };
    const req = {
      user: { id: 'user-1' },
      body: { sansuoMode: 'knowledge' },
      config: { interfaceConfig: {} },
    };

    const title = await addTitle(req, {
      text: '报销规定是什么？',
      response: { conversationId: 'convo-1' },
      client,
    });

    expect(client.titleConvo).not.toHaveBeenCalled();
    expect(title).toBe('报销规定是什么？');
    expect(mockCacheSet).toHaveBeenCalledWith('user-1-convo-1', '报销规定是什么？', 120000);
    expect(mockSaveConvo).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      { conversationId: 'convo-1', title: '报销规定是什么？' },
      expect.objectContaining({ noUpsert: true }),
    );
  });

  it('uses a specific question summary instead of a generic document title', async () => {
    const client = { options: { endpoint: 'SanSuoMain' }, titleConvo: jest.fn() };
    const req = {
      user: { id: 'user-1' },
      body: { sansuoMode: 'knowledge' },
      config: { interfaceConfig: {} },
    };

    const title = await addTitle(req, {
      text: '请总结管道等级表文档中的材料要求和适用范围',
      response: { conversationId: 'convo-2' },
      client,
    });

    expect(title).toBe('请总结管道等级表文档中的材料要求和适');
    expect(title).not.toBe('文档内容总结');
  });

  it('does not save titles for temporary conversations', async () => {
    const client = { options: { endpoint: 'SanSuoMain' }, titleConvo: jest.fn() };
    const title = await addTitle(
      {
        user: { id: 'user-1' },
        body: { sansuoMode: 'knowledge', isTemporary: true },
        config: { interfaceConfig: {} },
      },
      { text: '临时问题', response: { conversationId: 'convo-3' }, client },
    );

    expect(title).toBeUndefined();
    expect(mockSaveConvo).not.toHaveBeenCalled();
  });

  it('returns no title without throwing when persistence fails', async () => {
    mockSaveConvo.mockRejectedValueOnce(new Error('database unavailable'));
    const client = { options: { endpoint: 'SanSuoMain' }, titleConvo: jest.fn() };
    const title = await addTitle(
      {
        user: { id: 'user-1' },
        body: { sansuoMode: 'knowledge' },
        config: { interfaceConfig: {} },
      },
      { text: '失败不阻断回答', response: { conversationId: 'convo-4' }, client },
    );

    expect(title).toBeUndefined();
  });
});
