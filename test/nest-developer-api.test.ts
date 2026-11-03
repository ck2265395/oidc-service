import assert from 'node:assert/strict';
import test from 'node:test';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';

import { DeveloperAuthError } from '../src/developer-auth-service.js';
import { DeveloperReviewError } from '../src/developer-store.js';
import { DeveloperAuthModule, type DeveloperAuthModuleOptions } from '../src/modules/developer-auth/developer-auth.module.js';
import { DeveloperModule, type DeveloperModuleOptions } from '../src/modules/developer/developer.module.js';
import { testServiceConfig } from './fixtures/service-config.js';

const account = { id: 'dev-1', status: 'unsubmitted' as const, revision: 1, lastReview: null, submittedAt: null, approvedAt: null };

async function service(authOverrides: Partial<DeveloperAuthModuleOptions> = {}, developerOverrides: Partial<DeveloperModuleOptions> = {}) {
  const config = testServiceConfig();
  const auth: DeveloperAuthModuleOptions = {
    config,
    auth: { async register() { return account; }, async loginWithPassword() { return { developerId: 'dev-1', emailNormalized: 'dev@example.com', passwordDigest: 'scrypt$16384$8$1$salt$hash' as never, status: 'unsubmitted' }; } },
    codes: { async issue() { return 'sent' as const; } },
    sessions: { async create() { return 's'.repeat(43); }, async resolve(token: string) { return token === 's'.repeat(43) ? account : null; }, async revoke() {} },
    identities: { async listAuthenticationMethods() { return ['email']; } },
    ...authOverrides,
  };
  const developer: DeveloperModuleOptions = {
    config,
    sessions: auth.sessions,
    moondrop: { async subject() { return 'moondrop-user-1'; } },
    credentials: { async login() { return 'dev-1'; } },
    store: {
      async getProfile() { return { developerId: 'dev-1', displayName: 'Moon Dev', contactEmail: 'dev@example.com', contactEmailVerified: true, contactPhone: null, purpose: 'Build apps', revision: 1 }; },
      async saveProfile(_id, input) { return { developerId: 'dev-1', ...input, contactEmailVerified: true, revision: input.expectedRevision + 1 }; },
      async submitReview() { return { ...account, status: 'pending' as const, revision: 2 }; },
      async listReviewHistory() { return []; },
      async findByExternalIdentity() { return null; }, async createExternalAccount() { return account; }, async bindExternalIdentity() {},
    },
    ...developerOverrides,
  };
  @Module({ imports: [DeveloperAuthModule.register(auth), DeveloperModule.register(developer)] }) class TestModule {}
  const app = await NestFactory.create(TestModule, new ExpressAdapter(), { logger: false, bodyParser: false });
  app.getHttpAdapter().getInstance().use('/api', express.json({ limit: '32kb' }));
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address(); assert.ok(address && typeof address !== 'string');
  return { base: `http://127.0.0.1:${address.port}`, close: () => app.close() };
}

