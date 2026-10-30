const API = '/api/v1/developer';
const state = { csrf: '', language: 'zh', profileRevision: 0, profile: null, apps: [], groups: [], editing: null };
const t = {
  zh: {
    secure:'安全会话',signIn:'登录',eyebrow:'开发者工作区',title:'管理你的身份接入应用',intro:'维护开发者资料、提交应用审核，并查看当前审核状态。',
    accountEyebrow:'账户资料',profileTitle:'开发者资料',loading:'加载中',profileHelp:'联系邮箱仅用于联系，不代表已完成邮箱验证。',
    displayName:'开发者名称',contactEmail:'联系邮箱',saveProfile:'保存资料',sendVerification:'发送验证邮件',verificationSent:'验证邮件已发送，请检查收件箱。',verificationAlready:'该邮箱已验证。',catalogEyebrow:'应用',appsTitle:'我的应用',newApp:'新建应用',
    groupsEyebrow:'身份关联',groupsTitle:'应用组',groupsHelp:'同一所有者的应用组经审核后可用于关联应用身份。',
    groupName:'应用组名称',groupPlaceholder:'输入应用组名称',createGroup:'申请应用组',editorEyebrow:'应用设置',createAppTitle:'创建应用',
    editAppTitle:'编辑应用草稿',editorHelp:'提交审核后，当前已批准版本保持生效；回调地址和资料范围会由运营审核。',
    close:'关闭',appType:'客户端类型',appName:'应用名称',description:'应用简介',purpose:'应用用途',
    homepage:'应用主页 HTTPS 地址',icon:'图标 HTTPS 地址（可选）',privacy:'隐私政策 HTTPS 地址',terms:'服务条款 HTTPS 地址',
    redirects:'登录回调地址（每行一个，1–10 个）',logoutRedirects:'退出返回地址（每行一个，1–10 个）',
    scopes:'申请资料范围',scopeIdentity:'身份标识',scopeProfile:'昵称和头像',scopeEmail:'邮箱地址',groupId:'应用组 ID（可选）',
    cancel:'取消',saveDraft:'保存草稿',submitReview:'提交审核',secretEyebrow:'仅显示一次',secretTitle:'保存客户端密钥',
    secretHelp:'请立即复制并保存到安全的密钥管理器。关闭后不会再次显示。',copySecret:'复制密钥',
    footer:'协议接入仅对已批准应用开放',profileRequired:'请先完成开发者资料登记。',authRequired:'请先在此浏览器中登录身份服务，再打开开发者中心。',
    loginRequired:'登录状态失效，请刷新页面并重新登录。',saveOk:'已保存。',created:'应用已创建。',groupCreated:'应用组申请已提交。',
    submitted:'已提交审核。',rotated:'密钥已轮换，旧密钥已立即失效。',copied:'密钥已复制。',copyFailed:'复制失败，请手动复制。',
    loadFailed:'暂时无法加载数据。请稍后重试。',emptyApps:'还没有应用。创建一个应用草稿以开始。',emptyGroups:'还没有应用组申请。',
    edit:'编辑',submit:'提交审核',rotate:'轮换密钥',rename:'改名',revision:'版本',appTypes:{web:'Web',spa:'SPA',native:'Native'},
    groupApproved:'已批准',groupPending:'审核中',groupRejected:'已驳回',groupDisabled:'已停用',deleteGroup:'删除',confirmDeleteGroup:'删除此应用组？仅未被应用引用的待审或已驳回组可以删除。',
    noSecret:'该客户端不使用密钥。',secretWarning:'密钥只显示这一次，请先妥善保存再关闭。',
    loadProfileError:'开发者资料加载失败。',groupError:'应用组操作失败。',requestError:'操作失败。',
    confirmSubmit:'确认将此版本提交审核？',confirmRotate:'轮换后旧密钥立即失效。确定继续？',
    appSaved:'应用草稿已保存。', profileMissing:'请先登记开发者名称和联系邮箱。', copy:'复制',
    unknownError:'请求失败，请稍后重试。',verified:'已验证',unverified:'未验证',draft:'草稿',typeWeb:'Web · 服务端保密客户端',typeSpa:'SPA · 浏览器公开客户端',typeNative:'Native · 原生公开客户端'
  },
  en: {
    secure:'Secure session',signIn:'Sign in',eyebrow:'DEVELOPER WORKSPACE',title:'Manage your identity applications',intro:'Maintain your developer profile, submit applications for review, and track their status.',
    accountEyebrow:'ACCOUNT',profileTitle:'Developer profile',loading:'Loading',profileHelp:'The contact email is unverified until a separate verification flow is completed.',
    displayName:'Developer name',contactEmail:'Contact email',saveProfile:'Save profile',sendVerification:'Send verification email',verificationSent:'Verification email sent. Check your inbox.',verificationAlready:'This email is already verified.',catalogEyebrow:'APPLICATIONS',appsTitle:'My applications',newApp:'New application',
    groupsEyebrow:'IDENTITY LINKING',groupsTitle:'Application groups',groupsHelp:'Approved groups can link application identities owned by the same developer.',
    groupName:'Group name',groupPlaceholder:'Enter a group name',createGroup:'Request group',editorEyebrow:'APPLICATION SETTINGS',createAppTitle:'Create application',
    editAppTitle:'Edit application draft',editorHelp:'Submitting a change keeps the approved version active until the new version is reviewed.',
    close:'Close',appType:'Client type',appName:'Application name',description:'Description',purpose:'Purpose',
    homepage:'Homepage HTTPS URL',icon:'Icon HTTPS URL (optional)',privacy:'Privacy policy HTTPS URL',terms:'Terms of service HTTPS URL',
    redirects:'Login redirect URIs (one per line, 1–10)',logoutRedirects:'Logout return URIs (one per line, 1–10)',
    scopes:'Requested data',scopeIdentity:'Identity identifier',scopeProfile:'Nickname and picture',scopeEmail:'Email address',groupId:'Application group ID (optional)',
    cancel:'Cancel',saveDraft:'Save draft',submitReview:'Submit for review',secretEyebrow:'SHOWN ONCE',secretTitle:'Save your client secret',
    secretHelp:'Copy it now and store it in a secure secret manager. It cannot be displayed again after closing.',copySecret:'Copy secret',
    footer:'Protocol access is available only to approved applications',profileRequired:'Complete your developer profile first.',authRequired:'Sign in to the identity service in this browser, then open the developer center.',
    loginRequired:'Your session expired. Refresh the page and sign in again.',saveOk:'Saved.',created:'Application created.',groupCreated:'Group request submitted.',
    submitted:'Submitted for review.',rotated:'Secret rotated. The previous secret is now invalid.',copied:'Secret copied.',copyFailed:'Copy failed. Copy the value manually.',
    loadFailed:'Could not load the data. Please try again later.',emptyApps:'No applications yet. Create a draft to get started.',emptyGroups:'No group requests yet.',
    edit:'Edit',submit:'Submit',rotate:'Rotate secret',rename:'Rename',revision:'Revision',appTypes:{web:'Web',spa:'SPA',native:'Native'},
    groupApproved:'Approved',groupPending:'Pending review',groupRejected:'Rejected',groupDisabled:'Disabled',deleteGroup:'Delete',confirmDeleteGroup:'Delete this group? Only pending or rejected groups not referenced by an application can be deleted.',
    noSecret:'This public client does not use a secret.',secretWarning:'This secret is shown only once. Save it before closing.',
    loadProfileError:'Could not load the developer profile.',groupError:'Application group operation failed.',requestError:'Operation failed.',
    confirmSubmit:'Submit this revision for review?',confirmRotate:'The current secret will stop working immediately. Continue?',
    appSaved:'Application draft saved.',profileMissing:'Register a developer name and contact email first.',copy:'Copy',
    unknownError:'Request failed. Please try again later.',verified:'Verified',unverified:'Unverified',draft:'Draft',typeWeb:'Web · confidential server client',typeSpa:'SPA · public browser client',typeNative:'Native · public native client'
  }
};
function tr(key){return t[state.language][key]??t.zh[key]??key}
function setLanguage(language){
  state.language=language;
  document.documentElement.lang=language==='zh'?'zh-CN':'en';
  document.querySelectorAll('[data-i18n]').forEach(el=>{const value=tr(el.dataset.i18n);if(typeof value==='string')el.textContent=value});
  document.querySelectorAll('[data-placeholder]').forEach(el=>el.placeholder=tr(el.dataset.placeholder));
  document.querySelector('#language-toggle').textContent=language==='zh'?'EN':'中文';
  document.querySelector('#sign-in-link').textContent=tr('signIn');
}
function showSignInEntry(){document.querySelector('#sign-in-link').hidden=false;document.querySelector('#secure-label').hidden=true}
function notice(message,kind='success'){
  const el=document.querySelector('#notice');el.textContent=message;el.className='notice notice-'+kind;el.hidden=false;
  window.scrollTo({top:0,behavior:'smooth'});
}
function escapeHtml(value){
  return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
async function request(path,options={}){
  const response=await fetch(API+path,{...options,credentials:'same-origin',headers:{
    ...(options.body?{'Content-Type':'application/json'}:{}),
    ...(options.method&&options.method!=='GET'?{'X-CSRF-Token':state.csrf}:{}),
    ...options.headers
  }});
  const result=await response.json().catch(()=>null);
  if(response.status===401){showSignInEntry();throw new Error('AUTH_REQUIRED')}
  if(!response.ok||!result||result.code!==0)throw new Error(result?.desc||tr('unknownError'));
  return result.data;
}
async function loadCsrf(){
  const response=await fetch(API+'/csrf',{credentials:'same-origin',cache:'no-store'});
  if(response.status===401)throw new Error('AUTH_REQUIRED');
  const result=await response.json();
  if(!response.ok||result.code!==0||!result.data?.token)throw new Error(result.desc||tr('unknownError'));
  state.csrf=result.data.token;
  document.querySelector('#sign-in-link').hidden=true;document.querySelector('#secure-label').hidden=false;
}
function statusClass(status){return ['pending','approved','rejected','disabled'].includes(status)?'pill-'+status:'pill-muted'}
function statusName(status){
  const values={approved:tr('groupApproved'),pending:tr('groupPending'),rejected:tr('groupRejected'),disabled:tr('groupDisabled'),draft:tr('draft')};
  return values[status]||status;
}
function renderApps(){
  const target=document.querySelector('#application-list');
  if(!state.apps.length){target.innerHTML='<div class="empty-state">'+escapeHtml(tr('emptyApps'))+'</div>';return}
  target.innerHTML=state.apps.map(app=>{
    const allowed=app.status!=='pending'&&app.status!=='disabled';
    const actions=(allowed?'<button class="button button-quiet" data-action="edit" data-id="'+escapeHtml(app.id)+'">'+escapeHtml(tr('edit'))+'</button>':'')+
      (allowed?'<button class="button button-secondary" data-action="submit" data-id="'+escapeHtml(app.id)+'">'+escapeHtml(tr('submit'))+'</button>':'')+
      (app.type==='web'&&app.status==='approved'?'<button class="button button-quiet" data-action="rotate" data-id="'+escapeHtml(app.id)+'">'+escapeHtml(tr('rotate'))+'</button>':'');
    return '<article class="record"><div class="record-main"><div class="record-title">'+escapeHtml(app.draft.name)+'</div><div class="record-meta">'+escapeHtml(tr('appTypes')[app.type]||app.type)+' · '+escapeHtml(statusName(app.status))+' · '+escapeHtml(tr('revision'))+' '+app.revision+'</div></div><div class="record-actions">'+actions+'</div></article>'
  }).join('');
}
function renderGroups(){
  const target=document.querySelector('#group-list');
  if(!state.groups.length){target.innerHTML='<div class="empty-state">'+escapeHtml(tr('emptyGroups'))+'</div>';return}
  target.innerHTML=state.groups.map(group=>{
    const canRename=['pending','rejected'].includes(group.status);
    return '<article class="record"><div class="record-main"><div class="record-title">'+escapeHtml(group.displayName)+'</div><div class="record-meta">'+escapeHtml(statusName(group.status))+' · ID '+escapeHtml(group.id)+' · '+escapeHtml(tr('revision'))+' '+group.revision+'</div></div>'+
      (canRename?'<div class="record-actions"><button class="button button-quiet" data-action="rename-group" data-id="'+escapeHtml(group.id)+'">'+escapeHtml(tr('rename'))+'</button><button class="button button-quiet" data-action="delete-group" data-id="'+escapeHtml(group.id)+'">'+escapeHtml(tr('deleteGroup'))+'</button></div>':'')+'</article>'
  }).join('');
}
async function refresh(){
  const [profile,apps,groups]=await Promise.all([
    request('/profile'),request('/applications?page=1&pageSize=100'),request('/groups?page=1&pageSize=100')
  ]);
  state.profile=profile;state.apps=apps.list||[];state.groups=groups.list||[];
  const profileState=document.querySelector('#profile-state');
  if(profile){
    state.profileRevision=profile.revision;
    document.querySelector('#profile-form [name=displayName]').value=profile.displayName;
    document.querySelector('#profile-form [name=contactEmail]').value=profile.contactEmail;
    profileState.textContent=profile.contactEmailVerified?tr('verified'):tr('unverified');
    profileState.className='pill '+(profile.contactEmailVerified?'pill-approved':'pill-muted');
    document.querySelector('#verify-email').hidden=profile.contactEmailVerified;
  }else{
    state.profile=null;state.profileRevision=0;profileState.textContent=tr('profileRequired');profileState.className='pill pill-pending';
    document.querySelector('#verify-email').hidden=true;
  }
  renderApps();renderGroups();
}
function showEditor(app=null){
  state.editing=app;
  const section=document.querySelector('#app-editor'),form=document.querySelector('#application-form');
  form.reset();
  form.elements.id.value=app?.id||'';form.elements.revision.value=app?.revision||'';
  form.elements.type.value=app?.type||'web';form.elements.type.disabled=Boolean(app);
  document.querySelector('#editor-title').textContent=app?tr('editAppTitle'):tr('createAppTitle');
  const draft=app?.draft;
  if(draft){
    for(const key of ['name','description','purpose','homepageUrl','privacyUrl','termsUrl'])form.elements[key].value=draft[key]||'';
    form.elements.iconUrl.value=draft.iconUrl||'';
    form.elements.redirectUris.value=draft.redirectUris.join('\n');
    form.elements.postLogoutRedirectUris.value=draft.postLogoutRedirectUris.join('\n');
    form.elements.groupId.value=draft.groupId||'';
    form.elements.scopeProfile.checked=draft.scopes.includes('profile');
    form.elements.scopeEmail.checked=draft.scopes.includes('email');
  }
  section.hidden=false;section.scrollIntoView({behavior:'smooth',block:'start'});
}
function readDraft(form){
  const data=new FormData(form);
  const lines=name=>String(data.get(name)||'').split(/\r?\n/).map(value=>value.trim()).filter(Boolean);
  return {
    name:String(data.get('name')||''),description:String(data.get('description')||''),purpose:String(data.get('purpose')||''),
    homepageUrl:String(data.get('homepageUrl')||''),privacyUrl:String(data.get('privacyUrl')||''),termsUrl:String(data.get('termsUrl')||''),
    iconUrl:String(data.get('iconUrl')||'').trim()||null,redirectUris:lines('redirectUris'),
    postLogoutRedirectUris:lines('postLogoutRedirectUris'),
    scopes:['openid',...(data.has('scopeProfile')?['profile']:[]),...(data.has('scopeEmail')?['email']:[])],
    groupId:String(data.get('groupId')||'').trim()||null
  }
}
function showSecret(secret){
  if(!secret)return;
  document.querySelector('#secret-value').textContent=secret;
  document.querySelector('#secret-dialog').showModal();
}
document.querySelector('#language-toggle').addEventListener('click',()=>setLanguage(state.language==='zh'?'en':'zh'));
document.querySelector('#new-app').addEventListener('click',()=>showEditor());
document.querySelector('#close-editor').addEventListener('click',()=>document.querySelector('#app-editor').hidden=true);
document.querySelector('#cancel-editor').addEventListener('click',()=>document.querySelector('#app-editor').hidden=true);
document.querySelector('#application-list').addEventListener('click',async event=>{
  const button=event.target.closest('button[data-action]');if(!button)return;
  const app=state.apps.find(item=>item.id===button.dataset.id);if(!app)return;
  try{
    if(button.dataset.action==='edit'){showEditor(app);return}
    if(button.dataset.action==='submit'){
      if(!window.confirm(tr('confirmSubmit')))return;
      await request('/applications/'+encodeURIComponent(app.id)+'/submit',{method:'POST',body:JSON.stringify({expectedRevision:app.revision})});
      notice(tr('submitted'));await refresh();return
    }
    if(button.dataset.action==='rotate'){
      if(!window.confirm(tr('confirmRotate')))return;
      const data=await request('/applications/'+encodeURIComponent(app.id)+'/rotate-secret',{method:'POST',body:JSON.stringify({expectedRevision:app.revision})});
      showSecret(data.clientSecret);notice(tr('rotated'))
    }
  }catch(error){notice(error.message==='AUTH_REQUIRED'?tr('loginRequired'):error.message,'error')}
});
document.querySelector('#group-list').addEventListener('click',async event=>{
  const button=event.target.closest('button[data-action]');if(!button)return;
  const group=state.groups.find(item=>item.id===button.dataset.id);if(!group)return;
  if(button.dataset.action==='delete-group'){
    if(!window.confirm(tr('confirmDeleteGroup')))return;
    try{
      await request('/groups/'+encodeURIComponent(group.id),{method:'DELETE',body:JSON.stringify({expectedRevision:group.revision})});
      notice(tr('saveOk'));await refresh()
    }catch(error){notice(error.message==='AUTH_REQUIRED'?tr('loginRequired'):error.message,'error')}
    return
  }
  if(button.dataset.action!=='rename-group')return;
  const name=window.prompt(tr('groupName'),group.displayName);if(name===null)return;
  try{
    await request('/groups/'+encodeURIComponent(group.id),{method:'PUT',body:JSON.stringify({expectedRevision:group.revision,displayName:name})});
    notice(tr('saveOk'));await refresh()
  }catch(error){notice(error.message==='AUTH_REQUIRED'?tr('loginRequired'):error.message,'error')}
});
document.querySelector('#profile-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const form=event.currentTarget;
  try{
    await request('/profile',{method:'PUT',body:JSON.stringify({
      expectedRevision:state.profileRevision,displayName:form.elements.displayName.value,contactEmail:form.elements.contactEmail.value
    })});
    notice(tr('saveOk'));await refresh()
  }catch(error){notice(error.message==='AUTH_REQUIRED'?tr('loginRequired'):error.message,'error')}
});
document.querySelector('#verify-email').addEventListener('click',async()=>{
  try{
    const result=await request('/profile/verification-email',{method:'POST',body:JSON.stringify({})});
    notice(result==='sent'?tr('verificationSent'):tr('verificationAlready'));await refresh()
  }catch(error){notice(error.message==='AUTH_REQUIRED'?tr('loginRequired'):error.message,'error')}
});
document.querySelector('#group-form').addEventListener('submit',async event=>{
  event.preventDefault();
  if(!state.profileRevision){notice(tr('profileMissing'),'error');return}
  const form=event.currentTarget;
  try{
    await request('/groups',{method:'POST',body:JSON.stringify({displayName:form.elements.displayName.value})});
    form.reset();notice(tr('groupCreated'));await refresh()
  }catch(error){notice(error.message==='AUTH_REQUIRED'?tr('loginRequired'):error.message,'error')}
});
document.querySelector('#application-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const form=event.currentTarget;if(!state.profileRevision){notice(tr('profileMissing'),'error');return}
  const draft=readDraft(form),id=form.elements.id.value,revision=Number(form.elements.revision.value);
  try{
    if(id){
      await request('/applications/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({expectedRevision:revision,draft})});
      notice(tr('appSaved'))
    }else{
      const created=await request('/applications',{method:'POST',body:JSON.stringify({type:form.elements.type.value,draft})});
      if(created.clientSecret)showSecret(created.clientSecret);
      notice(tr('created'))
    }
    document.querySelector('#app-editor').hidden=true;await refresh()
  }catch(error){notice(error.message==='AUTH_REQUIRED'?tr('loginRequired'):error.message,'error')}
});
document.querySelector('#submit-app').addEventListener('click',async()=>{
  const form=document.querySelector('#application-form');
  if(!form.reportValidity())return;
  const id=form.elements.id.value;
  if(!id){notice(tr('saveDraft'),'info');form.requestSubmit();return}
  if(!window.confirm(tr('confirmSubmit')))return;
  try{
    const result=await request('/applications/'+encodeURIComponent(id)+'/submit',{method:'POST',body:JSON.stringify({expectedRevision:Number(form.elements.revision.value)})});
    notice(tr('submitted'));document.querySelector('#app-editor').hidden=true;await refresh()
  }catch(error){notice(error.message==='AUTH_REQUIRED'?tr('loginRequired'):error.message,'error')}
});
document.querySelector('#copy-secret').addEventListener('click',async()=>{
  const secret=document.querySelector('#secret-value').textContent;
  try{await navigator.clipboard.writeText(secret);notice(tr('copied'))}catch{notice(tr('copyFailed'),'error')}
});
setLanguage('zh');
loadCsrf().then(refresh).catch(error=>{
  if(error.message==='AUTH_REQUIRED'){document.querySelector('#sign-in-link').hidden=false;document.querySelector('#secure-label').hidden=true}
  document.querySelector('#profile-state').textContent=error.message==='AUTH_REQUIRED'?tr('authRequired'):tr('loadFailed');
  document.querySelector('#application-list').innerHTML='<div class="empty-state">'+escapeHtml(error.message==='AUTH_REQUIRED'?tr('authRequired'):tr('loadFailed'))+'</div>';
  document.querySelector('#group-list').innerHTML='';
});
