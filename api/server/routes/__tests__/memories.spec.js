const express = require('express');
const request = require('supertest');

const mockSetUserMemoryPreferences = jest.fn();

jest.mock('@librechat/api', () => ({
  Tokenizer: { getTokenCount: jest.fn(() => 1) },
  generateCheckAccess: jest.fn(() => (_req, _res, next) => next()),
}));

jest.mock('librechat-data-provider', () => ({
  PermissionTypes: { MEMORIES: 'MEMORIES' },
  Permissions: {
    USE: 'USE',
    READ: 'READ',
    CREATE: 'CREATE',
    UPDATE: 'UPDATE',
    OPT_OUT: 'OPT_OUT',
  },
}));

jest.mock('~/models', () => ({
  getAllUserMemories: jest.fn(() => []),
  setUserMemoryPreferences: (...args) => mockSetUserMemoryPreferences(...args),
  getRoleByName: jest.fn(),
  createMemory: jest.fn(),
  deleteMemory: jest.fn(),
  setMemory: jest.fn(),
}));

jest.mock('~/server/middleware', () => ({
  requireJwtAuth: (req, _res, next) => {
    req.user = { id: 'user-id' };
    next();
  },
  configMiddleware: (_req, _res, next) => next(),
}));

const memoriesRouter = require('../memories');

describe('memory preferences', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/memories', memoriesRouter);

  beforeEach(() => {
    mockSetUserMemoryPreferences.mockReset();
    mockSetUserMemoryPreferences.mockResolvedValue({
      personalization: { memories: true, memoryMode: 'manual' },
    });
  });

  test('accepts manual mode', async () => {
    const response = await request(app)
      .patch('/api/memories/preferences')
      .send({ memories: true, memoryMode: 'manual' });

    expect(response.status).toBe(200);
    expect(mockSetUserMemoryPreferences).toHaveBeenCalledWith('user-id', true, 'manual');
  });

  test('rejects auto mode', async () => {
    const response = await request(app)
      .patch('/api/memories/preferences')
      .send({ memories: true, memoryMode: 'auto' });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('memoryMode must be manual or off');
    expect(mockSetUserMemoryPreferences).not.toHaveBeenCalled();
  });
});
