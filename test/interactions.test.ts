import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import express from 'express';
import type Provider from 'oidc-provider';

import type { AccountService } from '../src/modules/account/application/account-identity.service.js';
import { createInteractionRouter } from '../src/modules/oidc/infrastructure/interaction.router.js';
import type { RedisLoginRateLimiter } from '../src/modules/oidc/infrastructure/login-rate-limiter.js';
import type { ApplicationService } from '../src/modules/application/application/application-management.service.js';

test('renders the login interaction with the unified identity shell', async (context) => {
  const provider = {
    interactionDetails: async () => ({ uid: 'login-1', prompt: { name: 'login' }, params: { client_id: 'dt-identity-portal' } }),
  } as unknown as Provider;
  const router = createInteractionRouter(
    provider,
    {} as AccountService,
    {} as ApplicationService,
    { async profile() { return null; } },
    'c'.repeat(43),
    false,
    {} as RedisLoginRateLimiter,
  );
  const app = express();
  app.use('/interaction', router);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  const response = await fetch(`http://127.0.0.1:${address.port}/interaction/login-1`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /href="\/assets\/identity\.css"/);
  assert.match(html, /class="identity-shell"/);
  assert.match(html, /class="identity-card"/);
  assert.match(html, /MOONDROP/);
  assert.match(html, /\/assets\/moondrop\.ico/);
});
