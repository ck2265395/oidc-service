import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

async function post(path: string, body: unknown): Promise<void> {
  const response = await fetch(path, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as { desc?: string } | null;
  if (!response.ok) throw new Error(payload?.desc || '请求失败，请稍后重试');
}

function Header() {
  return <header className="developer-public-header"><Link className="developer-public-brand" to="/developer"><img src="/assets/moondrop.ico" alt="MOONDROP" /><span><strong>MOONDROP</strong><small>开放平台</small></span></Link><nav><a href="/developer/docs">接入文档</a><Link to="/developer/login">登录</Link><Link className="button primary" to="/developer/register">注册开发者</Link></nav></header>;
}

export function DeveloperLanding() {
  return <div className="developer-public"><Header /><main><section className="developer-hero"><span>MOONDROP OPEN PLATFORM</span><h1>连接用户与应用，<br />从一个可信身份开始</h1><p>使用标准 OpenID Connect 能力，为 Web、SPA 与原生应用提供安全、稳定、可审计的统一登录。</p><div><Link className="button primary" to="/developer/register">注册开发者</Link><Link className="button secondary" to="/developer/login">登录控制台</Link></div></section><section className="developer-features"><article><b>01</b><h2>标准协议接入</h2><p>OIDC、OAuth 2.0、PKCE 与 Discovery，降低多端接入成本。</p></article><article><b>02</b><h2>审核与发布</h2><p>开发者资质、应用资料和生产凭据分层审核，状态全程可追踪。</p></article><article><b>03</b><h2>安全身份绑定</h2><p>支持独立开发者账号，也可安全绑定水月雨账号登录。</p></article></section></main></div>;
}

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <div className="developer-auth-page"><Header /><main><section className="developer-auth-copy"><span>MOONDROP DEVELOPER</span><h1>面向开发者的<br />统一身份基础设施</h1><p>一个控制台管理开发者资料、应用审核和 OIDC 客户端凭据。</p></section><section className="developer-auth-card"><h2>{title}</h2><p>{subtitle}</p>{children}</section></main></div>;
}

export function DeveloperLogin() {
  const [message, setMessage] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const values = new FormData(event.currentTarget); setMessage('');
    try { await post('/api/v1/developer-auth/login', { email: values.get('email'), password: values.get('password') }); window.location.assign('/developer/console/overview'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '登录失败'); }
  };
  return <AuthLayout title="登录开发者控制台" subtitle="使用开发者邮箱，或使用已绑定的水月雨账号。"><form className="developer-auth-form" onSubmit={submit}><label>邮箱<input name="email" type="email" autoComplete="username" required /></label><label>密码<input name="password" type="password" autoComplete="current-password" required /></label><button className="button primary" type="submit">登录</button><span role="status">{message}</span></form><div className="auth-divider"><span>其他登录方式</span></div><a className="moondrop-login" href="/developer/login/moondrop?returnTo=%2Fdeveloper%2Fconsole%2Foverview"><img src="/assets/moondrop.ico" alt="" />使用水月雨账号登录</a><p className="auth-switch">还没有开发者账号？<Link to="/developer/register">立即注册</Link></p></AuthLayout>;
}

export function DeveloperRegister() {
  const [message, setMessage] = useState('');
  const sendCode = async (form: HTMLFormElement) => {
    const values = new FormData(form); setMessage('');
    try { await post('/api/v1/developer-auth/email-code', { email: values.get('email'), purpose: 'register' }); setMessage('验证码已发送，请检查邮箱'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '验证码发送失败'); }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const values = new FormData(event.currentTarget); setMessage('');
    try { await post('/api/v1/developer-auth/register', { email: values.get('email'), code: values.get('code'), password: values.get('password') }); window.location.assign('/developer/console/profile'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '注册失败'); }
  };
  return <AuthLayout title="注册开发者账号" subtitle="邮箱验证成功后即可完善开发者资料并提交审核。"><form className="developer-auth-form" onSubmit={submit}><label>邮箱<input name="email" type="email" autoComplete="email" required /></label><label>邮箱验证码<span className="code-input"><input name="code" inputMode="numeric" pattern="[0-9]{6}" required /><button type="button" onClick={(event) => void sendCode(event.currentTarget.form!)}>获取验证码</button></span></label><label>设置密码<input name="password" type="password" minLength={10} autoComplete="new-password" required /></label><small>至少 10 位，并包含大写字母、小写字母、数字或符号中的三类。</small><button className="button primary" type="submit">注册并继续</button><span role="status">{message}</span></form><p className="auth-switch">已有开发者账号？<Link to="/developer/login">返回登录</Link></p></AuthLayout>;
}
