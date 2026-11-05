import assert from 'node:assert/strict';
import test from 'node:test';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { Router } from 'express';

import { AdminPageController, ADMIN_PAGE_ROUTER } from '../src/modules/admin/admin-page.controller.js';
import { AdminService } from '../src/modules/admin/admin.service.js';
import { WebController } from '../src/infrastructure/web/web.controller.js';

test('Nest administrator page delegates only login and leaves workspace routes to the SPA', async (context) => {
  const router = Router();
  router.get('/login', (_request, response) => response.type('html').send('<h1>Admin login</h1>'));
  router.post('/login', (_request, response) => response.status(303).redirect('/admin'));
  @Module({ controllers: [AdminPageController, WebController], providers: [
    { provide: ADMIN_PAGE_ROUTER, useValue: router },
    { provide: AdminService, useValue: { auth: { async authenticated(request: { headers: Record<string, unknown> }) { return request.headers['x-admin-test'] === 'yes'; } } } },
  ] }) class TestModule {}
  const app = await NestFactory.create(TestModule, new ExpressAdapter(), { logger: false });
  await app.listen(0, '127.0.0.1'); context.after(() => app.close());
  const address = app.getHttpServer().address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  assert.equal((await fetch(base + '/admin/login')).status, 200);
  const anonymous = await fetch(base + '/admin/overview', { redirect: 'manual' });
  assert.equal(anonymous.status, 303);
  assert.equal(anonymous.headers.get('location'), '/admin/login');
  const nested = await fetch(base + '/admin/applications/app-1', { headers: { 'x-admin-test': 'yes' } });
  assert.equal(nested.status, 200);
  assert.match(await nested.text(), /<div id="root"><\/div>/);
});
