import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import { apiGet, consoleMutation, developerMutation } from '../api';
import { DeveloperDocs } from './DeveloperDocs';
import { DeveloperBinding, DeveloperLanding, DeveloperLogin, DeveloperRegister } from './DeveloperPublic';

type ConsoleKind = 'account' | 'developer' | 'admin';
type ApplicationStatus = 'draft' | 'pending' | 'rejected' | 'approved' | 'disabled';

interface SessionData {
  account: { uuid: string; nickname: string; email: string | null; picture: string | null } | null;
  admin: { authenticated: boolean; username?: string };
  csrfToken: string;
  developerStatus?: 'unsubmitted' | 'pending' | 'approved' | 'rejected' | 'disabled';
  developerReview?: { reason: string | null; reviewedAt: string } | null;
  developerRevision?: number;
  authenticationMethods?: Array<'email' | 'moondrop'>;
}
interface DeveloperProfile { developerId?: string; accountUuid?: string; displayName: string; contactEmail: string; contactEmailVerified: boolean; contactPhone?: string | null; purpose?: string; revision: number }
interface ApplicationDraft { name: string; description: string; purpose: string; homepageUrl: string; privacyUrl: string; termsUrl: string; iconUrl: string | null; redirectUris: string[]; postLogoutRedirectUris: string[]; scopes: string[]; groupId: string | null }
interface ApplicationRecord { id: string; clientId: string; type: 'web' | 'spa' | 'native'; revision: number; status: ApplicationStatus; draft: ApplicationDraft }
interface GroupRecord { id: string; ownerUuid?: string; displayName: string; status: 'pending' | 'approved' | 'rejected' | 'disabled'; revision: number; lastReview?: { reason: string | null; reviewedAt: string } | null }
interface PageResult<T> { total: number; list: T[] }
interface AuthorizationRecord { id: string; clientId: string | null; name: string; scopes: string[]; status: string; authorizedAt: string }
interface AdminOverviewData { applications: Record<string, number>; groups: Record<string, number>; recentAudit: Array<{ created_at: string; action: string; outcome: string; actor_type: string }> }
interface AdminApplication extends ApplicationRecord { ownerUuid: string; approvedConfig: unknown; lastReview: { reason: string | null; reviewedAt: string } | null }
interface AdminDeveloper { id: string; status: NonNullable<SessionData['developerStatus']>; revision: number; displayName: string; contactEmail: string; identityTypes: string[]; reviewCount: number }
interface AuditRecord { created_at: string; actor_type: string; actor_id: string | null; action: string; application_id: string | null; outcome: string; details: unknown }
interface StatisticRecord { action: string; outcome: string; request_count: number; average_ms: number | null; p95_ms: number | null }

const consoleCopy: Record<ConsoleKind, { label: string; title: string; items: Array<[string, string]> }> = {
  account: { label: '账号中心', title: '个人账号', items: [['/account/profile', '个人资料'], ['/account/authorizations', '应用授权']] },
  developer: { label: '开发者控制台', title: '开发者空间', items: [['/developer/console/overview', '概览'], ['/developer/console/profile', '个人资料'], ['/developer/console/review', '开发者审核'], ['/developer/console/applications', '我的应用'], ['/developer/console/groups', '应用组'], ['/developer/console/security', '安全设置'], ['/developer/docs', '接入文档']] },
  admin: { label: '运营管理后台', title: '平台管理', items: [['/admin/overview', '概览'], ['/admin/developers', '开发者审核'], ['/admin/applications', '应用审核'], ['/admin/groups', '应用组审核'], ['/admin/audit', '操作审计'], ['/admin/statistics', '统计分析']] },
};

const statusText: Record<string, string> = { draft: '草稿', pending: '待审核', rejected: '已驳回', approved: '已通过', disabled: '已停用' };

function Brand({ compact = false }: { compact?: boolean }) {
  return <Link className="brand" to="/" aria-label="MOONDROP 首页"><img className="brand-mark" src="/assets/moondrop.ico" alt="MOONDROP" />{!compact && <span><strong>MOONDROP</strong><small>统一身份平台</small></span>}</Link>;
}

function useResource<T>(load: () => Promise<T>, dependencies: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => {
    setLoading(true); setError('');
    load().then(setData).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '加载失败')).finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
  useEffect(reload, [reload]);
  return { data, error, loading, reload };
}

function Feedback({ loading, error }: { loading: boolean; error: string }) {
  if (loading) return <section className="panel panel-state">正在加载数据…</section>;
  if (error) return <section className="panel panel-state error-state"><strong>暂时无法加载</strong><span>{error}</span></section>;
  return null;
}

function DeveloperOverview() {
  const resource = useResource(async () => {
    const [profile, applications, groups] = await Promise.all([
      apiGet<DeveloperProfile | null>('/api/v1/developer/profile'),
      apiGet<PageResult<ApplicationRecord>>('/api/v1/developer/applications?page=1&pageSize=100'),
      apiGet<PageResult<GroupRecord>>('/api/v1/developer/groups?page=1&pageSize=100'),
    ]);
    return { profile, applications, groups };
  });
  if (!resource.data) return <Feedback loading={resource.loading} error={resource.error} />;
  const pending = resource.data.applications.list.filter((item) => item.status === 'pending').length;
  return <><div className="metric-grid"><article><span>已接入应用</span><strong>{resource.data.applications.total}</strong><small>全部 OIDC 客户端</small></article><article><span>应用组</span><strong>{resource.data.groups.total}</strong><small>组织与权限边界</small></article><article><span>待审核</span><strong>{pending}</strong><small>正在等待平台审核</small></article><article><span>联系邮箱</span><strong className="metric-word">{resource.data.profile?.contactEmailVerified ? '已验证' : '待完善'}</strong><small>{resource.data.profile?.contactEmail || '尚未注册开发者资料'}</small></article></div><section className="panel"><div className="panel-heading"><div><span>RECENT APPLICATIONS</span><h2>最近的应用</h2></div><Link to="/developer/console/applications">查看全部 →</Link></div><DataTable headers={['应用名称', '客户端类型', 'Client ID', '状态']} empty="还没有创建应用">{resource.data.applications.list.slice(0, 5).map((item) => <tr key={item.id}><td><strong>{item.draft.name}</strong></td><td>{item.type.toUpperCase()}</td><td><code>{item.clientId}</code></td><td><Status value={item.status} /></td></tr>)}</DataTable></section></>;
}

