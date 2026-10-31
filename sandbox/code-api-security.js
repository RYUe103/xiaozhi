const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const SESSION_METADATA_FILE = '.session.json';
const VALID_KINDS = new Set(['skill', 'agent', 'user']);
const SAFE_ID = /^[A-Za-z0-9_-]{1,160}$/;
const DEFAULT_ISSUER = 'librechat';
const DEFAULT_AUDIENCE = 'codeapi';
const MAX_TOKEN_LIFETIME_SECONDS = 300;

class CodeApiSecurityError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'CodeApiSecurityError';
    this.status = status;
    this.code = code;
  }
}

function securityError(status, code, message) {
  return new CodeApiSecurityError(status, code, message);
}

function splitList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function constantTimeEquals(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  if (leftBuffer.length !== rightBuffer.length) {
    crypto.timingSafeEqual(leftBuffer, Buffer.alloc(leftBuffer.length));
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizePem(value) {
  return String(value || '')
    .replace(/\\n/g, '\n')
    .trim();
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    throw securityError(503, 'auth_configuration_invalid', `${label} is not valid JSON`);
  }
}

function createPublicKey(raw) {
  if (raw && typeof raw === 'object') {
    return crypto.createPublicKey({ key: raw, format: 'jwk' });
  }
  const normalized = normalizePem(raw);
  if (normalized.startsWith('{')) {
    return crypto.createPublicKey({
      key: parseJson(normalized, 'Code API public JWK'),
      format: 'jwk',
    });
  }
  return crypto.createPublicKey(normalized);
}

function loadJwtPublicKeys(env) {
  const result = new Map();
  const keySet = env.CODEAPI_JWT_PUBLIC_KEYS_JSON;
  if (keySet) {
    const parsed = parseJson(keySet, 'CODEAPI_JWT_PUBLIC_KEYS_JSON');
    for (const [kid, value] of Object.entries(parsed || {})) {
      if (kid && value) result.set(kid, createPublicKey(value));
    }
  }

  let single = env.CODEAPI_JWT_PUBLIC_KEY;
  if (!single && env.CODEAPI_JWT_PUBLIC_KEY_BASE64) {
    single = Buffer.from(env.CODEAPI_JWT_PUBLIC_KEY_BASE64, 'base64').toString('utf8');
  }
  if (!single && env.CODEAPI_JWT_PUBLIC_JWK_JSON) {
    single = env.CODEAPI_JWT_PUBLIC_JWK_JSON;
  }
  if (single) {
    result.set(
      env.CODEAPI_JWT_KID || env.CODEAPI_JWT_KEY_ID || 'lc-codeapi-2026-05',
      createPublicKey(single),
    );
  }
  return result;
}

function getAuthProvider(env) {
  const configured = String(env.CODEAPI_AUTH_PROVIDER || '')
    .trim()
    .toLowerCase();
  if (configured) return configured;
  if (
    env.CODEAPI_JWT_PUBLIC_KEY ||
    env.CODEAPI_JWT_PUBLIC_KEY_BASE64 ||
    env.CODEAPI_JWT_PUBLIC_JWK_JSON ||
    env.CODEAPI_JWT_PUBLIC_KEYS_JSON
  ) {
    return 'librechat-jwt';
  }
  if (env.LIBRECHAT_CODE_API_KEY || env.CODE_API_KEY || env.SANSUO_CODE_API_KEYS) {
    return 'legacy-api-key';
  }
  return 'unconfigured';
}

function readConfig(env = process.env) {
  const provider = getAuthProvider(env);
  if (!['librechat-jwt', 'legacy-api-key', 'both', 'unconfigured'].includes(provider)) {
    throw securityError(
      503,
      'auth_configuration_invalid',
      `Unsupported CODEAPI_AUTH_PROVIDER: ${provider}`,
    );
  }
  const legacyKeys = Array.from(
    new Set(
      [...splitList(env.SANSUO_CODE_API_KEYS), env.LIBRECHAT_CODE_API_KEY, env.CODE_API_KEY].filter(
        Boolean,
      ),
    ),
  );
  return {
    provider,
    legacyKeys,
    publicKeys: loadJwtPublicKeys(env),
    issuer: env.CODEAPI_JWT_ISSUER || DEFAULT_ISSUER,
    audience: env.CODEAPI_JWT_AUDIENCE || DEFAULT_AUDIENCE,
    singleTenantId: env.CODEAPI_JWT_SINGLE_TENANT_ID || 'legacy',
    legacySessionPolicy: String(env.CODEAPI_LEGACY_SESSION_POLICY || 'deny').toLowerCase(),
  };
}

function decodeJwtPart(value, label) {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw securityError(401, 'invalid_token', `Invalid JWT ${label}`);
  }
}

