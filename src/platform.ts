import { randomUUID } from 'node:crypto';

import { validateApplicationDraft, type ApplicationDraft, type ClientType, type RuntimeEnvironment } from './applications.js';
import { decryptSecret, encryptSecret, randomToken } from './security.js';
import type { ApplicationRepository, ApplicationPage } from './store.js';

export type ApplicationStatus = 'draft' | 'pending' | 'rejected' | 'approved' | 'disabled';

export interface ReviewRecord {
  action: 'approve' | 'reject' | 'disable';
  reviewerUuid: string;
  reason: string | null;
  revision: number;
  reviewedAt: string;
}

export interface ApplicationRecord {
  id: string;
  ownerUuid: string;
  clientId: string;
  type: ClientType;
  revision: number;
  draft: ApplicationDraft;
  approvedConfig: ApplicationDraft | null;
  approvedRevision: number | null;
  status: ApplicationStatus;
  disabledReason: string | null;
  lastReview: ReviewRecord | null;
}

export type ReviewCommand =
  | { action: 'approve'; reviewerUuid: string }
  | { action: 'reject'; reviewerUuid: string; reason: string }
  | { action: 'disable'; reviewerUuid: string; reason: string };

export class ApplicationConflictError extends Error {
  constructor(message = 'Application state or revision conflict') {
    super(message);
    this.name = 'ApplicationConflictError';
  }
}

function assertRevision(record: ApplicationRecord, expectedRevision: number): void {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== record.revision) {
    throw new ApplicationConflictError();
  }
}

function copyDraft(draft: ApplicationDraft): ApplicationDraft {
  return structuredClone(draft);
}

export function createApplicationRecord(input: {
  id: string;
  ownerUuid: string;
  clientId: string;
  type: ClientType;
  draft: ApplicationDraft;
}): ApplicationRecord {
  if (!input.id || !input.ownerUuid || !input.clientId) {
    throw new ApplicationConflictError('Application identifiers are required');
  }
  return {
    id: input.id,
    ownerUuid: input.ownerUuid,
    clientId: input.clientId,
    type: input.type,
    revision: 1,
    draft: copyDraft(input.draft),
    approvedConfig: null,
    approvedRevision: null,
    status: 'draft',
    disabledReason: null,
    lastReview: null,
  };
}

export function effectiveApplicationConfig(record: ApplicationRecord): ApplicationDraft | null {
  if (record.status === 'disabled' || !record.approvedConfig) return null;
  return copyDraft(record.approvedConfig);
}

export function replaceApplicationDraft(
  record: ApplicationRecord,
  expectedRevision: number,
  draft: ApplicationDraft,
): ApplicationRecord {
  assertRevision(record, expectedRevision);
  if (record.status === 'pending' || record.status === 'disabled') {
    throw new ApplicationConflictError();
  }
  if (record.revision >= Number.MAX_SAFE_INTEGER) {
    throw new ApplicationConflictError('Application revision limit reached');
  }

  return {
    ...record,
    revision: record.revision + 1,
    draft: copyDraft(draft),
  };
}

export function submitApplicationForReview(
  record: ApplicationRecord,
  expectedRevision: number,
): ApplicationRecord {
  assertRevision(record, expectedRevision);
  if (record.status === 'pending' || record.status === 'disabled') {
    throw new ApplicationConflictError();
  }

  return { ...record, status: 'pending' };
}

export function reviewApplication(
  record: ApplicationRecord,
  expectedRevision: number,
  command: ReviewCommand,
  reviewedAt = new Date().toISOString(),
): ApplicationRecord {
  assertRevision(record, expectedRevision);
  if (!command.reviewerUuid || command.reviewerUuid.length > 255) {
    throw new ApplicationConflictError();
  }

  const reason = command.action === 'approve' ? null : command.reason;
  if (command.action !== 'approve' && (!reason || !reason.trim() || reason.length > 2000)) {
    throw new ApplicationConflictError('A review reason is required');
  }

  if (command.action === 'approve' || command.action === 'reject') {
    if (record.status !== 'pending') throw new ApplicationConflictError();
  } else if (record.status === 'disabled' || !record.approvedConfig) {
    throw new ApplicationConflictError();
  }

  const common = {
    ...record,
    lastReview: {
      action: command.action,
      reviewerUuid: command.reviewerUuid,
      reason: reason ?? null,
      revision: record.revision,
      reviewedAt,
    },
  };

  if (command.action === 'approve') {
    return {
      ...common,
      status: 'approved',
      approvedConfig: copyDraft(record.draft),
      approvedRevision: record.revision,
      disabledReason: null,
    };
  }

  if (command.action === 'reject') {
    return { ...common, status: 'rejected' };
  }

  return {
    ...common,
    status: 'disabled',
    disabledReason: reason ?? null,
  };
}

export class ApplicationService {
  constructor(
    private readonly repository: ApplicationRepository,
    private readonly environment: RuntimeEnvironment,
    private readonly makeId: () => string = randomUUID,
    private readonly makeClientId: () => string = () => randomToken(32),
    private readonly encryptionKey?: string,
    private readonly makeClientSecret: () => string = () => randomToken(48),
  ) {}

  private clearClientCache: (clientId: string) => void = () => {};

  setClientCacheClearer(clear: (clientId: string) => void): void {
    this.clearClientCache = clear;
  }

  async create(ownerUuid: string, type: ClientType, input: unknown): Promise<ApplicationRecord> {
    const created = await this.createWithSecret(ownerUuid, type, input);
    return created.record;
  }

