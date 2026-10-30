import assert from 'node:assert/strict';
import test from 'node:test';

import type { AdapterPayload } from 'oidc-provider';
import type { Pool } from 'pg';

import { PostgresOidcAdapter } from '../src/adapter.js';
import type { ApplicationService } from '../src/platform.js';

class FakeRedis {
  readonly values = new Map<string, string>();
  readonly calls: Array<{ key: string; options: { EX: number; NX: true } }> = [];
  allowInsert = true;

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string, options: { EX: number; NX: true }): Promise<string | null> {
    this.calls.push({ key, options });
    if (!this.allowInsert || this.values.has(key)) return null;
    this.values.set(key, value);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    return this.values.delete(key) ? 1 : 0;
  }
}

test('ReplayDetection records use Redis NX with an expiry instead of PostgreSQL', async () => {
  const redis = new FakeRedis();
  const adapter = new PostgresOidcAdapter('ReplayDetection', {} as Pool, {} as ApplicationService, redis);
  const payload = { expiresAt: 1234567890 } as AdapterPayload;

  await adapter.upsert('request-id', payload, 45);

  assert.equal(redis.calls[0]?.key, 'dt:oidc:replay:request-id');
  assert.deepEqual(redis.calls[0]?.options, { EX: 45, NX: true });
  assert.deepEqual(await adapter.find('request-id'), payload);
  await adapter.destroy('request-id');
  assert.equal(await adapter.find('request-id'), undefined);
});

test('ReplayDetection rejects duplicate writes and fails closed when Redis is absent', async () => {
  const redis = new FakeRedis();
  const adapter = new PostgresOidcAdapter('ReplayDetection', {} as Pool, {} as ApplicationService, redis);
  const payload = { expiresAt: 1234567890 } as AdapterPayload;

  await adapter.upsert('request-id', payload, 45);
  await assert.rejects(adapter.upsert('request-id', payload, 45), /OIDC replay storage write failed/);

  const unavailable = new PostgresOidcAdapter('ReplayDetection', {} as Pool, {} as ApplicationService);
  await assert.rejects(unavailable.upsert('another-id', payload, 45), /OIDC replay storage is unavailable/);
});
