import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import express from 'express';
import type { Pool } from 'pg';

import { createAdminApiRouter } from '../src/admin-api.js';
import { DeveloperReviewError, type PostgresDeveloperStore } from '../src/developer-store.js';
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

async function fixture(store: Partial<PostgresDeveloperStore>) {
  const pool = { query: async () => ({ rowCount: 1, rows: [{}] }) } as unknown as Pool;
  const app = express();
  app.use('/api/v1/admin', createAdminApiRouter(pool, config, {} as ApplicationService, {} as ApplicationGroupService, store as PostgresDeveloperStore));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return { server, baseUrl: `http://127.0.0.1:${address.port}/api/v1/admin` };
}

test('administrator lists developers with status pagination filters', async (context) => {
  let received: unknown[] = [];
  const target = await fixture({ listForAdmin: async (...args: unknown[]) => { received = args; return { total: 1, list: [{ id: 'developer-1', status: 'pending' }] }; } } as never);
  context.after(() => new Promise<void>((resolve) => target.server.close(() => resolve())));

  const response = await fetch(target.baseUrl + '/developers?status=pending&page=2&pageSize=10', { headers: { cookie: 'dt-admin=session' } });
  const body = await response.json() as { data: { total: number } };

  assert.equal(response.status, 200);
  assert.equal(body.data.total, 1);
  assert.deepEqual(received, ['pending', 2, 10]);
});

test('administrator review requires a reason and reports optimistic conflicts', async (context) => {
  const target = await fixture({ reviewDeveloper: async () => { throw new DeveloperReviewError('review_conflict'); } } as never);
  context.after(() => new Promise<void>((resolve) => target.server.close(() => resolve())));
  const headers = { cookie: 'dt-admin=session; dt-console-csrf=token', origin: config.issuer, 'x-csrf-token': 'token', 'content-type': 'application/json' };

  const missingReason = await fetch(target.baseUrl + '/developers/developer-1/review', { method: 'POST', headers, body: JSON.stringify({ action: 'reject', expectedRevision: 2 }) });
  assert.equal(missingReason.status, 400);

  const conflict = await fetch(target.baseUrl + '/developers/developer-1/review', { method: 'POST', headers, body: JSON.stringify({ action: 'approve', expectedRevision: 2 }) });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json() as { code: string }).code, 'review_conflict');
});
