import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  const header = screen.getByRole('banner');
  expect(await within(header).findByRole('link', { name: '进入控制台' })).toHaveAttribute('href', '/developer/console/overview');
  expect(within(header).queryByRole('link', { name: '登录' })).not.toBeInTheDocument();
  expect(within(header).queryByRole('link', { name: '注册开发者' })).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith('/api/v1/developer-auth/session', expect.anything());

  const hero = screen.getByRole('heading', { level: 1, name: '接入文档' }).closest('section')!;
  expect(within(hero).getByRole('link', { name: '进入开发者控制台' })).toHaveAttribute('href', '/developer/console/overview');
  expect(within(hero).queryByRole('link', { name: '查看 Discovery 配置' })).not.toBeInTheDocument();

  const protocol = screen.getByRole('heading', { name: 'OIDC 与 OAuth 2.0' }).closest('section')!;
  const writeText = vi.fn(async () => undefined);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  fireEvent.click(within(protocol).getByRole('button', { name: '复制 Discovery 地址' }));
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/.well-known/openid-configuration`);
  expect(await within(protocol).findByRole('status')).toHaveTextContent('地址已复制');
  expect(within(protocol).getByRole('link', { name: '查看原始 JSON' })).toHaveAttribute('href', '/.well-known/openid-configuration');
  expect(screen.getAllByRole('link').filter((link) => link.getAttribute('href') === '/.well-known/openid-configuration')).toHaveLength(1);
});
