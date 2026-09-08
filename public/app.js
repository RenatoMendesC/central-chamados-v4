const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let me=null,meta={categories:[],departments:[],brandName:'Central de Serviços'},tickets=[],users=[],assets=[],articles=[];
const roleLabel={admin:'Administrador',agent:'Analista',requester:'Solicitante'},userStatus={active:'Ativo',pending:'Pendente',blocked:'Bloqueado'};
const ticketStatus={open:'Aberto',progress:'Em atendimento',resolved:'Resolvido',closed:'Encerrado'},priorityLabel={low:'Baixa',medium:'Média',high:'Alta',urgent:'Crítica'},impactLabel={low:'Baixo',medium:'Médio',high:'Alto'};
const assetStatus={active:'Em uso',maintenance:'Manutenção',stock:'Estoque',retired:'Baixado'},eventLabel={created:'Chamado criado',updated:'Chamado atualizado',commented:'Interação registrada',attachment_added:'Anexo incluído'};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=d=>d?new Date(d).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'—',fmtShort=d=>d?new Date(d).toLocaleDateString('pt-BR'):'—';
async function api(url,opt={}){const tenantHeader=localStorage.getItem('activeOrganizationId');const r=await fetch(url,{headers:{'Content-Type':'application/json',...(tenantHeader?{'X-Organization-Id':tenantHeader}:{}),...(opt.headers||{})},...opt}),j=await r.json().catch(()=>({}));if(r.status===401){location.href='/';throw new Error('Sessão encerrada.')}if(!r.ok)throw new Error(j.error||'Erro na operação.');return j}
function avatar(u,size='sm'){const p=u?.photoData||u?.photo_data,n=u?.name||u?.requester_name||'?';return `<span class="avatar ${size}">${p?`<img src="${p}" alt="">`:esc(n.trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase())}</span>`}
function feedback(msg,type='ok'){const e=$('#feedback');if(!e)return;e.className=`feedback ${type}`;e.textContent=msg;e.classList.remove('hidden')}
function toast(msg,type='ok'){let e=document.createElement('div');e.className=`toast ${type}`;e.textContent=msg;document.body.appendChild(e);setTimeout(()=>e.classList.add('show'),10);setTimeout(()=>{e.classList.remove('show');setTimeout(()=>e.remove(),250)},2800)}
function modal(html,wide=false){const bg=document.createElement('div');bg.className='modal-bg';bg.innerHTML=`<section class="modal ${wide?'modal-wide':''}">${html}</section>`;document.body.appendChild(bg);bg.addEventListener('click',e=>{if(e.target===bg||e.target.closest('[data-close]'))bg.remove()});return bg}
async function fileToDataUrl(file,max=900000){if(!file)return null;if(file.size>max)throw new Error('Arquivo muito grande. Limite aproximado: 1 MB.');return await new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=no;r.readAsDataURL(file)})}
async function photoToDataUrl(file){if(!file)return null;return await new Promise((ok,no)=>{const im=new Image(),r=new FileReader();r.onload=()=>im.src=r.result;r.onerror=no;im.onload=()=>{const c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d'),s=Math.min(im.width,im.height),ox=(im.width-s)/2,oy=(im.height-s)/2;x.drawImage(im,ox,oy,s,s,0,0,256,256);ok(c.toDataURL('image/jpeg',.82))};r.readAsDataURL(file)})}
function isOverdue(t){return t.due_at&&new Date(t.due_at)<new Date()&&!['resolved','closed'].includes(t.status)}
function slaText(t){if(!t.due_at)return 'Sem SLA';if(['resolved','closed'].includes(t.status))return 'Finalizado';if(isOverdue(t))return `SLA vencido`;const h=Math.max(0,Math.ceil((new Date(t.due_at)-Date.now())/3600000));return h<24?`${h}h restantes`:`${Math.ceil(h/24)}d restantes`}
function pct(v,max){return Math.max(3,Math.min(100,(Number(v)||0)/Math.max(1,max)*100))}


const PLAN_LEVEL={start:1,business:2,pro:3};
function hasPlan(minPlan='start'){
  if(me?.isSuperAdmin)return true;
  const org=meta?.organization||{};
  const status=String(org.status||me?.organizationStatus||'').toLowerCase();
  const trialEnds=org.trial_ends_at||org.trialEndsAt||me?.organizationTrialEndsAt||null;
  if(status==='trial'&&trialEnds){
    const end=new Date(trialEnds);
    if(!Number.isNaN(end.getTime())&&end.getTime()>Date.now())return true;
  }
  const current=PLAN_LEVEL[String(org.plan||me?.organizationPlan||'start').toLowerCase()]||1;
  const required=PLAN_LEVEL[String(minPlan||'start').toLowerCase()]||1;
  return current>=required;
}
function applyPlanNavigation(){
  if(!me||me.isSuperAdmin)return;
  const premium=hasPlan('business');
  ['/ativos','/relatorios','/historico'].forEach(href=>{
    $$(`a[href="${href}"]`).forEach(a=>a.style.setProperty('display',premium?'':'none','important'));
  });
  $$('.sidebar .nav-group-title').forEach(title=>{
    const next=title.nextElementSibling;
    if(next?.classList?.contains('nav')){
      const visible=[...next.querySelectorAll('a')].some(a=>a.style.display!=='none');
      if(!visible)title.style.display='none';
    }
  });
}


async function loadMe(){
  const [m,mt]=await Promise.all([api('/api/me'),api('/api/meta')]);
  me=m.user;meta=mt;
  const tenantColor=meta?.organization?.primary_color||'#56d4c4';if(/^#[0-9a-fA-F]{6}$/.test(tenantColor))document.documentElement.style.setProperty('--accent',tenantColor);
  document.body.classList.toggle('is-superadmin',Boolean(me.isSuperAdmin));
  document.body.classList.toggle('is-tenant-mode',Boolean(me.isSuperAdmin&&localStorage.getItem('activeOrganizationId')));
  $$('[data-brand]').forEach(x=>x.textContent=meta.brandName);
  $$('[data-company]').forEach(x=>x.textContent=meta.companyName);
  $$('[data-tagline]').forEach(x=>x.textContent=meta.tagline);
  $$('[data-admin]').forEach(x=>x.style.display=me.role==='admin'?'':'none');
  $$('[data-staff]').forEach(x=>x.style.display=(me.isSuperAdmin||me.role!=='requester')?'':'none');
  $$('[data-superadmin]').forEach(x=>x.style.display=me.isSuperAdmin?'':'none');
  if(me.isSuperAdmin&&localStorage.getItem('activeOrganizationId')){
    const h=document.querySelector('.top-actions');
    if(h&&!document.getElementById('tenantMode')){
      const wrap=document.createElement('div');wrap.id='tenantMode';wrap.className='tenant-mode-banner';
      wrap.innerHTML=`<span><b>Modo suporte</b><small>${esc(meta.companyName||'Empresa selecionada')}</small></span><button class="btn secondary small" id="backPlatform">← Voltar à Plataforma</button>`;
      h.prepend(wrap);$('#backPlatform').onclick=()=>{localStorage.removeItem('activeOrganizationId');location.href='/plataforma'};
    }
  }
  if($('#meBox')){
    $('#meBox').innerHTML=`<button class="user-chip" id="userMenuBtn">${avatar(me)}<span><strong>${esc(me.name)}</strong><small>${me.isSuperAdmin?'Super Admin':roleLabel[me.role]}</small></span><b>⌄</b></button><div class="user-dropdown hidden" id="userDropdown"><div class="user-dropdown-head">${avatar(me,'md')}<div><strong>${esc(me.name)}</strong><small>@${esc(me.username)}</small></div></div>${me.isSuperAdmin?'<button id="platformMenu">Gestão da Plataforma</button>':''}<button id="profileMenu">Meu perfil</button><button id="logoutBtn" class="danger-text">Sair da conta</button></div>`;
    $('#userMenuBtn').onclick=()=>$('#userDropdown').classList.toggle('hidden');
    $('#platformMenu')?.addEventListener('click',()=>{localStorage.removeItem('activeOrganizationId');location.href='/plataforma'});
    $('#profileMenu').onclick=openProfile;
    $('#logoutBtn').onclick=async()=>{await api('/api/auth/logout',{method:'POST'});localStorage.removeItem('activeOrganizationId');location.href='/'};
  }
  ensureV9Navigation();
  applyPlanNavigation();
  showTrialWelcome();
  await loadNotifications();
}


/* ============================================
   V9 - NAVEGAÇÃO
   ============================================ */
function ensureV9Navigation(){
  const sidebar=document.querySelector('.sidebar');
  if(!sidebar)return;
  const bottom=sidebar.querySelector('.side-bottom');
  if(!bottom)return;

  if(me?.role!=='requester'&&hasPlan('business')&&!sidebar.querySelector('a[href="/historico"]')){
    const title=document.createElement('div');title.className='nav-group-title v9-nav';title.textContent='Governança';
    const nav=document.createElement('nav');nav.className='nav v9-nav';
    nav.innerHTML='<a href="/historico"><span class="nav-glyph">◷</span><span>Histórico</span></a>';
    bottom.before(title,nav);
  }

  if(!sidebar.querySelector('a[href="/assinatura"]')){
    const title=document.createElement('div');title.className='nav-group-title v9-nav';title.textContent='Empresa';
    const nav=document.createElement('nav');nav.className='nav v9-nav';
    nav.innerHTML='<a href="/assinatura"><span class="nav-glyph">◇</span><span>Assinatura</span></a>';
    bottom.before(title,nav);
  }
}

/* ============================================
   TRIAL / COBRANÇA
   ============================================ */

function getTrialInfo(){
  if(!me || me.isSuperAdmin){
    return null;
  }

  const org = meta?.organization || {};

  const status =
    String(
      org.status ||
      me.organizationStatus ||
      me.organization_status ||
      ''
    ).toLowerCase();

  const trialEndsAt =
    org.trial_ends_at ||
    org.trialEndsAt ||
    me.organizationTrialEndsAt ||
    me.organization_trial_ends_at ||
    null;

  const billingRequired =
    Boolean(
      me.billingRequired ??
      me.billing_required ??
      false
    );

  if(status !== 'trial' && !billingRequired){
    return null;
  }

  if(!trialEndsAt){
    return billingRequired
      ? {expired:true,days:0,end:null}
      : null;
  }

  const end = new Date(trialEndsAt);

  if(Number.isNaN(end.getTime())){
    return null;
  }

  const remainingMs = end.getTime() - Date.now();
  const expired = billingRequired || remainingMs <= 0;
  const days = expired
    ? 0
    : Math.max(
        1,
        Math.ceil(remainingMs / 86400000)
      );

  return {
    expired,
    days,
    end
  };
}

function showTrialWelcome(){
  const info=getTrialInfo();

  if(!info || me?.isSuperAdmin){
    return;
  }

  /*
    Mostra apenas uma vez por sessão do navegador.
    Uma nova entrada/login em outra sessão poderá exibir novamente.
  */
  const orgId=me?.organizationId||me?.organization_id||'org';
  const sessionKey=`trialWelcome:${orgId}:${info.expired?'expired':'active'}`;

  if(sessionStorage.getItem(sessionKey)==='1'){
    return;
  }

  sessionStorage.setItem(sessionKey,'1');

  const isAdmin=me?.role==='admin';
  const title=info.expired
    ? 'Seu período de teste terminou'
    : 'Seu período de teste está ativo';

  const description=info.expired
    ? (
        isAdmin
          ? 'Para continuar utilizando todos os recursos da Central de Serviços, escolha um dos planos disponíveis.'
          : 'O período de teste da sua empresa terminou. Entre em contato com o administrador para continuar utilizando a plataforma.'
      )
    : `Você tem ${info.days} ${info.days===1?'dia restante':'dias restantes'} para explorar a Central de Serviços${info.end?` — seu teste vai até ${fmtShort(info.end)}`:''}.`;

  const bg=modal(`
    <div class="modal-head">
      <div>
        <span class="eyebrow">${info.expired?'PERÍODO ENCERRADO':'BEM-VINDO À CENTRAL'}</span>
        <h2>${title}</h2>
        <p>${description}</p>
      </div>
      <button class="close" data-close aria-label="Fechar">×</button>
    </div>

    ${!info.expired?`
      <div style="margin:8px 0 4px;padding:16px 18px;border:1px solid var(--border);border-radius:14px;background:var(--panel2);">
        <strong style="display:block;font-size:1.05rem;margin-bottom:5px;">
          ${info.days} ${info.days===1?'dia restante':'dias restantes'}
        </strong>
        <span style="color:var(--muted);font-size:.92rem;">
          Aproveite para testar chamados, ativos, usuários, relatórios e os demais recursos disponíveis.
        </span>
      </div>
    `:''}

    <div class="modal-actions" style="margin-top:22px;">
      <button type="button" class="btn ghost" data-close>Fechar</button>
      <button type="button" class="btn primary" id="trialSubscribeNow">Assinar agora</button>
    </div>
  `);

  $('#trialSubscribeNow')?.addEventListener('click',()=>{
    bg.remove();
    location.href='/assinatura';
  });
}

async function loadNotifications(){if(!me||!$('#notifHost'))return;const r=await api('/api/notifications');$('#notifHost').innerHTML=`<button class="icon-btn" id="notifBtn" aria-label="Notificações">◉${r.unread?`<span class="counter">${r.unread}</span>`:''}</button><div class="notif-panel hidden" id="notifPanel"><div class="notif-head"><div><strong>Notificações</strong><small>${r.unread} não lida(s)</small></div><button id="readAll">Marcar todas</button></div>${r.notifications.length?r.notifications.map(n=>`<button class="notif-item ${n.is_read?'':'unread'}" data-notif="${n.id}" data-ticket="${n.ticket_id||''}"><i></i><div><strong>${esc(n.title)}</strong><small>${esc(n.body||'')}</small><time>${fmt(n.created_at)}</time></div></button>`).join(''):'<div class="empty-mini">Nenhuma notificação.</div>'}</div>`;$('#notifBtn').onclick=()=>$('#notifPanel').classList.toggle('hidden');$('#readAll').onclick=async()=>{await api('/api/notifications/read-all',{method:'POST'});loadNotifications()};$$('[data-notif]').forEach(b=>b.onclick=async()=>{await api(`/api/notifications/${b.dataset.notif}/read`,{method:'PATCH'});b.dataset.ticket?location.href=`/chamados?ticket=${b.dataset.ticket}`:loadNotifications()})}
async function openProfile(){let photo=me.photoData;const bg=modal(`<div class="modal-head"><div><span class="eyebrow">CONTA</span><h2>Meu perfil</h2><p>Atualize suas informações pessoais e credenciais.</p></div><button class="close" data-close>×</button></div><form id="profileForm"><div class="profile-line"><div class="photo-preview" id="photoPreview">${photo?`<img src="${photo}">`:esc(me.name[0])}</div><label class="file-label">Alterar foto<input type="file" id="profilePhoto" accept="image/*"></label></div><div class="form-grid"><label class="field"><span>Nome completo</span><input name="name" value="${esc(me.name)}" required></label><label class="field"><span>E-mail</span><input name="email" type="email" value="${esc(me.email||'')}"></label></div><label class="field"><span>Setor</span><input name="department" value="${esc(me.department||'')}"></label><button class="btn primary">Salvar perfil</button></form><div class="divider"></div><form id="passwordForm"><h3>Segurança</h3><div class="form-grid"><label class="field"><span>Senha atual</span><input name="currentPassword" type="password" required></label><label class="field"><span>Nova senha</span><input name="newPassword" type="password" minlength="8" required></label></div><button class="btn secondary">Alterar senha</button></form>`);$('#profilePhoto').onchange=async e=>{photo=await photoToDataUrl(e.target.files[0]);$('#photoPreview').innerHTML=`<img src="${photo}">`};$('#profileForm').onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));d.photoData=photo;const r=await api('/api/me',{method:'PATCH',body:JSON.stringify(d)});me=r.user;bg.remove();loadMe();toast('Perfil atualizado.')};$('#passwordForm').onsubmit=async e=>{e.preventDefault();await api('/api/me/password',{method:'PATCH',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});toast('Senha alterada.');e.target.reset()}}

async function initLogin(){$('#loginForm').onsubmit=async e=>{e.preventDefault();const btn=e.target.querySelector('button[type=submit]');btn.disabled=true;btn.textContent='Entrando...';try{await api('/api/auth/login',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});location.href='/dashboard'}catch(err){feedback(err.message,'error');btn.disabled=false;btn.textContent='Acessar plataforma'}}}
async function initRegister(){const token=new URLSearchParams(location.search).get('invite')||'';if(!token){feedback('Para criar uma conta, solicite um link de convite ao administrador da sua empresa.','error');$('#registerForm').querySelector('button').disabled=true;return}try{const r=await api('/api/public/invite/'+encodeURIComponent(token));const box=$('#inviteCompany');if(box)box.innerHTML=`Convite para <strong>${esc(r.invite.organization_name)}</strong> · ${roleLabel[r.invite.role]||r.invite.role}`;if(r.invite.email&&$('#registerForm').email)$('#registerForm').email.value=r.invite.email}catch(err){feedback(err.message,'error');$('#registerForm').querySelector('button').disabled=true;return}$('#registerForm').onsubmit=async e=>{e.preventDefault();try{const d=Object.fromEntries(new FormData(e.target));d.inviteToken=token;const r=await api('/api/auth/register',{method:'POST',body:JSON.stringify(d)});feedback(r.message);setTimeout(()=>location.href='/',1200)}catch(err){feedback(err.message,'error')}}}
async function initDashboard(){await loadMe();const r=await api('/api/dashboard');const first=me.name.split(' ')[0];$('#welcomeTitle').textContent=`Olá, ${first}.`;$('#welcomeText').textContent=me.role==='requester'?'Acompanhe suas solicitações e encontre respostas rapidamente.':'Acompanhe a saúde da operação e priorize o que precisa de atenção agora.';const k=[['Backlog',Number(r.kpis.open)+Number(r.kpis.progress),'Chamados ativos','neutral'],['SLA vencido',r.kpis.overdue,'Exigem ação imediata','danger'],['Prioridade crítica',r.kpis.urgent,'Impacto elevado','warning'],['Resolvidos hoje',r.kpis.resolved_today,'Entregas concluídas','success'],['Tempo médio',`${r.kpis.avg_hours}h`,'Até resolução','neutral'],['1ª resposta',`${r.kpis.avg_first_response_min}m`,'Média da operação','neutral']];$('#dashKpis').innerHTML=k.map(x=>`<article class="metric-card ${x[3]}"><div class="metric-top"><span>${x[0]}</span><i></i></div><strong>${x[1]}</strong><small>${x[2]}</small></article>`).join('');$('#recentTickets').innerHTML=r.recent.length?r.recent.map(t=>`<a class="recent-row" href="/chamados?ticket=${t.id}"><span class="protocol">#${String(t.id).padStart(5,'0')}</span><div><strong>${esc(t.title)}</strong><small>${ticketStatus[t.status]} · ${priorityLabel[t.priority]}${t.assigned_name?` · ${esc(t.assigned_name)}`:''}</small></div><span class="sla ${isOverdue(t)?'late':''}">${slaText(t)}</span></a>`).join(''):'<div class="empty-mini">Nenhum chamado ainda.</div>';if($('#workload'))$('#workload').innerHTML=r.workload.length?r.workload.map(w=>`<div class="work-row"><span>${esc(w.name)}</span><div class="bar"><i style="width:${pct(w.total,Math.max(...r.workload.map(x=>x.total)))}%"></i></div><strong>${w.total}</strong></div>`).join(''):'<div class="empty-mini">Sem dados de carga.</div>';if($('#healthPanel')){const h=r.health||{};$('#healthPanel').innerHTML=`<div class="health-score"><div class="score-ring" style="--score:${Number(h.sla_compliance)||0}"><strong>${h.sla_compliance||0}%</strong><span>SLA</span></div><div><h3>Saúde operacional</h3><p>Indicador consolidado do cumprimento de SLA da operação.</p></div></div><div class="mini-stats"><div><strong>${h.active_agents||0}</strong><span>Analistas ativos</span></div><div><strong>${h.assets||0}</strong><span>Ativos gerenciados</span></div><div><strong>${h.articles||0}</strong><span>Artigos publicados</span></div></div>`}$('#newTicketBtn')?.addEventListener('click',newTicket)}

function ticketRow(t){return `<article class="ticket-row ${isOverdue(t)?'overdue':''}" data-ticket="${t.id}">${avatar({name:t.requester_name,photo_data:t.requester_photo})}<div class="ticket-main"><strong>${esc(t.title)}</strong><small><span class="protocol">#${String(t.id).padStart(5,'0')}</span> · ${esc(t.requester_name)} · ${esc(t.category)}${t.asset_tag?` · ${esc(t.asset_tag)}`:''}</small></div><span class="priority ${t.priority}">${priorityLabel[t.priority]}</span><span class="status ${t.status}">${ticketStatus[t.status]}</span><span class="assignee">${t.assigned_name?esc(t.assigned_name):'Não atribuído'}</span><span class="sla ${isOverdue(t)?'late':''}">${slaText(t)}</span><span class="chevron">›</span></article>`}
async function loadTickets(){const p=new URLSearchParams();[['q','#search'],['status','#statusFilter'],['priority','#priorityFilter'],['category','#categoryFilter'],['assigned','#assignedFilter']].forEach(([k,s])=>{const v=$(s)?.value;if(v)p.set(k,v)});if($('#overdueFilter')?.checked)p.set('overdue','1');const r=await api('/api/tickets?'+p);tickets=r.tickets;$('#ticketCount').textContent=`${tickets.length} registro${tickets.length===1?'':'s'}`;$('#ticketList').innerHTML=tickets.length?tickets.map(ticketRow).join(''):'<div class="empty-state"><div class="empty-icon">◇</div><strong>Nenhum chamado encontrado</strong><span>Ajuste os filtros ou registre uma nova solicitação.</span></div>';$$('[data-ticket]').forEach(x=>x.onclick=()=>openTicket(Number(x.dataset.ticket)))}
async function loadAssetsForSelect(){if(me?.role==='requester'||!hasPlan('business'))return [];try{return (await api('/api/assets')).assets}catch{return []}}
async function newTicket(){const assetOptions=(await loadAssetsForSelect()).map(a=>`<option value="${a.id}">${esc(a.asset_tag)} · ${esc(a.name)}</option>`).join('');const bg=modal(`<div class="modal-head"><div><span class="eyebrow">NOVA SOLICITAÇÃO</span><h2>Abrir chamado</h2><p>Registre o contexto completo para acelerar o atendimento.</p></div><button class="close" data-close>×</button></div><form id="newTicketForm"><label class="field"><span>Assunto</span><input name="title" maxlength="180" placeholder="Ex.: Sistema financeiro não abre" required></label><div class="form-grid"><label class="field"><span>Categoria</span><select name="category" required>${meta.categories.map(c=>`<option>${esc(c.name)}</option>`).join('')}</select></label><label class="field"><span>Prioridade</span><select name="priority"><option value="low">Baixa</option><option value="medium" selected>Média</option><option value="high">Alta</option><option value="urgent">Crítica</option></select></label><label class="field"><span>Impacto</span><select name="impact"><option value="low">Baixo — uma pessoa</option><option value="medium" selected>Médio — equipe/setor</option><option value="high">Alto — operação</option></select></label><label class="field"><span>Local</span><input name="location" placeholder="Sala, unidade, setor..."></label></div>${assetOptions?`<label class="field"><span>Ativo relacionado</span><select name="assetId"><option value="">Nenhum ativo</option>${assetOptions}</select></label>`:''}<label class="field"><span>Descrição detalhada</span><textarea name="description" rows="6" placeholder="Descreva o problema, quando começou e o que já foi testado." required></textarea></label><div class="modal-actions"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn primary">Registrar chamado</button></div></form>`);$('#newTicketForm').onsubmit=async e=>{e.preventDefault();try{const r=await api('/api/tickets',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});bg.remove();toast(`Chamado #${r.id} criado.`);if(document.body.dataset.page==='tickets')loadTickets();else location.href=`/chamados?ticket=${r.id}`}catch(err){toast(err.message,'error')}}}
async function openTicket(id){const [r,ag,ast]=await Promise.all([api('/api/tickets/'+id),api('/api/users/agents'),loadAssetsForSelect()]),t=r.ticket,can=me.role!=='requester';const comments=r.comments.map(c=>`<div class="comment"><div>${avatar({name:c.author_name,photo_data:c.author_photo})}</div><div><div class="comment-head"><strong>${esc(c.author_name)}</strong><span>${roleLabel[c.author_role]||''}</span><time>${fmt(c.created_at)}</time></div><p>${esc(c.body).replace(/\n/g,'<br>')}</p></div></div>`).join('');const events=r.events.map(e=>`<div class="event"><i></i><div><strong>${eventLabel[e.event_type]||e.event_type}</strong><small>${esc(e.actor_name||'Sistema')} · ${fmt(e.created_at)}</small></div></div>`).join('');const files=r.attachments.map(a=>`<button class="attachment" data-attachment="${a.id}"><span>▱ ${esc(a.file_name)}</span><small>${Math.ceil(a.size_bytes/1024)} KB</small></button>`).join('');const bg=modal(`<div class="modal-head"><div><span class="eyebrow">CHAMADO #${String(t.id).padStart(5,'0')}</span><h2>${esc(t.title)}</h2><p>Aberto por ${esc(t.requester_name)} em ${fmt(t.created_at)}</p></div><button class="close" data-close>×</button></div><div class="ticket-detail-grid"><main><div class="ticket-detail-badges"><span class="status ${t.status}">${ticketStatus[t.status]}</span><span class="priority ${t.priority}">${priorityLabel[t.priority]}</span><span class="impact">Impacto ${impactLabel[t.impact]||'Médio'}</span></div><section class="detail-box"><h3>Descrição</h3><div class="pre">${esc(t.description)}</div>${t.location?`<div class="detail-meta"><span>Local</span><strong>${esc(t.location)}</strong></div>`:''}${t.asset_tag?`<div class="detail-meta"><span>Ativo</span><strong>${esc(t.asset_tag)} · ${esc(t.asset_name)}${t.asset_model?` · ${esc(t.asset_model)}`:''}</strong></div>`:''}</section><section class="detail-box"><div class="detail-title"><h3>Interações</h3><span>${r.comments.length}</span></div>${comments||'<div class="empty-mini">Nenhuma interação registrada.</div>'}<form id="commentForm" class="comment-form"><textarea name="body" rows="3" placeholder="Registrar atualização, diagnóstico ou orientação..." required></textarea><button class="btn primary small">Enviar atualização</button></form></section><section class="detail-box"><div class="detail-title"><h3>Anexos</h3><label class="file-label">+ Anexar arquivo<input id="attachFile" type="file"></label></div>${files||'<div class="empty-mini">Nenhum anexo.</div>'}</section><section class="detail-box"><h3>Linha do tempo</h3>${events||'<div class="empty-mini">Sem eventos.</div>'}</section></main><aside><div class="detail-box sticky"><h3>Gestão do chamado</h3><label class="field"><span>Status</span><select id="mStatus" ${can?'':'disabled'}>${Object.entries(ticketStatus).map(([k,v])=>`<option value="${k}" ${t.status===k?'selected':''}>${v}</option>`).join('')}</select></label><label class="field"><span>Prioridade</span><select id="mPriority" ${can?'':'disabled'}>${Object.entries(priorityLabel).map(([k,v])=>`<option value="${k}" ${t.priority===k?'selected':''}>${v}</option>`).join('')}</select></label><label class="field"><span>Impacto</span><select id="mImpact" ${can?'':'disabled'}>${Object.entries(impactLabel).map(([k,v])=>`<option value="${k}" ${t.impact===k?'selected':''}>${v}</option>`).join('')}</select></label><label class="field"><span>Responsável</span><select id="mAssigned" ${can?'':'disabled'}><option value="">Não atribuído</option>${ag.users.map(a=>`<option value="${a.id}" ${Number(t.assigned_to)===a.id?'selected':''}>${esc(a.name)}</option>`).join('')}</select></label>${can?`<label class="field"><span>Ativo</span><select id="mAsset"><option value="">Nenhum</option>${ast.map(a=>`<option value="${a.id}" ${Number(t.asset_id)===Number(a.id)?'selected':''}>${esc(a.asset_tag)} · ${esc(a.name)}</option>`).join('')}</select></label><label class="field"><span>Local</span><input id="mLocation" value="${esc(t.location||'')}"></label>`:''}<div class="sla-box ${isOverdue(t)?'late':''}"><small>SLA de resolução</small><strong>${slaText(t)}</strong><span>Prazo: ${fmt(t.due_at)}</span></div>${can?'<button class="btn primary btn-block" id="saveTicket">Salvar alterações</button>':''}${me.role==='admin'?'<button class="btn danger btn-block" id="deleteTicket">Excluir chamado</button>':''}</div></aside></div>`,true);$('#commentForm').onsubmit=async e=>{e.preventDefault();await api(`/api/tickets/${id}/comments`,{method:'POST',body:JSON.stringify({body:e.target.body.value})});bg.remove();openTicket(id);if($('#ticketList'))loadTickets()};$('#saveTicket')?.addEventListener('click',async()=>{await api(`/api/tickets/${id}`,{method:'PATCH',body:JSON.stringify({status:$('#mStatus').value,priority:$('#mPriority').value,impact:$('#mImpact').value,assignedTo:$('#mAssigned').value||null,assetId:$('#mAsset')?.value||null,location:$('#mLocation')?.value||''})});bg.remove();toast('Chamado atualizado.');loadTickets()});$('#deleteTicket')?.addEventListener('click',async()=>{if(confirm('Excluir este chamado definitivamente?')){await api(`/api/tickets/${id}`,{method:'DELETE'});bg.remove();loadTickets()}});$('#attachFile').onchange=async e=>{try{const f=e.target.files[0],data=await fileToDataUrl(f);await api(`/api/tickets/${id}/attachments`,{method:'POST',body:JSON.stringify({fileName:f.name,mimeType:f.type,data})});bg.remove();openTicket(id)}catch(err){toast(err.message,'error')}};$$('[data-attachment]').forEach(b=>b.onclick=async()=>{const a=await api('/api/attachments/'+b.dataset.attachment),link=document.createElement('a');link.href=a.data;link.download=a.fileName;link.click()})}
async function initTickets(){await loadMe();$('#categoryFilter').innerHTML='<option value="">Todas as categorias</option>'+meta.categories.map(c=>`<option>${esc(c.name)}</option>`).join('');await loadTickets();$('#newTicketBtn').onclick=newTicket;['search','statusFilter','priorityFilter','categoryFilter','assignedFilter'].forEach(id=>$('#'+id)?.addEventListener(id==='search'?'input':'change',loadTickets));$('#overdueFilter').onchange=loadTickets;const id=new URLSearchParams(location.search).get('ticket');if(id)openTicket(Number(id))}

