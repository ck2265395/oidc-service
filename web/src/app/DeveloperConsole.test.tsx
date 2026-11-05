import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { ConsoleApp } from './ConsoleApp';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test('developer console displays the server-provided qualification status', async () => {
  window.history.replaceState({}, '', '/developer/console/overview');
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const path = new URL(raw, 'http://localhost').pathname;
    const data = path === '/api/v1/developer-auth/session'
      ? { account: { id: 'dev-1', status: 'unsubmitted', revision: 1 }, csrfToken: 'csrf-token' }
      : path === '/api/v1/developer/profile' ? null
      : path === '/api/v1/developer/applications' ? { total: 0, list: [] }
      : path === '/api/v1/developer/groups' ? { total: 0, list: [] }
      : undefined;
    return new Response(JSON.stringify({ code: 0, desc: 'ok', data }), { status: data === undefined ? 404 : 200, headers: { 'content-type': 'application/json' } });
  }));

  render(<ConsoleApp />);

  await waitFor(() => expect(screen.getByText('未提交审核')).toBeInTheDocument());
  expect(screen.getByText('完善开发者资料后手动提交审核')).toBeInTheDocument();
});

test('developer console never falls back to an ordinary OIDC user session', async () => {
  window.history.replaceState({}, '', '/developer/console/overview');
  const paths: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const path = new URL(raw, 'http://localhost').pathname;
    paths.push(path);
    if (path === '/api/v1/developer-auth/session') {
      return new Response(JSON.stringify({ code: 'unavailable', desc: 'database unavailable', data: null }), { status: 503, headers: { 'content-type': 'application/json' } });
    }
    if (path === '/api/v1/session') {
      return new Response(JSON.stringify({ code: 0, desc: 'ok', data: { account: { uuid: 'ordinary-user', nickname: '普通用户' }, admin: { authenticated: false }, csrfToken: 'csrf' } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('', { status: 404 });
  }));

  render(<ConsoleApp />);

  await waitFor(() => expect(paths).toContain('/api/v1/developer-auth/session'));
  expect(paths).not.toContain('/api/v1/session');
  expect(screen.queryByText('审核通过')).not.toBeInTheDocument();
});
