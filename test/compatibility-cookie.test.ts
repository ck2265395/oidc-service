import assert from 'node:assert/strict';
import test from 'node:test';

import { createDeveloperAuthRouter } from '../src/developer-auth.js';
import { createTestService } from './fixtures/service-config.js';

test('legacy runtime preserves cookie names and attributes', async (context) => {
  const account = { id: '11111111-1111-4111-8111-111111111111', status: 'unsubmitted', revision: 1, lastReview: null, submittedAt: null, approvedAt: null } as const;
  const developerAuth = createDeveloperAuthRouter({
    issuer: 'https://identity.example.test',
    secureCookies: true,
    auth: {
      async register() { return account; },
      async loginWithPassword() { return { developerId: account.id, emailNormalized: 'dev@example.test', passwordDigest: {} as never, status: account.status }; },
    },
    codes: { async issue() { return 'sent' as const; } },
    sessions: { async create() { return 't'.repeat(43); }, async resolve() { return account; }, async revoke() {} },
    identities: { async listAuthenticationMethods() { return ['email'] as const; } },
  });
  const service = await createTestService({ developerAuth });
  context.after(service.close);

  const response = await fetch(service.baseUrl + '/api/v1/developer-auth/login', {
    method: 'POST',
    headers: { origin: 'https://identity.example.test', 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'dev@example.test', password: 'Correct Horse 42!' }),
  });
  const cookie = response.headers.get('set-cookie') ?? '';

  assert.equal(response.status, 200);
  assert.match(cookie, /^md-developer=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Secure/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.match(cookie, /Path=\//i);
  assert.match(cookie, /Max-Age=604800/i);
});