async function loadAssets(){const r=await api('/api/assets?q='+encodeURIComponent($('#assetSearch')?.value||''));assets=r.assets;$('#assetCount').textContent=`${assets.length} ativo${assets.length===1?'':'s'}`;$('#assetsGrid').innerHTML=assets.length?assets.map(a=>`<article class="asset-card" data-asset="${a.id}"><div class="asset-card-top"><span class="asset-type">${esc(a.asset_type)}</span><span class="asset-state ${a.status}">${assetStatus[a.status]}</span></div><h3>${esc(a.name)}</h3><code>${esc(a.asset_tag)}</code><div class="asset-specs"><span>${esc([a.manufacturer,a.model].filter(Boolean).join(' ')||'Modelo não informado')}</span><span>${esc(a.assigned_user_name||'Sem usuário vinculado')}</span><span>${esc(a.location||a.department||'Local não informado')}</span></div><footer><span>${a.ticket_count} chamado(s)</span><button class="btn secondary small">Gerenciar</button></footer></article>`).join(''):'<div class="empty-state"><div class="empty-icon">▱</div><strong>Nenhum ativo cadastrado</strong><span>Cadastre computadores, impressoras, dispositivos e outros itens.</span></div>';$$('[data-asset]').forEach(x=>x.onclick=()=>editAsset(Number(x.dataset.asset)))}
async function assetForm(a=null){const ur=await api('/api/users/active'),u=ur.users;const bg=modal(`<div class="modal-head"><div><span class="eyebrow">CMDB / ATIVOS</span><h2>${a?'Gerenciar ativo':'Cadastrar ativo'}</h2><p>Centralize patrimônio, vínculo, localização e histórico.</p></div><button class="close" data-close>×</button></div><form id="assetForm"><div class="form-grid"><label class="field"><span>Patrimônio / TAG</span><input name="assetTag" value="${esc(a?.asset_tag||'')}" required></label><label class="field"><span>Nome do ativo</span><input name="name" value="${esc(a?.name||'')}" required></label><label class="field"><span>Tipo</span><input name="assetType" value="${esc(a?.asset_type||'Notebook')}" required></label><label class="field"><span>Status</span><select name="status">${Object.entries(assetStatus).map(([k,v])=>`<option value="${k}" ${a?.status===k?'selected':''}>${v}</option>`).join('')}</select></label><label class="field"><span>Fabricante</span><input name="manufacturer" value="${esc(a?.manufacturer||'')}"></label><label class="field"><span>Modelo</span><input name="model" value="${esc(a?.model||'')}"></label><label class="field"><span>Nº de série</span><input name="serialNumber" value="${esc(a?.serial_number||'')}"></label><label class="field"><span>Usuário responsável</span><select name="assignedUserId"><option value="">Não vinculado</option>${u.map(x=>`<option value="${x.id}" ${Number(a?.assigned_user_id)===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label><label class="field"><span>Setor</span><input name="department" value="${esc(a?.department||'')}"></label><label class="field"><span>Localização</span><input name="location" value="${esc(a?.location||'')}"></label></div><label class="field"><span>Observações</span><textarea name="notes" rows="4">${esc(a?.notes||'')}</textarea></label><div class="modal-actions">${a&&me.role==='admin'?'<button type="button" class="btn danger" id="deleteAsset">Excluir</button>':''}<span class="grow"></span><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn primary">Salvar ativo</button></div></form>`);$('#assetForm').onsubmit=async e=>{e.preventDefault();await api(a?`/api/assets/${a.id}`:'/api/assets',{method:a?'PATCH':'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});bg.remove();toast(a?'Ativo atualizado.':'Ativo cadastrado.');loadAssets()};$('#deleteAsset')?.addEventListener('click',async()=>{if(confirm('Excluir este ativo? O vínculo com chamados será removido.')){await api(`/api/assets/${a.id}`,{method:'DELETE'});bg.remove();loadAssets()}})}
function editAsset(id){assetForm(assets.find(x=>Number(x.id)===id))}
async function initAssets(){await loadMe();await loadAssets();$('#newAssetBtn').onclick=()=>assetForm();$('#assetSearch').addEventListener('input',loadAssets)}

async function loadKnowledge(){const r=await api('/api/knowledge?q='+encodeURIComponent($('#kbSearch')?.value||''));articles=r.articles;$('#kbGrid').innerHTML=articles.length?articles.map(a=>`<article class="kb-card" data-article="${a.id}"><div class="kb-meta"><span>${esc(a.category||'Geral')}</span>${!a.published?'<b>Rascunho</b>':''}</div><h3>${esc(a.title)}</h3><p>${esc(a.summary||a.content.slice(0,150))}</p><footer><span>${a.views} visualizações</span><span>Atualizado ${fmtShort(a.updated_at)}</span></footer></article>`).join(''):'<div class="empty-state"><div class="empty-icon">≡</div><strong>Nenhum artigo encontrado</strong><span>Documente soluções recorrentes e reduza chamados repetidos.</span></div>';$$('[data-article]').forEach(x=>x.onclick=()=>openArticle(Number(x.dataset.article)))}
async function articleForm(a=null){const bg=modal(`<div class="modal-head"><div><span class="eyebrow">BASE DE CONHECIMENTO</span><h2>${a?'Editar artigo':'Novo artigo'}</h2></div><button class="close" data-close>×</button></div><form id="articleForm"><label class="field"><span>Título</span><input name="title" value="${esc(a?.title||'')}" required></label><div class="form-grid"><label class="field"><span>Categoria</span><input name="category" value="${esc(a?.category||'')}"></label><label class="field checkbox-field"><input name="published" type="checkbox" ${a?.published!==false?'checked':''}><span>Publicado</span></label></div><label class="field"><span>Resumo</span><textarea name="summary" rows="2">${esc(a?.summary||'')}</textarea></label><label class="field"><span>Conteúdo</span><textarea name="content" rows="12" required>${esc(a?.content||'')}</textarea></label><div class="modal-actions">${a?'<button type="button" class="btn danger" id="deleteArticle">Excluir</button>':''}<span class="grow"></span><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn primary">Salvar artigo</button></div></form>`,true);$('#articleForm').onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));d.published=e.target.published.checked;await api(a?`/api/knowledge/${a.id}`:'/api/knowledge',{method:a?'PATCH':'POST',body:JSON.stringify(d)});bg.remove();toast('Artigo salvo.');loadKnowledge()};$('#deleteArticle')?.addEventListener('click',async()=>{if(confirm('Excluir artigo?')){await api(`/api/knowledge/${a.id}`,{method:'DELETE'});bg.remove();loadKnowledge()}})}
async function openArticle(id){const {article:a}=await api('/api/knowledge/'+id),bg=modal(`<div class="modal-head"><div><span class="eyebrow">${esc(a.category||'BASE DE CONHECIMENTO')}</span><h2>${esc(a.title)}</h2><p>Por ${esc(a.author_name||'Equipe')} · atualizado ${fmt(a.updated_at)}</p></div><button class="close" data-close>×</button></div><article class="article-body">${esc(a.content).replace(/\n/g,'<br>')}</article>${me.role==='admin'?'<div class="modal-actions"><button class="btn secondary" id="editArticle">Editar artigo</button></div>':''}`,true);$('#editArticle')?.addEventListener('click',()=>{bg.remove();articleForm(a)})}
async function initKnowledge(){await loadMe();await loadKnowledge();$('#newArticleBtn')&&( $('#newArticleBtn').onclick=()=>articleForm());$('#kbSearch').addEventListener('input',loadKnowledge)}