  async createWithSecret(
    ownerUuid: string,
    type: ClientType,
    input: unknown,
  ): Promise<{ record: ApplicationRecord; clientSecret: string | null }> {
    if (!ownerUuid || ownerUuid.length > 255) throw new ApplicationConflictError();
    if (type === 'web' && !this.encryptionKey) {
      throw new ApplicationConflictError('Confidential client secret storage is not configured');
    }

    const draft = validateApplicationDraft(input, type, this.environment);
    await this.assertGroupOwner(ownerUuid, draft.groupId);

    const record = createApplicationRecord({
      id: this.makeId(),
      ownerUuid,
      clientId: this.makeClientId(),
      type,
      draft,
    });
    const clientSecret = type === 'web' ? this.makeClientSecret() : null;
    const encryptedClientSecret = clientSecret && this.encryptionKey
      ? encryptSecret(clientSecret, this.encryptionKey)
      : null;
    await this.repository.createApplication(record, encryptedClientSecret);
    return { record, clientSecret };
  }

  async getClientSecret(clientId: string): Promise<string | null> {
    if (!this.encryptionKey) return null;
    const active = await this.activeClient(clientId);
    if (!active || active.record.type !== 'web' || !this.repository.getEncryptedClientSecret) return null;
    const envelope = await this.repository.getEncryptedClientSecret(clientId);
    if (!envelope) return null;
    return decryptSecret(envelope, this.encryptionKey);
  }

  async rotateClientSecret(
    id: string,
    ownerUuid: string,
    expectedRevision: number,
  ): Promise<{ clientSecret: string } | null> {
    if (!this.encryptionKey || !this.repository.getEncryptedClientSecret || !this.repository.rotateEncryptedClientSecret) {
      throw new ApplicationConflictError('Confidential client secret storage is unavailable');
    }
    const current = await this.repository.getOwnedApplication(id, ownerUuid);
    if (!current) return null;
    if (current.type !== 'web' || current.status !== 'approved') {
      throw new ApplicationConflictError('Only an approved confidential client can rotate its secret');
    }
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== current.revision) {
      throw new ApplicationConflictError();
    }
    const previousEnvelope = await this.repository.getEncryptedClientSecret(current.clientId);
    if (!previousEnvelope) throw new ApplicationConflictError('Client secret is unavailable');

    const clientSecret = this.makeClientSecret();
    const nextEnvelope = encryptSecret(clientSecret, this.encryptionKey);
    const updated = await this.repository.rotateEncryptedClientSecret(
      current.clientId,
      ownerUuid,
      expectedRevision,
      previousEnvelope,
      nextEnvelope,
    );
    if (!updated) throw new ApplicationConflictError();
    this.clearClientCache(current.clientId);
    return { clientSecret };
  }

  async getOwned(id: string, ownerUuid: string): Promise<ApplicationRecord | null> {
    return this.repository.getOwnedApplication(id, ownerUuid);
  }

  async edit(
    id: string,
    ownerUuid: string,
    expectedRevision: number,
    input: unknown,
  ): Promise<ApplicationRecord | null> {
    const current = await this.repository.getOwnedApplication(id, ownerUuid);
    if (!current) return null;

    const draft = validateApplicationDraft(input, current.type, this.environment);
    await this.assertGroupOwner(ownerUuid, draft.groupId);
    const next = replaceApplicationDraft(current, expectedRevision, draft);
    const saved = await this.repository.compareAndSwap(current, next);
    if (!saved) throw new ApplicationConflictError();
    return next;
  }

  async submit(
    id: string,
    ownerUuid: string,
    expectedRevision: number,
  ): Promise<ApplicationRecord | null> {
    const current = await this.repository.getOwnedApplication(id, ownerUuid);
    if (!current) return null;

    await this.assertGroupOwner(ownerUuid, current.draft.groupId);
    const next = submitApplicationForReview(current, expectedRevision);
    const saved = await this.repository.compareAndSwap(current, next);
    if (!saved) throw new ApplicationConflictError();
    return next;
  }

  async review(
    id: string,
    expectedRevision: number,
    command: ReviewCommand,
  ): Promise<ApplicationRecord | null> {
    const current = await this.repository.getApplication(id);
    if (!current) return null;

    const next = reviewApplication(current, expectedRevision, command);
    const saved = await this.repository.compareAndSwap(current, next, next.lastReview);
    if (!saved) throw new ApplicationConflictError();
    this.clearClientCache(current.clientId);
    return next;
  }

  async activeClient(clientId: string): Promise<{ record: ApplicationRecord; config: ApplicationDraft } | null> {
    const record = await this.repository.getApplicationByClientId(clientId);
    if (!record) return null;
    const config = effectiveApplicationConfig(record);
    if (!config) return null;
    if (
      config.groupId !== null &&
      !(await this.repository.groupApprovedBy(record.ownerUuid, config.groupId))
    ) {
      config.groupId = null;
    }
    return { record, config };
  }

  async listOwned(
    ownerUuid: string,
    page = 1,
    pageSize = 20,
    status?: ApplicationStatus,
  ): Promise<ApplicationPage> {
    return this.repository.listOwned(ownerUuid, page, pageSize, status);
  }

  private async assertGroupOwner(ownerUuid: string, groupId: string | null): Promise<void> {
    if (groupId === null) return;
    const belongsToOwner = await this.repository.groupOwnedBy(ownerUuid, groupId);
    if (!belongsToOwner) throw new ApplicationConflictError();
  }
}
