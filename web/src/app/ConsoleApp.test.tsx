import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { ConsoleApp } from './ConsoleApp';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test('renders the public identity navigation and role entry points', () => {
  window.history.replaceState({}, '', '/');
  render(<ConsoleApp />);

  const brand = screen.getByRole('link', { name: 'MOONDROP 首页' });
  expect(brand).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'MOONDROP' })).toHaveAttribute('src', '/assets/moondrop.ico');
  expect(screen.getByRole('link', { name: '账号中心' })).toHaveAttribute('href', '/account/profile');
  expect(screen.getByRole('link', { name: '开发者控制台' })).toHaveAttribute('href', '/developer/overview');
  expect(screen.getByRole('link', { name: '运营管理后台' })).toHaveAttribute('href', '/admin/overview');
});

test('shows live developer overview data for the signed-in account', async () => {
  window.history.replaceState({}, '', '/developer/overview');
  const responses: Record<string, unknown> = {
    '/api/v1/session': {
      account: { uuid: 'account-1', nickname: 'Moon Dev', email: 'm***@example.com', picture: null },
      admin: { authenticated: false }, csrfToken: 'console-token',
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