test('Nest developer API preserves registration conflict and session cookie contracts', async (context) => {
  const target = await service({ auth: { async register() { throw Object.assign(new Error('duplicate'), { code: '23505' }); }, async loginWithPassword() { throw new DeveloperAuthError('account_disabled'); } } }); context.after(target.close);
  const headers = { origin: 'https://identity.example.test', 'content-type': 'application/json' };
  const conflict = await fetch(target.base + '/api/v1/developer-auth/register', { method: 'POST', headers, body: JSON.stringify({ email: 'Dev@Example.com', password: 'Developer Password 42!', code: '123456' }) });
  assert.equal(conflict.status, 409); assert.equal((await conflict.json() as { code: string }).code, 'registration_conflict');
  const disabled = await fetch(target.base + '/api/v1/developer-auth/login', { method: 'POST', headers, body: JSON.stringify({ email: 'dev@example.com', password: 'Developer Password 42!' }) });
  assert.equal(disabled.status, 401); assert.equal((await disabled.json() as { code: string }).code, 'invalid_credentials');

  const okTarget = await service(); context.after(okTarget.close);
  const registered = await fetch(okTarget.base + '/api/v1/developer-auth/register', { method: 'POST', headers, body: JSON.stringify({ email: 'dev@example.com', password: 'Developer Password 42!', code: '123456' }) });
  assert.equal(registered.status, 200);
  const cookie = registered.headers.get('set-cookie') ?? '';
  assert.match(cookie, /^md-developer=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Secure/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.match(cookie, /Path=\//i);
  assert.match(cookie, /Max-Age=604800/i);
});

test('Nest developer API distinguishes registration dependency failures from duplicates', async (context) => {
  const target = await service({ auth: { async register() { throw new Error('database offline'); }, async loginWithPassword() { throw new Error('unused'); } } }); context.after(target.close);
  const response = await fetch(target.base + '/api/v1/developer-auth/register', { method: 'POST', headers: { origin: 'https://identity.example.test', 'content-type': 'application/json' }, body: JSON.stringify({ email: 'dev@example.com', password: 'Developer Password 42!', code: '123456' }) });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { code: 'registration_unavailable', desc: 'Developer account registration is unavailable', data: null });
});

test('Nest developer API binds a verified MOONDROP subject to the credential account without email merging', async (context) => {
  let bound: unknown[] = [];
  const target = await service({}, { store: {
    async getProfile() { return null; }, async saveProfile() { throw new Error('unused'); }, async submitReview() { throw new Error('unused'); }, async listReviewHistory() { return []; },
    async findByExternalIdentity() { return null; }, async createExternalAccount() { return account; },
    async bindExternalIdentity(developerId, provider, subject) { bound = [developerId, provider, subject]; },
  }, credentials: { async login() { return 'credential-owner-9'; } } }); context.after(target.close);
  const csrf = 'e'.repeat(43);
  const response = await fetch(target.base + '/api/v1/developer/moondrop/bind', { method: 'POST', headers: {
    origin: 'https://identity.example.test', cookie: `__Host-dt-api-csrf=${csrf}`, 'x-csrf-token': csrf, 'content-type': 'application/json',
  }, body: JSON.stringify({ email: 'same@example.com', password: 'Developer Password 42!' }) });
  assert.equal(response.status, 200);
  assert.deepEqual(bound, ['credential-owner-9', 'moondrop', 'moondrop-user-1']);
});

test('Nest developer API enforces origin and CSRF on logout', async (context) => {
  const target = await service(); context.after(target.close);
  assert.equal((await fetch(target.base + '/api/v1/developer-auth/logout', { method: 'POST' })).status, 403);
  const csrf = 'c'.repeat(43);
  const response = await fetch(target.base + '/api/v1/developer-auth/logout', { method: 'POST', headers: { origin: 'https://identity.example.test', cookie: `md-developer=${'s'.repeat(43)}; md-developer-csrf=${csrf}`, 'x-csrf-token': csrf } });
  assert.equal(response.status, 200);
});

test('Nest developer API preserves profile completeness and optimistic review conflicts', async (context) => {
  const target = await service({}, { store: {
    async getProfile() { return null; }, async saveProfile() { throw new DeveloperReviewError('profile_locked'); },
    async submitReview() { throw new DeveloperReviewError('profile_incomplete'); }, async listReviewHistory() { return []; },
    async findByExternalIdentity() { return null; }, async createExternalAccount() { return account; }, async bindExternalIdentity() {},
  } }); context.after(target.close);
  const csrf = 'd'.repeat(43); const headers = { origin: 'https://identity.example.test', cookie: `md-developer=${'s'.repeat(43)}; __Host-dt-api-csrf=${csrf}`, 'x-csrf-token': csrf, 'content-type': 'application/json' };
  const profile = await fetch(target.base + '/api/v1/developer/profile', { method: 'PUT', headers, body: JSON.stringify({ displayName: 'Moon', contactEmail: 'dev@example.com', purpose: 'Build', expectedRevision: 1 }) });
  assert.equal(profile.status, 423); assert.equal((await profile.json() as { code: string }).code, 'profile_locked');
  const submit = await fetch(target.base + '/api/v1/developer/review/submit', { method: 'POST', headers, body: JSON.stringify({ expectedRevision: 1 }) });
  assert.equal(submit.status, 400); assert.equal((await submit.json() as { code: string }).code, 'profile_incomplete');
});

test('Nest developer API preserves contact email verification routes', async (context) => {
  const target = await service(); context.after(target.close);
  const csrf = 'v'.repeat(43);
  const response = await fetch(target.base + '/api/v1/developer/profile/verification-email', { method: 'POST', headers: {
    origin: 'https://identity.example.test', cookie: `md-developer=${'s'.repeat(43)}; __Host-dt-api-csrf=${csrf}`, 'x-csrf-token': csrf,
  } });
  assert.equal(response.status, 503);
  assert.equal((await response.json() as { code: string }).code, 'email_delivery_unavailable');

  const confirm = await fetch(target.base + '/api/v1/developer/verify-email?token=' + 't'.repeat(43));
  assert.equal(confirm.status, 400);
  assert.match(await confirm.text(), /invalid or expired/i);
});
