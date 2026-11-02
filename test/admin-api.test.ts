import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import express from 'express';
import type { Pool } from 'pg';

import { createAdminApiRouter } from '../src/admin-api.js';
import type { ApplicationGroupService } from '../src/groups.js';
import type { ApplicationService } from '../src/platform.js';
import type { ServiceConfig } from '../src/config.js';

const config = {
  mode: 'development', issuer: 'http://127.0.0.1:3000', port: 3000,
  secrets: { legacyHmacKey: 'legacy-key&&', cookie: 'c'.repeat(43), fingerprint: 'f'.repeat(43), subject: 's'.repeat(43), encryption: 'e'.repeat(43) },
  admin: { username: 'ops', passwordHash: 'hash' }, databases: { oidc: '', accounts: '' },
  redisUrl: 'redis://127.0.0.1:6379/0', redisUsername: null, redisPassword: null,
  trustedProxyCidrs: [], loginRateLimit: { windowSeconds: 900, accountAttempts: 10, ipAttempts: 100 },
  smtp: null, accountPortal: null, profilePictureBaseUrl: null,
} satisfies ServiceConfig;

async function fixture(authenticated: boolean) {
  const pool = { query: async () => ({ rowCount: authenticated ? 1 : 0, rows: authenticated ? [{}] : [] }) } as unknown as Pool;
  const applications = { listForAdmin: async () => ({ total: 1, list: [{ id: 'application-1' }] }) } as unknown as ApplicationService;
  const groups = {} as ApplicationGroupService;
  const app = express();
  app.use('/api/v1/admin', createAdminApiRouter(pool, config, applications, groups));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return { server, baseUrl: `http://127.0.0.1:${address.port}/api/v1/admin` };
}

test('admin API rejects requests without an active administrator session', async (context) => {
  const target = await fixture(false);
  context.after(() => new Promise<void>((resolve) => target.server.close(() => resolve())));
  const response = await fetch(target.baseUrl + '/applications');
  assert.equal(response.status, 401);
  assert.equal((await response.json() as { code: string }).code, 'authentication_required');
});

test('admin API returns application review data for an active session', async (context) => {
  const target = await fixture(true);
  context.after(() => new Promise<void>((resolve) => target.server.close(() => resolve())));
  const response = await fetch(target.baseUrl + '/applications?status=pending&page=1&pageSize=20', { headers: { cookie: 'dt-admin=session-token' } });
  const body = await response.json() as { data: { total: number; list: Array<{ id: string }> } };
  assert.equal(response.status, 200);
  assert.equal(body.data.total, 1);
  assert.equal(body.data.list[0]?.id, 'application-1');
});
