import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';

@Injectable()
export class OidcAuditService {
  constructor(private readonly pool: Pool) {}
  async record(event: { requestId: string; endpoint: string; outcome: 'success'|'denied'|'failure'; status: number; durationMs: number; clientId: string|null }): Promise<void> {
    const details = JSON.stringify({ endpoint: event.endpoint, status: event.status, durationMs: event.durationMs });
    await this.pool.query("WITH client AS (SELECT id FROM oidc_application WHERE client_id = $5) INSERT INTO platform_audit (request_id, actor_type, actor_id, action, application_id, outcome, details, created_at) SELECT $1, 'system', 'oidc', $2, id, $3, $4::jsonb, now() FROM client UNION ALL SELECT $1, 'system', 'oidc', $2, NULL, $3, $4::jsonb, now() WHERE NOT EXISTS (SELECT 1 FROM client)", [event.requestId, 'protocol.' + event.endpoint.slice(1), event.outcome, details, event.clientId]);
  }
}
