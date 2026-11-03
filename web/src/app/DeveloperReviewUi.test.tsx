import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { ConsoleApp } from './ConsoleApp';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test('developer can submit the completed profile from the review page', async () => {
  window.history.replaceState({}, '', '/developer/console/review');
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

test('rejected developer sees the review reason and immutable history', async () => {
  window.history.replaceState({}, '', '/developer/console/review');
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const path = new URL(raw, 'http://localhost').pathname;
    const data = path === '/api/v1/developer-auth/session'
      ? { account: { id: 'dev-1', status: 'rejected', revision: 4, lastReview: { action: 'reject', reason: '请补充具体接入场景', reviewedAt: '2026-11-02T00:00:00.000Z' } }, csrfToken: 'csrf' }
      : path === '/api/v1/developer/profile' ? { developerId: 'dev-1', displayName: 'Moon Dev', contactEmail: 'dev@example.com', contactEmailVerified: true, contactPhone: '', purpose: 'OIDC', revision: 2 }
      : path === '/api/v1/developer/review/history' ? [{ action: 'reject', reason: '请补充具体接入场景', created_at: '2026-11-02T00:00:00.000Z' }]
      : undefined;
    return new Response(JSON.stringify({ code: 0, desc: 'ok', data }), { status: data === undefined ? 404 : 200, headers: { 'content-type': 'application/json' } });
  }));

  render(<ConsoleApp />);

  expect((await screen.findAllByText('请补充具体接入场景')).length).toBeGreaterThan(0);
  expect(await screen.findByText('审核记录')).toBeInTheDocument();
});

test('administrator developer detail shows submitted profile snapshot and history', async () => {
  window.history.replaceState({}, '', '/admin/developers/dev-1');
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const path = new URL(raw, 'http://localhost').pathname;
    const data = path === '/api/v1/session'
      ? { account: null, admin: { authenticated: true, username: 'ops' }, csrfToken: 'csrf' }
      : path === '/api/v1/admin/developers/dev-1' ? {
        account: { id: 'dev-1', status: 'pending', revision: 2, lastReview: null },
        profile: { developerId: 'dev-1', displayName: 'Moon Dev', contactEmail: 'dev@example.com', contactEmailVerified: true, contactPhone: '15800000000', purpose: '耳机配置服务接入', revision: 2 },
        history: [{ action: 'submit', reason: null, profile_snapshot: { purpose: '耳机配置服务接入' }, created_at: '2026-11-02T00:00:00.000Z' }],
      } : undefined;
    return new Response(JSON.stringify({ code: 0, desc: 'ok', data }), { status: data === undefined ? 404 : 200, headers: { 'content-type': 'application/json' } });
  }));

  render(<ConsoleApp />);

  expect((await screen.findAllByText('耳机配置服务接入')).length).toBeGreaterThan(0);
  expect(screen.getByText('15800000000')).toBeInTheDocument();
});

test('application creation stays unavailable until developer approval', async () => {
  window.history.replaceState({}, '', '/developer/console/applications');
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const path = new URL(raw, 'http://localhost').pathname;
    const data = path === '/api/v1/developer-auth/session'
      ? { account: { id: 'dev-1', status: 'pending', revision: 2 }, csrfToken: 'csrf' }
      : path === '/api/v1/developer/applications' ? { total: 0, list: [] }
      : undefined;
    return new Response(JSON.stringify({ code: 0, desc: 'ok', data }), { status: data === undefined ? 404 : 200, headers: { 'content-type': 'application/json' } });
  }));

  render(<ConsoleApp />);

  const create = await screen.findByRole('button', { name: '创建应用' });
  expect(create).toBeDisabled();
  expect(screen.getByText('开发者审核通过后可创建应用')).toBeInTheDocument();
});
