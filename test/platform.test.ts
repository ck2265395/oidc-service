import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ApplicationConflictError,
  ApplicationService,
  createApplicationRecord,
  effectiveApplicationConfig,
  replaceApplicationDraft,
  reviewApplication,
  submitApplicationForReview,
} from '../src/platform.js';
import { validateApplicationDraft } from '../src/applications.js';
import type { ApplicationPage, ApplicationRepository } from '../src/store.js';

const validDraft = (name: string, groupId: string | null = null) => validateApplicationDraft({
  name,
  description: 'A test application',
  purpose: 'Test sign in',
  homepageUrl: 'https://client.example.invalid',
  privacyUrl: 'https://client.example.invalid/privacy',
  termsUrl: 'https://client.example.invalid/terms',
  redirectUris: ['https://client.example.invalid/callback'],
  postLogoutRedirectUris: ['https://client.example.invalid/logout'],
  scopes: ['openid', 'profile'],
  groupId,
}, 'web', 'production');

const initial = () => createApplicationRecord({
  id: 'app-1',
  ownerUuid: 'owner-1',
  clientId: 'client-1',
  type: 'web',
  draft: validDraft('Version 1'),
});

test('new applications do not receive protocol access before approval', () => {
  const record = initial();

  assert.equal(record.status, 'draft');
  assert.equal(effectiveApplicationConfig(record), null);
});

test('approval publishes the reviewed snapshot', () => {
  const submitted = submitApplicationForReview(initial(), 1);
  const approved = reviewApplication(submitted, 1, {
    action: 'approve',
    reviewerUuid: 'operator-1',
  });

  assert.equal(approved.status, 'approved');
  assert.equal(approved.approvedRevision, 1);
  assert.equal(effectiveApplicationConfig(approved)?.name, 'Version 1');
});

test('pending edits remain isolated from the approved client configuration', () => {
  const approved = reviewApplication(
    submitApplicationForReview(initial(), 1),
    1,
    { action: 'approve', reviewerUuid: 'operator-1' },
  );
  const edited = replaceApplicationDraft(approved, 1, validDraft('Version 2'));
  const pending = submitApplicationForReview(edited, 2);

  assert.equal(pending.status, 'pending');
  assert.equal(pending.draft.name, 'Version 2');
  assert.equal(effectiveApplicationConfig(pending)?.name, 'Version 1');
});

test('rejected updates preserve the previously approved snapshot', () => {
  const approved = reviewApplication(
    submitApplicationForReview(initial(), 1),
    1,
    { action: 'approve', reviewerUuid: 'operator-1' },
  );
  const edited = replaceApplicationDraft(approved, 1, validDraft('Unsafe Version'));
  const rejected = reviewApplication(
    submitApplicationForReview(edited, 2),
    2,
    { action: 'reject', reviewerUuid: 'operator-1', reason: 'Callback needs correction' },
  );

  assert.equal(rejected.status, 'rejected');
  assert.equal(effectiveApplicationConfig(rejected)?.name, 'Version 1');
});

test('disable stops access even when an approved snapshot exists', () => {
  const approved = reviewApplication(
    submitApplicationForReview(initial(), 1),
    1,
    { action: 'approve', reviewerUuid: 'operator-1' },
  );
  const disabled = reviewApplication(
    approved,
    1,
    { action: 'disable', reviewerUuid: 'operator-1', reason: 'Security review' },
  );

  assert.equal(disabled.status, 'disabled');
  assert.equal(effectiveApplicationConfig(disabled), null);
});

test('stale revisions and reviews without reasons are rejected', () => {
  assert.throws(
    () => replaceApplicationDraft(initial(), 2, validDraft('Stale')),
    ApplicationConflictError,
  );
  assert.throws(
    () => reviewApplication(
      submitApplicationForReview(initial(), 1),
      1,
      { action: 'reject', reviewerUuid: 'operator-1', reason: '' },
    ),
    ApplicationConflictError,
  );
});

