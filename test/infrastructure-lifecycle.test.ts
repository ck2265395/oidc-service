import assert from 'node:assert/strict';
import test from 'node:test';

import { DatabaseLifecycle } from '../src/infrastructure/database/database.module.js';
import { RedisLifecycle } from '../src/infrastructure/redis/redis.module.js';
import { EmailLifecycle } from '../src/infrastructure/email/email.module.js';
import { ACCOUNT_POOL, OIDC_POOL, REDIS_COMMAND, REDIS_SUBSCRIBER } from '../src/common/tokens/injection-tokens.js';

function pool(fail = false) {
  return { queries: 0, closes: 0, async query() { this.queries++; if (fail) throw new Error('offline'); }, async end() { this.closes++; } };
}

function redis(fail = false) {
  return { isOpen: false, connects: 0, closes: 0, async connect() { this.connects++; if (fail) throw new Error('offline'); this.isOpen = true; }, async quit() { this.closes++; this.isOpen = false; } };
}

test('infrastructure providers create distinct readiness dependencies', async () => {
  assert.notEqual(OIDC_POOL, ACCOUNT_POOL);
  assert.notEqual(REDIS_COMMAND, REDIS_SUBSCRIBER);
  const oidc = pool(); const accounts = pool();
  const owner = new DatabaseLifecycle(oidc, accounts);
  await owner.onModuleInit();
  assert.equal(oidc.queries, 1); assert.equal(accounts.queries, 1);
});

test('SIGTERM shutdown closes every resource exactly once', async () => {
  const oidc = pool(); const accounts = pool();
  const command = redis(); const subscriber = redis();
  const database = new DatabaseLifecycle(oidc, accounts);
  const cache = new RedisLifecycle(command, subscriber);
  const mailer = { closes: 0, close() { this.closes++; } };
  const email = new EmailLifecycle(mailer as never);
  await database.onModuleInit(); await cache.onModuleInit();
  await database.onApplicationShutdown('SIGTERM'); await cache.onApplicationShutdown('SIGTERM');
  email.onApplicationShutdown();
  await database.onApplicationShutdown('SIGTERM'); await cache.onApplicationShutdown('SIGTERM');
  email.onApplicationShutdown();
  assert.deepEqual([oidc.closes, accounts.closes, command.closes, subscriber.closes, mailer.closes], [1, 1, 1, 1, 1]);
});

test('partial startup failure still permits idempotent infrastructure cleanup', async () => {
  const oidc = pool(); const accounts = pool(true);
  const owner = new DatabaseLifecycle(oidc, accounts);
  await assert.rejects(owner.onModuleInit(), /offline/);
  await owner.onApplicationShutdown(); await owner.onApplicationShutdown();
  assert.deepEqual([oidc.closes, accounts.closes], [1, 1]);
});
