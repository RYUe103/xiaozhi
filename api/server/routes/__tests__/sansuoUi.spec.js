jest.mock('~/server/middleware', () => ({
  requireJwtAuth: (_req, _res, next) => next(),
}));
jest.mock('~/server/services/SanSuoKnowledge', () => ({
  fetchSourceFile: jest.fn(),
  listAgents: jest.fn(),
  listKnowledgeConnections: jest.fn(),
  sanitizeAgentId: (value) => {
    const agentId = String(value || '').trim();
    return /^[A-Za-z0-9._-]{1,120}$/.test(agentId) ? agentId : '';
  },
}));
jest.mock('~/server/services/SanSuoIndustryMaterials', () => ({
  DEFAULT_MATERIAL_PROMPT_TEMPLATE: 'default template',
  getResource: jest.fn(),
  listMaterials: jest.fn(),
}));

const { sanitizePreferences } = require('../sansuoUi');

describe('sansuoUi preferences', () => {
  test('defaults missing or invalid modes to fast', () => {
    expect(sanitizePreferences()).toEqual({ answerMode: 'fast', knowledgeAgentId: null });
    expect(sanitizePreferences({ answerMode: 'invalid' })).toEqual({
      answerMode: 'fast',
      knowledgeAgentId: null,
    });
  });

  test('keeps supported modes and rejects unsafe agent identifiers', () => {
    expect(
      sanitizePreferences({ answerMode: 'knowledge', knowledgeAgentId: 'standards-v2' }),
    ).toEqual({ answerMode: 'knowledge', knowledgeAgentId: 'standards-v2' });
    expect(sanitizePreferences({ answerMode: 'deep', knowledgeAgentId: '../private' })).toEqual({
      answerMode: 'deep',
      knowledgeAgentId: null,
    });
  });
});
