import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import express from 'express';
import type { Pool } from 'pg';

import { createAdminLoginRouter } from '../src/modules/admin/admin-login.router.js';
import type { ServiceConfig } from '../src/config.js';
import { hashScryptPassword } from '../src/security.js';

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
    admin: { username: 'admin', passwordHash: hashScryptPassword('correct-password') },
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
  const app = express();
  app.use('/admin', createAdminLoginRouter(pool, config));
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
      'content-type': 'application/x-www-form-urlencoded',
      cookie,
      origin: 'null',
      'sec-fetch-site': 'same-origin',
    },
    body: new URLSearchParams({ csrf, username: 'admin', password: 'correct-password' }),
  });
  const sessionCookie = success.headers.get('set-cookie') ?? '';
  assert.equal(success.status, 303);
  assert.equal(success.headers.get('location'), '/admin/applications');
  assert.match(sessionCookie, /^dt-admin=/);
  assert.match(sessionCookie, /HttpOnly/i);
  assert.match(sessionCookie, /SameSite=Strict/i);
  assert.match(sessionCookie, /Path=\//i);
});