function DeveloperProfilePage() {
  const resource = useResource(() => apiGet<DeveloperProfile | null>('/api/v1/developer/profile'));
  const [message, setMessage] = useState('');
  if (!resource.data && (resource.loading || resource.error)) return <Feedback loading={resource.loading} error={resource.error} />;
  const profile = resource.data;
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setMessage('保存中…');
    const fields = new FormData(event.currentTarget);
    try {
      await developerMutation('/api/v1/developer/profile', 'PUT', { displayName: fields.get('displayName'), contactEmail: fields.get('contactEmail'), contactPhone: fields.get('contactPhone'), purpose: fields.get('purpose'), expectedRevision: profile?.revision || 0 });
      setMessage('资料已保存'); resource.reload();
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : '保存失败'); }
  };
  const verifyEmail = async () => {
    try { await developerMutation('/api/v1/developer/profile/verification-email', 'POST', {}); setMessage('验证邮件已发送，请检查收件箱'); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : '发送失败'); }
  };
  return <section className="panel form-panel"><div className="panel-heading"><div><span>PERSONAL PROFILE</span><h2>个人资料</h2><p>维护开发者名称、联系方式和接入用途。审核操作在“开发者审核”中单独管理。</p></div>{profile && <Status value={profile.contactEmailVerified ? 'verified' : 'unverified'} />}</div><form className="form-grid" onSubmit={save}><label><span>开发者名称</span><input name="displayName" required maxLength={100} defaultValue={profile?.displayName || ''} /></label><label><span>联系邮箱</span><input name="contactEmail" type="email" required defaultValue={profile?.contactEmail || ''} /></label><label><span>联系电话（选填）</span><input name="contactPhone" maxLength={50} defaultValue={profile?.contactPhone || ''} /></label><label className="full-field"><span>接入用途</span><textarea name="purpose" required maxLength={2000} defaultValue={profile?.purpose || ''} /></label><div className="form-actions"><button className="button primary" type="submit">保存资料</button>{profile && !profile.contactEmailVerified && <button className="button secondary" type="button" onClick={() => void verifyEmail()}>发送验证邮件</button>}<span role="status">{message}</span></div></form></section>;
}

function ReviewHistory({ refreshKey = 0 }: { refreshKey?: number }) {
  const resource = useResource(() => apiGet<Array<{ action: string; reason: string | null; created_at: string }>>('/api/v1/developer/review/history'), [refreshKey]);
  if (resource.loading || resource.error) return <Feedback loading={resource.loading} error={resource.error} />;
  return <div className="review-history"><h3>审核记录</h3>{resource.data?.length ? <ul>{resource.data.map((item, index) => <li key={`${item.created_at}-${index}`}><Status value={item.action === 'reject' ? 'rejected' : item.action === 'approve' ? 'approved' : 'pending'} /><span>{item.reason || '无附加说明'}</span><time>{new Date(item.created_at).toLocaleString('zh-CN')}</time></li>)}</ul> : <p>尚无审核记录。</p>}</div>;
}

function DeveloperReviewPage({ revision, status }: { revision?: number; status?: SessionData['developerStatus'] }) {
  const [message, setMessage] = useState('');
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const submitReview = async () => {
    setMessage('正在提交审核…');
    try {
      const currentRevision = revision ?? (await apiGet<{ account: { revision: number } | null }>('/api/v1/developer-auth/session')).account?.revision;
      if (!currentRevision) throw new Error('开发者会话缺少有效版本，请刷新后重试');
      await developerMutation('/api/v1/developer/review/submit', 'POST', { expectedRevision: currentRevision });
      setMessage('资料已提交审核');
      setHistoryRefreshKey((value) => value + 1);
      window.dispatchEvent(new Event('developer-session-changed'));
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : '提交审核失败'); }
  };
  const canSubmit = status === 'unsubmitted' || status === 'rejected';
  return <section className="panel"><div className="panel-heading"><div><span>DEVELOPER REVIEW</span><h2>开发者审核</h2><p>完善个人资料后手动提交审核，审核通过后才可创建应用。</p></div>{status && <Status value={status} />}</div><div className="form-actions">{canSubmit && <button className="button primary" type="button" onClick={() => void submitReview()}>提交开发者审核</button>}<span role="status">{message}</span></div><ReviewHistory refreshKey={historyRefreshKey} /></section>;
}

function DeveloperSecurityPage({ methods }: { methods?: Array<'email' | 'moondrop'> }) {
  const resource = useResource(() => methods ? Promise.resolve(methods) : apiGet<{ authenticationMethods: Array<'email' | 'moondrop'> }>('/api/v1/developer-auth/session').then((session) => session.authenticationMethods));
  const methodLabel = { email: '邮箱密码', moondrop: '水月雨账号' } as const;
  if (!resource.data) return <Feedback loading={resource.loading} error={resource.error} />;
  return <section className="panel"><div className="panel-heading"><div><span>ACCOUNT SECURITY</span><h2>安全设置</h2><p>这里仅展示当前开发者账号已经实际绑定的认证方式。</p></div></div><div className="security-methods">{resource.data.map((method) => <article key={method}><div><strong>{methodLabel[method]}</strong><p>{method === 'email' ? '使用开发者邮箱与密码登录' : '使用已绑定的水月雨账号登录'}</p></div><Status value="verified" /></article>)}</div><div className="security-unavailable"><article><strong>修改密码</strong><span>暂未开放</span></article><article><strong>解绑认证方式</strong><span>暂未开放</span></article><article><strong>会话管理</strong><span>暂未开放</span></article></div></section>;
}

