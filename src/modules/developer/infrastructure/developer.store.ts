import { randomUUID } from 'node:crypto';

import type { PoolClient, QueryResult } from 'pg';

import type { DeveloperCredential } from '../../developer-auth/application/credential.service.js';
import { assertDeveloperTransition, type DeveloperAccount, type DeveloperProfile, type DeveloperReviewAction, type PasswordDigest } from '../domain/developer-identity.js';

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

interface ProfileRow {
  developer_id: string;
  display_name: string;
  contact_email: string;
  contact_email_verified: boolean;
  contact_phone: string | null;
  purpose: string;
  revision: string | number;
}

export class DeveloperReviewError extends Error {
  constructor(readonly code: 'not_found' | 'profile_incomplete' | 'profile_locked' | 'review_conflict' | 'reason_required' | 'invalid_transition') {
    super(code);
  }
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

function mapProfile(row: ProfileRow): DeveloperProfile {
  return {
    developerId: row.developer_id,
    displayName: row.display_name,
    contactEmail: row.contact_email,
    contactEmailVerified: row.contact_email_verified,
    contactPhone: row.contact_phone,
    purpose: row.purpose,
    revision: Number(row.revision),
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
        'INSERT INTO developer_profile (account_uuid, developer_id, display_name, contact_email, contact_email_verified, purpose) VALUES ($1, $2, $3, $4, true, $5)',
        [id, id, input.emailDisplay.split('@')[0] ?? input.emailDisplay, input.emailDisplay, ''],
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

  async createExternalAccount(provider: 'moondrop', subject: string): Promise<DeveloperAccount> {
    if (!subject || subject.length > 255) throw new TypeError('External identity is invalid');
    const client = await this.pool.connect();
    const developerId = this.createId();
    try {
      await client.query('BEGIN');
      const created = await client.query<AccountRow>(
        "INSERT INTO developer_account (id, status) VALUES ($1, 'unsubmitted') RETURNING id, status, revision, last_review, submitted_at, approved_at",
        [developerId],
      );
      const account = created.rows[0];
      if (!account) throw new Error('Developer account could not be created');
      await client.query(
        'INSERT INTO developer_profile (account_uuid, developer_id, display_name, contact_email, contact_email_verified, purpose) VALUES ($1, $1, $2, $3, false, $4)',
        [developerId, 'MOONDROP 开发者', '', ''],
      );
      await client.query(
        'INSERT INTO developer_external_identity (id, developer_id, provider, subject) VALUES ($1, $2, $3, $4)',
        [this.createId(), developerId, provider, subject],
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

  async bindExternalIdentity(developerId: string, provider: 'moondrop', subject: string): Promise<void> {
    if (!subject || subject.length > 255) throw new TypeError('External identity is invalid');
    await this.pool.query(
      'INSERT INTO developer_external_identity (id, developer_id, provider, subject) VALUES ($1, $2, $3, $4)',
      [this.createId(), developerId, provider, subject],
    );
  }

  async listAuthenticationMethods(developerId: string): Promise<Array<'email' | 'moondrop'>> {
    const result = await this.pool.query<{ has_email: boolean; has_moondrop: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM developer_password_credential WHERE developer_id = $1) AS has_email, EXISTS (SELECT 1 FROM developer_external_identity WHERE developer_id = $1 AND provider = 'moondrop') AS has_moondrop",
      [developerId],
    );
    const row = result.rows[0];
    if (!row) return [];
    return [
      ...(row.has_email ? ['email' as const] : []),
      ...(row.has_moondrop ? ['moondrop' as const] : []),
    ];
  }

  async submitReview(developerId: string, expectedRevision: number): Promise<DeveloperAccount> {
    return this.changeReviewStatus(developerId, expectedRevision, 'submit', null, null);
  }

  async reviewDeveloper(
    developerId: string,
    expectedRevision: number,
    action: Exclude<DeveloperReviewAction, 'submit'>,
    reviewerId: string,
    reason: string | null,
  ): Promise<DeveloperAccount> {
    const normalizedReason = reason?.trim() || null;
    if ((action === 'reject' || action === 'disable') && !normalizedReason) {
      throw new DeveloperReviewError('reason_required');
    }
    return this.changeReviewStatus(developerId, expectedRevision, action, reviewerId, normalizedReason);
  }

  async listForAdmin(status: DeveloperAccount['status'], page: number, pageSize: number): Promise<{ total: number; list: unknown[] }> {
    const offset = (page - 1) * pageSize;
    const result = await this.pool.query<{
      id: string; status: DeveloperAccount['status']; revision: string | number; submitted_at: Date | string | null;
      display_name: string; contact_email: string; identity_types: string[]; review_count: string | number; total_count: string | number;
    }>(
      "SELECT a.id, a.status, a.revision, a.submitted_at, p.display_name, p.contact_email, ARRAY_REMOVE(ARRAY[CASE WHEN c.developer_id IS NOT NULL THEN 'email' END, CASE WHEN e.developer_id IS NOT NULL THEN 'moondrop' END], NULL) AS identity_types, (SELECT count(*) FROM developer_review_history h WHERE h.developer_id = a.id)::int AS review_count, count(*) OVER()::int AS total_count FROM developer_account a JOIN developer_profile p ON p.developer_id = a.id LEFT JOIN developer_password_credential c ON c.developer_id = a.id LEFT JOIN developer_external_identity e ON e.developer_id = a.id WHERE a.status = $1 ORDER BY a.submitted_at DESC NULLS LAST, a.created_at DESC LIMIT $2 OFFSET $3",
      [status, pageSize, offset],
    );
    return {
      total: Number(result.rows[0]?.total_count ?? 0),
      list: result.rows.map((row) => ({
        id: row.id, status: row.status, revision: Number(row.revision), submittedAt: iso(row.submitted_at),
        displayName: row.display_name, contactEmail: row.contact_email, identityTypes: row.identity_types, reviewCount: Number(row.review_count),
      })),
    };
  }

  async getForAdmin(developerId: string): Promise<{ account: DeveloperAccount; profile: DeveloperProfile; history: unknown[] } | null> {
    const accountResult = await this.pool.query<AccountRow>(
      'SELECT id, status, revision, last_review, submitted_at, approved_at FROM developer_account WHERE id = $1 LIMIT 1', [developerId],
    );
    const accountRow = accountResult.rows[0];
    if (!accountRow) return null;
    const [profileResult, historyResult] = await Promise.all([
      this.pool.query<ProfileRow>('SELECT developer_id, display_name, contact_email, contact_email_verified, contact_phone, purpose, revision FROM developer_profile WHERE developer_id = $1 LIMIT 1', [developerId]),
      this.pool.query('SELECT action, from_status, to_status, reviewer_id, reason, profile_snapshot, revision, created_at FROM developer_review_history WHERE developer_id = $1 ORDER BY created_at DESC, id DESC', [developerId]),
    ]);
    const profileRow = profileResult.rows[0];
    if (!profileRow) return null;
    return { account: mapAccount(accountRow), profile: mapProfile(profileRow), history: historyResult.rows };
  }

  async getProfile(developerId: string): Promise<DeveloperProfile | null> {
    const result = await this.pool.query<ProfileRow>(
      'SELECT developer_id, display_name, contact_email, contact_email_verified, contact_phone, purpose, revision FROM developer_profile WHERE developer_id = $1 LIMIT 1',
      [developerId],
    );
    return result.rows[0] ? mapProfile(result.rows[0]) : null;
  }

  async saveProfile(developerId: string, input: {
    displayName: string; contactEmail: string; contactEmailVerified?: boolean;
    contactPhone: string | null; purpose: string; expectedRevision: number;
  }): Promise<DeveloperProfile> {
    const account = await this.pool.query<AccountRow>(
      'SELECT id, status, revision, last_review, submitted_at, approved_at FROM developer_account WHERE id = $1 LIMIT 1', [developerId],
    );
    const accountRow = account.rows[0];
    if (!accountRow) throw new DeveloperReviewError('not_found');
    if (accountRow.status !== 'unsubmitted' && accountRow.status !== 'rejected') throw new DeveloperReviewError('profile_locked');
    const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
    const contactEmail = typeof input.contactEmail === 'string' ? input.contactEmail.trim() : '';
    const purpose = typeof input.purpose === 'string' ? input.purpose.trim() : '';
    const contactPhone = typeof input.contactPhone === 'string' ? input.contactPhone.trim() || null : null;
    if (!displayName || displayName.length > 100 || !contactEmail || contactEmail.length > 254 || purpose.length > 2000 || (contactPhone && contactPhone.length > 50)) {
      throw new DeveloperReviewError('profile_incomplete');
    }
    const result = await this.pool.query<ProfileRow>(
      'UPDATE developer_profile SET display_name = $2, contact_email_verified = CASE WHEN lower(contact_email) = lower($3) THEN contact_email_verified ELSE false END, contact_email = $3, contact_phone = $4, purpose = $5, revision = revision + 1, updated_at = now() WHERE developer_id = $1 AND revision = $6 RETURNING developer_id, display_name, contact_email, contact_email_verified, contact_phone, purpose, revision',
      [developerId, displayName, contactEmail, contactPhone, purpose, input.expectedRevision],
    );
    const row = result.rows[0];
    if (!row) throw new DeveloperReviewError('review_conflict');
    return mapProfile(row);
  }

  async listReviewHistory(developerId: string): Promise<unknown[]> {
    const result = await this.pool.query(
      'SELECT action, from_status, to_status, reviewer_id, reason, profile_snapshot, revision, created_at FROM developer_review_history WHERE developer_id = $1 ORDER BY created_at DESC, id DESC',
      [developerId],
    );
    return result.rows;
  }

  private async changeReviewStatus(
    developerId: string,
    expectedRevision: number,
    action: DeveloperReviewAction,
    reviewerId: string | null,
    reason: string | null,
  ): Promise<DeveloperAccount> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const accountResult = await client.query<AccountRow>(
        'SELECT id, status, revision, last_review, submitted_at, approved_at FROM developer_account WHERE id = $1 FOR UPDATE',
        [developerId],
      );
      const accountRow = accountResult.rows[0];
      if (!accountRow) throw new DeveloperReviewError('not_found');
      if (Number(accountRow.revision) !== expectedRevision) throw new DeveloperReviewError('review_conflict');

      const profileResult = await client.query<ProfileRow>(
        'SELECT developer_id, display_name, contact_email, contact_email_verified, contact_phone, purpose, revision FROM developer_profile WHERE developer_id = $1 LIMIT 1',
        [developerId],
      );
      const profileRow = profileResult.rows[0];
      if (!profileRow) throw new DeveloperReviewError('profile_incomplete');
      const profile = mapProfile(profileRow);
      if (action === 'submit' && (!profile.displayName.trim() || !profile.contactEmail.trim() || !profile.contactEmailVerified || !profile.purpose.trim())) {
        throw new DeveloperReviewError('profile_incomplete');
      }

      let nextStatus: DeveloperAccount['status'];
      try {
        nextStatus = assertDeveloperTransition(accountRow.status as DeveloperAccount['status'], action);
      } catch {
        throw new DeveloperReviewError('invalid_transition');
      }
      const reviewedAt = new Date().toISOString();
      const lastReview = { action, reason, reviewerId, reviewedAt };
      const updated = await client.query<AccountRow>(
        "UPDATE developer_account SET status = $2, revision = revision + 1, last_review = $3::jsonb, submitted_at = CASE WHEN $2 = 'pending' THEN now() ELSE submitted_at END, approved_at = CASE WHEN $2 = 'approved' THEN now() ELSE approved_at END, updated_at = now() WHERE id = $1 AND revision = $4 RETURNING id, status, revision, last_review, submitted_at, approved_at",
        [developerId, nextStatus, JSON.stringify(lastReview), expectedRevision],
      );
      const updatedRow = updated.rows[0];
      if (!updatedRow) throw new DeveloperReviewError('review_conflict');
      await client.query(
        'INSERT INTO developer_review_history (developer_id, action, from_status, to_status, reviewer_id, profile_snapshot, reason, revision) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)',
        [developerId, action, accountRow.status, nextStatus, reviewerId, JSON.stringify(profile), reason, Number(updatedRow.revision)],
      );
      if (action === 'disable') {
        await client.query(
          'UPDATE developer_session SET revoked_at = coalesce(revoked_at, now()) WHERE developer_id = $1',
          [developerId],
        );
      }
      await client.query('COMMIT');
      return mapAccount(updatedRow);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
