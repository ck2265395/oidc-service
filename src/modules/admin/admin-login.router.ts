import { createHash, createHmac } from 'node:crypto';

import express, { type Request, type Response, Router } from 'express';
import type { Pool } from 'pg';

import type { ServiceConfig } from '../../infrastructure/config/config.schema.js';
import { readCookie } from '../../common/security/http-security.js';
import { constantTimeEqual, escapeHtml, randomToken } from '../../common/security/security.js';
import type { AdminAuthenticationService } from './application/admin-authentication.service.js';
import type { PostgresAdminRepository } from './infrastructure/admin.repository.js';

function scalar(value: unknown): string | null { return typeof value === 'string' ? value : null; }
function body(request: Request): Record<string, unknown> { return typeof request.body === 'object' && request.body !== null && !Array.isArray(request.body) ? request.body as Record<string, unknown> : {}; }
function hashToken(token: string): string { return createHash('sha256').update(token, 'utf8').digest('hex'); }
function ipKey(request: Request, secret: string): string { return createHmac('sha256', secret).update(request.ip || request.socket.remoteAddress || 'unknown', 'utf8').digest('hex'); }

function html(title: string, content: string): string {
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escapeHtml(title) + ' · MOONDROP</title><link rel="icon" href="/assets/moondrop.ico">' +
    '<style>:root{font-family:Inter,"Segoe UI","Microsoft YaHei",sans-serif;color:#182133;background:#f4f6f9}' +
    '*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:28px;background:radial-gradient(circle at 75% 15%,#e9efff,transparent 34%),#f4f6f9}' +
    'main{width:min(440px,100%);background:#fff;border:1px solid #e1e6ee;border-radius:16px;padding:34px;box-shadow:0 25px 70px #26385c14}' +
    'main:before{content:"";display:block;width:42px;height:42px;border-radius:10px;background:url(/assets/moondrop.ico) center/contain no-repeat}' +
    'h1{font-size:25px;letter-spacing:-.04em;margin:22px 0 8px}label{display:block;margin:18px 0 7px;color:#5d697d;font-size:12px}' +
    'input,button{font:inherit;box-sizing:border-box}input{width:100%;border:1px solid #dce2eb;border-radius:8px;padding:12px;outline:none}' +
    'input:focus{border-color:#3157d5;box-shadow:0 0 0 3px #3157d512}button{width:100%;border:0;border-radius:8px;padding:12px;margin-top:20px;background:#3157d5;color:#fff;font-weight:700;cursor:pointer}' +
    'p{color:#6f7b90;font-size:13px;line-height:1.65}</style></head><body><main><h1>' + escapeHtml(title) + '</h1>' + content + '</main></body></html>';
}

function sendError(response: Response, status: number, message: string): void { response.status(status).type('html').send(html('无法继续', '<p>' + escapeHtml(message) + '</p>')); }

function requestOriginAllowed(request: Request, issuer: string): boolean {
  const expected = new URL(issuer).origin;
  const origin = request.header('origin');
  if (origin && origin !== 'null') return origin === expected;
  if (origin === 'null') return request.header('sec-fetch-site') === 'same-origin';
  const referer = request.header('referer');
  if (referer) { try { return new URL(referer).origin === expected; } catch { return false; } }
  return request.header('sec-fetch-site') === 'same-origin';
}

export function createAdminLoginRouter(
  pool: Pool,
  config: ServiceConfig,
  authentication: Pick<AdminAuthenticationService, 'login'>,
  administrators: Pick<PostgresAdminRepository, 'createSession'>,
): Router {
  const router = Router();
  router.use(express.urlencoded({ extended: false, limit: '16kb', parameterLimit: 20 }));
  router.use(express.json({ limit: '16kb' }));
  const secure = config.issuer.startsWith('https:');
  const cookieName = secure ? '__Host-dt-admin' : 'dt-admin';
  const csrfCookieName = secure ? '__Host-dt-admin-csrf' : 'dt-admin-csrf';

  const csrfPageToken = (response: Response): string => {
    const token = randomToken(32);
    response.cookie(csrfCookieName, token, { httpOnly: true, sameSite: 'strict', secure, path: '/', maxAge: 15 * 60 * 1000 });
    return token;
  };
  const validCsrf = (request: Request): boolean => {
    const expected = readCookie(request, csrfCookieName); const actual = scalar(body(request).csrf);
    return !!expected && !!actual && constantTimeEqual(expected, actual);
  };
  const enforceForm = (request: Request, response: Response): boolean => {
    if (!requestOriginAllowed(request, config.issuer)) { sendError(response, 403, '请求来源未获允许。'); return false; }
    if (!validCsrf(request)) { sendError(response, 403, '请求校验失败，请重新打开页面。'); return false; }
    return true;
  };

  router.get('/login', (_request, response) => {
    const csrf = csrfPageToken(response);
    const form = '<form method="post" action="/admin/login"><input type="hidden" name="csrf" value="' + escapeHtml(csrf) + '">' +
      '<p>使用平台管理员凭据登录统一身份控制台。</p><label for="username">管理员账号</label><input id="username" name="username" required maxlength="128" autocomplete="username">' +
      '<label for="password">管理员密码</label><input id="password" type="password" name="password" required maxlength="1024" autocomplete="current-password">' +
      '<button type="submit">登录管理后台</button></form>';
    response.type('html').send(html('管理员登录', form));
  });

  router.post('/login', async (request, response) => {
    if (!enforceForm(request, response)) return;
    const username = scalar(body(request).username); const password = scalar(body(request).password);
    const key = ipKey(request, config.secrets.cookie);
    try {
      const limit = await pool.query<{ blocked: boolean }>('SELECT coalesce(bool_or(blocked_until > now()), false) AS blocked FROM admin_login_limit WHERE ip_hash = $1', [key]);
      if (limit.rows[0]?.blocked) return sendError(response, 429, '登录尝试过多，请稍后再试。');
      const principal = await authentication.login(username, password);
      if (!principal) {
        await pool.query("INSERT INTO admin_login_limit (ip_hash, window_started_at, failed_attempts, blocked_until) VALUES ($1, now(), 1, NULL) ON CONFLICT (ip_hash) DO UPDATE SET window_started_at = CASE WHEN admin_login_limit.window_started_at < now() - interval '15 minutes' THEN now() ELSE admin_login_limit.window_started_at END, failed_attempts = CASE WHEN admin_login_limit.window_started_at < now() - interval '15 minutes' THEN 1 ELSE admin_login_limit.failed_attempts + 1 END, blocked_until = CASE WHEN admin_login_limit.window_started_at < now() - interval '15 minutes' THEN NULL WHEN admin_login_limit.failed_attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE admin_login_limit.blocked_until END", [key]);
        return sendError(response, 401, '管理员账号或密码不正确。');
      }
      await pool.query('DELETE FROM admin_login_limit WHERE ip_hash = $1', [key]);
      const token = randomToken(32);
      await administrators.createSession(principal.id, hashToken(token));
      response.cookie(cookieName, token, { httpOnly: true, sameSite: 'strict', secure, path: '/', maxAge: 8 * 60 * 60 * 1000 });
      response.clearCookie(csrfCookieName, { path: '/', secure, sameSite: 'strict' });
      response.redirect(303, '/admin/applications');
    } catch { sendError(response, 503, '管理服务暂时不可用。'); }
  });

  return router;
}
