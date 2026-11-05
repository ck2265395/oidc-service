import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import express, { type Request, type Response, Router } from 'express';
import type Provider from 'oidc-provider';

import type { AccountService } from '../../account/application/account-identity.service.js';
import type { LoginType } from '../../account/domain/accounts.js';
import { accountHandle, PORTAL_CLIENT_ID } from './provider.factory.js';
import type { ApplicationService } from '../../application/application/application-management.service.js';
import type { DeveloperService } from '../../developer/developer.service.js';
import { LoginRateLimitError, type RedisLoginRateLimiter } from './login-rate-limiter.js';
import { escapeHtml } from '../../../common/security/security.js';

const COOKIE_NAME = '__Host-dt-csrf';
const LOCAL_COOKIE_NAME = 'dt-csrf';
const ALLOWED_SCOPES = new Set(['openid', 'profile', 'email']);

interface FormBody {
  [key: string]: unknown;
}

function scalar(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const entry of header.split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 0 || entry.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(entry.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function csrfToken(uid: string, nonce: string, key: string): string {
  return createHmac('sha256', key)
    .update(uid, 'utf8')
    .update('\0')
    .update(nonce, 'utf8')
    .digest('base64url');
}

function validCsrf(request: Request, uid: string, key: string, secure: boolean): boolean {
  const nonce = cookieValue(request, secure ? COOKIE_NAME : LOCAL_COOKIE_NAME);
  const submitted = scalar((request.body as FormBody | undefined)?.csrf);
  if (!nonce || !submitted) return false;
  const expected = csrfToken(uid, nonce, key);
  const left = Buffer.from(submitted, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function setCsrf(response: Response, uid: string, key: string, secure: boolean): string {
  const nonce = randomBytes(32).toString('base64url');
  response.cookie(secure ? COOKIE_NAME : LOCAL_COOKIE_NAME, nonce, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    path: '/',
    maxAge: 15 * 60 * 1000,
  });
  return csrfToken(uid, nonce, key);
}

function page(title: string, content: string): string {
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escapeHtml(title) + ' · MOONDROP</title>' +
    '<link rel="icon" href="/assets/moondrop.ico"><link rel="stylesheet" href="/assets/identity.css"></head><body><div class="identity-shell">' +
    '<header><a class="identity-brand" href="/"><img src="/assets/moondrop.ico" alt="MOONDROP" width="36" height="36" style="object-fit:contain;border-radius:8px"><strong>MOONDROP<small>统一身份平台</small></strong></a>' +
    '<div class="security-label"><i></i>安全连接 / Secure connection</div></header>' +
    '<main class="identity-card"><div class="identity-heading"><span>IDENTITY ACCESS</span><h1>' + escapeHtml(title) + '</h1></div>' +
    content + '<footer>由 MOONDROP 提供安全认证 · Secured by OpenID Connect</footer></main>' +
    '<p class="identity-copyright">© 2026 MOONDROP</p></div></body></html>';
}

function errorPage(response: Response, status = 400): void {
  response.status(status).type('html').send(
    page('无法继续 / Unable to continue', '<p>此登录或授权请求已失效，请从应用重新开始。 / This sign-in or authorization request has expired. Start again from the application.</p>'),
  );
}

function stringParam(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 4096 ? value : null;
}

function requestedScopes(value: unknown, allowed: readonly string[]): string[] | null {
  if (typeof value !== 'string') return null;
  const scopes = [...new Set(value.split(/\s+/).filter(Boolean))];
  if (!scopes.includes('openid') || scopes.some((scope) => !ALLOWED_SCOPES.has(scope) || !allowed.includes(scope))) {
    return null;
  }
  return scopes;
}

export function createInteractionRouter(
  provider: Provider,
  accounts: AccountService,
  applications: ApplicationService,
  developers: Pick<DeveloperService, 'profile'>,
  csrfKey: string,
  secureCookies: boolean,
  rateLimiter: RedisLoginRateLimiter,
  accountPortal: { registrationUrl: string | null; passwordResetUrl: string | null; profileUrl: string | null } | null = null,
): Router {
  const router = Router();
  router.use(express.urlencoded({ extended: false, limit: '16kb', parameterLimit: 20 }));

  router.get('/:uid', async (request, response) => {
    try {
      const details = await provider.interactionDetails(request, response);
      if (details.uid !== request.params.uid) return errorPage(response);
      const clientId = stringParam(details.params.client_id);
      if (!clientId) return errorPage(response);
      const isPortalClient = clientId === PORTAL_CLIENT_ID;
      const active = isPortalClient ? null : await applications.activeClient(clientId);
      if (!isPortalClient && !active) return errorPage(response);

      const clientName = active?.config.name ?? 'MOONDROP';
      const csrf = setCsrf(response, details.uid, csrfKey, secureCookies);
      if (details.prompt.name === 'login') {
        const form = '<p class="muted">继续使用 / Continue signing in with ' + escapeHtml(clientName) + '</p>' +
          '<form method="post" action="/interaction/' + encodeURIComponent(details.uid) + '/login">' +
          '<input type="hidden" name="csrf" value="' + escapeHtml(csrf) + '">' +
          '<label for="identifierType">登录方式 / Sign-in method</label><select id="identifierType" name="identifierType">' +
          '<option value="username">用户名 / Username</option><option value="email">邮箱 / Email</option></select>' +
          '<label for="identifier">用户名或邮箱 / Username or email</label><input id="identifier" name="identifier" required maxlength="254" autocomplete="username">' +
          '<label for="password">密码 / Password</label><input id="password" type="password" name="password" required maxlength="1024" autocomplete="current-password">' +
          '<button type="submit">登录并继续 / Sign in and continue</button></form>' +
          '<nav aria-label="账号管理 / Account options">' +
          (accountPortal?.registrationUrl ? '<a href="' + escapeHtml(accountPortal.registrationUrl) + '" target="_blank" rel="noopener noreferrer">注册账号 / Register</a> ' : '') +
          (accountPortal?.passwordResetUrl ? '<a href="' + escapeHtml(accountPortal.passwordResetUrl) + '" target="_blank" rel="noopener noreferrer">忘记密码 / Reset password</a> ' : '') +
          '</nav>';
        return response.type('html').send(page('登录 / Sign in', form));
      }

      if (details.prompt.name === 'consent') {
        const scopes = requestedScopes(details.params.scope, active?.config.scopes ?? ['openid', 'profile', 'email']);
        if (!scopes) return errorPage(response);
        const developer = active
          ? await developers.profile(active.record.ownerUuid)
          : { displayName: 'MOONDROP' };
        if (!developer) return errorPage(response);
        const scopeNames: Record<string, string> = {
          openid: '识别你的身份 / Identify you',
          profile: '昵称和头像 / Nickname and profile picture',
          email: '邮箱地址 / Email address',
        };
        const list = scopes.map((scope) => '<li>' + escapeHtml(scopeNames[scope] ?? scope) + '</li>').join('');
        const form = '<p><strong>' + escapeHtml(clientName) + '</strong> 请求以下权限 / requests these permissions:</p>' +
          '<dl><dt>开发者 / Developer</dt><dd>' + escapeHtml(developer.displayName) + '</dd>' +
          (active ? '<dt>用途 / Purpose</dt><dd>' + escapeHtml(active.config.purpose) + '</dd></dl>' +
            '<p><a href="' + escapeHtml(active.config.homepageUrl) + '" target="_blank" rel="noopener noreferrer">应用主页 / Homepage</a> · ' +
            '<a href="' + escapeHtml(active.config.privacyUrl) + '" target="_blank" rel="noopener noreferrer">隐私政策 / Privacy</a> · ' +
            '<a href="' + escapeHtml(active.config.termsUrl) + '" target="_blank" rel="noopener noreferrer">服务条款 / Terms</a></p>' : '</dl>') +
          '<ul>' + list + '</ul>' +
          '<form method="post" action="/interaction/' + encodeURIComponent(details.uid) + '/consent">' +
          '<input type="hidden" name="csrf" value="' + escapeHtml(csrf) + '">' +
          '<button type="submit" name="decision" value="allow">全部同意 / Allow all</button>' +
          '<button type="submit" name="decision" value="deny">拒绝 / Deny</button></form>';
        return response.type('html').send(page('授权确认 / Consent', form));
      }

      return errorPage(response);
    } catch {
      return errorPage(response, 503);
    }
  });

  router.post('/:uid/login', async (request, response) => {
    if (!validCsrf(request, request.params.uid, csrfKey, secureCookies)) return errorPage(response, 403);
    const typeValue = scalar((request.body as FormBody | undefined)?.identifierType);
    const type = typeValue === 'username' || typeValue === 'email' ? typeValue as LoginType : null;
    const identifier = scalar((request.body as FormBody | undefined)?.identifier);
    const password = scalar((request.body as FormBody | undefined)?.password);
    if (!type || !identifier || !password) return errorPage(response);

    try {
      const details = await provider.interactionDetails(request, response);
      if (details.uid !== request.params.uid || details.prompt.name !== 'login') return errorPage(response);
      const clientId = stringParam(details.params.client_id);
      if (!clientId) return errorPage(response);
      const isPortalClient = clientId === PORTAL_CLIENT_ID;
      const active = isPortalClient ? null : await applications.activeClient(clientId);
      if (!isPortalClient && !active) return errorPage(response);
      const sourceAddress = request.ip || request.socket.remoteAddress || 'unknown';
      const identity = await accounts.authenticate(
        { type, value: identifier },
        password,
        active?.config.groupId ?? clientId,
        (accountUuid) => rateLimiter.consume(accountUuid, type, identifier, sourceAddress),
      );
      if (!identity) return response.status(401).type('html').send(
        page('登录失败 / Sign-in failed', '<p>登录信息不正确或账号当前不可用。 / Sign-in details are incorrect or the account is unavailable.</p><p><a href="/interaction/' +
          encodeURIComponent(details.uid) + '">返回重试 / Try again</a></p>'),
      );
      await provider.interactionFinished(request, response, {
        login: { accountId: accountHandle(identity.uuid, identity.fingerprint), remember: true, ts: Math.floor(Date.now() / 1000) },
      });
    } catch (error) {
      if (error instanceof LoginRateLimitError) {
        response.setHeader('Retry-After', String(error.retryAfterSeconds));
        return response.status(429).type('html').send(page('请稍后重试 / Try again later', '<p>登录尝试次数过多，请稍后再试。 / Too many sign-in attempts. Try again later.</p>'));
      }
      return errorPage(response, 503);
    }
  });

  router.post('/:uid/consent', async (request, response) => {
    if (!validCsrf(request, request.params.uid, csrfKey, secureCookies)) return errorPage(response, 403);
    try {
      const details = await provider.interactionDetails(request, response);
      if (details.uid !== request.params.uid || details.prompt.name !== 'consent') return errorPage(response);
      const decision = scalar((request.body as FormBody | undefined)?.decision);
      if (decision === 'deny') {
        await provider.interactionFinished(request, response, {
          error: 'access_denied',
          error_description: 'The account holder declined the request',
        });
        return;
      }
      if (decision !== 'allow') return errorPage(response);
      const accountId = details.session?.accountId;
      const clientId = stringParam(details.params.client_id);
      if (!accountId || !clientId) return errorPage(response);
      const isPortalClient = clientId === PORTAL_CLIENT_ID;
      const active = isPortalClient ? null : await applications.activeClient(clientId);
      if (!isPortalClient && !active) return errorPage(response);
      const scopes = requestedScopes(details.params.scope, active?.config.scopes ?? ['openid', 'profile', 'email']);
      if (!scopes) return errorPage(response);
      const grant = new provider.Grant({ accountId, clientId });
      grant.addOIDCScope(scopes);
      const grantId = await grant.save();
      await provider.interactionFinished(request, response, { consent: { grantId } });
    } catch {
      return errorPage(response, 503);
    }
  });

  return router;
}
