import assert from 'node:assert/strict';
import test from 'node:test';

import { createTestService } from './fixtures/service-config.js';

test('legacy runtime exposes the frozen business route inventory', async (context) => {
  const service = await createTestService();
  context.after(service.close);

  const routes = [
    ['/interaction/probe', 'interaction'],
    ['/api/v1/session/probe', 'session-api'],
    ['/api/v1/me/probe', 'user-api'],
    ['/api/v1/account/probe', 'account-api'],
    ['/api/v1/developer-auth/probe', 'developer-auth-api'],
    ['/api/v1/developer/probe', 'developer-api'],
    ['/api/v1/admin/probe', 'admin-api'],
    ['/portal/probe', 'portal'],
    ['/admin/login', 'admin'],
  ] as const;

  for (const [path, owner] of routes) {
    const response = await fetch(service.baseUrl + path);
    assert.equal(response.status, 200, path);
    assert.deepEqual(await response.json(), { owner }, path);
  }

  const live = await fetch(service.baseUrl + '/health/live');
  assert.equal(live.status, 200);
  assert.equal((await live.json() as { status: string }).status, 'ok');
});

test('legacy runtime preserves redirect and SPA fallback precedence', async (context) => {
  const service = await createTestService();
  context.after(service.close);
  const manual = { redirect: 'manual' as const };

  const developer = await fetch(service.baseUrl + '/developer', manual);
  const account = await fetch(service.baseUrl + '/account', manual);
  const moondrop = await fetch(service.baseUrl + '/developer/login/moondrop?returnTo=%2Fdeveloper%2Fconsole%2Fprofile', manual);
  const spa = await fetch(service.baseUrl + '/developer/console/profile');
  const unknownApi = await fetch(service.baseUrl + '/api/v1/unknown');

  assert.equal(developer.status, 303);
  assert.equal(developer.headers.get('location'), '/developer/overview');
  assert.equal(account.status, 303);
  assert.equal(account.headers.get('location'), '/account/profile');
  assert.equal(moondrop.status, 303);
  assert.match(moondrop.headers.get('location') ?? '', /^\/portal\/sign-in\?return=/);
  assert.equal(spa.status, 200);
  assert.match(spa.headers.get('content-type') ?? '', /^text\/html/);
  assert.match(await spa.text(), /<div id="root"><\/div>/);
  assert.equal(unknownApi.status, 404);
  assert.equal((await unknownApi.json() as { error: string }).error, 'not_found');
});
