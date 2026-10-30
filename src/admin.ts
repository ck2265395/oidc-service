import { createHash, createHmac } from 'node:crypto';

import express, { type Request, type Response, Router } from 'express';
import type { Pool } from 'pg';

import type { ServiceConfig } from './config.js';
import type { ApplicationStatus, ApplicationService, ReviewCommand } from './platform.js';
import { constantTimeEqual, escapeHtml, randomToken, verifyScryptPassword } from './security.js';

const SECURE_COOKIE = '__Host-dt-admin';
const LOCAL_COOKIE = 'dt-admin';

function scalar(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function body(request: Request): Record<string, unknown> {
  return typeof request.body === 'object' && request.body !== null && !Array.isArray(request.body)
    ? request.body as Record<string, unknown>
    : {};
}

function cookie(request: Request, name: string): string | null {
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

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function ipKey(request: Request, secret: string): string {
  const address = request.socket.remoteAddress ?? 'unknown';
  return createHmac('sha256', secret).update(address, 'utf8').digest('hex');
}

function html(title: string, content: string): string {
  return '<!doctype html><html lang="zh-CN"><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escapeHtml(title) + ' · DT 管理</title>' +
    '<style>body{font:16px system-ui,sans-serif;max-width:58rem;margin:6vh auto;padding:0 1rem;color:#182235}' +
    'main{border:1px solid #dce3ec;border-radius:12px;padding:1.5rem}label{display:block;margin:1rem 0 .35rem}' +
    'input,select,textarea,button{font:inherit;padding:.65rem;box-sizing:border-box}input,textarea{width:100%}' +
    'button{margin:.7rem .5rem .2rem 0;cursor:pointer}pre{white-space:pre-wrap;background:#f3f5f7;padding:1rem}</style>' +
    '<main><nav><a href="/admin/applications">审核队列</a></nav><h1>' + escapeHtml(title) + '</h1>' + content + '</main></html>';
}

function sendError(response: Response, status: number, message: string): void {
  response.status(status).type('html').send(html('无法继续', '<p>' + escapeHtml(message) + '</p>'));
}

function requestOriginAllowed(request: Request, issuer: string): boolean {
  return request.header('origin') === new URL(issuer).origin;
}

export function createAdminRouter(
  pool: Pool,
  config: ServiceConfig,
  applications: ApplicationService,
): Router {
  const router = Router();
  router.use(express.urlencoded({ extended: false, limit: '16kb', parameterLimit: 20 }));
  router.use(express.json({ limit: '16kb' }));

  const secure = config.issuer.startsWith('https:');
  const cookieName = secure ? SECURE_COOKIE : LOCAL_COOKIE;
  const csrfCookieName = secure ? '__Host-dt-admin-csrf' : 'dt-admin-csrf';

  const csrfPageToken = (response: Response): string => {
    const token = randomToken(32);
    response.cookie(csrfCookieName, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure,
      path: '/',
      maxAge: 15 * 60 * 1000,
    });
    return token;
  };

  const validCsrf = (request: Request): boolean => {
    const expected = cookie(request, csrfCookieName);
    const actual = scalar(body(request).csrf);
    return !!expected && !!actual && constantTimeEqual(expected, actual);
  };

  const adminSession = async (request: Request): Promise<boolean> => {
    const token = cookie(request, cookieName);
    if (!token || token.length > 128) return false;
    try {
      const updated = await pool.query(
        "UPDATE admin_session SET last_activity = now() WHERE session_hash = $1 AND created_at > now() - interval '8 hours' AND last_activity > now() - interval '30 minutes' RETURNING session_hash",
        [hashToken(token)],
      );
      return updated.rowCount === 1;
    } catch {
      return false;
    }
  };

  const enforceForm = (request: Request, response: Response): boolean => {
    if (!requestOriginAllowed(request, config.issuer)) {
      sendError(response, 403, '请求来源未获允许。');
      return false;
    }
    if (!validCsrf(request)) {
      sendError(response, 403, '请求校验失败，请重新打开页面。');
      return false;
    }
    return true;
  };

  router.get('/login', (_request, response) => {
    const csrf = csrfPageToken(response);
    const form = '<form method="post" action="/admin/login"><input type="hidden" name="csrf" value="' +
      escapeHtml(csrf) + '"><label for="username">管理员账号</label><input id="username" name="username" required maxlength="128" autocomplete="username">' +
      '<label for="password">管理员密码</label><input id="password" type="password" name="password" required maxlength="1024" autocomplete="current-password">' +
      '<button type="submit">登录</button></form>';
    response.type('html').send(html('管理员登录', form));
  });

  router.post('/login', async (request, response) => {
    if (!enforceForm(request, response)) return;
    const username = scalar(body(request).username);
    const password = scalar(body(request).password);
    const key = ipKey(request, config.secrets.cookie);
    try {
      const limit = await pool.query<{ blocked: boolean }>(
        'SELECT coalesce(bool_or(blocked_until > now()), false) AS blocked FROM admin_login_limit WHERE ip_hash = $1',
        [key],
      );
      if (limit.rows[0]?.blocked) return sendError(response, 429, '登录尝试过多，请稍后再试。');
      const passwordValid = typeof password === 'string' && password.length > 0 && password.length <= 1024
        ? verifyScryptPassword(password, config.admin.passwordHash)
        : false;
      const usernameValid = typeof username === 'string' && constantTimeEqual(username, config.admin.username);
      if (!passwordValid || !usernameValid) {
        await pool.query(
          "INSERT INTO admin_login_limit (ip_hash, window_started_at, failed_attempts, blocked_until) VALUES ($1, now(), 1, NULL) ON CONFLICT (ip_hash) DO UPDATE SET window_started_at = CASE WHEN admin_login_limit.window_started_at < now() - interval '15 minutes' THEN now() ELSE admin_login_limit.window_started_at END, failed_attempts = CASE WHEN admin_login_limit.window_started_at < now() - interval '15 minutes' THEN 1 ELSE admin_login_limit.failed_attempts + 1 END, blocked_until = CASE WHEN admin_login_limit.window_started_at < now() - interval '15 minutes' THEN NULL WHEN admin_login_limit.failed_attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE admin_login_limit.blocked_until END",
          [key],
        );
        return sendError(response, 401, '管理员账号或密码不正确。');
      }

      await pool.query('DELETE FROM admin_login_limit WHERE ip_hash = $1', [key]);
      const token = randomToken(32);
      await pool.query('INSERT INTO admin_session (session_hash) VALUES ($1)', [hashToken(token)]);
      response.cookie(cookieName, token, {
        httpOnly: true,
        sameSite: 'strict',
        secure,
        path: '/',
        maxAge: 8 * 60 * 60 * 1000,
      });
      response.clearCookie(csrfCookieName, { path: '/', secure, sameSite: 'strict' });
      response.redirect(303, '/admin/applications');
    } catch {
      sendError(response, 503, '管理服务暂时不可用。');
    }
  });

  router.post('/logout', async (request, response) => {
    if (!enforceForm(request, response)) return;
    const token = cookie(request, cookieName);
    if (token) {
      try {
        await pool.query('DELETE FROM admin_session WHERE session_hash = $1', [hashToken(token)]);
      } catch {
        return sendError(response, 503, '管理服务暂时不可用。');
      }
    }
    response.clearCookie(cookieName, { path: '/', httpOnly: true, secure, sameSite: 'strict' });
    response.redirect(303, '/admin/login');
  });

  router.get('/', async (request, response) => {
    if (!await adminSession(request)) return response.redirect(303, '/admin/login');
    response.redirect(303, '/admin/applications');
  });

  router.get('/applications', async (request, response) => {
    if (!await adminSession(request)) return response.redirect(303, '/admin/login');
    const page = typeof request.query.page === 'string' && /^[1-9][0-9]*$/.test(request.query.page)
      ? Number(request.query.page)
      : 1;
    const pageSize = 20;
    const status = typeof request.query.status === 'string'
      ? request.query.status as ApplicationStatus
      : 'pending';
    if (
      !Number.isSafeInteger(page) || page < 1 ||
      !['draft', 'pending', 'rejected', 'approved', 'disabled'].includes(status)
    ) return sendError(response, 400, '筛选条件无效。');

    try {
      const result = await applications.listForAdmin(page, pageSize, status);
      const rows = result.list.map((record) =>
        '<tr><td><a href="/admin/applications/' + encodeURIComponent(record.id) + '">' +
        escapeHtml(record.draft.name) + '</a></td><td>' + escapeHtml(record.type) +
        '</td><td>' + escapeHtml(record.status) + '</td><td>' + record.revision + '</td></tr>',
      ).join('');
      const csrf = csrfPageToken(response);
      const content = '<p>状态：' + escapeHtml(status) + '；总数：' + result.total + '</p>' +
        '<table><thead><tr><th>应用</th><th>类型</th><th>状态</th><th>版本</th></tr></thead><tbody>' + rows + '</tbody></table>' +
        '<form method="post" action="/admin/logout"><input type="hidden" name="csrf" value="' + escapeHtml(csrf) +
        '"><button type="submit">退出管理员会话</button></form>';
      response.type('html').send(html('应用审核', content));
    } catch {
      sendError(response, 503, '审核队列暂时不可用。');
    }
  });

  router.get('/applications/:id', async (request, response) => {
    if (!await adminSession(request)) return response.redirect(303, '/admin/login');
    try {
      const record = await applications.getForAdmin(request.params.id);
      if (!record) return sendError(response, 404, '应用不存在。');
      const csrf = csrfPageToken(response);
      const reviewForm = record.status === 'pending'
        ? '<form method="post" action="/admin/applications/' + encodeURIComponent(record.id) + '/review">' +
          '<input type="hidden" name="csrf" value="' + escapeHtml(csrf) + '">' +
          '<input type="hidden" name="expectedRevision" value="' + record.revision + '">' +
          '<label for="reason">审核理由（驳回时必填）</label><textarea id="reason" name="reason" maxlength="2000"></textarea>' +
          '<button name="action" value="approve">批准</button><button name="action" value="reject">驳回</button></form>'
        : record.status === 'approved'
          ? '<form method="post" action="/admin/applications/' + encodeURIComponent(record.id) + '/review">' +
            '<input type="hidden" name="csrf" value="' + escapeHtml(csrf) + '">' +
            '<input type="hidden" name="expectedRevision" value="' + record.revision + '">' +
            '<label for="reason">停用理由</label><textarea id="reason" name="reason" required maxlength="2000"></textarea>' +
            '<button name="action" value="disable">停用</button></form>'
          : '';
      const content = '<p>状态：' + escapeHtml(record.status) + '；修订：' + record.revision + '</p>' +
        '<h2>当前草稿</h2><pre>' + escapeHtml(JSON.stringify(record.draft, null, 2)) + '</pre>' +
        '<h2>已批准配置</h2><pre>' + escapeHtml(JSON.stringify(record.approvedConfig, null, 2)) + '</pre>' +
        '<h2>最近审核</h2><pre>' + escapeHtml(JSON.stringify(record.lastReview, null, 2)) + '</pre>' + reviewForm;
      response.type('html').send(html('应用详情', content));
    } catch {
      sendError(response, 503, '应用详情暂时不可用。');
    }
  });

  router.post('/applications/:id/review', async (request, response) => {
    if (!enforceForm(request, response)) return;
    if (!await adminSession(request)) return sendError(response, 401, '管理员会话已过期。');
    const input = body(request);
    const action = scalar(input.action);
    const reason = scalar(input.reason);
    const revision = typeof input.expectedRevision === 'string' ? Number(input.expectedRevision) : Number.NaN;
    if (!['approve', 'reject', 'disable'].includes(String(action)) || !Number.isSafeInteger(revision)) {
      return sendError(response, 400, '审核操作无效。');
    }
    try {
      const reviewerUuid = 'admin:' + config.admin.username;
      const command: ReviewCommand = action === 'approve'
        ? { action: 'approve', reviewerUuid }
        : action === 'reject'
          ? { action: 'reject', reviewerUuid, reason: reason ?? '' }
          : { action: 'disable', reviewerUuid, reason: reason ?? '' };
      const record = await applications.review(request.params.id, revision, command);
      if (!record) return sendError(response, 404, '应用不存在。');
      response.redirect(303, '/admin/applications/' + encodeURIComponent(record.id));
    } catch {
      sendError(response, 409, '审核失败：应用状态或修订已变化，请重新打开详情。');
    }
  });

  return router;
}
