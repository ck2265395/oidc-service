import { createHash } from 'node:crypto';

import { type Request, type Response, Router } from 'express';
import type Provider from 'oidc-provider';
import type { Pool } from 'pg';

import { AccountService, safeProfilePictureUrl } from './accounts.js';
import type { ServiceConfig } from './config.js';
import { readCookie, setConsoleCsrf } from './http-security.js';

function maskedEmail(value: string | null): string | null {
  if (!value) return null;
  const at = value.indexOf('@');
  return at > 0 ? value.slice(0, 1) + '***' + value.slice(at) : '***';
}

async function accountSummary(
  request: Request,
  response: Response,
  provider: Provider,
  accounts: AccountService,
  pictureBaseUrl: string | null,
): Promise<Record<string, unknown> | null> {
  try {
    const session = await provider.Session.get(provider.createContext(request, response));
    if (typeof session.accountId !== 'string') return null;
    const separator = session.accountId.lastIndexOf('.');
    if (separator < 1) return null;
    const uuid = session.accountId.slice(0, separator);
    const fingerprint = session.accountId.slice(separator + 1);
    if (!/^[A-Za-z0-9_-]{43}$/.test(fingerprint)) return null;
    const identity = await accounts.resolve(uuid, fingerprint, 'console-bootstrap');
    if (!identity) return null;
    return {
      uuid: identity.uuid,
      nickname: identity.profile.nickname,
      email: maskedEmail(identity.profile.email),
      picture: safeProfilePictureUrl(identity.profile.picture, pictureBaseUrl),
    };
  } catch {
    return null;
  }
}

export async function adminSessionAuthenticated(request: Request, pool: Pool, secure: boolean): Promise<boolean> {
  const token = readCookie(request, secure ? '__Host-dt-admin' : 'dt-admin');
  if (!token || token.length > 128) return false;
  try {
    const sessionHash = createHash('sha256').update(token, 'utf8').digest('hex');
    const result = await pool.query(
      "UPDATE admin_session SET last_activity = now() WHERE session_hash = $1 AND created_at > now() - interval '8 hours' AND last_activity > now() - interval '30 minutes' RETURNING session_hash",
      [sessionHash],
    );
    return result.rowCount === 1;
  } catch {
    return false;
  }
}

async function adminSummary(request: Request, pool: Pool, username: string, secure: boolean): Promise<Record<string, unknown>> {
  return await adminSessionAuthenticated(request, pool, secure)
    ? { authenticated: true, username }
    : { authenticated: false };
}

export function createSessionApiRouter(
  provider: Provider,
  accounts: AccountService,
  adminPool: Pool,
  config: ServiceConfig,
): Router {
  const router = Router();
  router.get('/', async (request, response) => {
    const [account, admin] = await Promise.all([
      accountSummary(request, response, provider, accounts, config.profilePictureBaseUrl),
      adminSummary(request, adminPool, config.admin.username, config.issuer.startsWith('https:')),
    ]);
    const csrfToken = setConsoleCsrf(response, config.issuer.startsWith('https:'));
    response.json({
      code: 0,
      desc: 'ok',
      data: { account, admin, csrfToken },
    });
  });
  return router;
}
