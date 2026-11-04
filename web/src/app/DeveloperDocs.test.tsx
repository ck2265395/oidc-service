import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { ConsoleApp } from './ConsoleApp';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test('developer docs show the developer console instead of login and registration for an authenticated developer', async () => {
  window.history.replaceState({}, '', '/developer/docs');
  const fetch = vi.fn(async () => new Response(JSON.stringify({
    code: 0,
    desc: 'ok',
    data: { account: { id: 'dev-1', status: 'approved', revision: 2 }, authenticationMethods: ['email'], csrfToken: 'csrf' },
  }), { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetch);

  render(<ConsoleApp />);

  expect(screen.getByRole('heading', { level: 1, name: '接入文档' })).toBeInTheDocument();
  for (const title of [
    '快速开始', '成为开发者', '创建应用', 'OIDC 与 OAuth 2.0',
    'Web 应用', 'SPA 应用', '原生应用', 'API 与错误码', '审核规范', '常见问题',
  ]) expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '查看 Discovery 配置' })).toHaveAttribute('href', '/.well-known/openid-configuration');
  const header = screen.getByRole('banner');
  expect(await within(header).findByRole('link', { name: '进入控制台' })).toHaveAttribute('href', '/developer/console/overview');
  expect(within(header).queryByRole('link', { name: '登录' })).not.toBeInTheDocument();
  expect(within(header).queryByRole('link', { name: '注册开发者' })).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith('/api/v1/developer-auth/session', expect.anything());
});