function verifyJwt(token, config) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw securityError(401, 'invalid_token', 'Malformed bearer token');
  const [encodedHeader, encodedClaims, encodedSignature] = parts;
  const header = decodeJwtPart(encodedHeader, 'header');
  const claims = decodeJwtPart(encodedClaims, 'claims');
  if (!['EdDSA', 'RS256'].includes(header.alg)) {
    throw securityError(401, 'invalid_token', 'Unsupported JWT algorithm');
  }
  const publicKey = config.publicKeys.get(String(header.kid || ''));
  if (!publicKey) throw securityError(401, 'invalid_token', 'Unknown JWT key id');
  const verified = crypto.verify(
    header.alg === 'RS256' ? 'RSA-SHA256' : null,
    Buffer.from(`${encodedHeader}.${encodedClaims}`),
    publicKey,
    Buffer.from(encodedSignature, 'base64url'),
  );
  if (!verified) throw securityError(401, 'invalid_token', 'Invalid JWT signature');

  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== config.issuer || claims.aud !== config.audience) {
    throw securityError(401, 'invalid_token', 'JWT issuer or audience mismatch');
  }
  if (!Number.isFinite(claims.exp) || claims.exp <= now || (claims.nbf && claims.nbf > now + 5)) {
    throw securityError(401, 'invalid_token', 'JWT is expired or not active');
  }
  if (
    !Number.isFinite(claims.iat) ||
    claims.iat > now + 5 ||
    claims.exp - claims.iat > MAX_TOKEN_LIFETIME_SECONDS
  ) {
    throw securityError(401, 'invalid_token', 'JWT lifetime is invalid');
  }
  if (!claims.sub || !claims.tenant_id) {
    throw securityError(401, 'invalid_token', 'JWT subject and tenant are required');
  }
  return {
    authType: 'jwt',
    userId: String(claims.sub),
    tenantId: String(claims.tenant_id),
    role: String(claims.role || 'USER'),
    tokenId: String(claims.jti || ''),
  };
}

function verifyLegacyApiKey(req, config) {
  const presented = req.get('X-API-Key') || '';
  const valid = config.legacyKeys.some((candidate) => constantTimeEquals(presented, candidate));
  if (!presented || !valid)
    throw securityError(401, 'invalid_api_key', 'Missing or invalid API key');
  const userId = String(req.get('User-Id') || req.get('X-User-Id') || '').trim();
  if (!userId)
    throw securityError(401, 'missing_principal', 'User-Id is required in legacy API key mode');
  return {
    authType: 'legacy-api-key',
    userId,
    tenantId: String(req.get('X-Tenant-Id') || config.singleTenantId),
    role: 'SERVICE',
    tokenId: '',
  };
}

function authenticate(req, env = process.env) {
  const config = readConfig(env);
  if (config.provider === 'unconfigured') {
    throw securityError(503, 'auth_not_configured', 'Code API authentication is not configured');
  }
  const authorization = String(req.get('Authorization') || '');
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if ((config.provider === 'librechat-jwt' || config.provider === 'both') && bearer) {
    if (config.publicKeys.size === 0) {
      throw securityError(
        503,
        'auth_configuration_invalid',
        'Code API JWT public key is not configured',
      );
    }
    return { principal: verifyJwt(bearer, config), config };
  }
  if (config.provider === 'legacy-api-key' || config.provider === 'both') {
    return { principal: verifyLegacyApiKey(req, config), config };
  }
  throw securityError(401, 'missing_credentials', 'Bearer token is required');
}