function ApplicationsPage({ canCreate }: { canCreate: boolean }) {
  const resource = useResource(() => apiGet<PageResult<ApplicationRecord>>('/api/v1/developer/applications?page=1&pageSize=100'));
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  if (!resource.data) return <Feedback loading={resource.loading} error={resource.error} />;
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setMessage('正在创建…'); setClientSecret('');
    const values = new FormData(event.currentTarget);
    const lines = (name: string) => String(values.get(name) || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    try {
      const result = await developerMutation<{ application: ApplicationRecord; clientSecret?: string }>('/api/v1/developer/applications', 'POST', {
        type: values.get('type'),
        draft: {
          name: values.get('name'), description: values.get('description'), purpose: values.get('purpose'),
          homepageUrl: values.get('homepageUrl'), privacyUrl: values.get('privacyUrl'), termsUrl: values.get('termsUrl'),
          iconUrl: null, redirectUris: lines('redirectUris'), postLogoutRedirectUris: lines('postLogoutRedirectUris'),
          scopes: ['openid', 'profile', 'email'], groupId: null,
        },
      });
      setClientSecret(result.clientSecret || ''); setMessage('应用已创建为草稿'); setCreating(false); resource.reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : '创建失败'); }
  };
  const submit = async (item: ApplicationRecord) => {
    if (!window.confirm(`确认提交“${item.draft.name}”审核？`)) return;
    try { await developerMutation(`/api/v1/developer/applications/${item.id}/submit`, 'POST', { expectedRevision: item.revision }); setMessage('应用已提交审核'); resource.reload(); }
    catch (error) { setMessage(error instanceof Error ? error.message : '提交失败'); }
  };
  return <>{clientSecret && <section className="secret-notice"><strong>请立即保存 Client Secret</strong><p>该密钥只展示一次，关闭后无法再次查看。</p><code>{clientSecret}</code></section>}{creating && canCreate && <ApplicationDraftForm title="创建应用" submitLabel="创建草稿" onCancel={() => setCreating(false)} onSubmit={create} message={message} /> }<section className="panel"><div className="panel-heading"><div><span>OIDC CLIENTS</span><h2>我的应用</h2><p>管理客户端配置、审核状态和生产凭据。</p>{!canCreate && <small>开发者审核通过后可创建应用</small>}</div><button className="button primary" type="button" disabled={!canCreate} onClick={() => setCreating(true)}>创建应用</button></div><span className="operation-message" role="status">{message}</span><DataTable headers={['应用名称', '类型', 'Client ID', '版本', '状态', '操作']} empty="还没有应用">{resource.data.list.map((item) => <tr key={item.id}><td><Link className="table-link" to={`/developer/console/applications/${item.id}`}><strong>{item.draft.name}</strong></Link><small className="cell-note">{item.draft.description || '暂无描述'}</small></td><td>{item.type.toUpperCase()}</td><td><code>{item.clientId}</code></td><td>v{item.revision}</td><td><Status value={item.status} /></td><td><div className="row-actions">{(item.status === 'draft' || item.status === 'rejected') && <button type="button" onClick={() => void submit(item)}>提交审核</button>}</div></td></tr>)}</DataTable></section></>;
}

function ApplicationDraftForm({ title, submitLabel, initial, type = 'web', onCancel, onSubmit, message }: { title: string; submitLabel: string; initial?: ApplicationDraft; type?: ApplicationRecord['type']; onCancel: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>; message: string }) {
  return <section className="panel form-panel application-form"><div className="panel-heading"><div><span>OIDC CLIENT CONFIGURATION</span><h2>{title}</h2></div><button className="text-button" type="button" onClick={onCancel}>取消</button></div><form className="form-grid" onSubmit={onSubmit}><label><span>客户端类型</span><select name="type" defaultValue={type} disabled={Boolean(initial)}><option value="web">Web 服务端</option><option value="spa">SPA 单页应用</option><option value="native">Native 客户端</option></select></label><label><span>应用名称</span><input name="name" required maxLength={100} defaultValue={initial?.name} /></label><label className="full-field"><span>应用描述</span><textarea name="description" required maxLength={1000} defaultValue={initial?.description} /></label><label className="full-field"><span>使用目的</span><textarea name="purpose" required maxLength={1000} defaultValue={initial?.purpose} /></label><label><span>应用主页（HTTPS）</span><input name="homepageUrl" type="url" required placeholder="https://example.com" defaultValue={initial?.homepageUrl} /></label><label><span>隐私政策（HTTPS）</span><input name="privacyUrl" type="url" required defaultValue={initial?.privacyUrl} /></label><label><span>服务条款（HTTPS）</span><input name="termsUrl" type="url" required defaultValue={initial?.termsUrl} /></label><label><span>回调地址（每行一个）</span><textarea name="redirectUris" required placeholder="https://example.com/oidc/callback" defaultValue={initial?.redirectUris.join('\n')} /></label><label className="full-field"><span>退出回调地址（每行一个）</span><textarea name="postLogoutRedirectUris" required placeholder="https://example.com/signed-out" defaultValue={initial?.postLogoutRedirectUris.join('\n')} /></label><div className="form-actions"><button className="button primary" type="submit">{submitLabel}</button><span role="status">{message}</span></div></form></section>;
}

function ApplicationDetailPage({ id }: { id: string }) {
  const resource = useResource(() => apiGet<ApplicationRecord>(`/api/v1/developer/applications/${encodeURIComponent(id)}`), [id]);
  const [editing, setEditing] = useState(false); const [message, setMessage] = useState(''); const [secret, setSecret] = useState('');
  if (!resource.data) return <Feedback loading={resource.loading} error={resource.error} />;
  const item = resource.data;
  const edit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const values = new FormData(event.currentTarget); const lines = (name: string) => String(values.get(name) || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const draft = { ...item.draft, name: values.get('name'), description: values.get('description'), purpose: values.get('purpose'), homepageUrl: values.get('homepageUrl'), privacyUrl: values.get('privacyUrl'), termsUrl: values.get('termsUrl'), redirectUris: lines('redirectUris'), postLogoutRedirectUris: lines('postLogoutRedirectUris') };
    try { await developerMutation(`/api/v1/developer/applications/${item.id}`, 'PATCH', { expectedRevision: item.revision, draft }); setMessage('应用配置已保存'); setEditing(false); resource.reload(); }
    catch (error) { setMessage(error instanceof Error ? error.message : '保存失败'); }
  };
  const rotate = async () => {
    if (!window.confirm('轮换后旧 Client Secret 将立即失效，确认继续？')) return;
    try { const data = await developerMutation<{ clientSecret: string }>(`/api/v1/developer/applications/${item.id}/rotate-secret`, 'POST', { expectedRevision: item.revision }); setSecret(data.clientSecret); setMessage('密钥已轮换，请立即保存'); resource.reload(); }
    catch (error) { setMessage(error instanceof Error ? error.message : '轮换失败'); }
  };
  if (editing) return <ApplicationDraftForm title={`编辑 ${item.draft.name}`} submitLabel="保存配置" initial={item.draft} type={item.type} onCancel={() => setEditing(false)} onSubmit={edit} message={message} />;
  return <>{secret && <section className="secret-notice"><strong>新的 Client Secret</strong><p>旧密钥已失效，该值只展示一次。</p><code>{secret}</code></section>}<section className="panel detail-panel"><div className="panel-heading"><div><span>APPLICATION DETAIL</span><h2>{item.draft.name}</h2><p><code>{item.clientId}</code></p></div><Status value={item.status} /></div><dl className="detail-grid"><div><dt>客户端类型</dt><dd>{item.type.toUpperCase()}</dd></div><div><dt>当前版本</dt><dd>v{item.revision}</dd></div><div><dt>应用主页</dt><dd>{item.draft.homepageUrl}</dd></div><div><dt>授权范围</dt><dd>{item.draft.scopes.join(' · ')}</dd></div><div className="wide"><dt>回调地址</dt><dd>{item.draft.redirectUris.map((uri) => <code key={uri}>{uri}</code>)}</dd></div></dl><div className="form-actions"><button className="button primary" type="button" onClick={() => setEditing(true)}>编辑配置</button>{item.type === 'web' && <button className="button secondary" type="button" onClick={() => void rotate()}>轮换 Client Secret</button>}<span role="status">{message}</span></div></section></>;
}

