import assert from 'node:assert/strict';
import test from 'node:test';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { Router } from 'express';

import { AdminPageController, ADMIN_PAGE_ROUTER } from '../src/modules/admin/admin-page.controller.js';

test('Nest administrator page delegates login and nested routes with the admin prefix removed', async (context) => {
  const router = Router();
  router.get('/login', (_request, response) => response.type('html').send('<h1>Admin login</h1>'));
  router.get('/applications/:id', (request, response) => response.json({ id: request.params.id }));
  @Module({ controllers: [AdminPageController], providers: [{ provide: ADMIN_PAGE_ROUTER, useValue: router }] }) class TestModule {}
  const app = await NestFactory.create(TestModule, new ExpressAdapter(), { logger: false });
  await app.listen(0, '127.0.0.1'); context.after(() => app.close());
  const address = app.getHttpServer().address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  assert.equal((await fetch(base + '/admin/login')).status, 200);
  const nested = await fetch(base + '/admin/applications/app-1');
  assert.deepEqual(await nested.json(), { id: 'app-1' });
});
