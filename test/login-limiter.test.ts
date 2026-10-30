import assert from 'node:assert/strict';
import test from 'node:test';

import { LoginRateLimitError, RedisLoginRateLimiter } from '../src/login-limiter.js';

class FakeRedis {
  calls: Array<{ script: string; options: { keys: string[]; arguments: string[] } }> = [];
  result: unknown = [1, 0, 1, 1];
  failure: Error | null = null;

  async eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown> {
    this.calls.push({ script, options });
    if (this.failure) throw this.failure;
    return this.result;
  }
}

test('login limits use atomic Redis counters without storing identifiers or addresses', async () => {
  const redis = new FakeRedis();
  const limiter = new RedisLoginRateLimiter(redis, 'test-key'.repeat(8));

  await limiter.consume('email', 'Person@example.invalid', '192.0.2.10');

  assert.equal(redis.calls.length, 1);
  assert.match(redis.calls[0]?.script ?? '', /INCR/);
  assert.match(redis.calls[0]?.script ?? '', /EXPIRE/);
  assert.equal(redis.calls[0]?.options.keys.length, 2);
  assert.equal(redis.calls[0]?.options.arguments[0], '900');
  assert.equal(redis.calls[0]?.options.arguments[1], '10');
  assert.equal(redis.calls[0]?.options.arguments[2], '100');
  assert.ok(redis.calls[0]?.options.keys.every((key) => !key.includes('Person') && !key.includes('192.0.2.10')));
});

test('login limiter rejects attempts beyond configured limits and reports retry delay', async () => {
  const redis = new FakeRedis();
  redis.result = [0, 73, 11, 11];
  const limiter = new RedisLoginRateLimiter(redis, 'test-key'.repeat(8));

  await assert.rejects(
    limiter.consume('username', 'sample-user', '192.0.2.11'),
    (error: unknown) => error instanceof LoginRateLimitError && error.retryAfterSeconds === 73,
  );
});

test('Redis failures propagate so login cannot fall back to an unthrottled path', async () => {
  const redis = new FakeRedis();
  redis.failure = new Error('redis unavailable');
  const limiter = new RedisLoginRateLimiter(redis, 'test-key'.repeat(8));

  await assert.rejects(limiter.consume('username', 'sample-user', '192.0.2.12'), /redis unavailable/);
});