function GroupsPage({ canCreate }: { canCreate: boolean }) {
  const resource = useResource(() => apiGet<PageResult<GroupRecord>>('/api/v1/developer/groups?page=1&pageSize=100'));
  const [message, setMessage] = useState('');
  if (!resource.data) return <Feedback loading={resource.loading} error={resource.error} />;
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const value = new FormData(form).get('displayName');
    try { await developerMutation('/api/v1/developer/groups', 'POST', { displayName: value }); form.reset(); setMessage('应用组已创建并进入审核'); resource.reload(); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : '创建失败'); }
  };
  const rename = async (item: GroupRecord) => {
    const displayName = window.prompt('新的应用组名称', item.displayName)?.trim(); if (!displayName || displayName === item.displayName) return;
    try { await developerMutation(`/api/v1/developer/groups/${item.id}`, 'PUT', { expectedRevision: item.revision, displayName }); setMessage('应用组名称已更新并重新进入审核'); resource.reload(); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : '修改失败'); }
  };
  const remove = async (item: GroupRecord) => {
    if (!window.confirm(`确认删除应用组“${item.displayName}”？仅未被应用引用的待审或已驳回应用组可以删除。`)) return;
    try { await developerMutation(`/api/v1/developer/groups/${item.id}`, 'DELETE', { expectedRevision: item.revision }); setMessage('应用组已删除'); resource.reload(); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : '删除失败'); }
  };
  return <><section className="panel compact-form"><form onSubmit={create}><label><span>新建应用组</span><input name="displayName" required maxLength={100} disabled={!canCreate} placeholder="例如：MOONDROP 官方应用" /></label><button className="button primary" type="submit" disabled={!canCreate}>创建应用组</button></form>{!canCreate && <small>开发者审核通过后可创建应用组</small>}<span role="status">{message}</span></section><section className="panel"><div className="panel-heading"><div><span>APPLICATION GROUPS</span><h2>应用组</h2><p>同一应用组可承载同一业务边界内的多个客户端。</p></div></div><DataTable headers={['应用组名称', '版本', '状态', '操作']} empty="还没有应用组">{resource.data.list.map((item) => <tr key={item.id}><td><strong>{item.displayName}</strong></td><td>v{item.revision}</td><td><Status value={item.status} /></td><td><div className="row-actions"><button type="button" onClick={() => void rename(item)}>改名</button>{(item.status === 'pending' || item.status === 'rejected') && <button className="danger" type="button" onClick={() => void remove(item)}>删除</button>}</div></td></tr>)}</DataTable></section></>;
}

function DataTable({ headers, empty, children }: { headers: string[]; empty: string; children: ReactNode }) {
  const rows = Array.isArray(children) ? children.length : children ? 1 : 0;
  return <div className="table-wrap"><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows ? children : <tr><td className="empty-cell" colSpan={headers.length}>{empty}</td></tr>}</tbody></table></div>;
}

function Status({ value }: { value: string }) { return <span className={`status status-${value}`}>{statusText[value] || (value === 'verified' ? '邮箱已验证' : '邮箱未验证')}</span>; }

function AccountProfilePage() {
  const resource = useResource(() => apiGet<{ nickname: string; email: string | null; picture: string | null }>('/api/v1/me'));
  if (!resource.data) return <Feedback loading={resource.loading} error={resource.error} />;
  return <section className="panel profile-card"><div className="profile-avatar">{resource.data.picture ? <img src={resource.data.picture} alt="账号头像" /> : resource.data.nickname.slice(0, 2).toUpperCase()}</div><div><span>MOONDROP ACCOUNT</span><h2>{resource.data.nickname}</h2><p>{resource.data.email || '未提供邮箱'}</p><small>基础账号资料由水月雨账号服务统一维护。</small></div></section>;
}

function AuthorizationsPage({ csrfToken }: { csrfToken: string }) {
  const resource = useResource(() => apiGet<AuthorizationRecord[]>('/api/v1/account/authorizations'));
  const [message, setMessage] = useState('');
  if (!resource.data) return <Feedback loading={resource.loading} error={resource.error} />;
  const revoke = async (record: AuthorizationRecord) => {
    if (!window.confirm(`确认撤销“${record.name}”的访问授权？`)) return;
    try { await consoleMutation(`/api/v1/account/authorizations/${encodeURIComponent(record.id)}`, 'DELETE', csrfToken); setMessage('授权已撤销'); resource.reload(); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : '撤销失败'); }
  };
  return <section className="panel"><div className="panel-heading"><div><span>AUTHORIZED APPLICATIONS</span><h2>应用授权</h2><p>查看哪些应用可以访问你的账号身份信息。</p></div><span role="status">{message}</span></div><DataTable headers={['应用', '授权范围', '授权时间', '操作']} empty="当前没有有效的应用授权">{resource.data.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><small className="cell-note">{item.clientId || '平台门户'}</small></td><td>{item.scopes.join(' · ')}</td><td>{new Date(item.authorizedAt).toLocaleString('zh-CN')}</td><td><button className="text-button danger" type="button" onClick={() => void revoke(item)}>撤销授权</button></td></tr>)}</DataTable></section>;
}

