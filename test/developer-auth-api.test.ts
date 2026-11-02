import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import express from 'express';

import { createDeveloperAuthRouter } from '../src/developer-auth.js';

test('developer auth API creates an isolated developer cookie and returns its session', async (context) => {
  const account = { id: 'dev-1', status: 'unsubmitted', revision: 1, lastReview: null, submittedAt: null, approvedAt: null } as const;
  const sessions = {
    async create() { return 't'.repeat(43); },
    async resolve(token: string) { return token === 't'.repeat(43) ? account : null; },
    async revoke() {},
  };
  const router = createDeveloperAuthRouter({
    issuer: 'http://127.0.0.1:3000', secureCookies: false,
    auth: { async register() { return account; }, async loginWithPassword() { return { developerId: account.id, emailNormalized: 'dev@example.com', passwordDigest: {} as never, status: account.status }; } },
    codes: { async issue() { return 'sent' as const; } },
    sessions,
  });
  const app = express(); app.use('/api/v1/developer-auth', router);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/v1/developer-auth`;

  const login = await fetch(base + '/login', {
    method: 'POST', headers: { origin: 'http://127.0.0.1:3000', 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'dev@example.com', password: 'Correct Horse 42!' }),
  });
  const cookie = login.headers.get('set-cookie') ?? '';
  assert.equal(login.status, 200);
  assert.match(cookie, /md-developer=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);

  const session = await fetch(base + '/session', { headers: { cookie: `md-developer=${'t'.repeat(43)}` } });
  const body = await session.json() as { data: { account: { id: string; status: string } | null; csrfToken: string } };
  assert.equal(body.data.account?.id, 'dev-1');
  assert.equal(body.data.account?.status, 'unsubmitted');
  assert.match(body.data.csrfToken, /^[A-Za-z0-9_-]{43}$/);
});

test('developer auth API rejects cross-origin credential mutations', async (context) => {
  const router = createDeveloperAuthRouter({
    issuer: 'http://127.0.0.1:3000', secureCookies: false,
    auth: { async register() { throw new Error('not called'); }, async loginWithPassword() { throw new Error('not called'); } },
    codes: { async issue() { throw new Error('not called'); } },
    sessions: { async create() { return ''; }, async resolve() { return null; }, async revoke() {} },
  });
  const app = express(); app.use('/api/v1/developer-auth', router);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address !== 'string');

  const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/developer-auth/login`, {
    method: 'POST', headers: { origin: 'https://attacker.invalid', 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(response.status, 403);
});
