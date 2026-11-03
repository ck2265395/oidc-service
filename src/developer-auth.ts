import { timingSafeEqual } from 'node:crypto';

import express, { Router, type Request, type Response } from 'express';

import { DeveloperAuthError, type DeveloperAuthService } from './developer-auth-service.js';
import type { DeveloperEmailCode } from './developer-email-code.js';
import type { DeveloperAccount } from './developer-identity.js';
import type { DeveloperSessionService } from './developer-session.js';
import type { PostgresDeveloperStore } from './developer-store.js';
import { normalizeDeveloperEmail } from './developer-identity.js';
import { randomToken } from './security.js';

interface AuthDependencies {
  issuer: string;
  secureCookies: boolean;
  auth: Pick<DeveloperAuthService, 'register' | 'loginWithPassword'>;
  codes: Pick<DeveloperEmailCode, 'issue'>;
  sessions: Pick<DeveloperSessionService, 'create' | 'resolve' | 'revoke'>;
  identities: Pick<PostgresDeveloperStore, 'listAuthenticationMethods'>;
}

const SESSION_COOKIE = 'md-developer';
const CSRF_COOKIE = 'md-developer-csrf';

function cookie(request: Request, name: string): string | null {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator > 0 && part.slice(0, separator).trim() === name) return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return null;
}

function jsonError(response: Response, status: number, code: string, desc: string): void {
  response.status(status).json({ code, desc, data: null });
}

function sameOrigin(request: Request, issuer: string): boolean {
  return request.header('origin') === new URL(issuer).origin;
}

function csrfValid(request: Request): boolean {
  const fromCookie = cookie(request, CSRF_COOKIE);
  const fromHeader = request.header('x-csrf-token');
  if (!fromCookie || !fromHeader) return false;
  const left = Buffer.from(fromCookie);
  const right = Buffer.from(fromHeader);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createDeveloperAuthRouter(dependencies: AuthDependencies): Router {
  const router = Router();
  router.use(express.json({ limit: '16kb' }));
  const cookieOptions = { httpOnly: true, sameSite: 'lax' as const, secure: dependencies.secureCookies, path: '/', maxAge: 7 * 24 * 60 * 60 * 1000 };

  const establish = async (response: Response, developerId: string, account?: DeveloperAccount): Promise<void> => {
    const token = await dependencies.sessions.create(developerId);
    response.cookie(SESSION_COOKIE, token, cookieOptions);
    response.json({ code: 0, desc: 'ok', data: { account: account ?? null } });
  };

  router.use((request, response, next) => {
    if (request.method === 'GET' || sameOrigin(request, dependencies.issuer)) return next();
    jsonError(response, 403, 'origin_denied', 'Request origin is not allowed');
  });

  router.post('/email-code', async (request, response) => {
    try {
      const email = normalizeDeveloperEmail(String(request.body?.email ?? ''));
      const purpose = request.body?.purpose === 'bind' || request.body?.purpose === 'reset' ? request.body.purpose : 'register';
      await dependencies.codes.issue(purpose, email, request.ip ?? 'unknown');
      response.status(202).json({ code: 0, desc: 'ok', data: 'sent' });
    } catch (error) {
      jsonError(response, error instanceof TypeError ? 400 : 429, 'email_code_unavailable', error instanceof Error ? error.message : 'Email code is unavailable');
    }
  });

  router.post('/register', async (request, response) => {
    try {
      const account = await dependencies.auth.register(String(request.body?.email ?? ''), String(request.body?.password ?? ''), String(request.body?.code ?? ''));
      await establish(response, account.id, account);
    } catch (error) {
      if (error instanceof DeveloperAuthError) return jsonError(response, 400, error.code, error.message);
      if (error instanceof TypeError) return jsonError(response, 400, 'invalid_registration', error.message);
      jsonError(response, 409, 'registration_conflict', 'Developer account could not be registered');
    }
  });

  router.post('/login', async (request, response) => {
    try {
      const credential = await dependencies.auth.loginWithPassword(String(request.body?.email ?? ''), String(request.body?.password ?? ''));
      await establish(response, credential.developerId);
    } catch (error) {
      if (error instanceof TypeError || error instanceof DeveloperAuthError) {
        return jsonError(response, 401, 'invalid_credentials', 'Email or password is incorrect');
      }
      jsonError(response, 503, 'authentication_unavailable', 'Developer authentication is unavailable');
    }
  });

  router.get('/session', async (request, response) => {
    const token = cookie(request, SESSION_COOKIE);
    const account = token ? await dependencies.sessions.resolve(token) : null;
    const authenticationMethods = account ? await dependencies.identities.listAuthenticationMethods(account.id) : [];
    const csrfToken = randomToken();
    response.cookie(CSRF_COOKIE, csrfToken, { ...cookieOptions, sameSite: 'strict', maxAge: 30 * 60 * 1000 });
    response.json({ code: 0, desc: 'ok', data: { account, authenticationMethods, csrfToken } });
  });

  router.post('/logout', async (request, response) => {
    if (!csrfValid(request)) return jsonError(response, 403, 'csrf_denied', 'Request verification failed');
    const token = cookie(request, SESSION_COOKIE);
    if (token) await dependencies.sessions.revoke(token);
    response.clearCookie(SESSION_COOKIE, { ...cookieOptions, maxAge: undefined });
    response.json({ code: 0, desc: 'ok', data: null });
  });

  return router;
}
