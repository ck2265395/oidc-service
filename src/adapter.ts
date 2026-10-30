import type { Adapter, AdapterFactory, AdapterPayload } from 'oidc-provider';
import type { Pool } from 'pg';

import type { ApplicationService } from './platform.js';

interface StoredRow {
  payload: AdapterPayload;
}

function toPayload(value: unknown): AdapterPayload | undefined {
  if (typeof value === 'string') {
    try {
      return toPayload(JSON.parse(value) as unknown);
    } catch {
      return undefined;
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as AdapterPayload;
}

export class PostgresOidcAdapter implements Adapter {
  constructor(
    private readonly model: string,
    private readonly pool: Pool,
    private readonly applications: ApplicationService,
  ) {}

  async upsert(id: string, payload: AdapterPayload, expiresIn?: number): Promise<void> {
    if (this.model === 'Client') {
      throw new Error('OIDC adapter write rejected');
    }
    const ttl = this.model === 'ReplayDetection' && (!Number.isSafeInteger(expiresIn) || (expiresIn as number) < 1)
      ? 60
      : expiresIn;
    const expiry = Number.isSafeInteger(ttl) && (ttl as number) > 0
      ? new Date(Date.now() + (ttl as number) * 1000).toISOString()
      : null;
    try {
      const result = await this.pool.query(
        'INSERT INTO oidc_document (model, document_id, payload, expires_at, grant_id, account_uuid, client_id) ' +
        'VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7) ' +
        'ON CONFLICT (model, document_id) DO UPDATE SET payload = EXCLUDED.payload, ' +
        'expires_at = EXCLUDED.expires_at, grant_id = EXCLUDED.grant_id, ' +
        'account_uuid = EXCLUDED.account_uuid, client_id = EXCLUDED.client_id ' +
        "WHERE $1 <> 'ReplayDetection' OR oidc_document.expires_at <= now()",
        [
          this.model,
          id,
          JSON.stringify(payload),
          expiry,
          typeof payload.grantId === 'string' ? payload.grantId : null,
          typeof payload.accountId === 'string' ? payload.accountId : null,
          typeof payload.clientId === 'string' ? payload.clientId : null,
        ],
      );
      if (result.rowCount !== 1) throw new Error('OIDC replay rejected');
    } catch {
      throw new Error('OIDC storage write failed');
    }
  }

  async find(id: string): Promise<AdapterPayload | undefined> {
    if (this.model === 'Client') return this.findApprovedClient(id);
    return this.fetch('document_id = $1', [id]);
  }

  async findByUserCode(userCode: string): Promise<AdapterPayload | undefined> {
    return this.fetch("payload->>'userCode' = $1", [userCode]);
  }

  async findByUid(uid: string): Promise<AdapterPayload | undefined> {
    return this.fetch("payload->>'uid' = $1", [uid]);
  }

  async consume(id: string): Promise<void> {
    try {
      await this.pool.query(
        "UPDATE oidc_document SET payload = jsonb_set(payload, '{consumed}', to_jsonb(floor(extract(epoch from now()))::bigint), true) WHERE model = $1 AND document_id = $2 AND (expires_at IS NULL OR expires_at > now())",
        [this.model, id],
      );
    } catch {
      throw new Error('OIDC storage update failed');
    }
  }

  async destroy(id: string): Promise<void> {
    try {
      await this.pool.query('DELETE FROM oidc_document WHERE model = $1 AND document_id = $2', [this.model, id]);
    } catch {
      throw new Error('OIDC storage delete failed');
    }
  }

  async revokeByGrantId(grantId: string): Promise<void> {
    try {
      await this.pool.query(
        'DELETE FROM oidc_document WHERE grant_id = $1 OR (model = $2 AND document_id = $1)',
        [grantId, this.model],
      );
    } catch {
      throw new Error('OIDC storage revoke failed');
    }
  }

  private async fetch(where: string, values: string[]): Promise<AdapterPayload | undefined> {
    try {
      const result = await this.pool.query<StoredRow>(
        'SELECT payload FROM oidc_document WHERE model = $1 AND ' + where +
        ' AND (expires_at IS NULL OR expires_at > now()) LIMIT 1',
        [this.model, ...values],
      );
      return toPayload(result.rows[0]?.payload);
    } catch {
      throw new Error('OIDC storage read failed');
    }
  }

  private async findApprovedClient(clientId: string): Promise<AdapterPayload | undefined> {
    try {
      const active = await this.applications.activeClient(clientId);
      if (!active) return undefined;
      const clientSecret = active.record.type === 'web'
        ? await this.applications.getClientSecret(clientId)
        : null;
      if (active.record.type === 'web' && !clientSecret) return undefined;
      return {
        client_id: active.record.clientId,
        client_name: active.config.name,
        client_uri: active.config.homepageUrl,
        policy_uri: active.config.privacyUrl,
        tos_uri: active.config.termsUrl,
        logo_uri: active.config.iconUrl ?? undefined,
        redirect_uris: active.config.redirectUris,
        post_logout_redirect_uris: active.config.postLogoutRedirectUris,
        response_types: ['code'],
        grant_types: ['authorization_code'],
        scope: active.config.scopes.join(' '),
        token_endpoint_auth_method: active.record.type === 'web' ? 'client_secret_basic' : 'none',
        ...(clientSecret ? { client_secret: clientSecret } : {}),
        application_type: active.record.type === 'native' ? 'native' : 'web',
        id_token_signed_response_alg: 'RS256',
      };
    } catch {
      throw new Error('OIDC client lookup failed');
    }
  }
}

export function createOidcAdapterFactory(
  pool: Pool,
  applications: ApplicationService,
): AdapterFactory {
  return (model: string): Adapter => new PostgresOidcAdapter(model, pool, applications);
}
