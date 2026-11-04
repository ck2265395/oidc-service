import assert from 'node:assert/strict';
import test from 'node:test';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import type { Express } from 'express';

import { configureHttpFoundation } from '../src/common/middleware/request-context.middleware.js';
import { AccountModule, type AccountModuleOptions } from '../src/modules/account/account.module.js';
import { testServiceConfig } from './fixtures/service-config.js';

async function service(options: Partial<AccountModuleOptions> = {}) {
  const config = { ...testServiceConfig(), profilePictureBaseUrl: 'https://identity.example.test/' };
  const authorizations = [{ id: 'grant-1', clientId: 'client-1', name: 'Example', scopes: ['openid'], status: 'approved', authorizedAt: '2026-01-01T00:00:00.000Z' }];
  const repository = {
    async listAuthorizations(accountId: string) { return accountId.startsWith('user-1.') ? authorizations : []; },
    async authorizationOwned(id: string, accountId: string) { return id === 'grant-1' && accountId.startsWith('user-1.'); },
    async recordRevocation() { return; },
  };
  const sessions = {
    async accountId() { return 'user-1.' + 'a'.repeat(43); },
    async revokeGrant(id: string, accountId: string) { return id === 'grant-1' && accountId.startsWith('user-1.') ? { clientId: 'client-1' } : null; },
  };
  const resolver = {
    async resolve(uuid: string, fingerprint: string) {
      return uuid === 'user-1' && fingerprint === 'a'.repeat(43)
        ? { uuid, sub: 'sub', fingerprint, profile: { nickname: 'Moon', email: 'moon@example.com', picture: '/avatars/moon.png' } }
        : null;
    },
  };
  const dependencies: AccountModuleOptions = { config, repository, sessions, resolver, ...options };
  @Module({ imports: [AccountModule.register(dependencies)] })
  class TestModule {}
  const app = await NestFactory.create(TestModule, new ExpressAdapter(), { logger: false, bodyParser: false });
  configureHttpFoundation(app.getHttpAdapter().getInstance() as Express, config, { log() {} });
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  assert.ok(address && typeof address !== 'string');
  return { base: `http://127.0.0.1:${address.port}`, close: () => app.close() };
}

test('Nest account API returns authenticated profile and masks email', async (context) => {
  const target = await service(); context.after(target.close);
  const response = await fetch(target.base + '/api/v1/me');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { code: 0, desc: 'ok', data: { nickname: 'Moon', email: 'm***@example.com', picture: 'https://identity.example.test/avatars/moon.png' } });
});

test('Nest account API preserves anonymous profile and session contracts', async (context) => {
  const target = await service({ sessions: { async accountId() { return null; }, async revokeGrant() { return null; } } }); context.after(target.close);
  const profile = await fetch(target.base + '/api/v1/me');
  assert.equal(profile.status, 401);
  assert.deepEqual(await profile.json(), { code: 'authentication_required', desc: 'Sign in is required', data: null });
  const session = await fetch(target.base + '/api/v1/session');
  assert.equal(session.status, 200);
  const body = await session.json() as { data: { account: unknown; admin: unknown; csrfToken: string } };
  assert.equal(body.data.account, null); assert.deepEqual(body.data.admin, { authenticated: false }); assert.match(body.data.csrfToken, /^[A-Za-z0-9_-]{43}$/);
});

test('Nest account API exposes administrator bootstrap without session identifiers', async (context) => {
  const target = await service({ adminAuth: { async authenticated() { return { id: 'admin-id', username: 'ops', mustChangePassword: false }; } } }); context.after(target.close);
  const response = await fetch(target.base + '/api/v1/session');
  assert.equal(response.status, 200);
  const body = await response.json() as { data: { admin: unknown } };
  assert.deepEqual(body.data.admin, { authenticated: true, username: 'ops' });
  assert.deepEqual(Object.keys(body.data.admin as object).sort(), ['authenticated', 'username']);
});

test('Nest account API enforces authorization ownership and CSRF before revocation', async (context) => {
  const target = await service(); context.after(target.close);
  const listed = await fetch(target.base + '/api/v1/account/authorizations');
  assert.equal(listed.status, 200);
  assert.equal((await listed.json() as { data: unknown[] }).data.length, 1);
  assert.equal((await fetch(target.base + '/api/v1/account/authorizations/grant-1', { method: 'DELETE' })).status, 403);
  const csrf = 'b'.repeat(43);
  const revoked = await fetch(target.base + '/api/v1/account/authorizations/grant-1', {
    method: 'DELETE', headers: { origin: 'https://identity.example.test', cookie: `dt-console-csrf=${csrf}`, 'x-csrf-token': csrf },
  });
  assert.equal(revoked.status, 200);
  assert.deepEqual(await revoked.json(), { code: 0, desc: 'ok', data: { revoked: true } });
  const missing = await fetch(target.base + '/api/v1/account/authorizations/not-owned', {
    method: 'DELETE', headers: { origin: 'https://identity.example.test', cookie: `dt-console-csrf=${csrf}`, 'x-csrf-token': csrf },
  });
  assert.equal(missing.status, 404);
});
