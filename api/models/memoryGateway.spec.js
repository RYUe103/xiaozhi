const {
  filterAndRankMemories,
  parseExplicitMemoryAction,
  shouldDeleteMemory,
  shouldPersistMemory,
  shouldRetrieveMemory,
} = require('./memoryGateway');

describe('memoryGateway', () => {
  test.each([
    ['记住我叫张杰', '我叫张杰。', 'personal_info'],
    ['以后回答我都要简洁', '用户偏好后续回答简洁。', 'preferences'],
    ['保存我的论文写作偏好：不要AI味', '用户偏好论文写作不要AI味。', 'preferences'],
    ['记住我正在做U-10Zr气泡肿胀模型', '用户正在做U-10Zr气泡肿胀模型。', 'work_info'],
    ['以后代码直接给完整版本', '用户偏好代码直接给完整版本。', 'preferences'],
  ])('allows explicit long-term memory: %s', (userMessage, value, key) => {
    expect(shouldPersistMemory({ key, value, userMessage }).allow).toBe(true);
  });

  test.each([
    ['帮我把当前对话生成PDF', '用户希望将当前对话生成PDF。'],
    ['把这个文件打包成zip', '用户希望把这个文件打包成zip。'],
    ['这次PPT用蓝色', '用户希望这次PPT用蓝色。'],
    ['当前回答短一点', '用户希望当前回答短一点。'],
    ['帮我下载这个docx', '用户希望下载这个docx。'],
    ['把这张图红框里的线去掉', '用户希望修改这张图。'],
    ['生成summary.txt', '用户希望生成summary.txt。'],
  ])('blocks transient task memory: %s', (userMessage, value) => {
    expect(shouldPersistMemory({ key: 'context', value, userMessage }).allow).toBe(false);
  });

  it('does not delete a key when content does not match the query', () => {
    const memory = { key: 'personal_info', value: '我叫小向。' };
    expect(shouldDeleteMemory({ memory, key: 'personal_info', query: '张杰' }).allow).toBe(false);
  });

  it('allows content-matched delete', () => {
    const memory = { key: 'personal_info', value: '我叫张杰。' };
    expect(shouldDeleteMemory({ memory, key: 'personal_info', query: '张杰' }).allow).toBe(true);
  });

  it('retrieves memory only for history-sensitive tasks', () => {
    expect(shouldRetrieveMemory({ userMessage: '按照我之前论文的风格改一下' }).allow).toBe(true);
    expect(shouldRetrieveMemory({ userMessage: '我是谁' }).allow).toBe(true);
    expect(shouldRetrieveMemory({ userMessage: '我现在有哪些记忆' }).allow).toBe(true);
    expect(shouldRetrieveMemory({ userMessage: '香农定理是什么' }).allow).toBe(false);
    expect(shouldRetrieveMemory({ userMessage: '把当前对话生成PDF' }).allow).toBe(false);
  });

  it('parses explicit memory set requests for backend hard path', () => {
    expect(parseExplicitMemoryAction('记住我是俞杨')).toEqual({
      type: 'set',
      key: 'personal_info',
      value: '我叫俞杨。',
    });
    expect(parseExplicitMemoryAction('以后回答我都要简洁')).toEqual({
      type: 'set',
      key: 'preferences',
      value: '用户偏好回答我都要简洁。',
    });
  });

  it('parses explicit memory delete requests for backend hard path', () => {
    expect(parseExplicitMemoryAction('忘记我叫俞杨')).toEqual({
      type: 'delete',
      key: 'personal_info',
      query: '俞杨',
    });
  });

  it('filters inactive memories and deduplicates by key', () => {
    const memories = filterAndRankMemories([
      { key: 'preferences', value: '用户偏好回答简洁。', updated_at: '2026-01-01' },
      { key: 'preferences', value: '用户偏好回答更简洁。', updated_at: '2026-02-01' },
      { key: 'context', value: '已删除。', status: 'deleted', updated_at: '2026-03-01' },
    ]);
    expect(memories).toHaveLength(1);
    expect(memories[0].value).toBe('用户偏好回答更简洁。');
  });
});
