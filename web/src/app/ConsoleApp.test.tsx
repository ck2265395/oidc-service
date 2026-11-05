import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const parsed = new URL(raw, 'http://localhost');
    if (parsed.pathname === '/api/v1/developer-auth/logout') {
      return new Response(JSON.stringify({ code: 0, desc: 'ok', data: null }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const data = responses[parsed.pathname + parsed.search];
    return new Response(JSON.stringify({ code: 0, desc: 'ok', data }), {
      status: data ? 200 : 404, headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetch);

  render(<ConsoleApp />);

  await waitFor(() => expect(screen.getByText('已接入应用')).toBeInTheDocument());
  expect(screen.getByText('2')).toBeInTheDocument();
  expect(screen.getByText('Portal')).toBeInTheDocument();
  expect(screen.getAllByText('待审核')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: '退出登录' }));
  await waitFor(() => expect(window.location.pathname).toBe('/'));
  expect(fetch).toHaveBeenCalledWith('/api/v1/developer-auth/logout', expect.objectContaining({
    method: 'POST',
    headers: expect.objectContaining({ 'x-csrf-token': 'console-token' }),
  }));
});

function adminFetch(session: Record<string, unknown>, administrators: unknown = { total: 0, list: [] }) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const parsed = new URL(raw, 'http://localhost');
    const data = parsed.pathname === '/api/v1/session' ? { account: null, admin: session, csrfToken: 'admin-csrf' }
      : parsed.pathname === '/api/v1/admin/administrators' ? administrators : null;
    return new Response(JSON.stringify({ code: 0, desc: 'ok', data }), { status: data ? 200 : 404, headers: { 'content-type': 'application/json' } });
  });
}

test('super administrator sees the administrator management page', async () => {
  window.history.replaceState({}, '', '/admin/administrators');
  vi.stubGlobal('fetch', adminFetch(
    { authenticated: true, username: 'root', role: 'super_admin', mustChangePassword: false },
    { total: 1, list: [{ id: 'admin-1', username: 'root', role: 'super_admin', status: 'active', mustChangePassword: false }] },
  ));
  render(<ConsoleApp />);
  await waitFor(() => expect(screen.getByRole('button', { name: '新增管理员' })).toBeInTheDocument());
  expect(screen.getByRole('link', { name: /管理员管理/ })).toBeInTheDocument();
  expect(screen.getAllByText('root')).toHaveLength(2);
});

test('operator does not see administrator management navigation', async () => {
  window.history.replaceState({}, '', '/admin/overview');
  vi.stubGlobal('fetch', adminFetch({ authenticated: true, username: 'operator', role: 'operator', mustChangePassword: false }));
  render(<ConsoleApp />);
  await waitFor(() => expect(screen.getByText('operator')).toBeInTheDocument());
  expect(screen.queryByRole('link', { name: /管理员管理/ })).not.toBeInTheDocument();
});

test('administrator with a temporary password must replace it before using the console', async () => {
  window.history.replaceState({}, '', '/admin/overview');
  vi.stubGlobal('fetch', adminFetch({ authenticated: true, username: 'root', role: 'super_admin', mustChangePassword: true }));
  render(<ConsoleApp />);
  await waitFor(() => expect(screen.getByRole('heading', { name: '修改管理员密码' })).toBeInTheDocument());
  expect(screen.getByLabelText('当前密码')).toBeInTheDocument();
  expect(screen.getByLabelText('新密码')).toBeInTheDocument();
  expect(screen.queryByText('协议请求统计')).not.toBeInTheDocument();
});
