import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { bootstrapNest } from '../src/bootstrap/bootstrap.js';
import { HealthService } from '../src/modules/health/health.service.js';

const secret = () => randomBytes(32).toString('base64url');

async function target(context: test.TestContext) {
  const path = join(tmpdir(), `nest-web-${randomBytes(6).toString('hex')}.json`);
  await writeFile(path, JSON.stringify({ mode: 'test', issuer: 'http://127.0.0.1:3000', port: 3000, secrets: { legacyHmacKey: secret(), cookie: secret(), fingerprint: secret(), subject: secret(), encryption: secret() }, admin: { username: 'ops', passwordHash: 'scrypt$16384$8$1$salt$hash' }, databases: { oidc: 'postgres://a:b@localhost/a', accounts: 'postgres://a:b@localhost/b' }, redisUrl: 'redis://localhost:6379' }));
  const handle = await bootstrapNest({ configPath: path, port: 0, logger: false });
  context.after(handle.close);
  return `http://127.0.0.1:${handle.port}`;
}

test('Nest web contract preserves health and SPA hosting', async (context) => {
  const base = await target(context);
  const live = await fetch(base + '/health/live');
  assert.equal(live.status, 200); assert.equal((await live.json() as { status: string }).status, 'ok');
  assert.equal((await fetch(base + '/health/ready')).status, 503);
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/developer/console/overview')).status, 200);
  const developer = await fetch(base + '/developer', { redirect: 'manual' }); assert.equal(developer.status, 303); assert.equal(developer.headers.get('location'), '/developer/overview');
  const account = await fetch(base + '/account', { redirect: 'manual' }); assert.equal(account.status, 303); assert.equal(account.headers.get('location'), '/account/profile');
  const moondrop = await fetch(base + '/developer/login/moondrop?returnTo=%2Fdeveloper%2Fapplications', { redirect: 'manual' }); assert.equal(moondrop.status, 303); assert.match(moondrop.headers.get('location') ?? '', /^\/portal\/sign-in/);
  assert.equal((await fetch(base + '/account/profile')).status, 200);
  assert.equal((await fetch(base + '/admin/applications')).status, 200);
  assert.equal((await fetch(base + '/admin/login')).status, 404);
  assert.equal((await fetch(base + '/assets/not-present.js')).status, 404);
  assert.equal((await fetch(base + '/assets/%2e%2e/package.json')).status, 404);
});

test('Nest web contract readiness checks all configured dependencies', async () => {
  const calls: string[] = [];
  const dependency = (name: string) => ({ async query() { calls.push(name); }, async ping() { calls.push(name); } });
  const health = new HealthService(dependency('oidc'), dependency('accounts'), dependency('command'), dependency('subscriber'));
  await health.ready();
  assert.deepEqual(calls.sort(), ['accounts', 'command', 'oidc', 'subscriber']);
});