async function loadUsers(){const r=await api('/api/users');users=r.users;const counts={active:users.filter(x=>x.status==='active').length,pending:users.filter(x=>x.status==='pending').length,admin:users.filter(x=>x.role==='admin').length,agent:users.filter(x=>x.role==='agent').length};$('#userStats').innerHTML=[['Ativos',counts.active],['Pendentes',counts.pending],['Analistas',counts.agent],['Administradores',counts.admin]].map(x=>`<div class="mini-stat"><strong>${x[1]}</strong><span>${x[0]}</span></div>`).join('');$('#usersBody').innerHTML=users.map(u=>`<tr><td><div class="user-cell">${avatar(u)}<div><strong>${esc(u.name)}</strong><small>${esc(u.email||'Sem e-mail')}</small></div></div></td><td><code>@${esc(u.username)}</code></td><td><span class="pill">${roleLabel[u.role]}</span></td><td><span class="user-status ${u.status}">${userStatus[u.status]}</span></td><td>${esc(u.department||'—')}</td><td>${fmt(u.lastLoginAt)}</td><td><button class="btn secondary small" data-edit="${u.id}">Gerenciar</button></td></tr>`).join('');$$('[data-edit]').forEach(b=>b.onclick=()=>editUser(Number(b.dataset.edit)))}
async function editUser(id){const u=users.find(x=>x.id===id);let photo=u.photoData;const bg=modal(`<div class="modal-head"><div><span class="eyebrow">GESTÃO DE ACESSO</span><h2>${esc(u.name)}</h2><p>@${esc(u.username)}</p></div><button class="close" data-close>×</button></div><form id="userEdit"><div class="profile-line"><div class="photo-preview" id="uPrev">${photo?`<img src="${photo}">`:esc(u.name[0])}</div><label class="file-label">Trocar foto<input id="uPhoto" type="file" accept="image/*"></label></div><div class="form-grid"><label class="field"><span>Nome</span><input name="name" value="${esc(u.name)}" required></label><label class="field"><span>E-mail</span><input name="email" value="${esc(u.email||'')}"></label><label class="field"><span>Setor</span><input name="department" value="${esc(u.department||'')}"></label><label class="field"><span>Perfil</span><select name="role">${Object.entries(roleLabel).map(([k,v])=>`<option value="${k}" ${u.role===k?'selected':''}>${v}</option>`).join('')}</select></label><label class="field"><span>Status</span><select name="status">${Object.entries(userStatus).map(([k,v])=>`<option value="${k}" ${u.status===k?'selected':''}>${v}</option>`).join('')}</select></label><label class="field"><span>Redefinir senha (opcional)</span><input name="password" type="password" minlength="8"></label></div><div class="modal-actions">${u.id!==me.id?'<button type="button" class="btn danger" id="delUser">Excluir</button>':''}<span class="grow"></span><button class="btn primary">Salvar alterações</button></div></form>`);$('#uPhoto').onchange=async e=>{photo=await photoToDataUrl(e.target.files[0]);$('#uPrev').innerHTML=`<img src="${photo}">`};$('#userEdit').onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));d.photoData=photo;if(!d.password)delete d.password;await api('/api/users/'+id,{method:'PATCH',body:JSON.stringify(d)});bg.remove();toast('Usuário atualizado.');loadUsers()};$('#delUser')?.addEventListener('click',async()=>{if(confirm('Excluir este usuário?')){try{await api('/api/users/'+id,{method:'DELETE'});bg.remove();loadUsers()}catch(err){toast(err.message,'error')}}})}
async function newUser(){const bg=modal(`<div class="modal-head"><div><span class="eyebrow">GESTÃO DE ACESSO</span><h2>Novo usuário</h2></div><button class="close" data-close>×</button></div><form id="newUserForm"><div class="form-grid"><label class="field"><span>Nome</span><input name="name" required></label><label class="field"><span>Usuário</span><input name="username" required></label><label class="field"><span>E-mail</span><input name="email" type="email"></label><label class="field"><span>Setor</span><input name="department"></label><label class="field"><span>Perfil</span><select name="role"><option value="requester">Solicitante</option><option value="agent">Analista</option><option value="admin">Administrador</option></select></label><label class="field"><span>Status</span><select name="status"><option value="active">Ativo</option><option value="pending">Pendente</option><option value="blocked">Bloqueado</option></select></label></div><label class="field"><span>Senha inicial</span><input name="password" type="password" minlength="8" required></label><div class="modal-actions"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn primary">Cadastrar usuário</button></div></form>`);$('#newUserForm').onsubmit=async e=>{e.preventDefault();await api('/api/users',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});bg.remove();toast('Usuário cadastrado.');loadUsers()}}
async function openInvite(){const bg=modal(`<div class="modal-head"><div><span class="eyebrow">CONVITE SEGURO</span><h2>Convidar usuário</h2><p>Gere um link exclusivo para esta empresa.</p></div><button class="close" data-close>×</button></div><form id="inviteForm"><label class="field"><span>E-mail (opcional)</span><input name="email" type="email"></label><div class="form-grid"><label class="field"><span>Perfil</span><select name="role"><option value="requester">Solicitante</option><option value="agent">Analista</option><option value="admin">Administrador</option></select></label><label class="field"><span>Validade</span><select name="days"><option value="1">1 dia</option><option value="7" selected>7 dias</option><option value="30">30 dias</option></select></label></div><button class="btn primary">Gerar convite</button></form><div id="inviteResult"></div>`);$('#inviteForm').onsubmit=async e=>{e.preventDefault();const r=await api('/api/invitations',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});$('#inviteResult').innerHTML=`<div class="invite-result"><strong>Link criado</strong><input id="inviteUrl" value="${esc(r.url)}" readonly><button class="btn secondary" id="copyInvite" type="button">Copiar link</button></div>`;$('#copyInvite').onclick=async()=>{await navigator.clipboard.writeText(r.url);toast('Link copiado.')};}}
async function initUsers(){
  await loadMe();
  await loadUsers();

  if($('#audit')){
    if(hasPlan('business')){
      try{
        const {logs}=await api('/api/audit');
        $('#audit').innerHTML=logs.slice(0,30).map(l=>`<div class="audit-row"><div><strong>${esc(l.actor_name||'Sistema')}</strong><small>${esc(l.target_type)}${l.target_id?` #${l.target_id}`:''}</small></div><span>${esc(l.action.replaceAll('_',' '))}</span><time>${fmt(l.created_at)}</time></div>`).join('');
      }catch(err){
        $('#audit').innerHTML='<div class="empty-mini">Não foi possível carregar a auditoria.</div>';
      }
    }else{
      $('#audit').innerHTML='<div class="empty-mini">Histórico de auditoria disponível a partir do plano Business.</div>';
    }
  }

  $('#newUserBtn').onclick=newUser;
  $('#inviteUserBtn')?.addEventListener('click',openInvite);
}
async function initReports(){await loadMe();const r=await api('/api/reports');const ks=[['Volume total',r.kpis.total,'Chamados registrados'],['Backlog',Number(r.kpis.open)+Number(r.kpis.progress),'Pendências atuais'],['SLA vencido',r.kpis.overdue,'Fora do prazo'],['SLA cumprido',`${r.kpis.sla_compliance}%`,'Resolvidos no prazo'],['Tempo resolução',`${r.kpis.avg_hours}h`,'Média geral'],['1ª resposta',`${r.kpis.avg_first_response_min}m`,'Tempo médio']];$('#kpis').innerHTML=ks.map(x=>`<div class="metric-card"><div class="metric-top"><span>${x[0]}</span></div><strong>${x[1]}</strong><small>${x[2]}</small></div>`).join('');function bars(id,data,key,label){const max=Math.max(1,...data.map(x=>Number(x.total)));$(id).innerHTML=data.map(x=>`<div class="bar-row"><div><span>${esc(label?label[x[key]]||x[key]:x[key]||'Não atribuído')}</span><strong>${x.total}</strong></div><div class="bar"><i style="width:${pct(x.total,max)}%"></i></div></div>`).join('')}bars('#statusBars',r.status,'status',ticketStatus);bars('#priorityBars',r.priority,'priority',priorityLabel);bars('#categoryBars',r.category,'category');bars('#agentBars',r.agents,'name');bars('#dailyBars',r.daily,'day');bars('#impactBars',r.impact,'impact',impactLabel);$('#aging').innerHTML=`<div class="aging-item"><strong>${r.aging.under24}</strong><span>Até 24h</span></div><div class="aging-item"><strong>${r.aging.h24_72}</strong><span>24–72h</span></div><div class="aging-item danger"><strong>${r.aging.over72}</strong><span>Acima de 72h</span></div>`}

async function initConfig(){
  await loadMe();

  let cfg=await api('/api/config');

  function render(){
    const s=cfg.settings;
    const f=$('#settingsForm');

    [
      'brand_name',
      'company_name',
      'brand_tagline',
      'support_email',
      'primary_color',
      'sla_low',
      'sla_medium',
      'sla_high',
      'sla_urgent'
    ].forEach(k=>{
      if(f[k]){
        f[k].value=s[k]||'';
      }
    });

    $('#catList').innerHTML=
      cfg.categories.map(c=>`
        <div class="config-row">
          <input
            value="${esc(c.name)}"
            data-cat-name="${c.id}"
          >

          <label class="switch">
            <input
              type="checkbox"
              data-cat-active="${c.id}"
              ${c.active?'checked':''}
            >
            <span></span>
          </label>

          <button
            class="btn secondary small"
            data-cat-save="${c.id}"
          >
            Salvar
          </button>
        </div>
      `).join('');

    $('#depList').innerHTML=
      cfg.departments.map(c=>`
        <div class="config-row">
          <input
            value="${esc(c.name)}"
            data-dep-name="${c.id}"
          >

          <label class="switch">
            <input
              type="checkbox"
              data-dep-active="${c.id}"
              ${c.active?'checked':''}
            >
            <span></span>
          </label>

          <button
            class="btn secondary small"
            data-dep-save="${c.id}"
          >
            Salvar
          </button>
        </div>
      `).join('');

    $$('[data-cat-save]').forEach(b=>{
      b.onclick=async()=>{
        const id=b.dataset.catSave;

        await api(
          '/api/config/categories/'+id,
          {
            method:'PATCH',
            body:JSON.stringify({
              name:$(
                `[data-cat-name="${id}"]`
              ).value,

              active:$(
                `[data-cat-active="${id}"]`
              ).checked
            })
          }
        );

        cfg=await api('/api/config');
        render();
      };
    });

    $$('[data-dep-save]').forEach(b=>{
      b.onclick=async()=>{
        const id=b.dataset.depSave;

        await api(
          '/api/config/departments/'+id,
          {
            method:'PATCH',
            body:JSON.stringify({
              name:$(
                `[data-dep-name="${id}"]`
              ).value,

              active:$(
                `[data-dep-active="${id}"]`
              ).checked
            })
          }
        );

        cfg=await api('/api/config');
        render();
      };
    });
  }

  render();


  /* ============================================
     CONFIGURAÇÕES NORMAIS
     ============================================ */

  $('#settingsForm').onsubmit=async e=>{
    e.preventDefault();

    await api(
      '/api/config/settings',
      {
        method:'PATCH',
        body:JSON.stringify(
          Object.fromEntries(
            new FormData(e.target)
          )
        )
      }
    );

    toast('Configurações salvas.');

    setTimeout(
      ()=>location.reload(),
      500
    );
  };


  $('#addCat').onsubmit=async e=>{
    e.preventDefault();

    await api(
      '/api/config/categories',
      {
        method:'POST',
        body:JSON.stringify({
          name:e.target.name.value
        })
      }
    );

    e.target.reset();

    cfg=await api('/api/config');

    render();
  };


  $('#addDep').onsubmit=async e=>{
    e.preventDefault();

    await api(
      '/api/config/departments',
      {
        method:'POST',
        body:JSON.stringify({
          name:e.target.name.value
        })
      }
    );

    e.target.reset();

    cfg=await api('/api/config');

    render();
  };


  /* ============================================
     BILLING
     ============================================ */

  const billingCurrent=
    $('#billingCurrent');

  const money=value=>{
    if(
      value===null ||
      value===undefined ||
      value===''
    ){
      return '—';
    }

    return Number(value).toLocaleString(
      'pt-BR',
      {
        style:'currency',
        currency:'BRL'
      }
    );
  };


  const statusLabel={
    authorized:'Ativa',
    pending:'Pendente',
    paused:'Pausada',
    cancelled:'Cancelada',
    inactive:'Sem assinatura'
  };


  async function loadBilling(){
    try{
      const data=
        await api(
          '/api/billing/subscription'
        );

      const org=
        data.organization||{};

      const subscription=
        data.subscription;

      const currentPlan=
        String(
          org.plan||''
        ).toLowerCase();

      const currentStatus=
        subscription?.status ||
        org.billing_status ||
        'inactive';


      if(billingCurrent){
        let html=`
          <strong>
            Plano atual:
          </strong>
          ${esc(
            currentPlan
              ?currentPlan.toUpperCase()
              :'—'
          )}
          &nbsp; • &nbsp;

          <strong>
            Status:
          </strong>
          ${
            statusLabel[currentStatus] ||
            esc(currentStatus)
          }
        `;

        if(
          subscription?.amount
        ){
          html+=`
            &nbsp; • &nbsp;

            <strong>
              Valor:
            </strong>
            ${money(
              subscription.amount
            )}
          `;
        }

        if(
          subscription?.nextPaymentDate
        ){
          html+=`
            &nbsp; • &nbsp;

            <strong>
              Próxima cobrança:
            </strong>
            ${new Date(
              subscription.nextPaymentDate
            ).toLocaleDateString(
              'pt-BR'
            )}
          `;
        }

        billingCurrent.innerHTML=html;
      }


      /* destacar plano atual */

      $$('[data-billing-plan]')
        .forEach(card=>{
          const cardPlan=
            card.dataset.billingPlan;

          card.style.outline='';

          const btn=
            card.querySelector(
              '.billing-subscribe'
            );

          if(
            cardPlan===currentPlan
          ){
            card.style.outline=
              '1px solid var(--primary)';

            if(
              btn &&
              currentStatus==='authorized'
            ){
              btn.disabled=true;
              btn.textContent='Plano atual';
            }
          }
        });


    }catch(err){
      console.error(
        'Erro ao carregar billing:',
        err
      );

      if(billingCurrent){
        billingCurrent.textContent=
          'Não foi possível carregar as informações da assinatura.';
      }
    }
  }


  /* ============================================
     ASSINAR
     ============================================ */

  $$('.billing-subscribe')
    .forEach(btn=>{

      btn.onclick=async()=>{

        const plan=
          btn.dataset.plan;

        const originalText=
          btn.textContent;

        btn.disabled=true;
        btn.textContent=
          'Abrindo Mercado Pago...';

        try{
          const email=
            cfg.organization
              ?.billing_email ||
            me?.email ||
            '';

          const result=
            await api(
              '/api/billing/subscribe',
              {
                method:'POST',

                body:JSON.stringify({
                  plan,
                  email
                })
              }
            );

          if(
            !result.checkoutUrl
          ){
            throw new Error(
              'O Mercado Pago não retornou a URL do checkout.'
            );
          }

          toast(
            'Redirecionando para o Mercado Pago...'
          );

          setTimeout(()=>{
            window.location.href=
              result.checkoutUrl;
          },400);

        }catch(err){
          console.error(
            'Erro ao criar assinatura:',
            err
          );

          btn.disabled=false;
          btn.textContent=
            originalText;

          toast(
            err.message ||
            'Não foi possível criar a assinatura.',
            'error'
          );
        }
      };
    });


  /* ============================================
     RETORNO DO MERCADO PAGO
     ============================================ */

  const params=
    new URLSearchParams(
      window.location.search
    );

  if(
    params.get('billing')===
    'return'
  ){
    toast(
      'Retorno do Mercado Pago recebido. Atualizando assinatura...'
    );

    setTimeout(
      async()=>{
        await loadBilling();
      },
      1200
    );
  }


  await loadBilling();
}


async function initSubscription(){
  await loadMe();
  const data=await api('/api/billing/overview');
  const org=data.organization||{},plans=data.plans||[];
  const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const planNames={start:'Start',business:'Business',pro:'Pro'};
  const billingLabels={authorized:'Ativa',pending:'Pendente',paused:'Pausada',cancelled:'Cancelada',inactive:'Sem assinatura'};
  const trial=org.status==='trial';
  const status=trial?'Trial':(billingLabels[org.billing_status]||org.billing_status||'Sem assinatura');
  const plan=plans.find(p=>p.id===org.plan)||{};

  $('#subscriptionSummary').innerHTML=`
    <article class="metric-card"><div class="metric-top"><span>Plano atual</span></div><strong>${esc(planNames[org.plan]||String(org.plan||'—').toUpperCase())}</strong><small>${plan.price?money(plan.price)+'/mês':'Plano da empresa'}</small></article>
    <article class="metric-card"><div class="metric-top"><span>Status</span></div><strong>${esc(status)}</strong><small>${trial&&data.trialDaysRemaining!==null?`${data.trialDaysRemaining} dia(s) de trial restantes`:'Situação da assinatura'}</small></article>
    <article class="metric-card"><div class="metric-top"><span>Usuários</span></div><strong>${data.usersUsed||0}/${org.user_limit||0}</strong><small>Licenças em utilização</small></article>
    <article class="metric-card"><div class="metric-top"><span>Próxima cobrança</span></div><strong style="font-size:17px">${org.next_payment_at?fmtShort(org.next_payment_at):'—'}</strong><small>${org.billing_email?esc(org.billing_email):'E-mail financeiro não informado'}</small></article>`;

  $('#subscriptionDetails').innerHTML=`
    <div class="subscription-detail"><span>Empresa</span><strong>${esc(org.name||'—')}</strong></div>
    <div class="subscription-detail"><span>Início na plataforma</span><strong>${fmtShort(org.created_at)}</strong></div>
    <div class="subscription-detail"><span>Fim do trial</span><strong>${fmtShort(org.trial_ends_at)}</strong></div>
    <div class="subscription-detail"><span>Validade / fim da assinatura</span><strong>${fmtShort(org.subscription_ends_at)}</strong></div>
    <div class="subscription-detail"><span>Último pagamento</span><strong>${fmt(org.last_payment_at)}</strong></div>
    <div class="subscription-detail"><span>Atualização da cobrança</span><strong>${fmt(org.billing_updated_at)}</strong></div>
    <div class="subscription-detail"><span>ID da assinatura</span><strong><code>${esc(org.mp_subscription_id||'—')}</code></strong></div>`;

  $('#subscriptionPlans').innerHTML=plans.map(p=>`<article class="subscription-plan ${p.id===org.plan?'current':''}"><span class="eyebrow">${p.id===org.plan?'PLANO ATUAL':'PLANO'}</span><h3>${esc(p.name)}</h3><strong>${money(p.price)}<small>/mês</small></strong><p>Até ${p.userLimit} usuários na empresa.</p><button class="btn ${p.id===org.plan&&org.billing_status==='authorized'?'secondary':'primary'} billing-v9-subscribe" data-plan="${p.id}" ${p.id===org.plan&&org.billing_status==='authorized'?'disabled':''}>${p.id===org.plan&&org.billing_status==='authorized'?'Plano atual':p.id===org.plan?'Assinar este plano':'Escolher plano'}</button></article>`).join('');

  $$('.billing-v9-subscribe').forEach(btn=>btn.onclick=async()=>{
    const original=btn.textContent;btn.disabled=true;btn.textContent='Abrindo Mercado Pago...';
    try{
      const r=await api('/api/billing/subscribe',{method:'POST',body:JSON.stringify({plan:btn.dataset.plan,email:me.email||org.billing_email||''})});
      if(!r.checkoutUrl)throw new Error('O Mercado Pago não retornou a URL do checkout.');
      location.href=r.checkoutUrl;
    }catch(err){btn.disabled=false;btn.textContent=original;toast(err.message,'error');}
  });

  if(new URLSearchParams(location.search).get('billing')==='return')toast('Retorno do Mercado Pago recebido. Atualizando dados da assinatura.');
}

const activityLabels={
  ticket_created:'Chamado criado',ticket_updated:'Chamado alterado',ticket_deleted:'Chamado excluído',ticket_comment_added:'Comentário no chamado',
  asset_created:'Ativo cadastrado',asset_updated:'Ativo alterado',asset_deleted:'Ativo excluído',
  user_created:'Usuário criado',user_updated:'Usuário alterado',knowledge_created:'Artigo criado',knowledge_updated:'Artigo alterado',knowledge_deleted:'Artigo excluído',
  settings_updated:'Configurações alteradas',billing_checkout_started:'Checkout iniciado',billing_authorized:'Assinatura autorizada',organization_created:'Empresa criada'
};
const activityTypeLabels={ticket:'Chamado',asset:'Ativo',user:'Usuário',knowledge:'Conhecimento',settings:'Configurações',billing:'Assinatura',organization:'Empresa'};
function renderActivityDetails(log){
  const details=log.details||{};
  const changes=details.changes||{};
  const changeRows=Object.entries(changes).map(([field,v])=>`<div class="change-row"><strong>${esc(field.replaceAll('_',' '))}</strong><span>${esc(v?.from??'—')}</span><b>→</b><span>${esc(v?.to??'—')}</span></div>`).join('');
  const other=Object.entries(details).filter(([k])=>k!=='changes').map(([k,v])=>`<div class="subscription-detail"><span>${esc(k)}</span><strong>${esc(typeof v==='object'?JSON.stringify(v):v)}</strong></div>`).join('');
  modal(`<div class="modal-head"><div><span class="eyebrow">AUDITORIA</span><h2>${esc(activityLabels[log.action]||log.action)}</h2><p>${esc(log.actor_name||'Sistema')} · ${fmt(log.created_at)}</p></div><button class="close" data-close>×</button></div><div class="activity-meta"><span>${esc(activityTypeLabels[log.target_type]||log.target_type)}</span>${log.target_id?`<code>#${log.target_id}</code>`:''}</div>${changeRows?`<div class="change-list">${changeRows}</div>`:''}${other?`<div class="subscription-details">${other}</div>`:''}${!changeRows&&!other?'<div class="empty-mini">Nenhum detalhe adicional registrado.</div>':''}`);
}
async function initActivity(){
  await loadMe();
  const load=async()=>{
    const p=new URLSearchParams();
    for(const [id,key] of [['activitySearch','q'],['activityActor','actor'],['activityType','type'],['activityAction','action'],['activityFrom','from'],['activityTo','to']]){const v=$('#'+id)?.value;if(v)p.set(key,v);}
    const r=await api('/api/activity?'+p.toString());
    if($('#activityActor')&&$('#activityActor').options.length<=1)$('#activityActor').innerHTML='<option value="">Todos os usuários</option>'+r.actors.map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join('');
    $('#activityCount').textContent=`${r.logs.length} registro${r.logs.length===1?'':'s'}`;
    $('#activityBody').innerHTML=r.logs.length?r.logs.map((l,i)=>`<tr data-activity="${i}"><td>${fmt(l.created_at)}</td><td><strong>${esc(l.actor_name||'Sistema')}</strong>${l.actor_username?`<small class="table-sub">@${esc(l.actor_username)}</small>`:''}</td><td>${esc(activityLabels[l.action]||l.action.replaceAll('_',' '))}</td><td><span class="pill">${esc(activityTypeLabels[l.target_type]||l.target_type)}</span>${l.target_id?` <code>#${l.target_id}</code>`:''}</td><td><button class="btn secondary small">Detalhes</button></td></tr>`).join(''):'<tr><td colspan="5"><div class="empty-state"><strong>Nenhuma atividade encontrada</strong><span>Ajuste os filtros para consultar outros registros.</span></div></td></tr>';
    $$('[data-activity]').forEach(row=>row.onclick=()=>renderActivityDetails(r.logs[Number(row.dataset.activity)]));
  };
  await load();
  ['activityActor','activityType','activityAction','activityFrom','activityTo'].forEach(id=>$('#'+id)?.addEventListener('change',load));
  $('#activitySearch')?.addEventListener('input',()=>{clearTimeout(window.__activityTimer);window.__activityTimer=setTimeout(load,250)});
  $('#activityClear')?.addEventListener('click',()=>{['activitySearch','activityActor','activityType','activityAction','activityFrom','activityTo'].forEach(id=>{if($('#'+id))$('#'+id).value=''});load()});
}

async function initPlatform(){
  localStorage.removeItem('activeOrganizationId');
  await loadMe();
  if(!me.isSuperAdmin)return location.href='/dashboard';
  const money=c=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((Number(c)||0)/100);
  const load=async()=>{
    const [sum,data,plans]=await Promise.all([api('/api/platform/summary'),api('/api/platform/organizations'),api('/api/platform/plans')]);
    $('#platformKpis').innerHTML=[['Empresas',sum.organizations,'Total de tenants'],['Ativas',sum.active,'Assinaturas ativas'],['Em trial',sum.trials,'Período de teste'],['Suspensas',sum.suspended,'Acesso bloqueado'],['MRR estimado',money(sum.mrr_cents),'Receita recorrente'],['Backlog global',sum.backlog,'Chamados em aberto']].map(x=>`<div class="metric-card"><div class="metric-top"><span>${x[0]}</span></div><strong>${x[1]}</strong><small>${x[2]}</small></div>`).join('');
    $('#orgBody').innerHTML=data.organizations.length?data.organizations.map(o=>`<tr><td><div class="tenant-cell"><span class="tenant-avatar">${esc(o.name.slice(0,2).toUpperCase())}</span><div><strong>${esc(o.name)}</strong><small>${esc(o.slug)} · ${esc(o.billing_email||'sem e-mail financeiro')}</small></div></div></td><td><span class="pill">${esc(o.plan)}</span></td><td>${o.users}/${o.user_limit}</td><td>${o.tickets}</td><td>${o.backlog}</td><td><span class="status-dot ${o.status}">${o.status==='active'?'Ativa':o.status==='trial'?'Trial':'Suspensa'}</span></td><td>${o.trial_ends_at?fmtShort(o.trial_ends_at):'—'}</td><td><button class="btn secondary small" data-enter-org="${o.id}">Acessar</button> <button class="btn ghost small" data-edit-org="${o.id}">Gerenciar</button></td></tr>`).join(''):'<tr><td colspan="8"><div class="empty-state"><strong>Nenhuma empresa cadastrada</strong><span>Crie seu primeiro cliente SaaS.</span></div></td></tr>';
    $$('[data-enter-org]').forEach(b=>b.onclick=()=>{localStorage.setItem('activeOrganizationId',b.dataset.enterOrg);location.href='/dashboard'});
    $$('[data-edit-org]').forEach(b=>b.onclick=()=>editOrganization(data.organizations.find(o=>String(o.id)===b.dataset.editOrg),load));
    if($('#planCards'))$('#planCards').innerHTML=plans.plans.map(p=>`<article class="plan-card"><span>${esc(p.name)}</span><strong>${money(p.price)}<small>/mês</small></strong><ul>${p.features.map(f=>`<li>${esc(f)}</li>`).join('')}</ul></article>`).join('');
  };
  await load();
  $('#newOrgBtn').onclick=()=>newOrganization(load);
}
function newOrganization(reload){
  const bg=modal(`<div class="modal-head"><div><span class="eyebrow">NOVO CLIENTE SaaS</span><h2>Cadastrar empresa</h2><p>Crie um tenant isolado, defina o plano e entregue o primeiro acesso.</p></div><button class="close" data-close>×</button></div><form id="orgForm"><h3>Empresa</h3><div class="form-grid"><label class="field"><span>Nome da empresa</span><input name="name" required></label><label class="field"><span>Slug</span><input name="slug" placeholder="empresa-abc" required></label><label class="field"><span>Plano</span><select name="plan"><option value="start">Start</option><option value="business" selected>Business</option><option value="pro">Pro</option></select></label><label class="field"><span>Limite de usuários</span><input name="userLimit" type="number" value="20" min="1"></label><label class="field"><span>Trial (dias)</span><input name="trialDays" type="number" value="14" min="0" max="90"></label><label class="field"><span>E-mail financeiro</span><input name="billingEmail" type="email"></label><label class="field"><span>Contato comercial</span><input name="contactName"></label><label class="field"><span>Telefone</span><input name="contactPhone"></label></div><label class="field"><span>Observações comerciais</span><textarea name="commercialNotes" rows="3" placeholder="Contrato, negociação, condições especiais..."></textarea></label><div class="divider"></div><h3>Administrador da empresa</h3><div class="form-grid"><label class="field"><span>Nome</span><input name="adminName" required></label><label class="field"><span>Usuário</span><input name="adminUsername" required></label><label class="field"><span>E-mail</span><input name="adminEmail" type="email"></label><label class="field"><span>Senha inicial</span><input name="adminPassword" type="password" minlength="8" required></label></div><div class="modal-actions"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn primary">Criar empresa</button></div></form>`,true);
  $('#orgForm').onsubmit=async e=>{e.preventDefault();try{const d=Object.fromEntries(new FormData(e.target));await api('/api/platform/organizations',{method:'POST',body:JSON.stringify(d)});bg.remove();toast('Empresa criada com isolamento de dados.');reload()}catch(err){toast(err.message,'error')}};
}
function editOrganization(o,reload){
  const dateVal=d=>d?new Date(d).toISOString().slice(0,10):'';
  const bg=modal(`<div class="modal-head"><div><span class="eyebrow">GESTÃO DO TENANT</span><h2>${esc(o.name)}</h2><p>${esc(o.slug)} · criado em ${fmtShort(o.created_at)}</p></div><button class="close" data-close>×</button></div><form id="editOrg"><div class="form-grid"><label class="field"><span>Nome</span><input name="name" value="${esc(o.name)}"></label><label class="field"><span>Plano</span><select name="plan">${['start','business','pro'].map(x=>`<option value="${x}" ${o.plan===x?'selected':''}>${x}</option>`).join('')}</select></label><label class="field"><span>Status</span><select name="status">${[['active','Ativa'],['trial','Trial'],['suspended','Suspensa']].map(([x,l])=>`<option value="${x}" ${o.status===x?'selected':''}>${l}</option>`).join('')}</select></label><label class="field"><span>Limite de usuários</span><input name="userLimit" type="number" value="${o.user_limit}"></label><label class="field"><span>Trial (dias)</span><input name="trialDays" type="number" min="0" max="90" value="${o.trial_days||0}"></label><label class="field"><span>Fim do trial</span><input name="trialEndsAt" type="date" value="${dateVal(o.trial_ends_at)}"></label><label class="field"><span>Fim da assinatura</span><input name="subscriptionEndsAt" type="date" value="${dateVal(o.subscription_ends_at)}"></label><label class="field"><span>E-mail financeiro</span><input name="billingEmail" type="email" value="${esc(o.billing_email||'')}"></label><label class="field"><span>Contato</span><input name="contactName" value="${esc(o.contact_name||'')}"></label><label class="field"><span>Telefone</span><input name="contactPhone" value="${esc(o.contact_phone||'')}"></label></div><label class="field"><span>Observações comerciais</span><textarea name="commercialNotes" rows="4">${esc(o.commercial_notes||'')}</textarea></label><div class="modal-actions"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn primary">Salvar alterações</button></div></form>`,true);
  $('#editOrg').onsubmit=async e=>{e.preventDefault();try{const d=Object.fromEntries(new FormData(e.target));await api('/api/platform/organizations/'+o.id,{method:'PATCH',body:JSON.stringify(d)});bg.remove();toast('Empresa atualizada.');reload()}catch(err){toast(err.message,'error')}};
}
document.addEventListener('DOMContentLoaded',async()=>{try{const p=document.body.dataset.page;const pages={login:initLogin,register:initRegister,dashboard:initDashboard,tickets:initTickets,assets:initAssets,knowledge:initKnowledge,users:initUsers,reports:initReports,activity:initActivity,subscription:initSubscription,config:initConfig,platform:initPlatform};const init=pages[p];if(typeof init==='function')await init()}catch(e){console.error(e);feedback(e.message,'error');toast(e.message,'error')}});
