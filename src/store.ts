import { Pool, type PoolClient } from 'pg';
import type { ApplicationGroupRecord, ApplicationGroupPage, ApplicationGroupRepository } from './groups.js';

import {
  validateApplicationDraft,
  type ApplicationDraft,
  type ClientType,
  type RuntimeEnvironment,
} from './applications.js';
import {
  ApplicationConflictError,
  type ApplicationRecord,
  type DeveloperProfileRecord,
  type ApplicationStatus,
  type ReviewRecord,
} from './platform.js';

export class PlatformStorageError extends Error {
  constructor() {
    super('Platform storage is unavailable');
    this.name = 'PlatformStorageError';
  }
}

export interface ApplicationPage {
  total: number;
  list: ApplicationRecord[];
}

export interface ApplicationRepository {
  getDeveloperProfile?(accountUuid: string): Promise<DeveloperProfileRecord | null>;
  saveDeveloperProfile?(
    accountUuid: string,
    displayName: string,
    contactEmail: string,
    expectedRevision: number,
  ): Promise<DeveloperProfileRecord | null>;
  createApplication(record: ApplicationRecord, encryptedClientSecret?: string | null): Promise<void>;
  getEncryptedClientSecret?(clientId: string): Promise<string | null>;
  rotateEncryptedClientSecret?(
    clientId: string,
    ownerUuid: string,
    expectedRevision: number,
    previousEnvelope: string,
    nextEnvelope: string,
  ): Promise<boolean>;
  getApplication(id: string): Promise<ApplicationRecord | null>;
  getOwnedApplication(id: string, ownerUuid: string): Promise<ApplicationRecord | null>;
  getApplicationByClientId(clientId: string): Promise<ApplicationRecord | null>;
  groupOwnedBy(ownerUuid: string, groupId: string): Promise<boolean>;
  groupApprovedBy(ownerUuid: string, groupId: string): Promise<boolean>;
  compareAndSwap(
    previous: ApplicationRecord,
    next: ApplicationRecord,
    reviewEvent?: ReviewRecord | null,
  ): Promise<boolean>;
  listForAdmin?(page: number, pageSize: number, status?: ApplicationStatus): Promise<ApplicationPage>;
  listOwned(
    ownerUuid: string,
    page: number,
    pageSize: number,
    status?: ApplicationStatus,
  ): Promise<ApplicationPage>;
  close(): Promise<void>;
}

interface GroupRow {
  id: string;
  owner_account_uuid: string;
  display_name: string;
  status: string;
  revision: string | number;
  last_review: unknown | null;
}

function mapGroupRow(row: GroupRow): ApplicationGroupRecord {
  const revision = Number(row.revision);
  if (
    !row.id || !row.owner_account_uuid ||
    typeof row.display_name !== 'string' || row.display_name.length < 1 || row.display_name.length > 100 ||
    !Number.isSafeInteger(revision) || revision < 1 ||
    !['pending', 'approved', 'rejected', 'disabled'].includes(row.status)
  ) throw new PlatformStorageError();
  let lastReview: ApplicationGroupRecord['lastReview'] = null;
  if (row.last_review !== null) {
    const value = recordValue(row.last_review);
    if (
      !['approve', 'reject', 'disable'].includes(String(value.action)) ||
      typeof value.reviewerUuid !== 'string' ||
      typeof value.revision !== 'number' ||
      typeof value.reviewedAt !== 'string' ||
      (value.reason !== null && typeof value.reason !== 'string')
    ) throw new PlatformStorageError();
    lastReview = {
      action: value.action as NonNullable<ApplicationGroupRecord['lastReview']>['action'],
      reviewerUuid: value.reviewerUuid,
      reason: value.reason as string | null,
      revision: value.revision,
      reviewedAt: value.reviewedAt,
    };
  }
  return {
    id: row.id,
    ownerUuid: row.owner_account_uuid,
    displayName: row.display_name,
    status: row.status as ApplicationGroupRecord['status'],
    revision,
    lastReview,
  };
}

interface ApplicationRow {
  id: string;
  owner_account_uuid: string;
  client_id: string;
  client_type: string;
  revision: string | number;
  status: string;
  draft_config: unknown;
  approved_config: unknown | null;
  approved_revision: string | number | null;
  group_id: string | null;
  last_review: unknown | null;
}

