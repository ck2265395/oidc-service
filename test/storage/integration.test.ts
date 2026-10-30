import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { createClient } from 'redis';
import type { AdapterPayload } from 'oidc-provider';

import { ApplicationGroupService } from '../../src/groups.js';
import { PostgresOidcAdapter } from '../../src/adapter.js';
import { LoginRateLimitError, RedisLoginRateLimiter } from '../../src/login-limiter.js';
import { ApplicationService } from '../../src/platform.js';
import { createPlatformPool, PostgresApplicationRepository } from '../../src/store.js';

const databaseUrl = process.env.OIDC_TEST_DATABASE_URL;
const redisUrl = process.env.REDIS_TEST_URL;

test('PostgreSQL repositories and Redis security controls work across connections', {
  skip: !databaseUrl || !redisUrl,
}, async () => {
  if (!databaseUrl || !redisUrl) return;
  const pool = createPlatformPool(databaseUrl);
  const redisA = createClient({ url: redisUrl });
  const redisB = createClient({ url: redisUrl! });
  const ownerUuid = randomUUID();
  const reviewerUuid = randomUUID();
  const groupId = randomUUID();
  let applicationId: string | null = null;

  try {
    await Promise.all([redisA.connect(), redisB.connect()]);
    await pool.query(await readFile(new URL('../../sql/postgre.sql', import.meta.url), 'utf8'));

    const repository = new PostgresApplicationRepository(pool, 'development');
    const profile = await repository.saveDeveloperProfile(ownerUuid, 'Storage Example', 'storage@example.invalid', 0);
    assert.equal(profile?.revision, 1);
    assert.equal(profile?.contactEmailVerified, false);

    const groups = new ApplicationGroupService(repository, () => groupId);
    const group = await groups.create(ownerUuid, 'Integration Group');
    assert.equal((await groups.listOwned(ownerUuid)).list[0]?.id, groupId);

    const applications = new ApplicationService(repository, 'development');
    const draft = {
      name: 'Storage Integration Client',
      description: 'Database integration check',
      purpose: 'Validate persistence adapters',
      homepageUrl: 'https://client.example.invalid',
      privacyUrl: 'https://client.example.invalid/privacy',
      termsUrl: 'https://client.example.invalid/terms',
      iconUrl: null,
      redirectUris: ['http://127.0.0.1:4100/callback'],
      postLogoutRedirectUris: ['http://127.0.0.1:4100/logout/callback'],
      scopes: ['openid', 'profile'],
      groupId,
    };
    const created = await applications.create(ownerUuid, 'spa', draft);
    applicationId = created.id;
    assert.equal((await repository.getOwnedApplication(created.id, ownerUuid))?.clientId, created.clientId);
    assert.equal(await repository.groupApprovedBy(ownerUuid, groupId), false);

    await applications.submit(created.id, ownerUuid, created.revision);
    await applications.review(created.id, created.revision, { action: 'approve', reviewerUuid });
    assert.equal((await applications.activeClient(created.clientId))?.config.groupId, null);

    await groups.review(groupId, group.revision, { action: 'approve', reviewerUuid });
    assert.equal((await applications.activeClient(created.clientId))?.config.name, draft.name);
    assert.equal((await applications.activeClient(created.clientId))?.config.groupId, groupId);
    assert.equal((await repository.listForAdmin?.(1, 10, 'approved'))?.total, 1);

    const key = randomBytesForTest();
    const limiterA = new RedisLoginRateLimiter(redisA, key, 60, 1, 20);
    const limiterB = new RedisLoginRateLimiter(redisB, key, 60, 1, 20);
    await limiterA.consume(ownerUuid, 'username', 'first-alias', '127.0.0.1');
    await assert.rejects(
      limiterB.consume(ownerUuid, 'email', 'second-alias', '127.0.0.2'),
      LoginRateLimitError,
    );

    const replayId = randomUUID();
    const payload = { jti: replayId, exp: Math.floor(Date.now() / 1000) + 60 } as unknown as AdapterPayload;
    const replayA = new PostgresOidcAdapter('ReplayDetection', pool, applications, redisA);
    const replayB = new PostgresOidcAdapter('ReplayDetection', pool, applications, redisB);
    await replayA.upsert(replayId, payload, 60);
    assert.deepEqual(await replayB.find(replayId), payload);
    await assert.rejects(replayB.upsert(replayId, payload, 60), /rejected|failed/i);
    await replayA.destroy(replayId);
    assert.equal(await replayB.find(replayId), undefined);
  } finally {
    if (applicationId) {
      await pool.query('DELETE FROM application_review_history WHERE application_id = $1', [applicationId]);
      await pool.query('DELETE FROM platform_audit WHERE application_id = $1', [applicationId]);
      await pool.query('DELETE FROM oidc_application WHERE id = $1', [applicationId]);
    }
    await pool.query('DELETE FROM application_group_review_history WHERE group_id = $1', [groupId]);
    await pool.query('DELETE FROM application_group WHERE id = $1', [groupId]);
    await pool.query('DELETE FROM developer_profile WHERE account_uuid = $1', [ownerUuid]);
    await Promise.allSettled([redisA.quit(), redisB.quit(), pool.end()]);
  }
});

function randomBytesForTest(): string {
  return randomUUID() + randomUUID();
}
