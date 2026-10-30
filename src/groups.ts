import { randomUUID } from 'node:crypto';

export type ApplicationGroupStatus = 'pending' | 'approved' | 'rejected' | 'disabled';

export interface ApplicationGroupReview {
  action: 'approve' | 'reject' | 'disable';
  reviewerUuid: string;
  reason: string | null;
  revision: number;
  reviewedAt: string;
}

export interface ApplicationGroupRecord {
  id: string;
  ownerUuid: string;
  displayName: string;
  status: ApplicationGroupStatus;
  revision: number;
  lastReview: ApplicationGroupReview | null;
}

export interface ApplicationGroupPage {
  total: number;
  list: ApplicationGroupRecord[];
}

export interface ApplicationGroupRepository {
  createGroup(record: ApplicationGroupRecord): Promise<void>;
  getOwnedGroup(id: string, ownerUuid: string): Promise<ApplicationGroupRecord | null>;
  getGroup(id: string): Promise<ApplicationGroupRecord | null>;
  listOwnedGroups(ownerUuid: string, page: number, pageSize: number): Promise<ApplicationGroupPage>;
  listGroupsForAdmin(status: ApplicationGroupStatus, page: number, pageSize: number): Promise<ApplicationGroupPage>;
  reviewGroup(previous: ApplicationGroupRecord, next: ApplicationGroupRecord): Promise<boolean>;
}

export class ApplicationGroupError extends Error {
  constructor(message = 'Application group conflict') {
    super(message);
    this.name = 'ApplicationGroupError';
  }
}

export class ApplicationGroupService {
  constructor(
    private readonly repository: ApplicationGroupRepository,
    private readonly makeId: () => string = randomUUID,
  ) {}

  async create(ownerUuid: string, displayName: unknown): Promise<ApplicationGroupRecord> {
    if (!ownerUuid || ownerUuid.length > 255) throw new ApplicationGroupError();
    if (
      typeof displayName !== 'string' ||
      displayName.trim() !== displayName ||
      displayName.length < 1 ||
      displayName.length > 100
    ) {
      throw new ApplicationGroupError('Group name must contain 1 to 100 characters');
    }
    const record: ApplicationGroupRecord = {
      id: this.makeId(),
      ownerUuid,
      displayName,
      status: 'pending',
      revision: 1,
      lastReview: null,
    };
    await this.repository.createGroup(record);
    return record;
  }

  async getOwned(id: string, ownerUuid: string): Promise<ApplicationGroupRecord | null> {
    return this.repository.getOwnedGroup(id, ownerUuid);
  }

  async listOwned(ownerUuid: string, page = 1, pageSize = 20): Promise<ApplicationGroupPage> {
    return this.repository.listOwnedGroups(ownerUuid, page, pageSize);
  }

  async listForAdmin(
    status: ApplicationGroupStatus = 'pending',
    page = 1,
    pageSize = 20,
  ): Promise<ApplicationGroupPage> {
    return this.repository.listGroupsForAdmin(status, page, pageSize);
  }

  async review(
    id: string,
    expectedRevision: number,
    command: { action: 'approve' | 'reject' | 'disable'; reviewerUuid: string; reason?: string },
    reviewedAt = new Date().toISOString(),
  ): Promise<ApplicationGroupRecord | null> {
    const record = await this.repository.getGroup(id);
    if (!record) return null;
    if (!Number.isSafeInteger(expectedRevision) || record.revision !== expectedRevision) {
      throw new ApplicationGroupError();
    }
    if (!command.reviewerUuid || command.reviewerUuid.length > 255) throw new ApplicationGroupError();
    if (
      (command.action === 'approve' || command.action === 'reject') &&
      record.status !== 'pending'
    ) throw new ApplicationGroupError();
    if (command.action === 'disable' && record.status !== 'approved') throw new ApplicationGroupError();
    const reason = command.action === 'approve' ? null : command.reason;
    if (command.action !== 'approve' && (!reason || !reason.trim() || reason.length > 2000)) {
      throw new ApplicationGroupError('A review reason is required');
    }
    if (record.revision >= Number.MAX_SAFE_INTEGER) throw new ApplicationGroupError();

    const next: ApplicationGroupRecord = {
      ...record,
      status: command.action === 'approve' ? 'approved' : command.action === 'reject' ? 'rejected' : 'disabled',
      revision: record.revision + 1,
      lastReview: {
        action: command.action,
        reviewerUuid: command.reviewerUuid,
        reason: reason ?? null,
        revision: record.revision + 1,
        reviewedAt,
      },
    };
    if (!await this.repository.reviewGroup(record, next)) throw new ApplicationGroupError();
    return next;
  }
}