const APPLICATION_COLUMNS =
  'id, owner_account_uuid, client_id, client_type, revision, status, draft_config, approved_config, approved_revision, group_id, last_review';

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new PlatformStorageError();
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  const parsed = parseJson(value);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new PlatformStorageError();
  }
  return parsed as Record<string, unknown>;
}

function parseStatus(value: string): ApplicationStatus {
  if (['draft', 'pending', 'rejected', 'approved', 'disabled'].includes(value)) {
    return value as ApplicationStatus;
  }
  throw new PlatformStorageError();
}

function parseClientType(value: string): ClientType {
  if (['web', 'spa', 'native'].includes(value)) return value as ClientType;
  throw new PlatformStorageError();
}

function parseReview(value: unknown): ReviewRecord | null {
  if (value === null) return null;
  const review = recordValue(value);
  if (
    !['approve', 'reject', 'disable'].includes(String(review.action)) ||
    typeof review.reviewerUuid !== 'string' ||
    typeof review.revision !== 'number' ||
    typeof review.reviewedAt !== 'string' ||
    (review.reason !== null && typeof review.reason !== 'string')
  ) {
    throw new PlatformStorageError();
  }
  return {
    action: review.action as ReviewRecord['action'],
    reviewerUuid: review.reviewerUuid,
    reason: review.reason as string | null,
    revision: review.revision,
    reviewedAt: review.reviewedAt,
  };
}

function mapApplicationRow(row: ApplicationRow, environment: RuntimeEnvironment): ApplicationRecord {
  const type = parseClientType(row.client_type);
  let draft: ApplicationDraft;
  try {
    draft = validateApplicationDraft(row.draft_config, type, environment);
  } catch {
    throw new PlatformStorageError();
  }

  let approvedConfig: ApplicationDraft | null = null;
  if (row.approved_config !== null) {
    try {
      approvedConfig = validateApplicationDraft(row.approved_config, type, environment);
    } catch {
      throw new PlatformStorageError();
    }
  }

  const revision = Number(row.revision);
  const approvedRevision = row.approved_revision === null ? null : Number(row.approved_revision);
  const status = parseStatus(row.status);
  const lastReview = parseReview(row.last_review);
  if (
    !row.id ||
    !row.owner_account_uuid ||
    !row.client_id ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    (approvedRevision !== null && (!Number.isSafeInteger(approvedRevision) || approvedRevision < 1)) ||
    (approvedConfig === null) !== (approvedRevision === null)
  ) {
    throw new PlatformStorageError();
  }
  if ((draft.groupId ?? null)?.toLowerCase() !== (row.group_id ?? null)?.toLowerCase()) {
    throw new PlatformStorageError();
  }

  return {
    id: row.id,
    ownerUuid: row.owner_account_uuid,
    clientId: row.client_id,
    type,
    revision,
    draft,
    approvedConfig,
    approvedRevision,
    status,
    disabledReason: status === 'disabled' ? lastReview?.reason ?? null : null,
    lastReview,
  };
}

export function createPlatformPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 10_000,
    application_name: 'dt-identity-service',
  });
}

export class PostgresApplicationRepository implements ApplicationRepository, ApplicationGroupRepository {
  constructor(
    private readonly pool: Pool,
    private readonly environment: RuntimeEnvironment,
  ) {}

  async getDeveloperProfile(accountUuid: string): Promise<DeveloperProfileRecord | null> {
    try {
      const result = await this.pool.query<{
        account_uuid: string;
        display_name: string;
        contact_email: string;
        contact_email_verified: boolean;
        revision: string | number;
      }>(
        'SELECT account_uuid, display_name, contact_email, contact_email_verified, revision FROM developer_profile WHERE account_uuid = $1 LIMIT 1',
        [accountUuid],
      );
      const row = result.rows[0];
      return row ? {
        accountUuid: row.account_uuid,
        displayName: row.display_name,
        contactEmail: row.contact_email,
        contactEmailVerified: row.contact_email_verified,
        revision: Number(row.revision),
      } : null;
    } catch {
      throw new PlatformStorageError();
    }
  }

