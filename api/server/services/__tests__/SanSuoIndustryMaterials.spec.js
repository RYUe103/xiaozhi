const mongoose = require('mongoose');
const {
  MAX_CONTEXT_CHARS,
  buildMaterialContext,
  getMaterialMarkdown,
  listMaterials,
  normalizeExtractionResult,
  normalizeSelection,
  sanitizeMaterialId,
  saveMaterial,
  validateSourceSelection,
} = require('../SanSuoIndustryMaterials');

describe('SanSuoIndustryMaterials', () => {
  afterEach(() => jest.restoreAllMocks());

  test('normalizes unique selections and rejects more than five', () => {
    expect(normalizeSelection(['a', 'a', '../bad', 'b'])).toEqual(['a', 'b']);
    expect(() => normalizeSelection(['a', 'b', 'c', 'd', 'e', 'f'])).toThrow('最多选择 5 份');
    expect(sanitizeMaterialId('../private')).toBe('');
  });

  test('rejects mixed big-knowledge and industry-material selections', () => {
    expect(() => validateSourceSelection('meeting-kb', ['pipes'])).toThrow('不能同时选择');
    expect(validateSourceSelection('', ['pipes'])).toEqual({
      knowledgeBaseId: '',
      materialIds: ['pipes'],
    });
  });

  test('keeps admin lists lightweight and reports markdown character count', async () => {
    const markdown = '行业资料正文';
    jest.spyOn(mongoose.connection, 'collection').mockReturnValue({
      find: () => ({
        sort: () => ({
          toArray: async () => [
            {
              materialId: 'pipes',
              name: '管道术语',
              markdown,
              allowedUserIds: [],
            },
          ],
        }),
      }),
    });

    const result = await listMaterials({ admin: true });

    expect(result[0]).not.toHaveProperty('markdown');
    expect(result[0].contentChars).toBe(markdown.length);
  });

  test('preserves stored markdown when saving metadata without replacement content', async () => {
    const current = {
      materialId: 'pipes',
      name: '管道术语',
      markdown: '原有正文',
      allowedUserIds: [],
      assets: [],
      sourceFiles: [],
    };
    const updateOne = jest.fn().mockResolvedValue({ matchedCount: 1 });
    jest.spyOn(mongoose.connection, 'collection').mockReturnValue({
      findOne: jest.fn().mockResolvedValue(current),
      updateOne,
    });

    const result = await saveMaterial({ materialId: 'pipes', name: '更新名称' }, 'pipes');

    expect(updateOne.mock.calls[0][1].$set.markdown).toBe('原有正文');
    expect(result).not.toHaveProperty('markdown');
    expect(result.contentChars).toBe(4);
  });

  test('returns markdown only through the explicit admin export helper', async () => {
    jest.spyOn(mongoose.connection, 'collection').mockReturnValue({
      findOne: jest.fn().mockResolvedValue({
        materialId: 'pipes',
        name: '管道术语',
        markdown: '# 正文',
      }),
    });

    await expect(getMaterialMarkdown('pipes')).resolves.toEqual({
      materialId: 'pipes',
      name: '管道术语',
      markdown: '# 正文',
    });
  });

  test('builds context only from selected published materials and excludes source files', async () => {
    const materials = [
      {
        materialId: 'pipes',
        name: '管道术语',
        version: '2026',
        markdown: '管道等级术语正文',
        enabled: true,
        published: true,
        allowedUserIds: [],
        assets: [{ assetId: 'image-1', filename: '示意图.png' }],
        sourceFiles: [{ sourceId: 'secret-pdf', filename: '原始资料.pdf' }],
      },
    ];
    jest.spyOn(mongoose.connection, 'collection').mockImplementation((name) => {
      if (name === 'sansuo_industry_materials') {
        return { find: () => ({ toArray: async () => materials }) };
      }
      return { findOne: async () => null };
    });

    const result = await buildMaterialContext({
      materialIds: ['pipes'],
      userId: 'user-1',
      userQuestion: '什么是管道等级？',
      promptTemplate: '{{material_names}}\n{{material_contents}}\n{{user_question}}',
      extractMaterial: async () => ({
        standaloneQuestion: '什么是管道等级？',
        sufficient: true,
        excerpts: [{ heading: '术语', quote: '管道等级术语正文' }],
      }),
    });

    expect(result.context).toContain('管道术语');
    expect(result.context).toContain('术语正文');
    expect(result.context).toContain('/assets/image-1');
    expect(result.context).not.toContain('原始资料.pdf');
    expect(result.context).not.toContain('secret-pdf');
  });

  test('passes only verified excerpts to the main model for a regular question', async () => {
    const materials = [
      {
        materialId: 'pipes',
        name: '管道专业资料',
        markdown: [
          '# 管道等级',
          '',
          '管道等级由介质、压力和温度共同确定。',
          '',
          '# 涂装颜色',
          '',
          '设备外表面应采用银灰色涂层。',
        ].join('\n'),
        enabled: true,
        published: true,
        allowedUserIds: [],
      },
    ];
    jest.spyOn(mongoose.connection, 'collection').mockImplementation((name) => {
      if (name === 'sansuo_industry_materials') {
        return { find: () => ({ toArray: async () => materials }) };
      }
      return { findOne: async () => null };
    });

    const result = await buildMaterialContext({
      materialIds: ['pipes'],
      userId: 'user-1',
      userQuestion: '管道等级由什么确定？',
      extractMaterial: async () => ({
        standaloneQuestion: '管道等级由什么确定？',
        sufficient: true,
        excerpts: [{ heading: '管道等级', quote: '管道等级由介质、压力和温度共同确定。' }],
      }),
    });

    expect(result.context).toContain('管道等级由介质、压力和温度共同确定');
    expect(result.context).not.toContain('设备外表面应采用银灰色涂层');
    expect(result.historyRecord.materials[0].excerpts).toEqual([
      { heading: '管道等级', quote: '管道等级由介质、压力和温度共同确定。' },
    ]);
    expect(result.selection).toMatchObject({
      fullRead: false,
      fullReadByExtractor: true,
      matchedChunks: 1,
      sourceContentChars: materials[0].markdown.length,
      failedMaterials: 0,
    });
  });

  test('gives the compact main-chat history to every selected material independently', async () => {
    const materials = [
      {
        materialId: 'pipes',
        name: '管道资料',
        markdown: '# 压力试验\n\n压力试验应符合管道规定。',
        enabled: true,
        published: true,
        allowedUserIds: [],
      },
      {
        materialId: 'electric',
        name: '电气资料',
        markdown: '# 接地\n\n设备外壳必须可靠接地。',
        enabled: true,
        published: true,
        allowedUserIds: [],
      },
    ];
    jest.spyOn(mongoose.connection, 'collection').mockImplementation((name) => {
      if (name === 'sansuo_industry_materials') {
        return { find: () => ({ toArray: async () => materials }) };
      }
      return { findOne: async () => null };
    });

    const extractMaterial = jest.fn(async ({ material, conversationHistory }) => ({
      standaloneQuestion: '对应专业还要注意什么？',
      sufficient: true,
      excerpts: [
        {
          heading: material.materialId,
          quote:
            material.materialId === 'pipes' ? '压力试验应符合管道规定。' : '设备外壳必须可靠接地。',
        },
      ],
      historySeen: conversationHistory,
    }));
    const history = [
      { role: 'user', content: '管道和电气分别有什么要求？' },
      { role: 'assistant', content: '先看基础要求。' },
    ];
    const result = await buildMaterialContext({
      materialIds: ['pipes', 'electric'],
      userId: 'user-1',
      userQuestion: '那还要注意什么？',
      conversationHistory: history,
      extractMaterial,
    });

    expect(extractMaterial).toHaveBeenCalledTimes(2);
    expect(extractMaterial.mock.calls.map(([input]) => input.material.materialId)).toEqual([
      'pipes',
      'electric',
    ]);
    expect(
      extractMaterial.mock.calls.every(([input]) => input.conversationHistory === history),
    ).toBe(true);
    expect(
      extractMaterial.mock.calls.every(([input]) =>
        input.selectedMaterialNames.every((name) => ['管道资料', '电气资料'].includes(name)),
      ),
    ).toBe(true);
    expect(extractMaterial.mock.calls[0][0].selectedMaterialNames).toHaveLength(2);
    expect(result.context).toContain('压力试验应符合管道规定');
    expect(result.context).toContain('设备外壳必须可靠接地');
    expect(result.selection.matchedChunks).toBe(2);
  });

  test('keeps prior verified excerpts in hidden evidence history without duplicating them', async () => {
    const materials = [
      {
        materialId: 'pipes',
        name: '管道资料',
        markdown: '压力试验必须记录。\n设计压力必须校核。',
        enabled: true,
        published: true,
        allowedUserIds: [],
      },
    ];
    jest.spyOn(mongoose.connection, 'collection').mockImplementation((name) => {
      if (name === 'sansuo_industry_materials') {
        return { find: () => ({ toArray: async () => materials }) };
      }
      return { findOne: async () => null };
    });

    const result = await buildMaterialContext({
      materialIds: ['pipes'],
      userId: 'user-1',
      userQuestion: '设计压力呢？',
      previousExtractions: [
        {
          version: 1,
          materials: [
            {
              materialId: 'pipes',
              sufficient: true,
              excerpts: [
                { heading: '试验', quote: '压力试验必须记录。' },
                { heading: '重复', quote: '设计压力必须校核。' },
              ],
            },
          ],
        },
      ],
      extractMaterial: async () => ({
        sufficient: true,
        excerpts: [{ heading: '设计', quote: '设计压力必须校核。' }],
      }),
    });

    expect(result.context.match(/压力试验必须记录。/g)).toHaveLength(1);
    expect(result.context.match(/设计压力必须校核。/g)).toHaveLength(1);
    expect(result.selection.retainedHistoryChars).toBe('压力试验必须记录。'.length);
    expect(result.historyRecord.materials[0].excerpts).toEqual([
      { heading: '设计', quote: '设计压力必须校核。' },
    ]);
  });

  test('retains at most the latest ten extraction batches', async () => {
    const historicalQuotes = Array.from(
      { length: 11 },
      (_value, index) => `历史证据第${index}批。`,
    );
    const materials = [
      {
        materialId: 'pipes',
        name: '管道资料',
        markdown: ['当前证据。', ...historicalQuotes].join('\n'),
        enabled: true,
        published: true,
        allowedUserIds: [],
      },
    ];
    jest.spyOn(mongoose.connection, 'collection').mockImplementation((name) => {
      if (name === 'sansuo_industry_materials') {
        return { find: () => ({ toArray: async () => materials }) };
      }
      return { findOne: async () => null };
    });

    const result = await buildMaterialContext({
      materialIds: ['pipes'],
      userId: 'user-1',
      userQuestion: '继续',
      previousExtractions: historicalQuotes.map((quote) => ({
        version: 1,
        materials: [
          {
            materialId: 'pipes',
            sufficient: true,
            excerpts: [{ quote }],
          },
        ],
      })),
      extractMaterial: async () => ({
        sufficient: true,
        excerpts: [{ quote: '当前证据。' }],
      }),
    });

    expect(result.context).not.toContain('历史证据第0批。');
    for (const quote of historicalQuotes.slice(1)) {
      expect(result.context).toContain(quote);
    }
  });

  test('keeps successful evidence when one selected material extraction fails', async () => {
    const materials = [
      {
        materialId: 'pipes',
        name: '管道资料',
        markdown: '管道等级需要校核压力边界。',
        enabled: true,
        published: true,
        allowedUserIds: [],
      },
      {
        materialId: 'broken',
        name: '不可用资料',
        markdown: '另一份正文。',
        enabled: true,
        published: true,
        allowedUserIds: [],
      },
    ];
    jest.spyOn(mongoose.connection, 'collection').mockImplementation((name) => {
      if (name === 'sansuo_industry_materials') {
        return { find: () => ({ toArray: async () => materials }) };
      }
      return { findOne: async () => null };
    });

    const result = await buildMaterialContext({
      materialIds: ['pipes', 'broken'],
      userId: 'user-1',
      userQuestion: '管道等级还要注意什么？',
      extractMaterial: async ({ material }) => {
        if (material.materialId === 'broken') {
          throw Object.assign(new Error('timeout'), { code: 'industry_extractor_timeout' });
        }
        return {
          sufficient: true,
          excerpts: [{ quote: '管道等级需要校核压力边界。' }],
        };
      },
    });

    expect(result.context).toContain('管道等级需要校核压力边界');
    expect(result.context).toContain('本资料提取失败');
    expect(result.selection.failedMaterials).toBe(1);
    expect(result.materials[1].extractionStatus).toBe('failed');
  });

  test('rejects the request when every selected material extraction fails', async () => {
    const materials = [
      {
        materialId: 'pipes',
        name: '管道专业资料',
        markdown: '正文',
        enabled: true,
        published: true,
        allowedUserIds: [],
      },
    ];
    jest.spyOn(mongoose.connection, 'collection').mockImplementation((name) => {
      if (name === 'sansuo_industry_materials') {
        return { find: () => ({ toArray: async () => materials }) };
      }
      return { findOne: async () => null };
    });

    await expect(
      buildMaterialContext({
        materialIds: ['pipes'],
        userId: 'user-1',
        userQuestion: '问题',
        extractMaterial: async () => {
          throw Object.assign(new Error('timeout'), { code: 'industry_extractor_timeout' });
        },
      }),
    ).rejects.toMatchObject({ code: 'industry_extractor_timeout' });
  });

  test('drops model excerpts that are not verbatim source text', () => {
    const result = normalizeExtractionResult(
      {
        sufficient: true,
        excerpts: [
          { heading: '真实', quote: '压力试验必须记录。' },
          { heading: '幻觉', quote: '模型自行补充的要求。' },
        ],
      },
      '# 规定\n压力试验必须记录。',
      20000,
    );

    expect(result.excerpts).toEqual([{ heading: '真实', quote: '压力试验必须记录。' }]);
    expect(result.sufficient).toBe(true);
  });

  test('accepts up to 150000 source characters before model extraction', async () => {
    expect(MAX_CONTEXT_CHARS).toBe(150000);
    let markdown = '甲'.repeat(MAX_CONTEXT_CHARS);
    jest.spyOn(mongoose.connection, 'collection').mockImplementation((name) => {
      if (name === 'sansuo_industry_materials') {
        return {
          find: () => ({
            toArray: async () => [
              {
                materialId: 'large-material',
                name: '大型行业资料',
                markdown,
                enabled: true,
                published: true,
                allowedUserIds: [],
              },
            ],
          }),
        };
      }
      return { findOne: async () => null };
    });

    await expect(
      buildMaterialContext({
        materialIds: ['large-material'],
        userId: 'user-1',
        userQuestion: '请通读全文',
        extractMaterial: async () => ({
          sufficient: true,
          excerpts: [{ quote: '甲'.repeat(1000) }],
        }),
      }),
    ).resolves.toMatchObject({
      selection: { fullReadByExtractor: true, sourceContentChars: MAX_CONTEXT_CHARS },
    });

    markdown += '乙';
    await expect(
      buildMaterialContext({
        materialIds: ['large-material'],
        userId: 'user-1',
        userQuestion: '请通读全文',
        extractMaterial: async () => ({ sufficient: false, excerpts: [] }),
      }),
    ).rejects.toThrow('超过 150000 字符');
  });

  test('rejects disabled or unauthorized materials', async () => {
    jest.spyOn(mongoose.connection, 'collection').mockReturnValue({
      find: () => ({
        toArray: async () => [
          {
            materialId: 'restricted',
            name: '受限资料',
            markdown: '内容',
            enabled: true,
            published: true,
            allowedUserIds: ['another-user'],
          },
        ],
      }),
    });
    await expect(
      buildMaterialContext({ materialIds: ['restricted'], userId: 'user-1', userQuestion: 'test' }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
