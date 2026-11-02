import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { ConsoleApp } from './ConsoleApp';

afterEach(cleanup);

test('unauthenticated developer landing shows portal content without console navigation', () => {
  window.history.replaceState({}, '', '/developer');
  render(<ConsoleApp />);

  expect(screen.getByRole('heading', { name: '连接用户与应用，从一个可信身份开始' })).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: '注册开发者' })[0]).toHaveAttribute('href', '/developer/register');
  expect(screen.getByRole('link', { name: '登录控制台' })).toHaveAttribute('href', '/developer/login');
  expect(screen.queryByRole('navigation', { name: '开发者控制台' })).not.toBeInTheDocument();
});

test('developer login offers email password and MOONDROP identity', () => {
  window.history.replaceState({}, '', '/developer/login');
  render(<ConsoleApp />);

  expect(screen.getByRole('heading', { name: '登录开发者控制台' })).toBeInTheDocument();
  expect(screen.getByLabelText('邮箱')).toBeInTheDocument();
  expect(screen.getByLabelText('密码')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '使用水月雨账号登录' })).toHaveAttribute('href', '/developer/login/moondrop?returnTo=%2Fdeveloper%2Fconsole%2Foverview');
});

test('developer registration uses email code and password without a phone field', () => {
  window.history.replaceState({}, '', '/developer/register');
  render(<ConsoleApp />);

  expect(screen.getByLabelText('邮箱')).toBeInTheDocument();
  expect(screen.getByLabelText('邮箱验证码')).toBeInTheDocument();
  expect(screen.getByLabelText('设置密码')).toBeInTheDocument();
  expect(screen.queryByLabelText('手机号')).not.toBeInTheDocument();
});

test('MOONDROP first login offers create or verified existing-account binding', async () => {
  window.history.replaceState({}, '', '/developer/bind');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, desc: 'ok', data: { bound: false, account: null } }), { status: 200, headers: { 'content-type': 'application/json' } })));
  render(<ConsoleApp />);

  expect(await screen.findByRole('button', { name: '创建新的开发者身份' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '绑定已有开发者账号' })).toBeInTheDocument();
  expect(screen.getByLabelText('开发者邮箱')).toBeInTheDocument();
});
