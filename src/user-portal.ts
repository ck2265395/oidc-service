import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import express, { type Request, type Response, Router } from 'express';
import type Provider from 'oidc-provider';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Pool } from 'pg';

import { AccountService } from './accounts.js';
import type { ServiceConfig } from './config.js';
import { escapeHtml } from './security.js';
import { PORTAL_CLIENT_ID } from './provider.js';

interface PortalState {
  verifier: string;
  nonce: string;
  returnTo: string;
}

interface PortalRedis {
  set(key: string, value: string, options: { EX: number; NX: true }): Promise<string | null>;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

const TAKE_PORTAL_STATE = "local value = redis.call('GET', KEYS[1]); if value then redis.call('DEL', KEYS[1]); end; return value";
const PORTAL_STATE_TTL_SECONDS = 900;
const PORTAL_JWKS = new WeakMap<Provider, ReturnType<typeof createRemoteJWKSet>>();

function loginStateKey(state: string, secret: string): string {
  return 'dt:portal:login:' + createHmac('sha256', secret).update(state, 'utf8').digest('hex');
}

function safeReturnPath(value: unknown): string {
  return value === '/portal/authorizations' ? value : '/developer';
}

function portalJwks(provider: Provider, issuer: string): ReturnType<typeof createRemoteJWKSet> {
  const existing = PORTAL_JWKS.get(provider);
  if (existing) return existing;
  const created = createRemoteJWKSet(new URL(issuer + '/jwks'));
  PORTAL_JWKS.set(provider, created);
  return created;
}

function scalar(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function cookieValue(request: Request, name: string): string | null {
  for (const entry of (request.headers.cookie ?? '').split(';')) {
    const index = entry.indexOf('=');
    if (index < 0 || entry.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(entry.slice(index + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function html(title: string, content: string): string {
  return '<!doctype html><html lang="zh-CN"><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escapeHtml(title) + ' · DT Identity</title>' +
    '<style>body{font:16px system-ui,sans-serif;max-width:48rem;margin:7vh auto;padding:0 1rem;color:#172033}' +
    'main{border:1px solid #dce3ec;border-radius:12px;padding:1.5rem}button{padding:.55rem 1rem;cursor:pointer}' +
    'li{padding:.6rem 0;border-bottom:1px solid #e6ebf1}</style><main><h1>' +
    escapeHtml(title) + '</h1>' + content + '</main></html>';
}

function error(response: Response, status: number, message: string): void {
  response.status(status).type('html').send(html('无法继续', '<p>' + escapeHtml(message) + '</p>'));
}

export function createUserPortalRouter(
  pool: Pool,
  provider: Provider,
  accounts: AccountService,
  config: ServiceConfig,
  redis: PortalRedis,
): Router {
  const router = Router();
  router.use(express.urlencoded({ extended: false, limit: '8kb', parameterLimit: 10 }));
  const secure = config.issuer.startsWith('https:');
  const csrfName = secure ? '__Host-dt-user-csrf' : 'dt-user-csrf';

  const currentSession = async (request: Request, response: Response): Promise<{ accountId: string; uuid: string } | null> => {
    try {
      const context = provider.createContext(request, response);
      const session = await provider.Session.get(context);
      const accountId = session.accountId;
      if (typeof accountId !== 'string') return null;
      const separator = accountId.lastIndexOf('.');
      if (separator < 1) return null;
      const uuid = accountId.slice(0, separator);
      const fingerprint = accountId.slice(separator + 1);
      if (!/^[A-Za-z0-9_-]{43}$/.test(fingerprint)) return null;
      const identity = await accounts.resolve(uuid, fingerprint, 'user-portal');
      return identity ? { accountId, uuid: identity.uuid } : null;
    } catch {
      return null;
    }
  };

  const csrfToken = (response: Response): string => {
    const token = randomBytes(32).toString('base64url');
    response.cookie(csrfName, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure,
      path: '/',
      maxAge: 15 * 60 * 1000,
    });
    return token;
  };

  const validatePost = (request: Request): boolean => {
    if (request.header('origin') !== new URL(config.issuer).origin) return false;
    const cookie = cookieValue(request, csrfName);
    const submitted = scalar(request.body?.csrf);
    if (!cookie || !submitted) return false;
    const left = Buffer.from(cookie);
    const right = Buffer.from(submitted);
    return left.length === right.length && timingSafeEqual(left, right);
  };

  router.get('/sign-in', async (request, response) => {
    const returnTo = safeReturnPath(request.query.return);
    if (await currentSession(request, response)) return response.redirect(303, returnTo);
    const state = randomBytes(32).toString('base64url');
    const loginState: PortalState = {
      verifier: randomBytes(32).toString('base64url'),
      nonce: randomBytes(32).toString('base64url'),
      returnTo,
    };
    try {
      const stored = await redis.set(
        loginStateKey(state, config.secrets.cookie),
        JSON.stringify(loginState),
        { EX: PORTAL_STATE_TTL_SECONDS, NX: true },
      );
      if (stored !== 'OK') throw new Error('Portal login state could not be stored');
      const challenge = createHash('sha256').update(loginState.verifier, 'utf8').digest('base64url');
      const authorization = new URL(config.issuer + '/authorize');
      authorization.searchParams.set('client_id', PORTAL_CLIENT_ID);
      authorization.searchParams.set('redirect_uri', config.issuer + '/portal/callback');
      authorization.searchParams.set('response_type', 'code');
      authorization.searchParams.set('scope', 'openid profile email');
      authorization.searchParams.set('state', state);
      authorization.searchParams.set('nonce', loginState.nonce);
      authorization.searchParams.set('code_challenge', challenge);
      authorization.searchParams.set('code_challenge_method', 'S256');
      response.redirect(303, authorization.toString());
    } catch {
      error(response, 503, '登录服务暂时不可用，请稍后重试。');
    }
  });

  router.get('/callback', async (request, response) => {
    const state = scalar(request.query.state);
    const code = scalar(request.query.code);
    if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state) || !code || code.length > 4096) {
      return error(response, 400, '登录事务无效，请重新开始。');
    }

    try {
      const stored = await redis.eval(TAKE_PORTAL_STATE, {
        keys: [loginStateKey(state, config.secrets.cookie)],
        arguments: [],
      });
      if (typeof stored !== 'string') return error(response, 400, '登录事务已失效，请重新开始。');
      const parsed = JSON.parse(stored) as unknown;
      if (
        typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) ||
        typeof (parsed as PortalState).verifier !== 'string' ||
        typeof (parsed as PortalState).nonce !== 'string' ||
        typeof (parsed as PortalState).returnTo !== 'string'
      ) return error(response, 400, '登录事务无效，请重新开始。');
      const loginState = parsed as PortalState;
      const tokenResponse = await fetch(config.issuer + '/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: config.issuer + '/portal/callback',
          client_id: PORTAL_CLIENT_ID,
          code_verifier: loginState.verifier,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!tokenResponse.ok) return error(response, 400, '登录验证失败，请重新开始。');
      const tokens = await tokenResponse.json() as Record<string, unknown>;
      if (typeof tokens.id_token !== 'string') return error(response, 400, '登录验证失败，请重新开始。');
      const verified = await jwtVerify(tokens.id_token, portalJwks(provider, config.issuer), {
        issuer: config.issuer,
        audience: PORTAL_CLIENT_ID,
        nonce: loginState.nonce,
      });
      const session = await currentSession(request, response);
      if (!session) return error(response, 401, '登录状态已失效，请重新开始。');
      const fingerprint = session.accountId.slice(session.accountId.lastIndexOf('.') + 1);
      const identity = await accounts.resolve(session.uuid, fingerprint, PORTAL_CLIENT_ID);
      if (!identity || verified.payload.sub !== identity.sub || scalar(verified.payload.nonce) !== loginState.nonce) {
        return error(response, 401, '身份验证未通过，请重新开始。');
      }
      response.redirect(303, safeReturnPath(loginState.returnTo));
    } catch {
      error(response, 503, '登录验证暂时不可用，请稍后重试。');
    }
  });

  router.get('/', (_request, response) => response.redirect(303, '/portal/authorizations'));

  router.get('/authorizations', async (request, response) => {
    const session = await currentSession(request, response);
    if (!session) return response.redirect(303, '/portal/sign-in?return=%2Fportal%2Fauthorizations');
    try {
      const result = await pool.query<{
        document_id: string;
        client_id: string | null;
        scope: string | null;
        created_at: Date;
        name: string | null;
      }>(
        "SELECT d.document_id, d.client_id, coalesce(d.payload->>'scope', d.payload->'openid'->>'scope') AS scope, d.created_at, coalesce(a.approved_config->>'name', a.draft_config->>'name') AS name FROM oidc_document d LEFT JOIN oidc_application a ON a.client_id = d.client_id AND a.status = 'approved' WHERE d.model = 'Grant' AND d.payload->>'accountId' = $1 AND (d.expires_at IS NULL OR d.expires_at > now()) ORDER BY d.created_at DESC, d.document_id LIMIT 100",
        [session.accountId],
      );
      const csrf = csrfToken(response);
      const list = result.rows.map((row) => {
        const name = row.name ?? row.client_id ?? '未知应用';
        return '<li><strong>' + escapeHtml(name) + '</strong><p>权限：' +
          escapeHtml(row.scope ?? 'openid') + '</p><form method="post" action="/authorizations/' +
          encodeURIComponent(row.document_id) + '/revoke"><input type="hidden" name="csrf" value="' +
          escapeHtml(csrf) + '"><button type="submit">撤销授权</button></form></li>';
      }).join('');
      const content = result.rows.length ? '<ul>' + list + '</ul>' : '<p>当前没有应用授权。</p>';
      response.type('html').send(html('已授权的应用', content));
    } catch {
      error(response, 503, '授权记录暂时不可用。');
    }
  });

  router.post('/authorizations/:id/revoke', async (request, response) => {
    if (!validatePost(request)) return error(response, 403, '请求校验失败，请重新打开授权页面。');
    const session = await currentSession(request, response);
    if (!session) return error(response, 401, '登录状态已失效。');
    const grantId = request.params.id;
    if (!grantId || grantId.length > 128) return error(response, 404, '授权记录不存在。');

    try {
      const row = await pool.query<{ document_id: string }>(
        "SELECT document_id FROM oidc_document WHERE model = 'Grant' AND document_id = $1 AND payload->>'accountId' = $2 LIMIT 1",
        [grantId, session.accountId],
      );
      if (row.rowCount !== 1) return error(response, 404, '授权记录不存在。');
      const grant = await provider.Grant.find(grantId);
      if (!grant || grant.accountId !== session.accountId) return error(response, 404, '授权记录不存在。');
      await grant.adapter.revokeByGrantId(grantId);
      await grant.destroy();
      await pool.query(
        "INSERT INTO platform_audit (actor_type, actor_id, action, application_id, outcome, details) SELECT 'account', $1, 'authorization.revoke', id, 'success', '{}'::jsonb FROM oidc_application WHERE client_id = $2",
        [session.uuid, grant.clientId ?? null],
      );
      response.redirect(303, '/portal/authorizations');
    } catch {
      error(response, 503, '撤销授权失败，请稍后重试。');
    }
  });

  return router;
}