function validateOpaqueId(value, label) {
  const normalized = String(value || '');
  if (!SAFE_ID.test(normalized)) {
    throw securityError(400, 'invalid_identifier', `Invalid ${label}`);
  }
  return normalized;
}

function parseIdentity(input, principal) {
  const kind = String(input?.kind || '');
  if (!VALID_KINDS.has(kind)) {
    throw securityError(400, 'invalid_identity', 'kind must be one of: skill, agent, user');
  }
  const rawResourceId = input?.resource_id ?? input?.resourceId ?? input?.id;
  const resourceId = kind === 'user' ? principal.userId : String(rawResourceId || '');
  if (!resourceId || resourceId.length > 256 || /[\0\r\n]/.test(resourceId)) {
    throw securityError(400, 'invalid_identity', 'Resource id is required');
  }
  const version =
    input?.version == null || input.version === '' ? undefined : Number(input.version);
  if (kind === 'skill' && (!Number.isInteger(version) || version < 0)) {
    throw securityError(400, 'invalid_identity', 'Skill version must be a non-negative integer');
  }
  if (kind !== 'skill' && version !== undefined) {
    throw securityError(400, 'invalid_identity', 'version is only valid for skill resources');
  }
  return { kind, resourceId, ...(version !== undefined ? { version } : {}) };
}

function sessionKey(principal, identity) {
  const owner = identity.kind === 'user' ? principal.userId : identity.resourceId;
  return [
    principal.tenantId,
    identity.kind,
    owner,
    ...(identity.kind === 'skill' ? ['v', String(identity.version)] : []),
  ].join(':');
}

function userSessionIdentity(principal) {
  return { kind: 'user', resourceId: principal.userId };
}

function sessionMetadata(principal, identity) {
  return {
    schemaVersion: 1,
    sessionKey: sessionKey(principal, identity),
    tenantId: principal.tenantId,
    ownerUserId: identity.kind === 'user' ? principal.userId : null,
    kind: identity.kind,
    resourceId: identity.resourceId,
    ...(identity.version !== undefined ? { version: identity.version } : {}),
    createdAt: new Date().toISOString(),
  };
}

function resolveInside(parent, ...parts) {
  const resolvedParent = path.resolve(parent);
  const target = path.resolve(resolvedParent, ...parts);
  if (target !== resolvedParent && !target.startsWith(`${resolvedParent}${path.sep}`)) {
    throw securityError(400, 'invalid_path', 'Path escapes Code API storage');
  }
  return target;
}

async function assertNoSymlink(target, allowMissing = false) {
  try {
    const stat = await fsp.lstat(target);
    if (stat.isSymbolicLink())
      throw securityError(403, 'symlink_forbidden', 'Symbolic links are not allowed');
    return stat;
  } catch (error) {
    if (allowMissing && error?.code === 'ENOENT') return null;
    throw error;
  }
}

