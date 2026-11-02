import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { ConsoleApp } from './ConsoleApp';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test('developer can edit qualification fields and submit the profile for review', async () => {
  window.history.replaceState({}, '', '/developer/console/profile');
  const requests: Array<{ path: string; method: string; body?: string }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const path = new URL(raw, 'http://localhost').pathname;
    requests.push({ path, method: init?.method || 'GET', ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
    const data = path === '/api/v1/developer-auth/session'
      ? { account: { id: 'dev-1', status: 'unsubmitted', revision: 3 }, csrfToken: 'auth-csrf' }
      : path === '/api/v1/developer/profile'
        ? { developerId: 'dev-1', displayName: 'Moon Dev', contactEmail: 'dev@example.com', contactEmailVerified: true, contactPhone: '', purpose: 'OIDC 接入', revision: 2 }
        : path === '/api/v1/developer/csrf' ? { token: 'write-csrf' }
        : path === '/api/v1/developer/review/submit' ? { status: 'pending', revision: 4 }
        : undefined;
    return new Response(JSON.stringify({ code: 0, desc: 'ok', data }), { status: data === undefined ? 404 : 200, headers: { 'content-type': 'application/json' } });
  }));

  render(<ConsoleApp />);

  const submit = await screen.findByRole('button', { name: '提交开发者审核' });
  fireEvent.click(submit);
  await waitFor(() => expect(requests.some((item) => item.path === '/api/v1/developer/review/submit' && item.body?.includes('"expectedRevision":3'))).toBe(true));
});

test('administrator can see the developer review queue', async () => {
  window.history.replaceState({}, '', '/admin/developers');
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const path = new URL(raw, 'http://localhost').pathname;
    const data = path === '/api/v1/session'
      ? { account: null, admin: { authenticated: true, username: 'ops' }, csrfToken: 'csrf' }
      : path === '/api/v1/admin/developers' ? { total: 1, list: [{ id: 'dev-1', status: 'pending', revision: 3, displayName: 'Moon Dev', contactEmail: 'dev@example.com', identityTypes: ['email'], reviewCount: 1 }] }
      : undefined;
    return new Response(JSON.stringify({ code: 0, desc: 'ok', data }), { status: data === undefined ? 404 : 200, headers: { 'content-type': 'application/json' } });
  }));

  render(<ConsoleApp />);

  expect(await screen.findByText('Moon Dev')).toBeInTheDocument();
  expect(screen.getByText('dev@example.com')).toBeInTheDocument();
});