function AdminDevelopers({ csrfToken }: { csrfToken: string }) {
  const [status, setStatus] = useState<AdminDeveloper['status']>('pending');
  const [message, setMessage] = useState('');
  const resource = useResource(() => apiGet<PageResult<AdminDeveloper>>(`/api/v1/admin/developers?page=1&pageSize=100&status=${status}`), [status]);
  if (!resource.data) return <Feedback loading={resource.loading} error={resource.error} />;
  const review = async (item: AdminDeveloper, action: 'approve' | 'reject' | 'disable' | 'restore') => {
    const reason = action === 'reject' || action === 'disable' ? window.prompt(action === 'reject' ? '请输入驳回理由' : '请输入禁用理由') || '' : '';
    if ((action === 'reject' || action === 'disable') && !reason) return;
    try {
      await consoleMutation(`/api/v1/admin/developers/${item.id}/review`, 'POST', csrfToken, { action, expectedRevision: item.revision, reason });
      setMessage('开发者审核结果已保存'); resource.reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : '审核失败'); }
  };
  return <section className="panel"><div className="panel-heading"><div><span>DEVELOPER QUALIFICATION</span><h2>开发者审核</h2><p>审核开发者资料与平台接入用途。</p></div><label className="filter-select"><span>状态</span><select value={status} onChange={(event) => setStatus(event.target.value as AdminDeveloper['status'])}>{['pending', 'unsubmitted', 'approved', 'rejected', 'disabled'].map((value) => <option key={value} value={value}>{statusText[value]}</option>)}</select></label></div><span className="operation-message" role="status">{message}</span><DataTable headers={['开发者', '联系邮箱', '登录方式', '审核次数', '状态', '操作']} empty="当前筛选条件下没有开发者">{resource.data.list.map((item) => <tr key={item.id}><td><Link className="table-link" to={`/admin/developers/${item.id}`}><strong>{item.displayName}</strong></Link><small className="cell-note">{item.id}</small></td><td>{item.contactEmail}</td><td>{item.identityTypes.join(' · ')}</td><td>{item.reviewCount}</td><td><Status value={item.status} /></td><td><div className="row-actions">{item.status === 'pending' && <><button type="button" onClick={() => void review(item, 'approve')}>批准</button><button className="danger" type="button" onClick={() => void review(item, 'reject')}>驳回</button></>}{item.status === 'approved' && <button className="danger" type="button" onClick={() => void review(item, 'disable')}>禁用</button>}{item.status === 'disabled' && <button type="button" onClick={() => void review(item, 'restore')}>恢复</button>}</div></td></tr>)}</DataTable></section>;
}

function AdminDeveloperDetail({ id, csrfToken }: { id: string; csrfToken: string }) {
  const [message, setMessage] = useState('');
  const resource = useResource(() => apiGet<{ account: { status: AdminDeveloper['status']; revision: number }; profile: DeveloperProfile; history: Array<{ action: string; reason: string | null; profile_snapshot: DeveloperProfile; created_at: string }> }>(`/api/v1/admin/developers/${encodeURIComponent(id)}`), [id]);
  if (!resource.data) return <Feedback loading={resource.loading} error={resource.error} />;
  const { account, profile, history } = resource.data;
  const review = async (action: 'approve' | 'reject' | 'disable' | 'restore') => {
    const reason = action === 'reject' || action === 'disable' ? window.prompt(action === 'reject' ? '请输入驳回理由' : '请输入禁用理由') || '' : '';
    if ((action === 'reject' || action === 'disable') && !reason) return;
    try { await consoleMutation(`/api/v1/admin/developers/${id}/review`, 'POST', csrfToken, { action, expectedRevision: account.revision, reason }); setMessage('审核结果已保存'); resource.reload(); }
    catch (error) { setMessage(error instanceof Error ? error.message : '审核失败'); }
  };
  return <><section className="panel detail-panel"><div className="panel-heading"><div><span>DEVELOPER REVIEW DETAIL</span><h2>{profile.displayName}</h2><p>{profile.contactEmail}</p></div><Status value={account.status} /></div><dl className="detail-grid"><div><dt>联系电话</dt><dd>{profile.contactPhone || '—'}</dd></div><div><dt>邮箱验证</dt><dd>{profile.contactEmailVerified ? '已验证' : '未验证'}</dd></div><div className="wide"><dt>接入用途</dt><dd>{profile.purpose || '—'}</dd></div></dl><div className="form-actions">{account.status === 'pending' && <><button className="button primary" type="button" onClick={() => void review('approve')}>批准开发者</button><button className="button secondary" type="button" onClick={() => void review('reject')}>驳回</button></>}{account.status === 'approved' && <button className="button secondary" type="button" onClick={() => void review('disable')}>禁用开发者</button>}{account.status === 'disabled' && <button className="button primary" type="button" onClick={() => void review('restore')}>恢复开发者</button>}<span role="status">{message}</span></div></section><section className="panel"><div className="panel-heading"><div><span>REVIEW HISTORY</span><h2>审核记录</h2></div></div><DataTable headers={['时间', '动作', '当时用途', '理由']} empty="暂无审核记录">{history.map((item, index) => <tr key={`${item.created_at}-${index}`}><td>{new Date(item.created_at).toLocaleString('zh-CN')}</td><td>{item.action}</td><td>{item.profile_snapshot?.purpose || '—'}</td><td>{item.reason || '—'}</td></tr>)}</DataTable></section></>;
}

function AdminOverview() {
  const resource = useResource(() => apiGet<AdminOverviewData>('/api/v1/admin/overview'));
  if (!resource.data) return <Feedback loading={resource.loading} error={resource.error} />;
  const appTotal = Object.values(resource.data.applications).reduce((sum, value) => sum + value, 0);
  const groupTotal = Object.values(resource.data.groups).reduce((sum, value) => sum + value, 0);
  return <><div className="metric-grid"><article><span>应用总数</span><strong>{appTotal}</strong><small>所有已登记 OIDC 客户端</small></article><article><span>待审应用</span><strong>{resource.data.applications.pending || 0}</strong><small>需要运营人员处理</small></article><article><span>应用组</span><strong>{groupTotal}</strong><small>全部业务归属分组</small></article><article><span>待审应用组</span><strong>{resource.data.groups.pending || 0}</strong><small>需要确认组织归属</small></article></div><section className="panel"><div className="panel-heading"><div><span>RECENT AUDIT</span><h2>最近操作</h2></div><Link to="/admin/audit">查看审计 →</Link></div><DataTable headers={['时间', '主体', '操作', '结果']} empty="暂无审计记录">{resource.data.recentAudit.map((item, index) => <tr key={`${item.created_at}-${index}`}><td>{new Date(item.created_at).toLocaleString('zh-CN')}</td><td>{item.actor_type}</td><td><code>{item.action}</code></td><td><Status value={item.outcome} /></td></tr>)}</DataTable></section></>;
}

