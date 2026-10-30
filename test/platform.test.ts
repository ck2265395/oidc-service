import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ApplicationConflictError,
  createApplicationRecord,
  effectiveApplicationConfig,
  replaceApplicationDraft,
  reviewApplication,
  submitApplicationForReview,
} from '../src/platform.js';
import { validateApplicationDraft } from '../src/applications.js';

const validDraft = (name: string) => validateApplicationDraft({
  name,
  description: 'A test application',
  purpose: 'Test sign in',
  homepageUrl: 'https://client.example.invalid',
  privacyUrl: 'https://client.example.invalid/privacy',
  termsUrl: 'https://client.example.invalid/terms',
  redirectUris: ['https://client.example.invalid/callback'],
  postLogoutRedirectUris: ['https://client.example.invalid/logout'],
  scopes: ['openid', 'profile'],
  groupId: null,
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