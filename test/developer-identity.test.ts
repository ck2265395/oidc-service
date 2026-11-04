import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertDeveloperTransition,
  hashDeveloperPassword,
  normalizeDeveloperEmail,
  verifyDeveloperPassword,
} from '../src/modules/developer/domain/developer-identity.js';

test('normalizes developer email without locale-dependent rules', () => {
  assert.equal(normalizeDeveloperEmail('  Developer.Name@Example.COM  '), 'developer.name@example.com');
  assert.throws(() => normalizeDeveloperEmail('not-an-email'), /email/i);
  assert.throws(() => normalizeDeveloperEmail(`${'a'.repeat(245)}@example.com`), /email/i);
});

test('developer passwords require length and character diversity', async () => {
  await assert.rejects(() => hashDeveloperPassword('short1!A'), /password/i);
  await assert.rejects(() => hashDeveloperPassword('alllowercasepassword'), /password/i);
});

test('developer password digests verify only the original password', async () => {
  const digest = await hashDeveloperPassword('Correct Horse 42!');

  assert.equal(digest.version, 'scrypt-v1');
  assert.equal(await verifyDeveloperPassword('Correct Horse 42!', digest), true);
  assert.equal(await verifyDeveloperPassword('Wrong Horse 42!', digest), false);
  assert.equal(await verifyDeveloperPassword('Correct Horse 42!', { ...digest, hash: 'invalid' }), false);
});

test('developer review state machine permits only explicit transitions', () => {
  assert.equal(assertDeveloperTransition('unsubmitted', 'submit'), 'pending');
  assert.equal(assertDeveloperTransition('rejected', 'submit'), 'pending');
  assert.equal(assertDeveloperTransition('pending', 'approve'), 'approved');
  assert.equal(assertDeveloperTransition('pending', 'reject'), 'rejected');
  assert.equal(assertDeveloperTransition('approved', 'disable'), 'disabled');
  assert.equal(assertDeveloperTransition('disabled', 'restore'), 'unsubmitted');

  assert.throws(() => assertDeveloperTransition('unsubmitted', 'approve'), /transition/i);
  assert.throws(() => assertDeveloperTransition('pending', 'submit'), /transition/i);
  assert.throws(() => assertDeveloperTransition('disabled', 'approve'), /transition/i);
});
