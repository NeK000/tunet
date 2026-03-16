import {
  createConnection,
  createLongLivedTokenAuth,
  ERR_INVALID_AUTH,
} from 'home-assistant-js-websocket';
import { WebSocket as NodeWebSocket } from 'ws';

const DEFAULT_CACHE_TTL_MS = Math.min(
  Math.max(Number(process.env.HA_AUTH_CACHE_TTL_MS) || 15_000, 1_000),
  300_000
);
const DEFAULT_INVALID_AUTH_CACHE_TTL_MS = Math.min(
  Math.max(Number(process.env.HA_INVALID_AUTH_CACHE_TTL_MS) || 60_000, 1_000),
  3_600_000
);
const MAX_CACHE_ENTRIES = 200;
const TRUSTED_INGRESS_IPS = new Set(['172.30.32.2', '127.0.0.1', '::1']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const NETWORK_ERROR_PATTERNS = [
  'econnrefused',
  'econnreset',
  'enotfound',
  'ehostunreach',
  'eai_again',
  'etimedout',
  'socket hang up',
  'network error',
  'fetch failed',
  'getaddrinfo',
];
const TLS_ERROR_PATTERNS = [
  'certificate',
  'self signed',
  'tls',
  'ssl',
  'unable to verify the first certificate',
  'hostname/ip does not match certificate',
];

if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = NodeWebSocket;
}

const isSupervisorIngressTrustEnabled = () => process.env.TUNET_TRUST_SUPERVISOR_INGRESS === '1';

const normalizeRemoteAddress = (rawAddress) => {
  if (typeof rawAddress !== 'string' || !rawAddress.trim()) return '';
  const trimmed = rawAddress.trim();
  return trimmed.startsWith('::ffff:') ? trimmed.slice(7) : trimmed;
};

const isTrustedIngressRequest = (req) => {
  if (!isSupervisorIngressTrustEnabled()) {
    return false;
  }

  const ingressPath = req.get('x-ingress-path');
  if (typeof ingressPath !== 'string' || !ingressPath.trim()) {
    return false;
  }

  const remoteAddress = normalizeRemoteAddress(
    req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || ''
  );

  return TRUSTED_INGRESS_IPS.has(remoteAddress);
};

const getTrustedSupervisorUser = (req) => {
  if (!isTrustedIngressRequest(req)) return null;

  const userId = req.get('x-remote-user-id');
  if (typeof userId !== 'string' || !userId.trim()) return null;

  const displayName = req.get('x-remote-user-display-name');
  const userName = req.get('x-remote-user-name');

  return {
    id: userId.trim(),
    name:
      (typeof displayName === 'string' && displayName.trim()) ||
      (typeof userName === 'string' && userName.trim()) ||
      '',
    is_admin: false,
    is_owner: false,
    source: 'supervisor-ingress',
  };
};

const normalizeHomeAssistantUrl = (rawUrl) => {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;

  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    parsed.hash = '';
    parsed.search = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
};

const buildDockerReachableUrlCandidate = (rawUrl) => {
  const normalized = normalizeHomeAssistantUrl(rawUrl);
  if (!normalized) return null;

  try {
    const parsed = new URL(normalized);
    if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
      return null;
    }

    parsed.hostname = 'host.docker.internal';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
};

const pushUniqueCandidate = (candidates, rawCandidate) => {
  const normalized = normalizeHomeAssistantUrl(rawCandidate);
  if (!normalized || candidates.includes(normalized)) return;
  candidates.push(normalized);
};

const getHomeAssistantUrlCandidates = (req) => {
  const candidates = [];
  const envCandidates = [
    process.env.TUNET_INTERNAL_HA_URL,
    process.env.TUNET_INTERNAL_HA_FALLBACK_URL,
  ];
  const requestCandidates = [req.get('x-ha-url'), req.get('x-ha-fallback-url')];

  envCandidates.forEach((candidate) => {
    pushUniqueCandidate(candidates, candidate);
  });

  requestCandidates.forEach((candidate) => {
    pushUniqueCandidate(candidates, candidate);
    pushUniqueCandidate(candidates, buildDockerReachableUrlCandidate(candidate));
  });

  return candidates;
};

const getBearerToken = (req) => {
  const authHeader = req.get('authorization');
  if (typeof authHeader !== 'string') return null;

  const trimmedHeader = authHeader.trim();
  if (trimmedHeader.length <= 7 || !trimmedHeader.toLowerCase().startsWith('bearer ')) {
    return null;
  }

  const token = trimmedHeader.slice(7).trim();
  return token || null;
};

const pruneCache = (cache, now) => {
  for (const [cacheKey, entry] of cache.entries()) {
    if ((entry?.expiresAt || 0) <= now && !entry?.pendingPromise) {
      cache.delete(cacheKey);
    }
  }

  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
};

const isInvalidAuthError = (error) => {
  if (error === ERR_INVALID_AUTH) return true;

  const message = String(error?.message || error || '').toLowerCase();
  return (
    message.includes('invalid auth') ||
    message.includes('auth_invalid') ||
    message.includes('unauthorized') ||
    message.includes('invalid authentication')
  );
};

