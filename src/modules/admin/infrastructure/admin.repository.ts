import type { Pool, PoolClient } from 'pg';

import type { AdminCredential, AdminPrincipal, AdminRole, AdminStatus, AdministratorRecord } from '../domain/administrator.js';

type Queryable = Pick<Pool, 'query'> & Partial<Pick<Pool, 'connect'>>;

function administrator(row: { id: string; username: string; role: AdminRole; status: AdminStatus; must_change_password: boolean; created_at?: Date | string; updated_at?: Date | string }): AdministratorRecord {
  return {
    id: row.id, username: row.username, role: row.role, status: row.status, mustChangePassword: row.must_change_password,
    ...(row.created_at ? { createdAt: new Date(row.created_at).toISOString() } : {}),
    ...(row.updated_at ? { updatedAt: new Date(row.updated_at).toISOString() } : {}),
  };
}

export class PostgresAdminRepository {
  constructor(private readonly pool: Queryable) {}

  async findCredential(username: string): Promise<AdminCredential | null> {
    const normalized = username.trim().toLowerCase();
    if (!normalized || normalized.length > 128) return null;
    const result = await this.pool.query<{
      id: string; username: string; password_hash: string; role: AdminRole; status: AdminStatus; must_change_password: boolean;
    }>('SELECT id, username, password_hash, role, status, must_change_password FROM platform_admin WHERE username_normalized = $1 LIMIT 1', [normalized]);
    const row = result.rows[0];
    return row ? {
      principal: { id: row.id, username: row.username, role: row.role, mustChangePassword: row.must_change_password },
      passwordHash: row.password_hash,
      status: row.status,
    } : null;
  }

  async createLocalDefault(id: string, username: string, passwordHash: string): Promise<boolean> {
    const normalized = username.trim().toLowerCase();
    const result = await this.pool.query(
      "INSERT INTO platform_admin (id, username, username_normalized, password_hash, role, status, must_change_password) SELECT $1, $2, $3, $4, $5, 'active', true WHERE NOT EXISTS (SELECT 1 FROM platform_admin) ON CONFLICT (username_normalized) DO NOTHING",
      [id, username, normalized, passwordHash, 'super_admin'],
    );
    return result.rowCount === 1;
  }

  async createAdministrator(id: string, username: string, passwordHash: string, role: AdminRole = 'super_admin', mustChangePassword = false): Promise<AdministratorRecord> {
    const displayName = username.trim();
    const result = await this.pool.query<Parameters<typeof administrator>[0]>(
      "INSERT INTO platform_admin (id, username, username_normalized, password_hash, role, status, must_change_password) VALUES ($1, $2, $3, $4, $5, 'active', $6) RETURNING id, username, role, status, must_change_password, created_at, updated_at",
      [id, displayName, displayName.toLowerCase(), passwordHash, role, mustChangePassword],
    );
    return result.rows[0] ? administrator(result.rows[0]) : { id, username: displayName, role, status: 'active', mustChangePassword };
  }

  async createManagedAdministrator(actorId: string, id: string, username: string, passwordHash: string, role: AdminRole): Promise<AdministratorRecord> {
    const displayName = username.trim();
    return this.transactional(async (client) => {
      const result = await client.query<Parameters<typeof administrator>[0]>(
        "INSERT INTO platform_admin (id, username, username_normalized, password_hash, role, status, must_change_password) VALUES ($1, $2, $3, $4, $5, 'active', true) RETURNING id, username, role, status, must_change_password, created_at, updated_at",
        [id, displayName, displayName.toLowerCase(), passwordHash, role],
      );
      const created = result.rows[0];
      if (!created) throw new Error('Administrator was not created');
      await this.audit(client, actorId, 'administrator.create', id, { role });
      return administrator(created);
    });
  }

  async listAdministrators(page: number, pageSize: number): Promise<{ total: number; list: AdministratorRecord[] }> {
    const [count, rows] = await Promise.all([
      this.pool.query<{ total: string }>('SELECT count(*)::text AS total FROM platform_admin'),
      this.pool.query<Parameters<typeof administrator>[0]>('SELECT id, username, role, status, must_change_password, created_at, updated_at FROM platform_admin ORDER BY created_at, id LIMIT $1 OFFSET $2', [pageSize, (page - 1) * pageSize]),
    ]);
    return { total: Number(count.rows[0]?.total ?? 0), list: rows.rows.map(administrator) };
  }

