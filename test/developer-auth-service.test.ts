import assert from 'node:assert/strict';
import test from 'node:test';

import { DeveloperAuthError, DeveloperAuthService } from '../src/modules/developer-auth/application/credential.service.js';
import { DeveloperEmailCode } from '../src/modules/developer-auth/domain/email-code.js';
import { hashDeveloperPassword } from '../src/modules/developer/domain/developer-identity.js';

test('email code stores only a keyed digest and can be consumed once', async () => {
  const values = new Map<string, string>();
  const writes: Array<{ key: string; value: string; options: unknown }> = [];
  const redis = {
    async set(key: string, value: string, options: unknown) {
      writes.push({ key, value, options });
      if (typeof options === 'object' && options !== null && 'NX' in options && values.has(key)) return null;
      values.set(key, value);
      return 'OK';
    },
    async getDel(key: string) { const value = values.get(key) ?? null; values.delete(key); return value; },
    async del(key: string) { return values.delete(key) ? 1 : 0; },
  };
  const sent: string[] = [];
  const codes = new DeveloperEmailCode(redis, 'h'.repeat(64), async (_email, code) => { sent.push(code); }, () => '123456');

  await codes.issue('register', 'dev@example.com', '127.0.0.1');

  assert.deepEqual(sent, ['123456']);
  assert.equal(writes.some((item) => item.key.includes('123456') || item.value.includes('123456') || item.value.includes('dev@example.com') || item.value.includes('register')), false);
  assert.equal(await codes.consume('register', 'dev@example.com', '123456'), true);
  assert.equal(await codes.consume('register', 'dev@example.com', '123456'), false);
  assert.equal(await codes.consume('bind', 'dev@example.com', '123456'), false);
});

test('registration consumes a code and creates an unsubmitted developer account', async () => {
  let consumed = 0;
  let createdEmail = '';
  const service = new DeveloperAuthService({
    async createEmailAccount(input) { createdEmail = input.emailNormalized; return { id: 'dev-1', status: 'unsubmitted', revision: 1, lastReview: null, submittedAt: null, approvedAt: null }; },
    async findCredentialByEmail() { return null; },
  }, {
    async consume() { consumed += 1; return true; },
  }, await hashDeveloperPassword('Dummy Password 42!'));

  const account = await service.register(' Dev@Example.com ', 'Correct Horse 42!', '123456');

  assert.equal(consumed, 1);
  assert.equal(createdEmail, 'dev@example.com');
  assert.equal(account.status, 'unsubmitted');
});

test('password login returns one generic error for unknown and wrong credentials', async () => {
  const knownDigest = await hashDeveloperPassword('Correct Horse 42!');
  const dummyDigest = await hashDeveloperPassword('Dummy Password 42!');
  const service = new DeveloperAuthService({
    async createEmailAccount() { throw new Error('not used'); },
    async findCredentialByEmail(email) {
      return email === 'known@example.com'
        ? { developerId: 'dev-1', emailNormalized: email, passwordDigest: knownDigest, status: 'approved' }
        : null;
    },
  }, { async consume() { return false; } }, dummyDigest);

  await assert.rejects(() => service.loginWithPassword('known@example.com', 'Wrong Horse 42!'), (error) => error instanceof DeveloperAuthError && error.code === 'invalid_credentials');
  await assert.rejects(() => service.loginWithPassword('missing@example.com', 'Wrong Horse 42!'), (error) => error instanceof DeveloperAuthError && error.code === 'invalid_credentials');
  assert.equal((await service.loginWithPassword('known@example.com', 'Correct Horse 42!')).developerId, 'dev-1');
});