  async saveDeveloperProfile(
    accountUuid: string,
    displayName: string,
    contactEmail: string,
    expectedRevision: number,
  ): Promise<DeveloperProfileRecord | null> {
    try {
      const result = expectedRevision === 0
        ? await this.pool.query<{
            account_uuid: string;
            display_name: string;
            contact_email: string;
            contact_email_verified: boolean;
            revision: string | number;
          }>(
            'INSERT INTO developer_profile (account_uuid, display_name, contact_email, contact_email_verified, revision) VALUES ($1, $2, $3, false, 1) ON CONFLICT (account_uuid) DO NOTHING RETURNING account_uuid, display_name, contact_email, contact_email_verified, revision',
            [accountUuid, displayName, contactEmail],
          )
        : await this.pool.query<{
            account_uuid: string;
            display_name: string;
            contact_email: string;
            contact_email_verified: boolean;
            revision: string | number;
          }>(
            'UPDATE developer_profile SET display_name = $2, contact_email_verified = CASE WHEN contact_email = $3 THEN contact_email_verified ELSE false END, contact_email = $3, revision = revision + 1, updated_at = now() WHERE account_uuid = $1 AND revision = $4 RETURNING account_uuid, display_name, contact_email, contact_email_verified, revision',
            [accountUuid, displayName, contactEmail, expectedRevision],
          );
      const row = result.rows[0];
      return row ? {
        accountUuid: row.account_uuid,
        displayName: row.display_name,
        contactEmail: row.contact_email,
        contactEmailVerified: row.contact_email_verified,
        revision: Number(row.revision),
      } : null;
    } catch {
      throw new PlatformStorageError();
    }
  }

  async createApplication(record: ApplicationRecord, encryptedClientSecret: string | null = null): Promise<void> {
    try {
      await this.pool.query(
        'INSERT INTO oidc_application (id, owner_account_uuid, client_id, client_type, revision, status, draft_config, approved_config, approved_revision, encrypted_client_secret, group_id, last_review) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12::jsonb)',
        [
          record.id,
          record.ownerUuid,
          record.clientId,
          record.type,
          record.revision,
          record.status,
          JSON.stringify(record.draft),
          record.approvedConfig === null ? null : JSON.stringify(record.approvedConfig),
          record.approvedRevision,
          encryptedClientSecret,
          record.draft.groupId,
          record.lastReview === null ? null : JSON.stringify(record.lastReview),
        ],
      );
    } catch {
      throw new PlatformStorageError();
    }
  }

  async getApplication(id: string): Promise<ApplicationRecord | null> {
    return this.fetchOne(
      'SELECT ' + APPLICATION_COLUMNS + ' FROM oidc_application WHERE id = $1 LIMIT 1',
      [id],
    );
  }

  async getOwnedApplication(id: string, ownerUuid: string): Promise<ApplicationRecord | null> {
    return this.fetchOne(
      'SELECT ' + APPLICATION_COLUMNS + ' FROM oidc_application WHERE id = $1 AND owner_account_uuid = $2 LIMIT 1',
      [id, ownerUuid],
    );
  }

  async getApplicationByClientId(clientId: string): Promise<ApplicationRecord | null> {
    return this.fetchOne(
      'SELECT ' + APPLICATION_COLUMNS + ' FROM oidc_application WHERE client_id = $1 LIMIT 1',
      [clientId],
    );
  }

  async getEncryptedClientSecret(clientId: string): Promise<string | null> {
    try {
      const result = await this.pool.query<{ encrypted_client_secret: string | null }>(
        "SELECT encrypted_client_secret FROM oidc_application WHERE client_id = $1 AND status = 'approved' LIMIT 1",
        [clientId],
      );
      return result.rows[0]?.encrypted_client_secret ?? null;
    } catch {
      throw new PlatformStorageError();
    }
  }

  async rotateEncryptedClientSecret(
    clientId: string,
    ownerUuid: string,
    expectedRevision: number,
    previousEnvelope: string,
    nextEnvelope: string,
  ): Promise<boolean> {
    try {
      const result = await this.pool.query(
        "UPDATE oidc_application SET encrypted_client_secret = $1, updated_at = now() WHERE client_id = $2 AND owner_account_uuid = $3 AND revision = $4 AND status = 'approved' AND encrypted_client_secret = $5",
        [nextEnvelope, clientId, ownerUuid, expectedRevision, previousEnvelope],
      );
      return result.rowCount === 1;
    } catch {
      throw new PlatformStorageError();
    }
  }