function AdminApplications({ csrfToken }: { csrfToken: string }) {
  const [status, setStatus] = useState<ApplicationStatus>('pending');
  const resource = useResource(() => apiGet<PageResult<AdminApplication>>(`/api/v1/admin/applications?page=1&pageSize=100&status=${status}`), [status]);
  const [message, setMessage] = useState('');
  if (!resource.data) return <Feedback loading={resource.loading} error={resource.error} />;
  const review = async (item: AdminApplication, action: 'approve' | 'reject' | 'disable') => {
    const reason = action === 'approve' ? '' : window.prompt(action === 'reject' ? '请输入驳回理由' : '请输入停用理由') || '';
    if (action !== 'approve' && !reason) return;
    try { await consoleMutation(`/api/v1/admin/applications/${item.id}/review`, 'POST', csrfToken, { action, expectedRevision: item.revision, reason }); setMessage('审核结果已保存'); resource.reload(); }
    catch (error) { setMessage(error instanceof Error ? error.message : '审核失败'); }
  };
  return <section className="panel"><div className="panel-heading"><div><span>APPLICATION REVIEW</span><h2>应用审核</h2><p>审核开发者提交的 OIDC 客户端配置。</p></div><FilterSelect value={status} onChange={(value) => setStatus(value as ApplicationStatus)} /></div><span className="operation-message" role="status">{message}</span><DataTable headers={['应用', '类型', 'Client ID', '版本', '状态', '操作']} empty="当前筛选条件下没有应用">{resource.data.list.map((item) => <tr key={item.id}><td><Link className="table-link" to={`/admin/applications/${item.id}`}><strong>{item.draft.name}</strong></Link><small className="cell-note">{item.ownerUuid}</small></td><td>{item.type.toUpperCase()}</td><td><code>{item.clientId}</code></td><td>v{item.revision}</td><td><Status value={item.status} /></td><td><div className="row-actions">{item.status === 'pending' && <><button onClick={() => void review(item, 'approve')} type="button">批准</button><button className="danger" onClick={() => void review(item, 'reject')} type="button">驳回</button></>}{item.status === 'approved' && <button className="danger" onClick={() => void review(item, 'disable')} type="button">停用</button>}</div></td></tr>)}</DataTable></section>;
}

function AdminApplicationDetail({ id, csrfToken }: { id: string; csrfToken: string }) {
  const resource = useResource(() => apiGet<AdminApplication>(`/api/v1/admin/applications/${encodeURIComponent(id)}`), [id]); const [message, setMessage] = useState('');
  if (!resource.data) return <Feedback loading={resource.loading} error={resource.error} />; const item = resource.data;
  const review = async (action: 'approve' | 'reject' | 'disable') => {
    const reason = action === 'approve' ? '' : window.prompt(action === 'reject' ? '请输入驳回理由' : '请输入停用理由') || ''; if (action !== 'approve' && !reason) return;
    try { await consoleMutation(`/api/v1/admin/applications/${item.id}/review`, 'POST', csrfToken, { action, expectedRevision: item.revision, reason }); setMessage('审核结果已保存'); resource.reload(); }
    catch (error) { setMessage(error instanceof Error ? error.message : '审核失败'); }
  };
  return <section className="panel detail-panel"><div className="panel-heading"><div><span>APPLICATION REVIEW DETAIL</span><h2>{item.draft.name}</h2><p><code>{item.clientId}</code></p></div><Status value={item.status} /></div><dl className="detail-grid"><div><dt>申请账号</dt><dd>{item.ownerUuid}</dd></div><div><dt>客户端类型</dt><dd>{item.type.toUpperCase()}</dd></div><div><dt>应用主页</dt><dd>{item.draft.homepageUrl}</dd></div><div><dt>隐私政策</dt><dd>{item.draft.privacyUrl}</dd></div><div className="wide"><dt>应用描述与使用目的</dt><dd>{item.draft.description}<br />{item.draft.purpose}</dd></div><div className="wide"><dt>登录回调地址</dt><dd>{item.draft.redirectUris.map((uri) => <code key={uri}>{uri}</code>)}</dd></div></dl><div className="form-actions">{item.status === 'pending' && <><button className="button primary" type="button" onClick={() => void review('approve')}>批准应用</button><button className="button secondary" type="button" onClick={() => void review('reject')}>驳回</button></>}{item.status === 'approved' && <button className="button secondary" type="button" onClick={() => void review('disable')}>停用应用</button>}<span role="status">{message}</span></div></section>;
}

function AdminGroups({ csrfToken }: { csrfToken: string }) {
  const [status, setStatus] = useState('pending');
  const resource = useResource(() => apiGet<PageResult<GroupRecord>>(`/api/v1/admin/groups?page=1&pageSize=100&status=${status}`), [status]);
  const [message, setMessage] = useState('');
  if (!resource.data) return <Feedback loading={resource.loading} error={resource.error} />;
  const review = async (item: GroupRecord, action: 'approve' | 'reject' | 'disable') => {
    const reason = action === 'approve' ? '' : window.prompt(action === 'reject' ? '请输入驳回理由' : '请输入停用理由') || '';
    if (action !== 'approve' && !reason) return;
    try { await consoleMutation(`/api/v1/admin/groups/${item.id}/review`, 'POST', csrfToken, { action, expectedRevision: item.revision, reason }); setMessage('审核结果已保存'); resource.reload(); }
    catch (error) { setMessage(error instanceof Error ? error.message : '审核失败'); }
  };
  return <section className="panel"><div className="panel-heading"><div><span>GROUP REVIEW</span><h2>应用组审核</h2><p>确认应用组的业务归属与平台使用资格。</p></div><FilterSelect value={status} onChange={setStatus} group /></div><span className="operation-message" role="status">{message}</span><DataTable headers={['应用组', '申请账号', '版本', '状态', '操作']} empty="当前筛选条件下没有应用组">{resource.data.list.map((item) => <tr key={item.id}><td><Link className="table-link" to={`/admin/groups/${item.id}`}><strong>{item.displayName}</strong></Link></td><td>{item.ownerUuid || '—'}</td><td>v{item.revision}</td><td><Status value={item.status} /></td><td><div className="row-actions">{item.status === 'pending' && <><button onClick={() => void review(item, 'approve')} type="button">批准</button><button className="danger" onClick={() => void review(item, 'reject')} type="button">驳回</button></>}{item.status === 'approved' && <button className="danger" onClick={() => void review(item, 'disable')} type="button">停用</button>}</div></td></tr>)}</DataTable></section>;
}