function createCodeApiSecurity({ root, env = process.env, audit = () => {} }) {
  const storageRoot = resolveInside(root, 'storage');

  function sessionDir(sessionId) {
    return resolveInside(storageRoot, validateOpaqueId(sessionId, 'session id'));
  }

  function filePath(sessionId, fileId) {
    return resolveInside(sessionDir(sessionId), validateOpaqueId(fileId, 'file id'));
  }

  async function readSessionMetadata(sessionId) {
    const dir = sessionDir(sessionId);
    await assertNoSymlink(dir);
    const metadataPath = resolveInside(dir, SESSION_METADATA_FILE);
    await assertNoSymlink(metadataPath);
    return JSON.parse(await fsp.readFile(metadataPath, 'utf8'));
  }

  async function writeSessionMetadata(sessionId, metadata) {
    const dir = sessionDir(sessionId);
    await fsp.mkdir(dir, { recursive: true });
    await assertNoSymlink(dir);
    const metadataPath = resolveInside(dir, SESSION_METADATA_FILE);
    const tempPath = resolveInside(
      dir,
      `${SESSION_METADATA_FILE}.${crypto.randomBytes(6).toString('hex')}.tmp`,
    );
    await fsp.writeFile(tempPath, JSON.stringify(metadata), { mode: 0o600, flag: 'wx' });
    try {
      await fsp.link(tempPath, metadataPath);
      return true;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      return false;
    } finally {
      await fsp.rm(tempPath, { force: true }).catch(() => {});
    }
  }

  async function authorizeSession(principal, sessionId, identity, options = {}) {
    const expected = sessionKey(principal, identity);
    let metadata;
    try {
      metadata = await readSessionMetadata(sessionId);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const config = readConfig(env);
      if (options.create === true && !fs.existsSync(sessionDir(sessionId))) {
        metadata = sessionMetadata(principal, identity);
        const created = await writeSessionMetadata(sessionId, metadata);
        if (created) return metadata;
        metadata = await readSessionMetadata(sessionId);
      }
      if (
        !metadata &&
        config.legacySessionPolicy === 'claim' &&
        fs.existsSync(sessionDir(sessionId))
      ) {
        metadata = sessionMetadata(principal, identity);
        const claimed = await writeSessionMetadata(sessionId, metadata);
        if (claimed) {
          audit('legacy_session_claimed', {
            sessionId,
            authType: principal.authType,
            kind: identity.kind,
          });
          return metadata;
        }
        metadata = await readSessionMetadata(sessionId);
      }
      if (!metadata) {
        throw securityError(403, 'unowned_session', 'Storage session has no ownership metadata');
      }
    }
    if (metadata.sessionKey !== expected || metadata.tenantId !== principal.tenantId) {
      throw securityError(
        403,
        'session_forbidden',
        'Storage session is owned by another principal or resource',
      );
    }
    return metadata;
  }

  async function authorizeFile(principal, file, options = {}) {
    const storageSessionId = validateOpaqueId(
      file?.storage_session_id || file?.session_id,
      'session id',
    );
    const storageFileId = validateOpaqueId(file?.file_id || file?.id, 'file id');
    const identity = parseIdentity(file?.kind ? file : { ...file, kind: 'user' }, principal);
    await authorizeSession(principal, storageSessionId, identity, options);
    const target = filePath(storageSessionId, storageFileId);
    const stat = await assertNoSymlink(target, true);
    if (!stat?.isFile()) throw securityError(404, 'file_not_found', 'File not found');
    return { storageSessionId, storageFileId, identity, path: target };
  }

  function middleware(req, res, next) {
    try {
      const result = authenticate(req, env);
      req.codeApiPrincipal = result.principal;
      req.codeApiAuthConfig = result.config;
      next();
    } catch (error) {
      const status = error instanceof CodeApiSecurityError ? error.status : 500;
      if (status >= 500)
        audit('auth_configuration_error', { code: error.code || 'internal_error' });
      else audit('request_denied', { code: error.code || 'unauthorized', path: req.path });
      res.status(status).json({ error: error.code || 'unauthorized', message: error.message });
    }
  }

  return {
    middleware,
    readConfig: () => readConfig(env),
    parseIdentity,
    sessionKey,
    sessionMetadata,
    userSessionIdentity,
    authorizeSession,
    authorizeFile,
    readSessionMetadata,
    writeSessionMetadata,
    sessionDir,
    filePath,
    validateOpaqueId,
    assertNoSymlink,
  };
}

module.exports = {
  SESSION_METADATA_FILE,
  CodeApiSecurityError,
  createCodeApiSecurity,
};
