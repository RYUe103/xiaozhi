const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const request = require('supertest');

const TEST_KEY = 'code-api-test-key-with-sufficient-entropy';

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function signToken(privateKey, overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'EdDSA', typ: 'JWT', kid: 'test-kid' };
  const claims = {
    iss: 'librechat',
    aud: 'codeapi',
    sub: 'user-a',
    tenant_id: 'tenant-a',
    role: 'USER',
    iat: now,
    nbf: now,
    exp: now + 300,
    jti: crypto.randomUUID(),
    ...overrides,
  };
  const input = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;
  return `${input}.${base64Url(crypto.sign(null, Buffer.from(input), privateKey))}`;
}

describe('SanSuo Code API security', () => {
  let root;
  let app;
  let sessionId;
  let fileId;
  let privateKey;
  let publicKey;

  const legacyHeaders = (userId = 'user-a', tenantId = 'tenant-a', key = TEST_KEY) => ({
    'X-API-Key': key,
    'User-Id': userId,
    'X-Tenant-Id': tenantId,
  });

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'sansuo-code-api-security-'));
    await fs.mkdir(path.join(root, 'tmp'), { recursive: true });
    process.env.SANSUO_CODE_API_DATA = root;
    process.env.CODEAPI_AUTH_PROVIDER = 'legacy-api-key';
    process.env.LIBRECHAT_CODE_API_KEY = TEST_KEY;
    process.env.CODEAPI_JWT_SINGLE_TENANT_ID = 'tenant-a';
    process.env.CODEAPI_LEGACY_SESSION_POLICY = 'deny';
    process.env.SANSUO_CODE_API_DEBUG = 'false';
    process.env.SANSUO_ENABLE_FILENAME_AUTOMOUNT = 'false';
    ({ privateKey, publicKey } = crypto.generateKeyPairSync('ed25519'));
    ({ app } = require('./code-api-server'));
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
    for (const key of [
      'SANSUO_CODE_API_DATA',
      'CODEAPI_AUTH_PROVIDER',
      'LIBRECHAT_CODE_API_KEY',
      'CODEAPI_JWT_PUBLIC_JWK_JSON',
      'CODEAPI_JWT_KID',
      'CODEAPI_JWT_SINGLE_TENANT_ID',
      'CODEAPI_LEGACY_SESSION_POLICY',
      'SANSUO_CODE_API_DEBUG',
      'SANSUO_ENABLE_FILENAME_AUTOMOUNT',
    ]) {
      delete process.env[key];
    }
  });

  it('keeps health anonymous while reporting auth status without secrets', async () => {
    const response = await request(app).get('/health').expect(200);
    expect(response.body.auth).toEqual({ provider: 'legacy-api-key', configured: true });
    expect(JSON.stringify(response.body)).not.toContain(TEST_KEY);
  });

  it('rejects missing and incorrect API keys before execution', async () => {
    await request(app).post('/v1/exec').send({ lang: 'invalid', code: '' }).expect(401);
    await request(app)
      .post('/v1/exec')
      .set(legacyHeaders('user-a', 'tenant-a', 'wrong-key'))
      .send({ lang: 'invalid', code: '' })
      .expect(401);
  });

  it('uploads and downloads a user-owned file with valid credentials', async () => {
    const uploaded = await request(app)
      .post('/v1/upload')
      .set(legacyHeaders())
      .field('kind', 'user')
      .field('id', 'user-a')
      .attach('file', Buffer.from('classified test content'), 'report.txt')
      .expect(200);

    sessionId = uploaded.body.storage_session_id;
    fileId = uploaded.body.files[0].fileId;

    const downloaded = await request(app)
      .get(`/v1/download/${sessionId}/${fileId}?kind=user&id=user-a`)
      .set(legacyHeaders())
      .expect(200);
    expect(downloaded.text || downloaded.body.toString()).toContain('classified test content');
  });

  it('denies cross-user and cross-tenant session access', async () => {
    await request(app)
      .get(`/v1/download/${sessionId}/${fileId}?kind=user&id=user-b`)
      .set(legacyHeaders('user-b'))
      .expect(403);
    await request(app)
      .get(`/v1/download/${sessionId}/${fileId}?kind=user&id=user-a`)
      .set(legacyHeaders('user-a', 'tenant-b'))
      .expect(403);
  });

  it('rejects forged refs, traversal identifiers, and symlink objects', async () => {
    await request(app)
      .get(`/v1/download/${sessionId}/file_does_not_exist?kind=user&id=user-a`)
      .set(legacyHeaders())
      .expect(404);

    const traversal = await request(app)
      .get('/v1/download/not..safe/file_x?kind=user&id=user-a')
      .set(legacyHeaders());
    expect([400, 404]).toContain(traversal.status);

    const linkId = 'file_symlink_test';
    await fs.symlink('/etc/hosts', path.join(root, 'storage', sessionId, linkId));
    await request(app)
      .get(`/v1/download/${sessionId}/${linkId}?kind=user&id=user-a`)
      .set(legacyHeaders())
      .expect(403);
  });

  it('authorizes mounted refs before starting an execution backend', async () => {
    await request(app)
      .post('/v1/exec')
      .set(legacyHeaders('user-b'))
      .send({
        lang: 'invalid',
        code: '',
        files: [{ kind: 'user', id: fileId, storage_session_id: sessionId, name: 'report.txt' }],
      })
      .expect(403);

    const response = await request(app)
      .post('/v1/exec')
      .set(legacyHeaders())
      .send({
        lang: 'invalid',
        code: '',
        files: [{ kind: 'user', id: fileId, storage_session_id: sessionId, name: 'report.txt' }],
      })
      .expect(200);
    expect(response.body.stderr).toContain('Unsupported sandbox language');
  });

  it('binds client-supplied execution session ids to the authenticated owner', async () => {
    const fixedSession = 'exec_fixed_owner_test';
    await request(app)
      .post('/v1/exec')
      .set(legacyHeaders())
      .send({ session_id: fixedSession, lang: 'invalid', code: '' })
      .expect(200);

    await request(app)
      .post('/v1/exec')
      .set(legacyHeaders('user-b'))
      .send({ session_id: fixedSession, lang: 'invalid', code: '' })
      .expect(403);

    await request(app)
      .get(`/v1/download/${sessionId}/${fileId}?kind=skill&id=forged-skill&version=1`)
      .set(legacyHeaders())
      .expect(403);
  });

  it('accepts a valid short-lived JWT and rejects bad signatures', async () => {
    process.env.CODEAPI_AUTH_PROVIDER = 'librechat-jwt';
    process.env.CODEAPI_JWT_KID = 'test-kid';
    process.env.CODEAPI_JWT_PUBLIC_JWK_JSON = JSON.stringify(publicKey.export({ format: 'jwk' }));

    await request(app)
      .get(`/v1/download/${sessionId}/${fileId}?kind=user&id=user-a`)
      .set('Authorization', `Bearer ${signToken(privateKey)}`)
      .expect(200);

    const otherPair = crypto.generateKeyPairSync('ed25519');
    await request(app)
      .get(`/v1/download/${sessionId}/${fileId}?kind=user&id=user-a`)
      .set('Authorization', `Bearer ${signToken(otherPair.privateKey)}`)
      .expect(401);

    process.env.CODEAPI_AUTH_PROVIDER = 'legacy-api-key';
    delete process.env.CODEAPI_JWT_PUBLIC_JWK_JSON;
  });
});
