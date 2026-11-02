import { type Request, type Response, Router } from 'express';
import type Provider from 'oidc-provider';
import type { Pool } from 'pg';

import type { ServiceConfig } from './config.js';
import { consoleMutationAllowed } from './http-security.js';

interface AccountSession { accountId: string; uuid: string }

async function accountSession(provider: Provider, request: Request, response: Response): Promise<AccountSession | null> {
  try {
    const session = await provider.Session.get(provider.createContext(request, response));
    if (typeof session.accountId !== 'string') return null;
    const separator = session.accountId.lastIndexOf('.');
    if (separator < 1 || !/^[A-Za-z0-9_-]{43}$/.test(session.accountId.slice(separator + 1))) return null;
    return { accountId: session.accountId, uuid: session.accountId.slice(0, separator) };
  } catch { return null; }
}

export function createAccountApiRouter(pool: Pool, provider: Provider, config: ServiceConfig): Router {
  const router = Router();
  router.get('/authorizations', async (request, response) => {
    const session = await accountSession(provider, request, response);
    if (!session) return response.status(401).json({ code: 'authentication_required', desc: 'Sign in is required', data: null });
    try {
      const result = await pool.query<{
        document_id: string; client_id: string | null; scope: string | null; created_at: Date;
        name: string | null; status: string | null;
      }>(
        "SELECT d.document_id, d.client_id, coalesce(d.payload->>'scope', d.payload->'openid'->>'scope') AS scope, " +
        "d.created_at, coalesce(a.approved_config->>'name', a.draft_config->>'name') AS name, a.status " +
        "FROM oidc_document d LEFT JOIN oidc_application a ON a.client_id = d.client_id AND a.status = 'approved' " +
        "WHERE d.model = 'Grant' AND d.payload->>'accountId' = $1 AND (d.expires_at IS NULL OR d.expires_at > now()) " +
        'ORDER BY d.created_at DESC, d.document_id LIMIT 100',
        [session.accountId],
      );
      response.json({ code: 0, desc: 'ok', data: result.rows.map((row) => ({
        id: row.document_id, clientId: row.client_id, name: row.name ?? row.client_id ?? '平台门户',
        scopes: (row.scope ?? 'openid').split(' ').filter(Boolean), status: row.status ?? 'platform',
        authorizedAt: new Date(row.created_at).toISOString(),
      })) });
    } catch {
      response.status(503).json({ code: 'storage_unavailable', desc: 'Authorization data is unavailable', data: null });
    }
  });

  router.delete('/authorizations/:id', async (request, response) => {
    if (!consoleMutationAllowed(request, config.issuer)) return response.status(403).json({ code: 'csrf_denied', desc: 'Request verification failed', data: null });
    const session = await accountSession(provider, request, response);
    if (!session) return response.status(401).json({ code: 'authentication_required', desc: 'Sign in is required', data: null });
    const grantId = request.params.id;
    if (!grantId || grantId.length > 128) return response.status(404).json({ code: 'not_found', desc: 'Authorization not found', data: null });
    try {
      const selected = await pool.query<{ document_id: string }>(
        "SELECT document_id FROM oidc_document WHERE model = 'Grant' AND document_id = $1 AND payload->>'accountId' = $2 LIMIT 1",
        [grantId, session.accountId],
      );
      if (selected.rowCount !== 1) return response.status(404).json({ code: 'not_found', desc: 'Authorization not found', data: null });
      const grant = await provider.Grant.find(grantId);
      if (!grant || grant.accountId !== session.accountId) return response.status(404).json({ code: 'not_found', desc: 'Authorization not found', data: null });
      await grant.adapter.revokeByGrantId(grantId);
      await grant.destroy();
      await pool.query(
        "INSERT INTO platform_audit (actor_type, actor_id, action, application_id, outcome, details) SELECT 'account', $1, 'authorization.revoke', id, 'success', '{}'::jsonb FROM oidc_application WHERE client_id = $2",
        [session.uuid, grant.clientId ?? null],
      );
      response.json({ code: 0, desc: 'ok', data: { revoked: true } });
    } catch {
      response.status(503).json({ code: 'revoke_failed', desc: 'Revocation failed', data: null });
    }
  });
  return router;
}
