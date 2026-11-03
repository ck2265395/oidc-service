import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';

import type { ServiceConfig } from '../../config.js';
import type { ApplicationGroupService } from '../../groups.js';
import { consoleMutationAllowed, readCookie } from '../../http-security.js';
import type { ApplicationService } from '../../platform.js';
import type { PostgresDeveloperStore } from '../../developer-store.js';

export interface AdminAuthPort { authenticated(request: Request): Promise<boolean>; mutationAllowed(request: Request): boolean; logout(request: Request, response: Response): Promise<void>; }
export interface AdminAuditPort { overview(): Promise<unknown>; list(page: number): Promise<unknown>; statistics(days: number): Promise<unknown>; recordDeveloperReview(id: string, action: string): Promise<void>; }

@Injectable()
export class AdminService {
  constructor(readonly config: ServiceConfig, readonly auth: AdminAuthPort, readonly applications: ApplicationService, readonly groups: ApplicationGroupService, readonly developers: Pick<PostgresDeveloperStore, 'listForAdmin' | 'getForAdmin' | 'reviewDeveloper'>, readonly audit: AdminAuditPort) {}
}

export class PostgresAdminAuth implements AdminAuthPort {
  constructor(private readonly pool: Pool, private readonly config: ServiceConfig) {}
  async authenticated(request: Request): Promise<boolean> {
    const token = readCookie(request, this.config.issuer.startsWith('https:') ? '__Host-dt-admin' : 'dt-admin');
    if (!token || token.length > 128) return false;
    try {
      const digest = createHash('sha256').update(token, 'utf8').digest('hex');
      const result = await this.pool.query("UPDATE admin_session SET last_activity = now() WHERE session_hash = $1 AND created_at > now() - interval '8 hours' AND last_activity > now() - interval '30 minutes' RETURNING session_hash", [digest]);
      return result.rowCount === 1;
    } catch { return false; }
  }
  mutationAllowed(request: Request): boolean { return consoleMutationAllowed(request, this.config.issuer); }
  async logout(request: Request, response: Response): Promise<void> { const secure = this.config.issuer.startsWith('https:'); const name = secure ? '__Host-dt-admin' : 'dt-admin'; const token = readCookie(request, name); if (token) await this.pool.query('DELETE FROM admin_session WHERE session_hash = $1', [createHash('sha256').update(token).digest('hex')]); response.clearCookie(name, { path: '/', httpOnly: true, secure, sameSite: 'strict' }); }
}

export class PostgresAdminAudit implements AdminAuditPort {
  constructor(private readonly pool: Pool, private readonly config: ServiceConfig) {}
  async overview(): Promise<unknown> { const [applications, groups, audit] = await Promise.all([this.pool.query<{status:string;count:string}>('SELECT status, count(*)::text AS count FROM oidc_application GROUP BY status'), this.pool.query<{status:string;count:string}>('SELECT status, count(*)::text AS count FROM oidc_application_group GROUP BY status'), this.pool.query('SELECT created_at, action, outcome, actor_type FROM platform_audit ORDER BY created_at DESC, id DESC LIMIT 8')]); return { applications: Object.fromEntries(applications.rows.map((row) => [row.status, Number(row.count)])), groups: Object.fromEntries(groups.rows.map((row) => [row.status, Number(row.count)])), recentAudit: audit.rows }; }
  async list(page: number): Promise<unknown> { const result = await this.pool.query('SELECT created_at, actor_type, actor_id, action, application_id, outcome, details FROM platform_audit ORDER BY created_at DESC, id DESC LIMIT 50 OFFSET $1', [(page - 1) * 50]); return { page, list: result.rows }; }
  async statistics(days: number): Promise<unknown> { const result = await this.pool.query("SELECT p.action, p.outcome, count(*)::int AS request_count, round(avg((p.details->>'durationMs')::numeric), 1)::float8 AS average_ms, round(percentile_cont(0.95) WITHIN GROUP (ORDER BY (p.details->>'durationMs')::double precision)::numeric, 1)::float8 AS p95_ms FROM platform_audit p WHERE p.action LIKE 'protocol.%' AND p.created_at >= now() - ($1::int * interval '1 day') GROUP BY p.action, p.outcome ORDER BY count(*) DESC LIMIT 200", [days]); return { days, list: result.rows }; }
  async recordDeveloperReview(id: string, action: string): Promise<void> { await this.pool.query("INSERT INTO platform_audit (actor_type, actor_id, action, outcome, details) VALUES ('admin', $1, 'developer.review', 'success', $2::jsonb)", [`admin:${this.config.admin.username}`, JSON.stringify({ developerId: id, action })]); }
}
