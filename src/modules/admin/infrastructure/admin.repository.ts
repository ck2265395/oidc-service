import type { Pool } from 'pg';

import type { AdminCredential, AdminPrincipal } from '../domain/administrator.js';

type Queryable = Pick<Pool, 'query'>;

export class PostgresAdminRepository {
  constructor(private readonly pool: Queryable) {}

  async findCredential(username: string): Promise<AdminCredential | null> {
    const normalized = username.trim().toLowerCase();
    if (!normalized || normalized.length > 128) return null;
    const result = await this.pool.query<{
      id: string; username: string; password_hash: string; status: 'active' | 'disabled'; must_change_password: boolean;
    }>('SELECT id, username, password_hash, status, must_change_password FROM platform_admin WHERE username_normalized = $1 LIMIT 1', [normalized]);
    const row = result.rows[0];
    return row ? {
      principal: { id: row.id, username: row.username, mustChangePassword: row.must_change_password },
      passwordHash: row.password_hash,
      status: row.status,
    } : null;
  }

  async createLocalDefault(id: string, username: string, passwordHash: string): Promise<boolean> {
    const normalized = username.trim().toLowerCase();
    const result = await this.pool.query(
      "INSERT INTO platform_admin (id, username, username_normalized, password_hash, status, must_change_password) SELECT $1, $2, $3, $4, 'active', true WHERE NOT EXISTS (SELECT 1 FROM platform_admin) ON CONFLICT (username_normalized) DO NOTHING",
      [id, username, normalized, passwordHash],
    );
    return result.rowCount === 1;
  }

  async createSession(adminId: string, sessionHash: string): Promise<void> {
    await this.pool.query('INSERT INTO admin_session (admin_id, session_hash) VALUES ($1, $2)', [adminId, sessionHash]);
  }

  async resolveSession(sessionHash: string): Promise<AdminPrincipal | null> {
    const result = await this.pool.query<{ id: string; username: string; must_change_password: boolean }>(
      "UPDATE admin_session s SET last_activity = now() FROM platform_admin a WHERE s.session_hash = $1 AND s.admin_id = a.id AND a.status = 'active' AND s.created_at > now() - interval '8 hours' AND s.last_activity > now() - interval '30 minutes' RETURNING a.id, a.username, a.must_change_password",
      [sessionHash],
    );
    const row = result.rows[0];
    return row ? { id: row.id, username: row.username, mustChangePassword: row.must_change_password } : null;
  }

  async deleteSession(sessionHash: string): Promise<void> {
    await this.pool.query('DELETE FROM admin_session WHERE session_hash = $1', [sessionHash]);
  }
}