function AdminGroupDetail({ id, csrfToken }: { id: string; csrfToken: string }) {
  const resource = useResource(() => apiGet<GroupRecord>(`/api/v1/admin/groups/${encodeURIComponent(id)}`), [id]); const [message, setMessage] = useState('');
  if (!resource.data) return <Feedback loading={resource.loading} error={resource.error} />; const item = resource.data;
  const review = async (action: 'approve' | 'reject' | 'disable') => { const reason = action === 'approve' ? '' : window.prompt(action === 'reject' ? '请输入驳回理由' : '请输入停用理由') || ''; if (action !== 'approve' && !reason) return; try { await consoleMutation(`/api/v1/admin/groups/${item.id}/review`, 'POST', csrfToken, { action, expectedRevision: item.revision, reason }); setMessage('审核结果已保存'); resource.reload(); } catch (error) { setMessage(error instanceof Error ? error.message : '审核失败'); } };
  return <section className="panel detail-panel"><div className="panel-heading"><div><span>GROUP REVIEW DETAIL</span><h2>{item.displayName}</h2></div><Status value={item.status} /></div><dl className="detail-grid"><div><dt>申请账号</dt><dd>{item.ownerUuid || '—'}</dd></div><div><dt>当前版本</dt><dd>v{item.revision}</dd></div><div className="wide"><dt>最近审核</dt><dd>{item.lastReview ? `${item.lastReview.reviewedAt} · ${item.lastReview.reason || '无附加理由'}` : '尚无审核记录'}</dd></div></dl><div className="form-actions">{item.status === 'pending' && <><button className="button primary" type="button" onClick={() => void review('approve')}>批准应用组</button><button className="button secondary" type="button" onClick={() => void review('reject')}>驳回</button></>}{item.status === 'approved' && <button className="button secondary" type="button" onClick={() => void review('disable')}>停用应用组</button>}<span role="status">{message}</span></div></section>;
}

function FilterSelect({ value, onChange, group = false }: { value: string; onChange: (value: string) => void; group?: boolean }) {
  const values = group ? ['pending', 'approved', 'rejected', 'disabled'] : ['pending', 'approved', 'draft', 'rejected', 'disabled'];
  return <label className="filter-select"><span>状态</span><select value={value} onChange={(event) => onChange(event.target.value)}>{values.map((item) => <option key={item} value={item}>{statusText[item]}</option>)}</select></label>;
}

function AdminAudit() {
  const resource = useResource(() => apiGet<{ page: number; list: AuditRecord[] }>('/api/v1/admin/audit?page=1'));
  if (!resource.data) return <Feedback loading={resource.loading} error={resource.error} />;
  return <section className="panel"><div className="panel-heading"><div><span>PLATFORM AUDIT</span><h2>操作审计</h2><p>平台安全事件和业务状态变更的不可变记录。</p></div></div><DataTable headers={['时间', '主体', '操作', '应用', '结果']} empty="暂无审计记录">{resource.data.list.map((item, index) => <tr key={`${item.created_at}-${index}`}><td>{new Date(item.created_at).toLocaleString('zh-CN')}</td><td>{item.actor_type}<small className="cell-note">{item.actor_id || '—'}</small></td><td><code>{item.action}</code></td><td>{item.application_id || '—'}</td><td><Status value={item.outcome} /></td></tr>)}</DataTable></section>;
}

function AdminStatistics() {
  const [days, setDays] = useState('7');
  const resource = useResource(() => apiGet<{ days: number; list: StatisticRecord[] }>(`/api/v1/admin/statistics?days=${days}`), [days]);
  if (!resource.data) return <Feedback loading={resource.loading} error={resource.error} />;
  return <section className="panel"><div className="panel-heading"><div><span>PROTOCOL METRICS</span><h2>协议请求统计</h2><p>按 OIDC 端点与结果汇总请求量、平均延迟和 P95 延迟。</p></div><label className="filter-select"><span>统计周期</span><select value={days} onChange={(event) => setDays(event.target.value)}><option value="1">1 天</option><option value="7">7 天</option><option value="30">30 天</option><option value="90">90 天</option></select></label></div><DataTable headers={['端点', '结果', '请求数', '平均延迟', 'P95 延迟']} empty="周期内暂无协议请求">{resource.data.list.map((item) => <tr key={`${item.action}-${item.outcome}`}><td><code>{item.action.replace('protocol.', '')}</code></td><td><Status value={item.outcome} /></td><td>{item.request_count}</td><td>{item.average_ms ?? '—'} ms</td><td>{item.p95_ms ?? '—'} ms</td></tr>)}</DataTable></section>;
}

function Placeholder({ title }: { title: string }) { return <section className="placeholder-panel"><div className="placeholder-icon">◆</div><h2>{title}</h2><p>该模块正在接入统一控制台数据与操作流程。</p></section>; }

function ConsoleContent({ kind, active, csrfToken, developerStatus, developerRevision, authenticationMethods = [] }: { kind: ConsoleKind; active: string; csrfToken: string; developerStatus?: SessionData['developerStatus']; developerRevision?: number; authenticationMethods?: Array<'email' | 'moondrop'> }) {
  const location = useLocation();
  const pathname = location.pathname.replace(/^\/developer\/console/, '/developer');
  if (pathname === '/account/profile') return <AccountProfilePage />;
  if (location.pathname === '/account/authorizations') return <AuthorizationsPage csrfToken={csrfToken} />;
  if (pathname === '/developer/overview') return <DeveloperOverview />;
  if (pathname === '/developer/profile') return <DeveloperProfilePage />;
  if (pathname === '/developer/review') return <DeveloperReviewPage revision={developerRevision} status={developerStatus} />;
  if (pathname === '/developer/applications') return <ApplicationsPage canCreate={developerStatus === 'approved'} />;
  if (pathname.startsWith('/developer/applications/')) return <ApplicationDetailPage id={pathname.slice('/developer/applications/'.length)} />;
  if (pathname === '/developer/groups') return <GroupsPage canCreate={developerStatus === 'approved'} />;
  if (pathname === '/developer/security') return <DeveloperSecurityPage methods={authenticationMethods.length ? authenticationMethods : undefined} />;
  if (location.pathname === '/admin/overview') return <AdminOverview />;
  if (location.pathname === '/admin/developers') return <AdminDevelopers csrfToken={csrfToken} />;
  if (location.pathname.startsWith('/admin/developers/')) return <AdminDeveloperDetail id={location.pathname.slice('/admin/developers/'.length)} csrfToken={csrfToken} />;
  if (location.pathname === '/admin/applications') return <AdminApplications csrfToken={csrfToken} />;
  if (location.pathname.startsWith('/admin/applications/')) return <AdminApplicationDetail id={location.pathname.slice('/admin/applications/'.length)} csrfToken={csrfToken} />;
  if (location.pathname === '/admin/groups') return <AdminGroups csrfToken={csrfToken} />;
  if (location.pathname.startsWith('/admin/groups/')) return <AdminGroupDetail id={location.pathname.slice('/admin/groups/'.length)} csrfToken={csrfToken} />;
  if (location.pathname === '/admin/audit') return <AdminAudit />;
  if (location.pathname === '/admin/statistics') return <AdminStatistics />;
  return <Placeholder title={active || consoleCopy[kind].label} />;
}

