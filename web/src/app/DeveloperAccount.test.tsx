import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { ConsoleApp } from './ConsoleApp';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function sessionFetch(methods: Array<'email' | 'moondrop'> = ['email']) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const path = new URL(raw, 'http://localhost').pathname;
    const data = path === '/api/v1/developer-auth/session'
      ? { account: { id: 'dev-1', status: 'unsubmitted', revision: 3 }, authenticationMethods: methods, csrfToken: 'csrf' }
      : path === '/api/v1/developer/review/history' ? []
      : undefined;
    return new Response(JSON.stringify({ code: 0, desc: 'ok', data }), { status: data === undefined ? 404 : 200, headers: { 'content-type': 'application/json' } });
  });
}

test('developer console keeps profile, review and security in one account workspace', async () => {
  window.history.replaceState({}, '', '/developer/console/security');
  vi.stubGlobal('fetch', sessionFetch(['email', 'moondrop']));

  render(<ConsoleApp />);

  expect(await screen.findByRole('link', { name: /个人资料/ })).toHaveAttribute('href', '/developer/console/profile');
  expect(screen.getByRole('link', { name: /开发者审核/ })).toHaveAttribute('href', '/developer/console/review');
  expect(screen.getByRole('link', { name: /安全设置/ })).toHaveAttribute('href', '/developer/console/security');
  expect(screen.queryByText('账号中心')).not.toBeInTheDocument();
});

test('security page only reports real authentication methods and marks unsupported actions unavailable', async () => {
  window.history.replaceState({}, '', '/developer/console/security');
  vi.stubGlobal('fetch', sessionFetch(['email', 'moondrop']));

  render(<ConsoleApp />);

  expect(await screen.findByText('邮箱密码')).toBeInTheDocument();
  expect(screen.getByText('水月雨账号')).toBeInTheDocument();
  expect(screen.getAllByText('暂未开放').length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: /解绑|修改密码|管理会话/ })).not.toBeInTheDocument();
});

test('review submission and immutable history live on the dedicated review page', async () => {
  window.history.replaceState({}, '', '/developer/console/review');
  vi.stubGlobal('fetch', sessionFetch());

  render(<ConsoleApp />);

  expect(await screen.findByRole('button', { name: '提交开发者审核' })).toBeInTheDocument();
  expect(await screen.findByText('审核记录')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '保存资料' })).not.toBeInTheDocument();
});

test('successful review submission refreshes status, revision and history', async () => {
  window.history.replaceState({}, '', '/developer/console/review');
  let submitted = false;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const path = new URL(raw, 'http://localhost').pathname;
    if (path === '/api/v1/developer-auth/session') {
      return new Response(JSON.stringify({ code: 0, desc: 'ok', data: { account: { id: 'dev-1', status: submitted ? 'pending' : 'unsubmitted', revision: submitted ? 4 : 3 }, authenticationMethods: ['email'], csrfToken: 'csrf' } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (path === '/api/v1/developer/review/history') {
      const data = submitted ? [{ action: 'submit', reason: null, created_at: '2026-11-03T00:00:00.000Z' }] : [];
      return new Response(JSON.stringify({ code: 0, desc: 'ok', data }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (path === '/api/v1/developer/csrf') {
      return new Response(JSON.stringify({ code: 0, desc: 'ok', data: { token: 'write-csrf' } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (path === '/api/v1/developer/review/submit' && init?.method === 'POST') {
      submitted = true;
      return new Response(JSON.stringify({ code: 0, desc: 'ok', data: { status: 'pending', revision: 4 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('', { status: 404 });
  }));

  render(<ConsoleApp />);
  fireEvent.click(await screen.findByRole('button', { name: '提交开发者审核' }));

  await waitFor(() => expect(screen.getByText('审核中')).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: '提交开发者审核' })).not.toBeInTheDocument();
  expect(await screen.findByText('无附加说明')).toBeInTheDocument();
});
