import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { ConsoleApp } from './ConsoleApp';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test('removed account routes return to the developer portal', () => {
  window.history.replaceState({}, '', '/account/profile');
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  render(<ConsoleApp />);

  expect(screen.getByRole('heading', { name: '连接用户与应用，从一个可信身份开始' })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/');
  expect(fetch).toHaveBeenCalledWith('/api/v1/developer-auth/session', expect.anything());
});

test('shows live developer overview data for the signed-in account', async () => {
  window.history.replaceState({}, '', '/developer/console/overview');
  const responses: Record<string, unknown> = {
    '/api/v1/developer-auth/session': {
      account: { id: 'developer-1', status: 'approved', revision: 2 },
      authenticationMethods: ['email'], csrfToken: 'console-token',
    },
    '/api/v1/developer/profile': {
      accountUuid: 'account-1', displayName: 'Moon Dev', contactEmail: 'moon@example.com',
      contactEmailVerified: true, revision: 2,
    },
    '/api/v1/developer/applications?page=1&pageSize=100': {
      total: 2,
      list: [
        { id: '1', clientId: 'client-1', type: 'web', revision: 1, status: 'approved', draft: { name: 'Portal' } },
        { id: '2', clientId: 'client-2', type: 'spa', revision: 1, status: 'pending', draft: { name: 'Console' } },
      ],
    },
    '/api/v1/developer/groups?page=1&pageSize=100': { total: 1, list: [] },
  };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const parsed = new URL(raw, 'http://localhost');
    const data = responses[parsed.pathname + parsed.search];
    return new Response(JSON.stringify({ code: 0, desc: 'ok', data }), {
      status: data ? 200 : 404, headers: { 'content-type': 'application/json' },
    });
  }));

  render(<ConsoleApp />);

  await waitFor(() => expect(screen.getByText('已接入应用')).toBeInTheDocument());
  expect(screen.getByText('2')).toBeInTheDocument();
  expect(screen.getByText('Portal')).toBeInTheDocument();
  expect(screen.getAllByText('待审核')).toHaveLength(2);
});