class MemoryRepository implements ApplicationRepository {
  readonly records = new Map<string, import('../src/platform.js').ApplicationRecord>();
  readonly groups = new Set<string>();
  readonly approvedGroups = new Set<string>();

  async createApplication(record: import('../src/platform.js').ApplicationRecord): Promise<void> {
    this.records.set(record.id, record);
  }

  async getApplication(id: string) {
    return this.records.get(id) ?? null;
  }

  async getOwnedApplication(id: string, ownerUuid: string) {
    const record = this.records.get(id);
    return record?.ownerUuid === ownerUuid ? record : null;
  }

  async getApplicationByClientId(clientId: string) {
    return [...this.records.values()].find((record) => record.clientId === clientId) ?? null;
  }

  async groupOwnedBy(ownerUuid: string, groupId: string) {
    return this.groups.has(ownerUuid + ':' + groupId);
  }

  async groupApprovedBy(ownerUuid: string, groupId: string) {
    return this.approvedGroups.has(ownerUuid + ':' + groupId);
  }

  async compareAndSwap(previous: import('../src/platform.js').ApplicationRecord, next: import('../src/platform.js').ApplicationRecord) {
    const current = this.records.get(previous.id);
    if (!current || current.revision !== previous.revision || current.status !== previous.status) return false;
    this.records.set(next.id, next);
    return true;
  }

  async listOwned(ownerUuid: string, page: number, pageSize: number): Promise<ApplicationPage> {
    const list = [...this.records.values()].filter((record) => record.ownerUuid === ownerUuid);
    const offset = (page - 1) * pageSize;
    return { total: list.length, list: list.slice(offset, offset + pageSize) };
  }

  async close(): Promise<void> {}
}

test('application service derives ownership from the caller and waits for approval', async () => {
  const repository = new MemoryRepository();
  const service = new ApplicationService(repository, 'production', () => 'app-id', () => 'client-id', Buffer.alloc(32, 7).toString('base64url'));
  const created = await service.create('owner-a', 'web', validDraft('Draft'));

  assert.equal(created.ownerUuid, 'owner-a');
  assert.equal(created.clientId, 'client-id');
  assert.equal(await service.getOwned(created.id, 'owner-b'), null);
  assert.equal(await service.activeClient(created.clientId), null);

  const pending = await service.submit(created.id, 'owner-a', created.revision);
  assert.ok(pending);
  const approved = await service.review(
    created.id,
    pending.revision,
    { action: 'approve', reviewerUuid: 'admin-a' },
  );

  assert.ok(approved);
  assert.equal((await service.activeClient(created.clientId))?.config.name, 'Draft');
});

test('application service refuses groups owned by another account', async () => {
  const repository = new MemoryRepository();
  const service = new ApplicationService(repository, 'production', () => 'app-id', () => 'client-id');
  const groupId = 'a23e4567-e89b-42d3-a456-426614174000';
  repository.groups.add('owner-b:' + groupId);

  await assert.rejects(
    service.create('owner-a', 'web', validDraft('Grouped', groupId)),
    ApplicationConflictError,
  );
});

test('shared subjects wait for both application and group approval', async () => {
  const repository = new MemoryRepository();
  const service = new ApplicationService(repository, 'production', () => 'grouped-app', () => 'grouped-client', Buffer.alloc(32, 7).toString('base64url'));
  const ownerUuid = 'owner-a';
  const groupId = 'a23e4567-e89b-42d3-a456-426614174000';
  repository.groups.add(ownerUuid + ':' + groupId);

  const created = await service.create(ownerUuid, 'web', validDraft('Grouped', groupId));
  const pending = await service.submit(created.id, ownerUuid, created.revision);
  assert.ok(pending);
  await service.review(created.id, pending.revision, { action: 'approve', reviewerUuid: 'admin-a' });

  assert.equal((await service.activeClient(created.clientId))?.config.groupId, null);

  repository.approvedGroups.add(ownerUuid + ':' + groupId);
  assert.equal((await service.activeClient(created.clientId))?.config.groupId, groupId);
});
