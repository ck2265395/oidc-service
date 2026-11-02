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
