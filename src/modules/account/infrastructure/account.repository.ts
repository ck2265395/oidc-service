import { createHash } from 'node:crypto';

import type { Request } from 'express';
import type { Pool } from 'pg';

import { readCookie } from '../../../http-security.js';
import type { ServiceConfig } from '../../../config.js';
import type { AccountRepositoryPort, AuthorizationView } from '../application/account.service.js';

export class AccountRepository implements AccountRepositoryPort {
  constructor(private readonly pool: Pool, private readonly config: ServiceConfig) {}

  async listAuthorizations(accountId: string): Promise<AuthorizationView[]> {
    const result = await this.pool.query<{
      document_id: string; client_id: string | null; scope: string | null; created_at: Date; name: string | null; status: string | null;
    }>(
      "SELECT d.document_id, d.client_id, coalesce(d.payload->>'scope', d.payload->'openid'->>'scope') AS scope, d.created_at, " +
      "coalesce(a.approved_config->>'name', a.draft_config->>'name') AS name, a.status FROM oidc_document d " +
      "LEFT JOIN oidc_application a ON a.client_id = d.client_id AND a.status = 'approved' WHERE d.model = 'Grant' " +
      "AND d.payload->>'accountId' = $1 AND (d.expires_at IS NULL OR d.expires_at > now()) ORDER BY d.created_at DESC, d.document_id LIMIT 100",
      [accountId],
    );
    return result.rows.map((row) => ({
      id: row.document_id, clientId: row.client_id, name: row.name ?? row.client_id ?? '平台门户',
      scopes: (row.scope ?? 'openid').split(' ').filter(Boolean), status: row.status ?? 'platform', authorizedAt: new Date(row.created_at).toISOString(),
    }));
  }

  async authorizationOwned(id: string, accountId: string): Promise<boolean> {
    const result = await this.pool.query(
      "SELECT document_id FROM oidc_document WHERE model = 'Grant' AND document_id = $1 AND payload->>'accountId' = $2 LIMIT 1",
      [id, accountId],
    );
    return result.rowCount === 1;
  }

  async recordRevocation(uuid: string, clientId: string | null): Promise<void> {
    await this.pool.query(
      "INSERT INTO platform_audit (actor_type, actor_id, action, application_id, outcome, details) SELECT 'account', $1, 'authorization.revoke', id, 'success', '{}'::jsonb FROM oidc_application WHERE client_id = $2",
      [uuid, clientId],
    );
  }

  async adminAuthenticated(request: Request): Promise<boolean> {
    const secure = this.config.issuer.startsWith('https:');
    const token = readCookie(request, secure ? '__Host-dt-admin' : 'dt-admin');
    if (!token || token.length > 128) return false;
    const digest = createHash('sha256').update(token, 'utf8').digest('hex');
    const result = await this.pool.query("UPDATE admin_session SET last_activity = now() WHERE session_hash = $1 AND created_at > now() - interval '8 hours' AND last_activity > now() - interval '30 minutes' RETURNING session_hash", [digest]);
    return result.rowCount === 1;
  }
}