const isHomeAssistantReachabilityError = (error) => {
  const message = String(error?.message || error || '').toLowerCase();
  return [...NETWORK_ERROR_PATTERNS, ...TLS_ERROR_PATTERNS].some((pattern) =>
    message.includes(pattern)
  );
};

const sendJsonError = (res, statusCode, error, code) => {
  const body = { error };
  if (code) {
    body.code = code;
  }
  res.status(statusCode).json(body);
};

const sendValidationFailure = (res, error) => {
  const message = String(error?.message || 'Home Assistant validation failed');

  if (isInvalidAuthError(error)) {
    sendJsonError(res, 401, `Home Assistant authentication failed: ${message}`, 'HA_AUTH_INVALID');
    return;
  }

  if (isHomeAssistantReachabilityError(error)) {
    sendJsonError(
      res,
      503,
      'Tunet backend could not reach Home Assistant while validating the current user.',
      'HA_VALIDATION_UNREACHABLE'
    );
    return;
  }

  sendJsonError(
    res,
    503,
    'Tunet backend could not validate the current Home Assistant session.',
    'HA_VALIDATION_FAILED'
  );
};

const createCachedAuthError = (error) => {
  if (error instanceof Error) return error;
  return new Error(String(error || 'Home Assistant authentication failed'));
};

const loadCurrentUserFromHomeAssistant = async ({ haUrl, accessToken }) => {
  const auth = createLongLivedTokenAuth(haUrl, accessToken);
  const connection = await createConnection({ auth });

  try {
    const user = await connection.sendMessagePromise({ type: 'auth/current_user' });
    if (!user?.id || typeof user.id !== 'string') {
      throw new Error('Home Assistant did not return an authenticated user');
    }

    return {
      id: user.id,
      name: user.name || '',
      is_admin: Boolean(user.is_admin),
      is_owner: Boolean(user.is_owner),
    };
  } finally {
    try {
      connection.close();
    } catch {
      // ignore close errors
    }
  }
};

export const createValidatedHomeAssistantUserResolver = ({
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  invalidAuthCacheTtlMs = DEFAULT_INVALID_AUTH_CACHE_TTL_MS,
  loadCurrentUser = loadCurrentUserFromHomeAssistant,
} = {}) => {
  const cache = new Map();

  return async ({ haUrl, accessToken }) => {
    const cacheKey = `${haUrl}::${accessToken}`;
    const now = Date.now();
    const cached = cache.get(cacheKey);

    if (cached?.user && cached.expiresAt > now) {
      return cached.user;
    }

    if (cached?.error && cached.expiresAt > now) {
      throw cached.error;
    }

    if (cached?.pendingPromise) {
      return cached.pendingPromise;
    }

    const pendingPromise = loadCurrentUser({ haUrl, accessToken })
      .then((user) => {
        const resolvedAt = Date.now();
        cache.set(cacheKey, {
          user,
          expiresAt: resolvedAt + cacheTtlMs,
        });
        pruneCache(cache, resolvedAt);
        return user;
      })
      .catch((error) => {
        if (isInvalidAuthError(error)) {
          cache.set(cacheKey, {
            error: createCachedAuthError(error),
            expiresAt: Date.now() + invalidAuthCacheTtlMs,
          });
        } else {
          cache.delete(cacheKey);
        }
        throw error;
      });

    cache.set(cacheKey, {
      pendingPromise,
      expiresAt: now + cacheTtlMs,
    });

    return pendingPromise;
  };
};

const resolveValidatedHomeAssistantUser = createValidatedHomeAssistantUserResolver();

export const createHomeAssistantAuthMiddleware = ({
  validateHomeAssistantUser = resolveValidatedHomeAssistantUser,
} = {}) => {
  return async (req, res, next) => {
    const trustedSupervisorUser = getTrustedSupervisorUser(req);
    if (trustedSupervisorUser) {
      req.authenticatedHaUser = trustedSupervisorUser;
      req.authenticatedHaUrl = null;
      next();
      return;
    }

    const haUrls = getHomeAssistantUrlCandidates(req);
    if (!haUrls.length) {
      sendJsonError(res, 401, 'Missing or invalid x-ha-url header');
      return;
    }

    const accessToken = getBearerToken(req);
    if (!accessToken) {
      sendJsonError(res, 401, 'Missing Authorization bearer token');
      return;
    }

    let lastError = null;
    let authError = null;

    for (const haUrl of haUrls) {
      try {
        const user = await validateHomeAssistantUser({ haUrl, accessToken });
        req.authenticatedHaUser = user;
        req.authenticatedHaUrl = haUrl;
        next();
        return;
      } catch (error) {
        lastError = error;
        if (!authError && isInvalidAuthError(error)) {
          authError = error;
        }
      }
    }

    sendValidationFailure(res, authError || lastError);
  };
};