function ConsoleShell({ kind }: { kind: ConsoleKind }) {
  const location = useLocation(); const navigate = useNavigate(); const copy = consoleCopy[kind];
  const active = copy.items.find(([path]) => location.pathname === path)?.[1] ?? copy.label;
  const session = useResource<SessionData>(async () => {
    if (kind !== 'developer') return apiGet<SessionData>('/api/v1/session');
    const developer = await apiGet<{ account: { id: string; status: SessionData['developerStatus']; revision: number; lastReview?: { reason: string | null; reviewedAt: string } | null } | null; authenticationMethods: Array<'email' | 'moondrop'>; csrfToken: string }>('/api/v1/developer-auth/session');
    if (developer.account) return {
        account: { uuid: developer.account.id, nickname: '开发者', email: null, picture: null },
        admin: { authenticated: false }, csrfToken: developer.csrfToken,
        developerRevision: developer.account.revision,
        authenticationMethods: developer.authenticationMethods,
        ...(developer.account.status ? { developerStatus: developer.account.status } : {}),
        ...(developer.account.lastReview ? { developerReview: developer.account.lastReview } : {}),
    };
    return { account: null, admin: { authenticated: false }, csrfToken: developer.csrfToken, authenticationMethods: [] };
  }, [location.pathname, kind]);
  useEffect(() => {
    const refresh = () => session.reload();
    window.addEventListener('developer-session-changed', refresh);
    return () => window.removeEventListener('developer-session-changed', refresh);
  }, [session.reload]);
  const signedIn = kind === 'admin' ? session.data?.admin.authenticated : Boolean(session.data?.account);
  const loginHref = kind === 'admin' ? '/admin/login' : `/developer/login?returnTo=${encodeURIComponent(location.pathname)}`;
  const logoutAdmin = async () => {
    if (!session.data?.csrfToken) return;
    try { await consoleMutation('/api/v1/admin/logout', 'POST', session.data.csrfToken); window.location.assign('/admin/login'); }
    catch { session.reload(); }
  };
  const logoutDeveloper = async () => {
    if (!session.data?.csrfToken) return;
    try {
      await consoleMutation('/api/v1/developer-auth/logout', 'POST', session.data.csrfToken);
      navigate('/');
    } catch { session.reload(); }
  };
  const developerStatus = session.data?.developerStatus;
  const statusCopy = developerStatus ? ({ unsubmitted: ['未提交审核', '完善开发者资料后手动提交审核'], pending: ['审核中', '平台管理员正在审核开发者资质'], approved: ['审核通过', '可以创建应用和应用组'], rejected: ['审核已驳回', '请根据审核意见修改资料后重新提交'], disabled: ['账号已禁用', '请联系平台管理员处理'] } as const)[developerStatus] : null;
  return <div className="console-layout"><aside className="sidebar"><div className="sidebar-brand"><Brand /></div><div className="workspace-label"><span>当前工作区</span><strong>{copy.title}</strong></div><nav className="side-nav" aria-label={copy.label}>{copy.items.map(([path, label], index) => <Link className={location.pathname === path ? 'active' : ''} to={path} key={path}><span>{String(index + 1).padStart(2, '0')}</span>{label}</Link>)}</nav><Link className="sidebar-help" to="/developer/docs">帮助与文档<span>→</span></Link></aside><div className="console-main"><header className="console-header"><div className="breadcrumb">MOONDROP <span>/</span> {copy.label} <span>/</span> <strong>{active}</strong></div><div className="header-actions"><span className="header-user">{session.data?.account?.nickname || session.data?.admin.username || '访客'}</span>{kind === 'admin' && signedIn && <button className="header-logout" type="button" onClick={() => void logoutAdmin()}>退出</button>}{kind === 'developer' && signedIn && <button className="header-logout" type="button" onClick={() => void logoutDeveloper()}>退出登录</button>}<span className="avatar">{(session.data?.account?.nickname || session.data?.admin.username || 'MD').slice(0, 2).toUpperCase()}</span></div></header><main className="workspace"><div className="page-title"><div><span>{copy.label}</span><h1>{active}</h1><p>统一身份平台工作区，所有关键操作均可追踪与审计。</p></div></div>{session.loading ? <Feedback loading error="" /> : !signedIn ? <section className="panel auth-required"><span className="placeholder-icon">↗</span><h2>需要登录后继续</h2><p>{kind === 'admin' ? '请使用平台管理员凭据登录。' : '使用开发者邮箱或水月雨账号登录后继续。'}</p><a className="button primary" href={loginHref}>前往登录</a></section> : <>{kind === 'developer' && statusCopy && <section className={`developer-status-card status-${developerStatus}`}><div><span>开发者状态</span><strong>{statusCopy[0]}</strong><small>{session.data?.developerReview?.reason || statusCopy[1]}</small></div>{developerStatus === 'unsubmitted' && <Link className="button primary" to="/developer/console/profile">完善资料</Link>}</section>}<ConsoleContent kind={kind} active={active} csrfToken={session.data?.csrfToken || ''} developerStatus={developerStatus} /></>}</main></div></div>;
}

export function ConsoleApp() {
  return <BrowserRouter><Routes><Route path="/" element={<DeveloperLanding />} /><Route path="/developer" element={<Navigate to="/" replace />} /><Route path="/developer/login" element={<DeveloperLogin />} /><Route path="/developer/register" element={<DeveloperRegister />} /><Route path="/developer/bind" element={<DeveloperBinding />} /><Route path="/developer/docs" element={<DeveloperDocs />} /><Route path="/developer/console/*" element={<ConsoleShell kind="developer" />} /><Route path="/developer/overview" element={<Navigate to="/developer/console/overview" replace />} /><Route path="/developer/profile" element={<Navigate to="/developer/console/profile" replace />} /><Route path="/developer/review" element={<Navigate to="/developer/console/review" replace />} /><Route path="/developer/applications" element={<Navigate to="/developer/console/applications" replace />} /><Route path="/developer/groups" element={<Navigate to="/developer/console/groups" replace />} /><Route path="/developer/security" element={<Navigate to="/developer/console/security" replace />} /><Route path="/admin" element={<Navigate to="/admin/overview" replace />} /><Route path="/admin/*" element={<ConsoleShell kind="admin" />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></BrowserRouter>;
}
