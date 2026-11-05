import { useState } from 'react';
import { Link } from 'react-router-dom';

import { DeveloperPublicHeader } from './DeveloperPublic';

const sections = [
  ['quick-start', '快速开始'],
  ['developer-account', '成为开发者'],
  ['create-application', '创建应用'],
  ['protocol', 'OIDC 与 OAuth 2.0'],
  ['client-types', '客户端类型'],
  ['api-errors', 'API 与错误码'],
  ['review', '审核规范'],
  ['faq', '常见问题'],
] as const;

export function DeveloperDocs() {
  const [copyStatus, setCopyStatus] = useState('');
  const copyDiscoveryUrl = async () => {
    const url = `${window.location.origin}/.well-known/openid-configuration`;
    try {
      await navigator.clipboard.writeText(url);
      setCopyStatus('地址已复制');
    } catch {
      setCopyStatus(`复制失败，请手动复制：${url}`);
    }
  };
  return <div className="developer-public developer-docs-page">
    <DeveloperPublicHeader />
    <main>
      <section className="developer-docs-hero">
        <span>MOONDROP DEVELOPER DOCUMENTATION</span>
        <h1>接入文档</h1>
        <p>从开发者注册、应用审核到标准 OIDC 登录，按真实上线流程完成接入。</p>
        <div><Link className="button primary" to="/developer/register">注册开发者</Link><Link className="button secondary" to="/developer/console/overview">进入开发者控制台</Link></div>
      </section>
      <div className="developer-docs-layout">
        <nav className="developer-docs-toc" aria-label="文档目录"><strong>文档目录</strong>{sections.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}</nav>
        <article className="developer-docs-content">
          <section id="quick-start"><span>QUICK START</span><h2>快速开始</h2><ol className="developer-docs-steps"><li><b>1</b><div><strong>注册并完善资料</strong><p>使用邮箱验证码注册，或使用水月雨账号创建、绑定开发者身份。</p></div></li><li><b>2</b><div><strong>提交开发者审核</strong><p>验证联系邮箱并提交真实用途；审核通过后才能创建应用。</p></div></li><li><b>3</b><div><strong>创建应用并联调</strong><p>选择客户端类型，填写精确回调地址，提交应用审核后按 Discovery 配置接入。</p></div></li></ol></section>
          <section id="developer-account"><span>DEVELOPER IDENTITY</span><h2>成为开发者</h2><p>开发者账号独立存放在开放平台。邮箱密码和水月雨账号是登录同一开发者身份的两种凭据，不会按邮箱自动合并账号。</p><Link to="/developer/register">注册开发者账号 →</Link></section>
          <section id="create-application"><span>APPLICATION</span><h2>创建应用</h2><p>开发者审核通过后，可以创建应用组和 OIDC 应用。应用名称、用途、主页、隐私政策、服务条款、回调地址和申请范围必须完整准确。</p><p>回调地址执行精确匹配，不支持通配符、片段或包含凭据的 URL。</p></section>
          <section id="protocol"><span>PROTOCOL</span><h2>OIDC 与 OAuth 2.0</h2><p>平台使用 OpenID Connect 构建身份层，采用 Authorization Code 流程。SPA 与原生应用必须使用 PKCE，服务端 Web 应用还应安全保管 Client Secret。</p><p>Discovery 地址供 OIDC SDK 自动获取授权、Token、用户信息和公钥端点。</p><pre><code>GET /.well-known/openid-configuration</code></pre><div className="developer-docs-actions"><button className="button secondary" type="button" onClick={() => void copyDiscoveryUrl()}>复制 Discovery 地址</button><a className="button secondary" href="/.well-known/openid-configuration" target="_blank" rel="noreferrer">查看原始 JSON</a><span role="status">{copyStatus}</span></div></section>
          <section id="client-types"><span>CLIENT TYPES</span><h2>客户端类型</h2><div className="developer-docs-cards"><div><h3>Web 应用</h3><p>适合有可信服务端的应用。服务端交换授权码并保管 Client Secret。</p></div><div><h3>SPA 应用</h3><p>浏览器公开客户端，不下发 Client Secret，必须使用 Authorization Code + PKCE。</p></div><div><h3>原生应用</h3><p>移动端或桌面公开客户端，使用反向域名私有 URI 或审核通过的 HTTPS 回调，并启用 PKCE。</p></div></div></section>
          <section id="api-errors"><span>REFERENCE</span><h2>API 与错误码</h2><p>JSON API 统一返回 <code>{'{ code, desc, data }'}</code>。HTTP 状态表示协议结果，稳定的业务码用于程序判断；响应中的描述只用于展示。</p></section>
          <section id="review"><span>REVIEW</span><h2>审核规范</h2><p>开发者资质、应用组和应用分别审核。资料必须真实，回调地址必须属于申请方控制，申请范围应满足最小权限原则；被驳回后根据原因修改并重新提交。</p></section>
          <section id="faq"><span>FAQ</span><h2>常见问题</h2><details><summary>为什么创建不了应用？</summary><p>只有开发者状态为“审核通过”时才能创建应用和应用组。</p></details><details><summary>邮箱登录和水月雨账号会生成两个开发者吗？</summary><p>不会自动按邮箱合并。首次使用水月雨账号时，可以新建开发者身份，或通过密码复验绑定已有开发者账号。</p></details><details><summary>为什么回调地址不支持通配符？</summary><p>精确匹配可以阻止授权码被发送到未审核的地址，是登录安全边界的一部分。</p></details></section>
        </article>
      </div>
    </main>
    <footer className="developer-docs-footer"><span>© MOONDROP</span><span>OpenID Connect · OAuth 2.0 · PKCE</span></footer>
  </div>;
}
