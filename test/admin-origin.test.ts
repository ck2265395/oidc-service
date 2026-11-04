import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import express from 'express';
import type { Pool } from 'pg';

import { createAdminLoginRouter } from '../src/modules/admin/admin-login.router.js';
import type { ServiceConfig } from '../src/infrastructure/config/config.schema.js';
import { AdminAuthenticationService, hashAdminPassword } from '../src/modules/admin/application/admin-authentication.service.js';

test('accepts an opaque Origin only for a browser-declared same-origin form', async (context) => {
  const pool = {
    query: async (sql: string) => sql.startsWith('SELECT coalesce(bool_or')
      ? { rows: [{ blocked: false }], rowCount: 1 }
      : { rows: [], rowCount: 1 },
  } as unknown as Pool;
  const config = {
    mode: 'development',
    issuer: 'http://127.0.0.1:3000',
    port: 3000,
    secrets: { legacyHmacKey: 'legacy-key&&', cookie: 'c'.repeat(43), fingerprint: 'f'.repeat(43), subject: 's'.repeat(43), encryption: 'e'.repeat(43) },
    databases: { oidc: '', accounts: '' },
    redisUrl: 'redis://127.0.0.1:6379/0',
    redisUsername: null,
    redisPassword: null,
    trustedProxyCidrs: [],
    loginRateLimit: { windowSeconds: 900, accountAttempts: 10, ipAttempts: 100 },
    smtp: null,
    accountPortal: null,
    profilePictureBaseUrl: null,
  } satisfies ServiceConfig;
  const passwordHash = hashAdminPassword('correct-password');
  const authentication = new AdminAuthenticationService({ async findCredential(username) { return username === 'admin' ? { principal: { id: 'admin-id', username: 'admin', mustChangePassword: false }, passwordHash, status: 'active' } : null; } });
  const sessions: Array<[string, string]> = [];
  const repository = { async createSession(adminId: string, sessionHash: string) { sessions.push([adminId, sessionHash]); } };
  const app = express();
  app.use('/admin', createAdminLoginRouter(pool, config, authentication, repository));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const loginPage = await fetch(baseUrl + '/admin/login');
  const html = await loginPage.text();
  const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1];
  const cookie = loginPage.headers.getSetCookie()[0]?.split(';', 1)[0];
  assert.ok(csrf && cookie);

  const response = await fetch(baseUrl + '/admin/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie,
      origin: 'null',
      'sec-fetch-site': 'same-origin',
    },
    body: new URLSearchParams({ csrf, username: 'admin', password: 'wrong-password' }),
  });

  assert.equal(response.status, 401);

  const success = await fetch(baseUrl + '/admin/login', {
    method: 'POST', redirect: 'manual',
    headers: {
      'content-type': 'application/json',
      cookie,
      origin: 'null',
      'sec-fetch-site': 'same-origin',
    },
    body: JSON.stringify({ csrf, username: 'admin', password: 'correct-password' }),
  });
  const sessionCookie = success.headers.get('set-cookie') ?? '';
  assert.equal(success.status, 303);
  assert.equal(success.headers.get('location'), '/admin/applications');
  assert.match(sessionCookie, /^dt-admin=/);
  assert.match(sessionCookie, /HttpOnly/i);
  assert.match(sessionCookie, /SameSite=Strict/i);
  assert.match(sessionCookie, /Path=\//i);
  assert.equal(sessions[0]?.[0], 'admin-id');
});