  private async transactional<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!this.pool.connect) throw new Error('Administrator mutations require a PostgreSQL pool');
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); await client.query('LOCK TABLE platform_admin IN SHARE ROW EXCLUSIVE MODE'); const value = await work(client); await client.query('COMMIT'); return value; }
    catch (cause) { await client.query('ROLLBACK'); throw cause; }
    finally { client.release(); }
  }

  private async audit(client: PoolClient, actorId: string, action: string, targetId: string, details: Record<string, unknown> = {}): Promise<void> {
    await client.query("INSERT INTO platform_audit (actor_type, actor_id, action, outcome, details) VALUES ('admin', $1, $2, 'success', $3::jsonb)", [`admin:${actorId}`, action, JSON.stringify({ administratorId: targetId, ...details })]);
  }

  async setStatus(actorId: string, targetId: string, status: AdminStatus): Promise<AdministratorRecord | null> {
    return this.transactional(async (client) => {
      const current = await client.query<{ role: AdminRole; status: AdminStatus }>('SELECT role, status FROM platform_admin WHERE id = $1 FOR UPDATE', [targetId]);
      const row = current.rows[0];
      if (!row) return null;
      if (status === 'disabled' && row.role === 'super_admin' && row.status === 'active') {
        const active = await client.query<{ total: string }>("SELECT count(*)::text AS total FROM platform_admin WHERE role = 'super_admin' AND status = 'active'");
        if (Number(active.rows[0]?.total ?? 0) <= 1) return null;
      }
      const result = await client.query<Parameters<typeof administrator>[0]>('UPDATE platform_admin SET status = $2, updated_at = now() WHERE id = $1 RETURNING id, username, role, status, must_change_password, created_at, updated_at', [targetId, status]);
      if (status === 'disabled') await client.query('DELETE FROM admin_session WHERE admin_id = $1', [targetId]);
      await this.audit(client, actorId, 'administrator.status', targetId, { status });
      return result.rows[0] ? administrator(result.rows[0]) : null;
    });
  }

  async setRole(actorId: string, targetId: string, role: AdminRole): Promise<AdministratorRecord | null> {
    return this.transactional(async (client) => {
      const current = await client.query<{ role: AdminRole; status: AdminStatus }>('SELECT role, status FROM platform_admin WHERE id = $1 FOR UPDATE', [targetId]);
      const row = current.rows[0];
      if (!row) return null;
      if (row.role === 'super_admin' && role !== 'super_admin' && row.status === 'active') {
        const active = await client.query<{ total: string }>("SELECT count(*)::text AS total FROM platform_admin WHERE role = 'super_admin' AND status = 'active'");
        if (Number(active.rows[0]?.total ?? 0) <= 1) return null;
      }
      const result = await client.query<Parameters<typeof administrator>[0]>('UPDATE platform_admin SET role = $2, updated_at = now() WHERE id = $1 RETURNING id, username, role, status, must_change_password, created_at, updated_at', [targetId, role]);
      await client.query('DELETE FROM admin_session WHERE admin_id = $1', [targetId]);
      await this.audit(client, actorId, 'administrator.role', targetId, { role });
      return result.rows[0] ? administrator(result.rows[0]) : null;
    });
  }

  async resetPassword(actorId: string, targetId: string, passwordHash: string): Promise<boolean> {
    return this.transactional(async (client) => {
      const result = await client.query('UPDATE platform_admin SET password_hash = $2, must_change_password = true, updated_at = now() WHERE id = $1', [targetId, passwordHash]);
      if (!result.rowCount) return false;
      await client.query('DELETE FROM admin_session WHERE admin_id = $1', [targetId]);
      await this.audit(client, actorId, 'administrator.password.reset', targetId);
      return true;
    });
  }

  async changeOwnPassword(targetId: string, passwordHash: string): Promise<void> {
    await this.transactional(async (client) => {
      await client.query('UPDATE platform_admin SET password_hash = $2, must_change_password = false, updated_at = now() WHERE id = $1', [targetId, passwordHash]);
      await client.query('DELETE FROM admin_session WHERE admin_id = $1', [targetId]);
      await this.audit(client, targetId, 'administrator.password.change', targetId);
    });
  }

  async createSession(adminId: string, sessionHash: string): Promise<void> {
    await this.pool.query('INSERT INTO admin_session (admin_id, session_hash) VALUES ($1, $2)', [adminId, sessionHash]);
  }

  async resolveSession(sessionHash: string): Promise<AdminPrincipal | null> {
    const result = await this.pool.query<{ id: string; username: string; role: AdminRole; must_change_password: boolean }>(
      "UPDATE admin_session s SET last_activity = now() FROM platform_admin a WHERE s.session_hash = $1 AND s.admin_id = a.id AND a.status = 'active' AND s.created_at > now() - interval '8 hours' AND s.last_activity > now() - interval '30 minutes' RETURNING a.id, a.username, a.role, a.must_change_password",
      [sessionHash],
    );
    const row = result.rows[0];
    return row ? { id: row.id, username: row.username, role: row.role, mustChangePassword: row.must_change_password } : null;
  }

  async deleteSession(sessionHash: string): Promise<void> {
    await this.pool.query('DELETE FROM admin_session WHERE session_hash = $1', [sessionHash]);
  }
}
