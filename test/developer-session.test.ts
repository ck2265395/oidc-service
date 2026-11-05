import assert from 'node:assert/strict';
import test from 'node:test';

import { DeveloperSessionService } from '../src/modules/developer/application/developer-session.service.js';

test('developer sessions store only a SHA-256 digest and resolve current account state', async () => {
  let storedHash = '';
  let storedExpiry: Date | null = null;
  const account = { id: 'dev-1', status: 'approved', revision: 2, lastReview: null, submittedAt: null, approvedAt: null } as const;
  const store = {
    async createSession(_developerId: string, hash: string, expiry: Date) { storedHash = hash; storedExpiry = expiry; },
    async resolveSession(hash: string) { assert.equal(hash, storedHash); return account; },
    async touchSession() {},
    async revokeSession() {},
  };
  const opaqueToken = 't'.repeat(43);
  const sessions = new DeveloperSessionService(store, () => opaqueToken, () => new Date('2026-11-02T00:00:00.000Z'));

  const token = await sessions.create('dev-1');
  const resolved = await sessions.resolve(token);

  assert.equal(token, opaqueToken);
  assert.match(storedHash, /^[a-f0-9]{64}$/);
  assert.equal(storedHash.includes(token), false);
  assert.ok(storedExpiry);
  assert.equal((storedExpiry as Date).toISOString(), '2026-12-02T00:00:00.000Z');
  assert.equal(resolved?.id, 'dev-1');
});

test('developer sessions reject malformed tokens without querying storage', async () => {
  let queried = false;
  const sessions = new DeveloperSessionService({
    async createSession() {},
    async resolveSession() { queried = true; return null; },
    async touchSession() {},
    async revokeSession() {},
  });

  assert.equal(await sessions.resolve('short'), null);
  assert.equal(queried, false);
});
