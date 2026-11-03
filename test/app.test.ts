import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createServer } from 'node:http';

import express from 'express';

import { createApplication } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const testSecret = () => randomBytes(32).toString('base64url');

const config = loadConfig({
  mode: 'test',
  issuer: 'https://identity.example.test',
  port: 3000,
  secrets: {
    legacyHmacKey: randomBytes(32).toString('base64url'),
    cookie: testSecret(),
    fingerprint: testSecret(),
    subject: testSecret(),
    encryption: testSecret(),
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

test('public sources contain no administrator entry', async () => {
  const source = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /\/admin|运营管理|OPERATIONS/);
});

test('console routes serve the frontend shell without shadowing API routes', async (context) => {
  const server = createServer(createApplication(config));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const consoleResponse = await fetch(`http://127.0.0.1:${address.port}/developer/overview`);
  const developerLogin = await fetch(`http://127.0.0.1:${address.port}/developer/login`);
  const homeResponse = await fetch(`http://127.0.0.1:${address.port}/`);
  const apiResponse = await fetch(`http://127.0.0.1:${address.port}/api/v1/unknown`);

  assert.equal(consoleResponse.status, 200);
  assert.match(consoleResponse.headers.get('content-type') ?? '', /^text\/html/);
  assert.match(await consoleResponse.text(), /<div id="root"><\/div>/);
  assert.equal(developerLogin.status, 200);
  assert.match(developerLogin.headers.get('content-type') ?? '', /^text\/html/);
  assert.match(await homeResponse.text(), /<div id="root"><\/div>/);
  assert.equal(apiResponse.status, 404);
  assert.deepEqual((await apiResponse.json() as { error: string }).error, 'not_found');
});
test('readiness endpoint checks dependencies and fails closed on dependency errors', async (context) => {
  const unavailable = createServer(createApplication(config, undefined, undefined, undefined, undefined, undefined, async () => {
    throw new Error('dependency unavailable');
  }));
  await new Promise<void>((resolve) => unavailable.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise<void>((resolve, reject) => {
    unavailable.close((error) => error ? reject(error) : resolve());
  }));

  const address = unavailable.address();
  assert.ok(address && typeof address !== 'string');
  const response = await fetch(`http://127.0.0.1:${address.port}/health/ready`);
  const body = await response.json() as { status: string; requestId: string };

  assert.equal(response.status, 503);
  assert.equal(body.status, 'unavailable');
  assert.equal(response.headers.get('x-request-id'), body.requestId);
});

test('developer auth API is mounted before the developer SPA fallback', async (context) => {
  const developerAuth = express.Router();
  developerAuth.get('/session', (_request, response) => response.json({ code: 0, data: { account: null } }));
  const app = createApplication(config, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, developerAuth);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/developer-auth/session`);
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { code: number }).code, 0);
});