  async createGroup(record: ApplicationGroupRecord): Promise<void> {
    try {
      await this.pool.query(
        'INSERT INTO application_group (id, owner_account_uuid, display_name, status, revision, last_review) VALUES ($1, $2, $3, $4, $5, $6::jsonb)',
        [record.id, record.ownerUuid, record.displayName, record.status, record.revision, record.lastReview ? JSON.stringify(record.lastReview) : null],
      );
    } catch {
      throw new PlatformStorageError();
    }
  }

  async renameGroup(previous: ApplicationGroupRecord, next: ApplicationGroupRecord): Promise<boolean> {
    const connection = await this.pool.connect();
    try {
      await connection.query('BEGIN');
      const update = await connection.query(
        "UPDATE application_group SET display_name = $1, status = 'pending', revision = $2, last_review = NULL, updated_at = now() WHERE id = $3 AND owner_account_uuid = $4 AND revision = $5 AND status IN ('pending', 'rejected')",
        [next.displayName, next.revision, previous.id, previous.ownerUuid, previous.revision],
      );
      if (update.rowCount !== 1) {
        await connection.query('ROLLBACK');
        return false;
      }
      await connection.query(
        "INSERT INTO platform_audit (actor_type, actor_id, action, outcome, details, created_at) VALUES ('account', $1, 'application_group.rename', 'success', $2::jsonb, now())",
        [previous.ownerUuid, JSON.stringify({ groupId: next.id, revision: next.revision, status: next.status })],
      );
      await connection.query('COMMIT');
      return true;
    } catch (error) {
      await this.rollbackQuietly(connection);
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: unknown }).code === '23505'
      ) return false;
      throw new PlatformStorageError();
    } finally {
      connection.release();
    }
  }

  async getGroup(id: string): Promise<ApplicationGroupRecord | null> {
    try {
      const result = await this.pool.query<GroupRow>(
        'SELECT id, owner_account_uuid, display_name, status, revision, last_review FROM application_group WHERE id = $1 LIMIT 1',
        [id],
      );
      const row = result.rows[0];
      return row ? mapGroupRow(row) : null;
    } catch {
      throw new PlatformStorageError();
    }
  }

  async getOwnedGroup(id: string, ownerUuid: string): Promise<ApplicationGroupRecord | null> {
    try {
      const result = await this.pool.query<GroupRow>(
        'SELECT id, owner_account_uuid, display_name, status, revision, last_review FROM application_group WHERE id = $1 AND owner_account_uuid = $2 LIMIT 1',
        [id, ownerUuid],
      );
      const row = result.rows[0];
      return row ? mapGroupRow(row) : null;
    } catch {
      throw new PlatformStorageError();
    }
  }

  async listOwnedGroups(ownerUuid: string, page: number, pageSize: number): Promise<ApplicationGroupPage> {
    return this.listGroups('owner_account_uuid = $1', [ownerUuid], page, pageSize);
  }

  async listGroupsForAdmin(
    status: ApplicationGroupRecord['status'],
    page: number,
    pageSize: number,
  ): Promise<ApplicationGroupPage> {
    return this.listGroups('status = $1', [status], page, pageSize);
  }

  async reviewGroup(previous: ApplicationGroupRecord, next: ApplicationGroupRecord): Promise<boolean> {
    const connection = await this.pool.connect();
    try {
      await connection.query('BEGIN');
      const update = await connection.query(
        'UPDATE application_group SET status = $1, revision = $2, last_review = $3::jsonb, updated_at = now() WHERE id = $4 AND revision = $5 AND status = $6',
        [next.status, next.revision, JSON.stringify(next.lastReview), previous.id, previous.revision, previous.status],
      );
      if (update.rowCount !== 1) {
        await connection.query('ROLLBACK');
        return false;
      }
      const review = next.lastReview;
      if (review) {
        await connection.query(
          'INSERT INTO application_group_review_history (group_id, owner_account_uuid, reviewer_uuid, decision, reason, revision, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [next.id, next.ownerUuid, review.reviewerUuid, review.action, review.reason, review.revision, review.reviewedAt],
        );
        await connection.query(
          'INSERT INTO platform_audit (actor_type, actor_id, action, outcome, details, created_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6)',
          [review.reviewerUuid.startsWith('admin:') ? 'admin' : 'system', review.reviewerUuid, 'application_group.' + review.action, 'success', JSON.stringify({ groupId: next.id, revision: review.revision, status: next.status }), review.reviewedAt],
        );
      }
      await connection.query('COMMIT');
      return true;
    } catch {
      await this.rollbackQuietly(connection);
      throw new PlatformStorageError();
    } finally {
      connection.release();
    }
  }

  private async listGroups(
    where: string,
    values: string[],
    page: number,
    pageSize: number,
  ): Promise<ApplicationGroupPage> {
    if (
      !Number.isSafeInteger(page) || page < 1 ||
      !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100
    ) throw new ApplicationConflictError('Invalid pagination');
    const offset = (page - 1) * pageSize;
    if (!Number.isSafeInteger(offset)) throw new ApplicationConflictError('Invalid pagination');
    try {
      const count = await this.pool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM application_group WHERE ' + where,
        values,
      );
      const limitPosition = values.length + 1;
      const offsetPosition = values.length + 2;
      const rows = await this.pool.query<GroupRow>(
        'SELECT id, owner_account_uuid, display_name, status, revision, last_review FROM application_group WHERE ' +
          where + ' ORDER BY updated_at DESC, id DESC LIMIT $' + limitPosition + ' OFFSET $' + offsetPosition,
        [...values, pageSize, offset],
      );
      return {
        total: Number(count.rows[0]?.count ?? '0'),
        list: rows.rows.map(mapGroupRow),
      };
    } catch (error) {
      if (error instanceof ApplicationConflictError || error instanceof PlatformStorageError) throw error;
      throw new PlatformStorageError();
    }
  }

  async groupOwnedBy(ownerUuid: string, groupId: string): Promise<boolean> {
    try {
      const result = await this.pool.query<{ exists: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM application_group WHERE id = $1 AND owner_account_uuid = $2) AS exists",
        [groupId, ownerUuid],
      );
      return result.rows[0]?.exists === true;
    } catch {
      throw new PlatformStorageError();
    }
  }

  async groupApprovedBy(ownerUuid: string, groupId: string): Promise<boolean> {
    try {
      const result = await this.pool.query<{ exists: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM application_group WHERE id = $1 AND owner_account_uuid = $2 AND status = 'approved') AS exists",
        [groupId, ownerUuid],
      );
      return result.rows[0]?.exists === true;
    } catch {
      throw new PlatformStorageError();
    }
  }

  async compareAndSwap(
    previous: ApplicationRecord,
    next: ApplicationRecord,
    reviewEvent: ReviewRecord | null = null,
  ): Promise<boolean> {
    const connection = await this.pool.connect();
    try {
      await connection.query('BEGIN');
      const update = await connection.query(
        'UPDATE oidc_application SET revision = $1, status = $2, draft_config = $3::jsonb, approved_config = $4::jsonb, approved_revision = $5, group_id = $6, last_review = $7::jsonb, updated_at = now() WHERE id = $8 AND owner_account_uuid = $9 AND revision = $10 AND status = $11',
        [
          next.revision,
          next.status,
          JSON.stringify(next.draft),
          next.approvedConfig === null ? null : JSON.stringify(next.approvedConfig),
          next.approvedRevision,
          next.draft.groupId,
          next.lastReview === null ? null : JSON.stringify(next.lastReview),
          previous.id,
          previous.ownerUuid,
          previous.revision,
          previous.status,
        ],
      );

      if (update.rowCount !== 1) {
        await connection.query('ROLLBACK');
        return false;
      }

      if (reviewEvent) {
        await this.insertReviewHistory(connection, previous, next, reviewEvent);
      }
      await connection.query('COMMIT');
      return true;
    } catch {
      await this.rollbackQuietly(connection);
      throw new PlatformStorageError();
    } finally {
      connection.release();
    }
  }

  async listForAdmin(
    page: number,
    pageSize: number,
    status: ApplicationStatus = 'pending',
  ): Promise<ApplicationPage> {
    if (
      !Number.isSafeInteger(page) || page < 1 ||
      !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 ||
      !['draft', 'pending', 'rejected', 'approved', 'disabled'].includes(status)
    ) {
      throw new ApplicationConflictError('Invalid pagination');
    }
    const offset = (page - 1) * pageSize;
    if (!Number.isSafeInteger(offset)) throw new ApplicationConflictError('Invalid pagination');
    try {
      const count = await this.pool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM oidc_application WHERE status = $1',
        [status],
      );
      const rows = await this.pool.query<ApplicationRow>(
        'SELECT ' + APPLICATION_COLUMNS + ' FROM oidc_application WHERE status = $1 ORDER BY updated_at DESC, id DESC LIMIT $2 OFFSET $3',
        [status, pageSize, offset],
      );
      return {
        total: Number(count.rows[0]?.count ?? '0'),
        list: rows.rows.map((row) => mapApplicationRow(row, this.environment)),
      };
    } catch (error) {
      if (error instanceof ApplicationConflictError || error instanceof PlatformStorageError) throw error;
      throw new PlatformStorageError();
    }
  }

  async listOwned(
    ownerUuid: string,
    page: number,
    pageSize: number,
    status?: ApplicationStatus,
  ): Promise<ApplicationPage> {
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    ) {
      throw new ApplicationConflictError('Invalid pagination');
    }

    const offset = (page - 1) * pageSize;
    if (!Number.isSafeInteger(offset)) throw new ApplicationConflictError('Invalid pagination');

    try {
      const count = await this.pool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM oidc_application WHERE owner_account_uuid = $1 AND ($2::text IS NULL OR status = $2)',
        [ownerUuid, status ?? null],
      );
      const rows = await this.pool.query<ApplicationRow>(
        'SELECT ' + APPLICATION_COLUMNS + ' FROM oidc_application WHERE owner_account_uuid = $1 AND ($4::text IS NULL OR status = $4) ORDER BY updated_at DESC, id DESC LIMIT $2 OFFSET $3',
        [ownerUuid, pageSize, offset, status ?? null],
      );
      return {
        total: Number(count.rows[0]?.count ?? '0'),
        list: rows.rows.map((row) => mapApplicationRow(row, this.environment)),
      };
    } catch (error) {
      if (error instanceof ApplicationConflictError || error instanceof PlatformStorageError) throw error;
      throw new PlatformStorageError();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async fetchOne(query: string, values: unknown[]): Promise<ApplicationRecord | null> {
    try {
      const result = await this.pool.query<ApplicationRow>(query, values);
      const row = result.rows[0];
      return row ? mapApplicationRow(row, this.environment) : null;
    } catch (error) {
      if (error instanceof PlatformStorageError) throw error;
      throw new PlatformStorageError();
    }
  }

  private async insertReviewHistory(
    connection: PoolClient,
    previous: ApplicationRecord,
    next: ApplicationRecord,
    review: ReviewRecord,
  ): Promise<void> {
    await connection.query(
      'INSERT INTO application_review_history (application_id, revision, submitted_by_account_uuid, reviewed_by_account_uuid, decision, reason, submitted_config, previously_approved_config, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)',
      [
        next.id,
        review.revision,
        next.ownerUuid,
        review.reviewerUuid,
        review.action,
        review.reason,
        JSON.stringify(next.draft),
        previous.approvedConfig === null ? null : JSON.stringify(previous.approvedConfig),
        review.reviewedAt,
      ],
    );
    await connection.query(
      'INSERT INTO platform_audit (actor_type, actor_id, action, application_id, outcome, details, created_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)',
      [
        review.reviewerUuid.startsWith('admin:') ? 'admin' : 'system',
        review.reviewerUuid,
        'application.' + review.action,
        next.id,
        'success',
        JSON.stringify({ revision: review.revision, status: next.status }),
        review.reviewedAt,
      ],
    );
  }

  private async rollbackQuietly(connection: PoolClient): Promise<void> {
    try {
      await connection.query('ROLLBACK');
    } catch {
      // Keep storage errors generic and avoid logging driver details.
    }
  }
}