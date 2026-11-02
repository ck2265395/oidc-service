import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import express from 'express';
import type Provider from 'oidc-provider';
import type { Pool } from 'pg';

import { createAccountApiRouter } from '../src/account-api.js';
import type { ServiceConfig } from '../src/config.js';

const config = {
  mode: 'development', issuer: 'http://127.0.0.1:3000', port: 3000,
  secrets: { legacyHmacKey: 'legacy-key&&', cookie: 'c'.repeat(43), fingerprint: 'f'.repeat(43), subject: 's'.repeat(43), encryption: 'e'.repeat(43) },
  admin: { username: 'ops', passwordHash: 'hash' }, databases: { oidc: '', accounts: '' },
  redisUrl: 'redis://127.0.0.1:6379/0', redisUsername: null, redisPassword: null,
  trustedProxyCidrs: [], loginRateLimit: { windowSeconds: 900, accountAttempts: 10, ipAttempts: 100 },
  smtp: null, accountPortal: null, profilePictureBaseUrl: null,
} satisfies ServiceConfig;

test('account API lists only grants associated with the signed provider session', async (context) => {
  const accountId = 'user-1.' + 'a'.repeat(43);
  const provider = { createContext: () => ({}), Session: { get: async () => ({ accountId }) } } as unknown as Provider;
  let queryAccountId = '';
  const pool = { query: async (_query: string, values: unknown[]) => {
    queryAccountId = String(values[0]);
    return { rowCount: 1, rows: [{ document_id: 'grant-1', client_id: 'client-1', scope: 'openid profile', created_at: new Date('2026-01-02T03:04:05Z'), name: 'Moon App', status: 'approved' }] };
  } } as unknown as Pool;
  const app = express(); app.use('/api/v1/account', createAccountApiRouter(pool, provider, config));
  const server = createServer(app); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address !== 'string');

  const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/account/authorizations`);
  const body = await response.json() as { data: Array<{ id: string; scopes: string[] }> };

  assert.equal(response.status, 200);
  assert.equal(queryAccountId, accountId);
  assert.deepEqual(body.data[0], { id: 'grant-1', clientId: 'client-1', name: 'Moon App', scopes: ['openid', 'profile'], status: 'approved', authorizedAt: '2026-01-02T03:04:05.000Z' });
});

test('account API refuses to revoke a grant not owned by the signed session', async (context) => {
  const accountId = 'user-1.' + 'a'.repeat(43);
  let grantLookupCalled = false;
  const provider = {
    createContext: () => ({}), Session: { get: async () => ({ accountId }) },
    Grant: { find: async () => { grantLookupCalled = true; return null; } },
  } as unknown as Provider;
  const pool = { query: async () => ({ rowCount: 0, rows: [] }) } as unknown as Pool;
  const app = express(); app.use('/api/v1/account', createAccountApiRouter(pool, provider, config));
  const server = createServer(app); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address !== 'string');

  const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/account/authorizations/other-grant`, {
    method: 'DELETE',
    headers: { origin: config.issuer, cookie: 'dt-console-csrf=test-token', 'x-csrf-token': 'test-token' },
  });

  assert.equal(response.status, 404);
  assert.equal(grantLookupCalled, false);
});
