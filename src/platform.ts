import type { ApplicationDraft, ClientType } from './applications.js';

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