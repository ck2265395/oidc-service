import { randomUUID } from 'node:crypto';

import type { PoolClient, QueryResult } from 'pg';

import type { DeveloperCredential } from './developer-auth-service.js';
import type { DeveloperAccount, PasswordDigest } from './developer-identity.js';

interface Queryable {
  query<T extends object = Record<string, unknown>>(sql: string, values?: readonly unknown[]): Promise<QueryResult<T>>;
}

export interface DeveloperPool extends Queryable {
  connect(): Promise<PoolClient>;
}

interface AccountRow {
  id: string;
  status: string;
  revision: string | number;
  last_review: unknown | null;
  submitted_at: Date | string | null;
  approved_at: Date | string | null;
}

export interface CreateEmailAccountInput {
  emailNormalized: string;
  emailDisplay: string;
  passwordDigest: PasswordDigest;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapAccount(row: AccountRow): DeveloperAccount {
  const revision = Number(row.revision);
  if (
    !row.id || !['unsubmitted', 'pending', 'approved', 'rejected', 'disabled'].includes(row.status) ||
    !Number.isSafeInteger(revision) || revision < 1
  ) throw new Error('Developer account storage returned invalid data');
  return {
    id: row.id,
    status: row.status as DeveloperAccount['status'],
    revision,
    lastReview: row.last_review as DeveloperAccount['lastReview'],
    submittedAt: iso(row.submitted_at),
    approvedAt: iso(row.approved_at),
  };
}

export class PostgresDeveloperStore {
  constructor(
    private readonly pool: DeveloperPool,
    private readonly createId: () => string = randomUUID,
  ) {}

  async createEmailAccount(input: CreateEmailAccountInput): Promise<DeveloperAccount> {
    const client = await this.pool.connect();
    const id = this.createId();
    try {
      await client.query('BEGIN');
      const created = await client.query<AccountRow>(
        "INSERT INTO developer_account (id, status) VALUES ($1, 'unsubmitted') RETURNING id, status, revision, last_review, submitted_at, approved_at",
        [id],
      );
      const account = created.rows[0];
      if (!account) throw new Error('Developer account could not be created');
      await client.query(
        'INSERT INTO developer_password_credential (developer_id, email_normalized, email_display, password_digest) VALUES ($1, $2, $3, $4::jsonb)',
        [id, input.emailNormalized, input.emailDisplay, JSON.stringify(input.passwordDigest)],
      );
      await client.query(
        'INSERT INTO developer_profile (account_uuid, developer_id, display_name, contact_email, contact_email_verified, purpose) VALUES ($1, $1, $2, $3, true, $4)',
        [id, input.emailDisplay.split('@')[0] ?? input.emailDisplay, input.emailDisplay, ''],
      );
      await client.query('COMMIT');
      return mapAccount(account);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async resolveSession(sessionHash: string): Promise<DeveloperAccount | null> {
    if (!/^[a-f0-9]{64}$/.test(sessionHash)) return null;
    const result = await this.pool.query<AccountRow>(
      "SELECT a.id, a.status, a.revision, a.last_review, a.submitted_at, a.approved_at FROM developer_session s JOIN developer_account a ON a.id = s.developer_id WHERE s.session_hash = $1 AND s.revoked_at IS NULL AND s.absolute_expires_at > now() AND s.last_activity > now() - interval '7 days' LIMIT 1",
      [sessionHash],
    );
    const row = result.rows[0];
    return row ? mapAccount(row) : null;
  }

  async findCredentialByEmail(emailNormalized: string): Promise<DeveloperCredential | null> {
    const result = await this.pool.query<{
      developer_id: string;
      email_normalized: string;
      password_digest: PasswordDigest | string;
      status: string;
    }>(
      'SELECT c.developer_id, c.email_normalized, c.password_digest, a.status FROM developer_password_credential c JOIN developer_account a ON a.id = c.developer_id WHERE c.email_normalized = $1 LIMIT 1',
      [emailNormalized],
    );
    const row = result.rows[0];
    if (!row || !['unsubmitted', 'pending', 'approved', 'rejected', 'disabled'].includes(row.status)) return null;
    const digest = typeof row.password_digest === 'string' ? JSON.parse(row.password_digest) as PasswordDigest : row.password_digest;
    return {
      developerId: row.developer_id,
      emailNormalized: row.email_normalized,
      passwordDigest: digest,
      status: row.status as DeveloperCredential['status'],
    };
  }

  async createSession(developerId: string, sessionHash: string, absoluteExpiresAt: Date): Promise<void> {
    await this.pool.query(
      'INSERT INTO developer_session (session_hash, developer_id, absolute_expires_at) VALUES ($1, $2, $3)',
      [sessionHash, developerId, absoluteExpiresAt],
    );
  }

  async touchSession(sessionHash: string): Promise<void> {
    await this.pool.query(
      "UPDATE developer_session SET last_activity = now() WHERE session_hash = $1 AND revoked_at IS NULL AND absolute_expires_at > now() AND last_activity > now() - interval '7 days'",
      [sessionHash],
    );
  }

  async revokeSession(sessionHash: string): Promise<void> {
    await this.pool.query(
      'UPDATE developer_session SET revoked_at = coalesce(revoked_at, now()) WHERE session_hash = $1',
      [sessionHash],
    );
  }

  async revokeAllSessions(developerId: string): Promise<void> {
    await this.pool.query(
      'UPDATE developer_session SET revoked_at = coalesce(revoked_at, now()) WHERE developer_id = $1',
      [developerId],
    );
  }

  async findByExternalIdentity(provider: 'moondrop', subject: string): Promise<DeveloperAccount | null> {
    if (!subject || subject.length > 255) return null;
    const result = await this.pool.query<AccountRow>(
      'SELECT a.id, a.status, a.revision, a.last_review, a.submitted_at, a.approved_at FROM developer_external_identity e JOIN developer_account a ON a.id = e.developer_id WHERE e.provider = $1 AND e.subject = $2 LIMIT 1',
      [provider, subject],
    );
    const row = result.rows[0];
    return row ? mapAccount(row) : null;
  }
}
