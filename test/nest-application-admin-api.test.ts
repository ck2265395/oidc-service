import assert from 'node:assert/strict';
import test from 'node:test';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';

import { ApplicationConflictError } from '../src/platform.js';
import { ApplicationModule, type ApplicationModuleOptions } from '../src/modules/application/application.module.js';
import { AdminModule, type AdminModuleOptions } from '../src/modules/admin/admin.module.js';
import { testServiceConfig } from './fixtures/service-config.js';

async function service(applicationOverrides: Partial<ApplicationModuleOptions> = {}, adminOverrides: Partial<AdminModuleOptions> = {}) {
  const config = testServiceConfig();
  const developer = { async authenticated() { return { id: 'dev-approved', status: 'approved' as const }; }, writeAllowed() { return true as const; } };
  const apps = {
    async getDeveloperProfile() { return { accountUuid: 'dev-approved' }; },
    async createWithSecret() { return { record: { id: 'app-1', clientId: 'client-1', type: 'web', revision: 1, status: 'draft', draft: { name: 'App' }, approvedConfig: null, approvedRevision: null, lastReview: null }, clientSecret: 'one-time-secret' }; },
    async listOwned() { return { total: 0, list: [] }; }, async getOwned() { return null; }, async edit() { return null; }, async submit() { return null; }, async rotateClientSecret() { return null; },
    async listForAdmin() { return { total: 0, list: [] }; }, async getForAdmin() { return null; }, async review() { throw new ApplicationConflictError('revision changed'); },
  };
  const groups = { async listOwned() { return { total: 0, list: [] }; }, async create() { throw new Error('unused'); }, async delete() { return false; }, async rename() { return null; }, async listForAdmin() { return { total: 0, list: [] }; }, async getForAdmin() { return null; }, async review() { return null; } };
  const application: ApplicationModuleOptions = { config, developer, applications: apps as never, groups: groups as never, ...applicationOverrides };
  const admin: AdminModuleOptions = {
    config,
    auth: { async authenticated(request) { return request.headers['x-admin-test'] === 'yes'; }, mutationAllowed() { return true; }, async logout() {} },
    applications: application.applications, groups: application.groups,
    developers: { async listForAdmin() { return { total: 0, list: [] }; }, async getForAdmin() { return null; }, async reviewDeveloper() { throw new Error('unused'); } } as never,
    audit: { async list(page) { return { page, list: [{ action: 'application.review' }] }; }, async statistics(days) { return { days, list: [] }; }, async overview() { return { applications: {}, groups: {}, recentAudit: [] }; }, async recordDeveloperReview() {} },
    ...adminOverrides,
  };
  @Module({ imports: [ApplicationModule.register(application), AdminModule.register(admin)] }) class TestModule {}
  const app = await NestFactory.create(TestModule, new ExpressAdapter(), { logger: false, bodyParser: false });
  app.getHttpAdapter().getInstance().use('/api', express.json({ limit: '32kb' }));
  await app.listen(0, '127.0.0.1'); const address = app.getHttpServer().address(); assert.ok(address && typeof address !== 'string');
  return { base: `http://127.0.0.1:${address.port}`, close: () => app.close() };
}

const writeHeaders = { origin: 'https://identity.example.test', 'content-type': 'application/json' };

test('Nest application and admin API gates creation and returns a client secret once', async (context) => {
  const target = await service(); context.after(target.close);
  const response = await fetch(target.base + '/api/v1/developer/applications', { method: 'POST', headers: writeHeaders, body: JSON.stringify({ type: 'web', draft: { name: 'App' } }) });
  assert.equal(response.status, 201);
  const body = await response.json() as { data: { clientSecret: string; application: { status: string } } };
  assert.equal(body.data.clientSecret, 'one-time-secret'); assert.equal(body.data.application.status, 'draft');
});

test('Nest application and admin API rejects unauthenticated admin and maps optimistic review conflicts', async (context) => {
  const target = await service(); context.after(target.close);
  assert.equal((await fetch(target.base + '/api/v1/admin/applications')).status, 401);
  const response = await fetch(target.base + '/api/v1/admin/applications/app-1/review', { method: 'POST', headers: { ...writeHeaders, 'x-admin-test': 'yes' }, body: JSON.stringify({ action: 'approve', expectedRevision: 1 }) });
  assert.equal(response.status, 409); assert.equal((await response.json() as { code: string }).code, 'review_conflict');
});

test('Nest application and admin API validates audit pagination', async (context) => {
  const target = await service(); context.after(target.close);
  const invalid = await fetch(target.base + '/api/v1/admin/audit?page=0', { headers: { 'x-admin-test': 'yes' } });
  assert.equal(invalid.status, 400);
  const valid = await fetch(target.base + '/api/v1/admin/audit?page=2', { headers: { 'x-admin-test': 'yes' } });
  assert.equal(valid.status, 200); assert.equal((await valid.json() as { data: { page: number } }).data.page, 2);
});
