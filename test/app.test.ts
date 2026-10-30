import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';

import { createApplication } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const config = loadConfig({
  mode: 'test',
  issuer: 'https://identity.example.test',
  port: 3000,
  secrets: {
    cookie: 'c'.repeat(48),
    fingerprint: 'f'.repeat(48),
    subject: 's'.repeat(48),
    encryption: 'e'.repeat(48),
  },
  admin: { username: 'ops', passwordHash: 'scrypt$16384$8$1$salt$hash' },
  databases: {
    oidc: 'postgres://oidc:secret@localhost:5432/oidc_test',
    accounts: 'postgres://reader:secret@localhost:5432/accounts_test',
  },
  redisUrl: 'redis://localhost:6379/0',
});

test('health endpoint returns a request id and disables caching', async (context) => {
  const server = createServer(createApplication(config));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const response = await fetch(`http://127.0.0.1:${address.port}/health/live`);
  const body = await response.json() as { status: string; requestId: string };

  assert.equal(response.status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-request-id'), body.requestId);
});

test('unknown routes do not reveal internal error details', async (context) => {
  const server = createServer(createApplication(config));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const response = await fetch(`http://127.0.0.1:${address.port}/private-error`);
  const body = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 404);
  assert.deepEqual(Object.keys(body).sort(), ['error', 'requestId']);
  assert.equal(body.error, 'not_found');
});