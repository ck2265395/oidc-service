import type { Pool } from 'pg';

export interface AdminAuditPort {
  overview(): Promise<unknown>;
  list(page: number): Promise<unknown>;
  statistics(days: number): Promise<unknown>;
  recordDeveloperReview(id: string, action: string, administratorId: string): Promise<void>;
}

export class PostgresAdminAudit implements AdminAuditPort {
  constructor(private readonly pool: Pool) {}
  async overview(): Promise<unknown> { const [applications, groups, audit] = await Promise.all([this.pool.query<{status:string;count:string}>('SELECT status, count(*)::text AS count FROM oidc_application GROUP BY status'), this.pool.query<{status:string;count:string}>('SELECT status, count(*)::text AS count FROM oidc_application_group GROUP BY status'), this.pool.query('SELECT created_at, action, outcome, actor_type FROM platform_audit ORDER BY created_at DESC, id DESC LIMIT 8')]); return { applications: Object.fromEntries(applications.rows.map((row) => [row.status, Number(row.count)])), groups: Object.fromEntries(groups.rows.map((row) => [row.status, Number(row.count)])), recentAudit: audit.rows }; }
  async list(page: number): Promise<unknown> { const result = await this.pool.query('SELECT created_at, actor_type, actor_id, action, application_id, outcome, details FROM platform_audit ORDER BY created_at DESC, id DESC LIMIT 50 OFFSET $1', [(page - 1) * 50]); return { page, list: result.rows }; }
  async statistics(days: number): Promise<unknown> { const result = await this.pool.query("SELECT p.action, p.outcome, count(*)::int AS request_count, round(avg((p.details->>'durationMs')::numeric), 1)::float8 AS average_ms, round(percentile_cont(0.95) WITHIN GROUP (ORDER BY (p.details->>'durationMs')::double precision)::numeric, 1)::float8 AS p95_ms FROM platform_audit p WHERE p.action LIKE 'protocol.%' AND p.created_at >= now() - ($1::int * interval '1 day') GROUP BY p.action, p.outcome ORDER BY count(*) DESC LIMIT 200", [days]); return { days, list: result.rows }; }
  async recordDeveloperReview(id: string, action: string, administratorId: string): Promise<void> { await this.pool.query("INSERT INTO platform_audit (actor_type, actor_id, action, outcome, details) VALUES ('admin', $1, 'developer.review', 'success', $2::jsonb)", [`admin:${administratorId}`, JSON.stringify({ developerId: id, action })]); }
}
