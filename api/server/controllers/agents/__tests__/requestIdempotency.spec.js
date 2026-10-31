const { createRequestStartRegistry, normalizeClientRequestId } = require('../requestIdempotency');

describe('requestIdempotency', () => {
  it('normalizes supported request ids and rejects unsafe values', () => {
    expect(normalizeClientRequestId(' 550e8400-e29b-41d4-a716-446655440000 ')).toBe(
      '550e8400-e29b-41d4-a716-446655440000',
    );
    expect(normalizeClientRequestId('short')).toBeNull();
    expect(normalizeClientRequestId('bad request id')).toBeNull();
    expect(normalizeClientRequestId(null)).toBeNull();
  });

  it('lets one owner start work while duplicate claims await the same result', async () => {
    const registry = createRequestStartRegistry();
    const owner = registry.claim('user-1:request-1');
    const duplicate = registry.claim('user-1:request-1');

    expect(owner.isOwner).toBe(true);
    expect(duplicate.isOwner).toBe(false);

    owner.resolve({ streamId: 'stream-1', conversationId: 'conversation-1' });

    await expect(duplicate.promise).resolves.toEqual({
      streamId: 'stream-1',
      conversationId: 'conversation-1',
    });
    registry.clear();
  });

  it('keeps identical request ids isolated by user key', () => {
    const registry = createRequestStartRegistry();

    expect(registry.claim('user-1:request-1').isOwner).toBe(true);
    expect(registry.claim('user-2:request-1').isOwner).toBe(true);
    registry.clear();
  });

  it('allows a retry to become owner after the original start fails', async () => {
    const registry = createRequestStartRegistry();
    const owner = registry.claim('user-1:request-1');
    const duplicate = registry.claim('user-1:request-1');
    const error = new Error('start failed');

    owner.reject(error);
    await expect(duplicate.promise).rejects.toThrow('start failed');
    expect(registry.claim('user-1:request-1').isOwner).toBe(true);
    registry.clear();
  });
});
