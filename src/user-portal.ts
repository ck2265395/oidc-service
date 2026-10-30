import { randomBytes, timingSafeEqual } from 'node:crypto';

import express, { type Request, type Response, Router } from 'express';
import type Provider from 'oidc-provider';
import type { Pool } from 'pg';

import { AccountService } from './accounts.js';
import type { ServiceConfig } from './config.js';
import { escapeHtml } from './security.js';

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

  router.get('/authorizations', async (request, response) => {
    const session = await currentSession(request, response);
    if (!session) return error(response, 401, '请先通过身份服务登录。');
    try {
      const result = await pool.query<{
        document_id: string;
        client_id: string | null;
        scope: string | null;
        created_at: Date;
        name: string | null;
      }>(
        "SELECT d.document_id, d.client_id, coalesce(d.payload->>'scope', d.payload->'openid'->>'scope') AS scope, d.created_at, coalesce(a.approved_config->>'name', a.draft_config->>'name') AS name FROM oidc_document d LEFT JOIN oidc_application a ON a.client_id = d.client_id AND a.status = 'approved' WHERE d.model = 'Grant' AND d.payload->>'accountId' = $1 ORDER BY d.created_at DESC, d.document_id LIMIT 100",
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
