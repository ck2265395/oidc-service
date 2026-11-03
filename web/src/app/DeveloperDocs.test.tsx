import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { ConsoleApp } from './ConsoleApp';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test('developer docs cover the complete onboarding path without private requests', () => {
  window.history.replaceState({}, '', '/developer/docs');
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);

  render(<ConsoleApp />);

  expect(screen.getByRole('heading', { level: 1, name: '接入文档' })).toBeInTheDocument();
  for (const title of [
    '快速开始', '成为开发者', '创建应用', 'OIDC 与 OAuth 2.0',
    'Web 应用', 'SPA 应用', '原生应用', 'API 与错误码', '审核规范', '常见问题',
  ]) expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '查看 Discovery 配置' })).toHaveAttribute('href', '/.well-known/openid-configuration');
  expect(fetch).not.toHaveBeenCalled();
});
