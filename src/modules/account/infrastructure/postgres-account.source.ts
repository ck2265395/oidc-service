import { Pool } from 'pg';

import type { AccountRecord, AccountSource, LoginType } from '../domain/accounts.js';

export class AccountDataError extends Error {
  constructor() { super('Account data is unavailable'); this.name = 'AccountDataError'; }
}

const SELECT_COLUMNS = '"uuid", "username", "password", "status", "nickname", "email", "profilepic"';

export function createAccountPool(connectionString: string): Pool {
  return new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 30_000, statement_timeout: 5_000, application_name: 'dt-identity-service' });
}

export class PostgresAccountSource implements AccountSource {
  constructor(private readonly pool: Pool) {}
  async findByUuid(uuid: string): Promise<AccountRecord | null> {
    try { const result = await this.pool.query<AccountRecord>(`SELECT ${SELECT_COLUMNS} FROM "USER" WHERE "uuid" = $1 LIMIT 2`, [uuid]); if (result.rows.length > 1) throw new AccountDataError(); return result.rows[0] ?? null; }
    catch { throw new AccountDataError(); }
  }
  async lookup(type: LoginType, value: string): Promise<AccountRecord[]> {
    try { return (await this.pool.query<AccountRecord>(`SELECT ${SELECT_COLUMNS} FROM "USER" WHERE ${type === 'username' ? '"username"' : '"email"'} = $1 LIMIT 2`, [value])).rows; }
    catch { throw new AccountDataError(); }
  }
  async close(): Promise<void> { await this.pool.end(); }
}
