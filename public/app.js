const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let me=null,meta={categories:[],departments:[],brandName:'Central de Serviços'},tickets=[],users=[],assets=[],articles=[];
const roleLabel={admin:'Administrador',agent:'Analista',requester:'Solicitante'},userStatus={active:'Ativo',pending:'Pendente',blocked:'Bloqueado'};
const ticketStatus={open:'Aberto',progress:'Em atendimento',resolved:'Resolvido',closed:'Encerrado'},priorityLabel={low:'Baixa',medium:'Média',high:'Alta',urgent:'Crítica'},impactLabel={low:'Baixo',medium:'Médio',high:'Alto'};
const assetStatus={active:'Em uso',maintenance:'Manutenção',stock:'Estoque',retired:'Baixado'},eventLabel={created:'Chamado criado',updated:'Chamado atualizado',commented:'Interação registrada',attachment_added:'Anexo incluído'};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=d=>d?new Date(d).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'—',fmtShort=d=>d?new Date(d).toLocaleDateString('pt-BR'):'—';

async function api(url,opt={}){
    const tenantHeader=localStorage.getItem('activeOrganizationId');

    const r=await fetch(url,{
        headers:{
            'Content-Type':'application/json',
            ...(tenantHeader?{'X-Organization-Id':tenantHeader}:{}),
            ...(opt.headers||{})
        },
        ...opt
    });

    const j=await r.json().catch(()=>({}));

    if(r.status===401){
        location.href='/';
        throw new Error('Sessão encerrada.');
    }

    if(!r.ok)throw new Error(j.error||'Erro na operação.');

    return j;
}

function avatar(u,size='sm'){
    const p=u?.photoData||u?.photo_data;
    const n=u?.name||u?.requester_name||'?';

    return `
        <span class="avatar ${size}">
            ${
                p
                ? `<img src="${p}" alt="">`
                : esc(
                    n.trim()
                    .split(/\s+/)
                    .slice(0,2)
                    .map(x=>x[0])
                    .join('')
                    .toUpperCase()
                )
            }
        </span>
    `;
}

function feedback(msg,type='ok'){
    const e=$('#feedback');
    if(!e)return;

    e.className=`feedback ${type}`;
    e.textContent=msg;
    e.classList.remove('hidden');
}

function toast(msg,type='ok'){
    let e=document.createElement('div');

    e.className=`toast ${type}`;
    e.textContent=msg;

    document.body.appendChild(e);

    setTimeout(()=>e.classList.add('show'),10);

    setTimeout(()=>{
        e.classList.remove('show');
        setTimeout(()=>e.remove(),250);
    },2800);
}

function modal(html,wide=false){
    const bg=document.createElement('div');

    bg.className='modal-bg';
    bg.innerHTML=`
        <section class="modal ${wide?'modal-wide':''}">
            ${html}
        </section>
    `;

    document.body.appendChild(bg);

    bg.addEventListener('click',e=>{
        if(e.target===bg||e.target.closest('[data-close]')){
            bg.remove();
        }
    });

    return bg;
}

async function fileToDataUrl(file,max=900000){
    if(!file)return null;

    if(file.size>max){
        throw new Error('Arquivo muito grande. Limite aproximado: 1 MB.');
    }

    return await new Promise((ok,no)=>{
        const r=new FileReader();

        r.onload=()=>ok(r.result);
        r.onerror=no;
        r.readAsDataURL(file);
    });
}

async function photoToDataUrl(file){
    if(!file)return null;

    return await new Promise((ok,no)=>{
        const im=new Image();
        const r=new FileReader();

        r.onload=()=>im.src=r.result;
        r.onerror=no;

        im.onload=()=>{
            const c=document.createElement('canvas');

            c.width=256;
            c.height=256;

            const x=c.getContext('2d');
            const s=Math.min(im.width,im.height);
            const ox=(im.width-s)/2;
            const oy=(im.height-s)/2;

            x.drawImage(
                im,
                ox,
                oy,
                s,
                s,
                0,
                0,
                256,
                256
            );

            ok(c.toDataURL('image/jpeg',.82));
        };

        r.readAsDataURL(file);
    });
}

function isOverdue(t){
    return t.due_at &&
        new Date(t.due_at)<new Date() &&
        !['resolved','closed'].includes(t.status);
}

function slaText(t){
    if(!t.due_at)return 'Sem SLA';

    if(['resolved','closed'].includes(t.status)){
        return 'Finalizado';
    }

    if(isOverdue(t)){
        return 'SLA vencido';
    }

    const h=Math.max(
        0,
        Math.ceil(
            (new Date(t.due_at)-Date.now())/3600000
        )
    );

    return h<24
        ? `${h}h restantes`
        : `${Math.ceil(h/24)}d restantes`;
}

function pct(v,max){
    return Math.max(
        3,
        Math.min(
            100,
            (Number(v)||0)/Math.max(1,max)*100
        )
    );
}

/* ============================================
   USUÁRIO / SUPER ADMIN
   ============================================ */

async function loadMe(){
    const [m,mt]=await Promise.all([
        api('/api/me'),
        api('/api/meta')
    ]);

    me=m.user;
    meta=mt;

    $$('[data-brand]').forEach(x=>{
        x.textContent=meta.brandName;
    });

    $$('[data-company]').forEach(x=>{
        x.textContent=meta.companyName;
    });

    $$('[data-tagline]').forEach(x=>{
        x.textContent=meta.tagline;
    });

    $$('[data-admin]').forEach(x=>{
        x.style.display=
            me.role==='admin'
            ? ''
            : 'none';
    });

    $$('[data-staff]').forEach(x=>{
        x.style.display=
            me.role!=='requester'
            ? ''
            : 'none';
    });

    // Corrige a exibição dos itens exclusivos do Super Admin,
    // inclusive quando o CSS possui display:none.
    $$('[data-superadmin]').forEach(x=>{
        x.style.setProperty(
            'display',
            me.isSuperAdmin ? 'block' : 'none',
            'important'
        );
    });

    // Super Admin operando dentro de uma empresa.
    if(
        me.isSuperAdmin &&
        localStorage.getItem('activeOrganizationId')
    ){
        const h=document.querySelector('.top-actions');

        if(
            h &&
            !document.getElementById('backPlatform')
        ){
            const b=document.createElement('button');

            b.id='backPlatform';
            b.className='btn secondary small';
            b.textContent='← Voltar à Plataforma';

            b.onclick=()=>{
                localStorage.removeItem(
                    'activeOrganizationId'
                );

                location.href='/plataforma';
            };

            h.prepend(b);
        }
    }

    if($('#meBox')){
        $('#meBox').innerHTML=`
            <button
                class="user-chip"
                id="userMenuBtn"
            >
                ${avatar(me)}

                <span>
                    <strong>${esc(me.name)}</strong>

                    <small>
                        ${
                            me.isSuperAdmin
                            ? 'Super Admin'
                            : roleLabel[me.role]
                        }
                    </small>
                </span>

                <b>⌄</b>
            </button>

            <div
                class="user-dropdown hidden"
                id="userDropdown"
            >
                <div class="user-dropdown-head">
                    ${avatar(me,'md')}

                    <div>
                        <strong>
                            ${esc(me.name)}
                        </strong>

                        <small>
                            @${esc(me.username)}
                        </small>
                    </div>
                </div>

                ${
                    me.isSuperAdmin
                    ? `
                        <button id="platformMenu">
                            Gestão da Plataforma
                        </button>
                    `
                    : ''
                }

                <button id="profileMenu">
                    Meu perfil
                </button>

                <button
                    id="logoutBtn"
                    class="danger-text"
                >
                    Sair da conta
                </button>
            </div>
        `;

        $('#userMenuBtn').onclick=()=>{
            $('#userDropdown')
            .classList
            .toggle('hidden');
        };

        $('#platformMenu')
        ?.addEventListener(
            'click',
            ()=>{
                localStorage.removeItem(
                    'activeOrganizationId'
                );

                location.href='/plataforma';
            }
        );

        $('#profileMenu').onclick=openProfile;

        $('#logoutBtn').onclick=async()=>{
            await api(
                '/api/auth/logout',
                {method:'POST'}
            );

            localStorage.removeItem(
                'activeOrganizationId'
            );

            location.href='/';
        };
    }

    await loadNotifications();
}

async function loadNotifications(){
    if(!me||!$('#notifHost'))return;

    const r=await api('/api/notifications');

    $('#notifHost').innerHTML=`
        <button
            class="icon-btn"
            id="notifBtn"
            aria-label="Notificações"
        >
            ◉
            ${
                r.unread
                ? `<span class="counter">${r.unread}</span>`
                : ''
            }
        </button>

        <div
            class="notif-panel hidden"
            id="notifPanel"
        >
            <div class="notif-head">
                <div>
                    <strong>Notificações</strong>
                    <small>
                        ${r.unread} não lida(s)
                    </small>
                </div>

                <button id="readAll">
                    Marcar todas
                </button>
            </div>

            ${
                r.notifications.length
                ? r.notifications.map(n=>`
                    <button
                        class="notif-item ${
                            n.is_read
                            ? ''
                            : 'unread'
                        }"
                        data-notif="${n.id}"
                        data-ticket="${n.ticket_id||''}"
                    >
                        <i></i>

                        <div>
                            <strong>
                                ${esc(n.title)}
                            </strong>

                            <small>
                                ${esc(n.body||'')}
                            </small>

                            <time>
                                ${fmt(n.created_at)}
                            </time>
                        </div>
                    </button>
                `).join('')
                : `
                    <div class="empty-mini">
                        Nenhuma notificação.
                    </div>
                `
            }
        </div>
    `;

    $('#notifBtn').onclick=()=>{
        $('#notifPanel')
        .classList
        .toggle('hidden');
    };

    $('#readAll').onclick=async()=>{
        await api(
            '/api/notifications/read-all',
            {method:'POST'}
        );

        loadNotifications();
    };

    $$('[data-notif]').forEach(b=>{
        b.onclick=async()=>{
            await api(
                `/api/notifications/${b.dataset.notif}/read`,
                {method:'PATCH'}
            );

            b.dataset.ticket
                ? location.href=
                    `/chamados?ticket=${b.dataset.ticket}`
                : loadNotifications();
        };
    });
}

async function openProfile(){
    let photo=me.photoData;

    const bg=modal(`
        <div class="modal-head">
            <div>
                <span class="eyebrow">
                    CONTA
                </span>

                <h2>Meu perfil</h2>

                <p>
                    Atualize suas informações
                    pessoais e credenciais.
                </p>
            </div>

            <button
                class="close"
                data-close
            >
                ×
            </button>
        </div>

        <form id="profileForm">
            <div class="profile-line">
                <div
                    class="photo-preview"
                    id="photoPreview"
                >
                    ${
                        photo
                        ? `<img src="${photo}">`
                        : esc(me.name[0])
                    }
                </div>

                <label class="file-label">
                    Alterar foto

                    <input
                        type="file"
                        id="profilePhoto"
                        accept="image/*"
                    >
                </label>
            </div>

            <div class="form-grid">
                <label class="field">
                    <span>
                        Nome completo
                    </span>

                    <input
                        name="name"
                        value="${esc(me.name)}"
                        required
                    >
                </label>

                <label class="field">
                    <span>E-mail</span>

                    <input
                        name="email"
                        type="email"
                        value="${esc(me.email||'')}"
                    >
                </label>
            </div>

            <label class="field">
                <span>Setor</span>

                <input
                    name="department"
                    value="${esc(me.department||'')}"
                >
            </label>

            <button class="btn primary">
                Salvar perfil
            </button>
        </form>

        <div class="divider"></div>

        <form id="passwordForm">
            <h3>Segurança</h3>

            <div class="form-grid">
                <label class="field">
                    <span>
                        Senha atual
                    </span>

                    <input
                        name="currentPassword"
                        type="password"
                        required
                    >
                </label>

                <label class="field">
                    <span>
                        Nova senha
                    </span>

                    <input
                        name="newPassword"
                        type="password"
                        minlength="8"
                        required
                    >
                </label>
            </div>

            <button class="btn secondary">
                Alterar senha
            </button>
        </form>
    `);

    $('#profilePhoto').onchange=async e=>{
        photo=await photoToDataUrl(
            e.target.files[0]
        );

        $('#photoPreview').innerHTML=`
            <img src="${photo}">
        `;
    };

    $('#profileForm').onsubmit=async e=>{
        e.preventDefault();

        const d=Object.fromEntries(
            new FormData(e.target)
        );

        d.photoData=photo;

        const r=await api(
            '/api/me',
            {
                method:'PATCH',
                body:JSON.stringify(d)
            }
        );

        me=r.user;
        bg.remove();

        loadMe();

        toast('Perfil atualizado.');
    };

    $('#passwordForm').onsubmit=async e=>{
        e.preventDefault();

        await api(
            '/api/me/password',
            {
                method:'PATCH',
                body:JSON.stringify(
                    Object.fromEntries(
                        new FormData(e.target)
                    )
                )
            }
        );

        toast('Senha alterada.');

        e.target.reset();
    };
}

/* ============================================
   LOGIN / CADASTRO
   ============================================ */

async function initLogin(){
    $('#loginForm').onsubmit=async e=>{
        e.preventDefault();

        const btn=e.target.querySelector(
            'button[type=submit]'
        );

        btn.disabled=true;
        btn.textContent='Entrando...';

        try{
            await api(
                '/api/auth/login',
                {
                    method:'POST',
                    body:JSON.stringify(
                        Object.fromEntries(
                            new FormData(e.target)
                        )
                    )
                }
            );

            location.href='/dashboard';

        }catch(err){
            feedback(
                err.message,
                'error'
            );

            btn.disabled=false;

            btn.textContent=
                'Acessar plataforma';
        }
    };
}

async function initRegister(){
    const token=
        new URLSearchParams(
            location.search
        ).get('invite')||'';

    if(!token){
        feedback(
            'Para criar uma conta, solicite um link de convite ao administrador da sua empresa.',
            'error'
        );

        $('#registerForm')
        .querySelector('button')
        .disabled=true;

        return;
    }

    try{
        const r=await api(
            '/api/public/invite/'+
            encodeURIComponent(token)
        );

        const box=$('#inviteCompany');

        if(box){
            box.innerHTML=`
                Convite para
                <strong>
                    ${esc(r.invite.organization_name)}
                </strong>
                ·
                ${
                    roleLabel[r.invite.role]
                    ||r.invite.role
                }
            `;
        }

        if(
            r.invite.email &&
            $('#registerForm').email
        ){
            $('#registerForm').email.value=
                r.invite.email;
        }

    }catch(err){
        feedback(
            err.message,
            'error'
        );

        $('#registerForm')
        .querySelector('button')
        .disabled=true;

        return;
    }

    $('#registerForm').onsubmit=async e=>{
        e.preventDefault();

        try{
            const d=Object.fromEntries(
                new FormData(e.target)
            );

            d.inviteToken=token;

            const r=await api(
                '/api/auth/register',
                {
                    method:'POST',
                    body:JSON.stringify(d)
                }
            );

            feedback(r.message);

            setTimeout(
                ()=>location.href='/',
                1200
            );

        }catch(err){
            feedback(
                err.message,
                'error'
            );
        }
    };
}

/* ============================================
   DASHBOARD
   ============================================ */

async function initDashboard(){
    await loadMe();

    const r=await api('/api/dashboard');
    const first=me.name.split(' ')[0];

    $('#welcomeTitle').textContent=
        `Olá, ${first}.`;

    $('#welcomeText').textContent=
        me.role==='requester'
        ? 'Acompanhe suas solicitações e encontre respostas rapidamente.'
        : 'Acompanhe a saúde da operação e priorize o que precisa de atenção agora.';

    const k=[
        [
            'Backlog',
            Number(r.kpis.open)+
            Number(r.kpis.progress),
            'Chamados ativos',
            'neutral'
        ],
        [
            'SLA vencido',
            r.kpis.overdue,
            'Exigem ação imediata',
            'danger'
        ],
        [
            'Prioridade crítica',
            r.kpis.urgent,
            'Impacto elevado',
            'warning'
        ],
        [
            'Resolvidos hoje',
            r.kpis.resolved_today,
            'Entregas concluídas',
            'success'
        ],
        [
            'Tempo médio',
            `${r.kpis.avg_hours}h`,
            'Até resolução',
            'neutral'
        ],
        [
            '1ª resposta',
            `${r.kpis.avg_first_response_min}m`,
            'Média da operação',
            'neutral'
        ]
    ];

    $('#dashKpis').innerHTML=
        k.map(x=>`
            <article class="metric-card ${x[3]}">
                <div class="metric-top">
                    <span>${x[0]}</span>
                    <i></i>
                </div>

                <strong>${x[1]}</strong>

                <small>${x[2]}</small>
            </article>
        `).join('');

    $('#recentTickets').innerHTML=
        r.recent.length
        ? r.recent.map(t=>`
            <a
                class="recent-row"
                href="/chamados?ticket=${t.id}"
            >
                <span class="protocol">
                    #${String(t.id).padStart(5,'0')}
                </span>

                <div>
                    <strong>
                        ${esc(t.title)}
                    </strong>

                    <small>
                        ${ticketStatus[t.status]}
                        ·
                        ${priorityLabel[t.priority]}
                        ${
                            t.assigned_name
                            ? ` · ${esc(t.assigned_name)}`
                            : ''
                        }
                    </small>
                </div>

                <span
                    class="sla ${
                        isOverdue(t)
                        ? 'late'
                        : ''
                    }"
                >
                    ${slaText(t)}
                </span>
            </a>
        `).join('')
        : `
            <div class="empty-mini">
                Nenhum chamado ainda.
            </div>
        `;

    if($('#workload')){
        $('#workload').innerHTML=
            r.workload.length
            ? r.workload.map(w=>`
                <div class="work-row">
                    <span>
                        ${esc(w.name)}
                    </span>

                    <div class="bar">
                        <i
                            style="
                                width:
                                ${
                                    pct(
                                        w.total,
                                        Math.max(
                                            ...r.workload
                                            .map(x=>x.total)
                                        )
                                    )
                                }%
                            "
                        ></i>
                    </div>

                    <strong>
                        ${w.total}
                    </strong>
                </div>
            `).join('')
            : `
                <div class="empty-mini">
                    Sem dados de carga.
                </div>
            `;
    }

    if($('#healthPanel')){
        const h=r.health||{};

        $('#healthPanel').innerHTML=`
            <div class="health-score">
                <div
                    class="score-ring"
                    style="
                        --score:
                        ${Number(h.sla_compliance)||0}
                    "
                >
                    <strong>
                        ${h.sla_compliance||0}%
                    </strong>

                    <span>SLA</span>
                </div>

                <div>
                    <h3>
                        Saúde operacional
                    </h3>

                    <p>
                        Indicador consolidado
                        do cumprimento de SLA
                        da operação.
                    </p>
                </div>
            </div>

            <div class="mini-stats">
                <div>
                    <strong>
                        ${h.active_agents||0}
                    </strong>

                    <span>
                        Analistas ativos
                    </span>
                </div>

                <div>
                    <strong>
                        ${h.assets||0}
                    </strong>

                    <span>
                        Ativos gerenciados
                    </span>
                </div>

                <div>
                    <strong>
                        ${h.articles||0}
                    </strong>

                    <span>
                        Artigos publicados
                    </span>
                </div>
            </div>
        `;
    }

    $('#newTicketBtn')
    ?.addEventListener(
        'click',
        newTicket
    );
}

/* ============================================
   CHAMADOS
   ============================================ */

function ticketRow(t){
    return `
        <article
            class="
                ticket-row
                ${isOverdue(t)?'overdue':''}
            "
            data-ticket="${t.id}"
        >
            ${avatar({
                name:t.requester_name,
                photo_data:t.requester_photo
            })}

            <div class="ticket-main">
                <strong>
                    ${esc(t.title)}
                </strong>

                <small>
                    <span class="protocol">
                        #${String(t.id).padStart(5,'0')}
                    </span>

                    · ${esc(t.requester_name)}
                    · ${esc(t.category)}

                    ${
                        t.asset_tag
                        ? ` · ${esc(t.asset_tag)}`
                        : ''
                    }
                </small>
            </div>

            <span class="priority ${t.priority}">
                ${priorityLabel[t.priority]}
            </span>

            <span class="status ${t.status}">
                ${ticketStatus[t.status]}
            </span>

            <span class="assignee">
                ${
                    t.assigned_name
                    ? esc(t.assigned_name)
                    : 'Não atribuído'
                }
            </span>

            <span
                class="
                    sla
                    ${isOverdue(t)?'late':''}
                "
            >
                ${slaText(t)}
            </span>

            <span class="chevron">
                ›
            </span>
        </article>
    `;
}

async function loadTickets(){
    const p=new URLSearchParams();

    [
        ['q','#search'],
        ['status','#statusFilter'],
        ['priority','#priorityFilter'],
        ['category','#categoryFilter'],
        ['assigned','#assignedFilter']
    ].forEach(([k,s])=>{
        const v=$(s)?.value;

        if(v){
            p.set(k,v);
        }
    });

    if($('#overdueFilter')?.checked){
        p.set('overdue','1');
    }

    const r=await api(
        '/api/tickets?'+p
    );

    tickets=r.tickets;

    $('#ticketCount').textContent=
        `${tickets.length} registro${
            tickets.length===1
            ? ''
            : 's'
        }`;

    $('#ticketList').innerHTML=
        tickets.length
        ? tickets.map(ticketRow).join('')
        : `
            <div class="empty-state">
                <div class="empty-icon">
                    ◇
                </div>

                <strong>
                    Nenhum chamado encontrado
                </strong>

                <span>
                    Ajuste os filtros
                    ou registre uma nova
                    solicitação.
                </span>
            </div>
        `;

    $$('[data-ticket]').forEach(x=>{
        x.onclick=()=>{
            openTicket(
                Number(x.dataset.ticket)
            );
        };
    });
}

async function loadAssetsForSelect(){
    if(me?.role==='requester'){
        return [];
    }

    try{
        return (
            await api('/api/assets')
        ).assets;
    }catch{
        return [];
    }
}

async function newTicket(){
    const assetOptions=
        (
            await loadAssetsForSelect()
        )
        .map(a=>`
            <option value="${a.id}">
                ${esc(a.asset_tag)}
                ·
                ${esc(a.name)}
            </option>
        `)
        .join('');

    const bg=modal(`
        <div class="modal-head">
            <div>
                <span class="eyebrow">
                    NOVA SOLICITAÇÃO
                </span>

                <h2>Abrir chamado</h2>

                <p>
                    Registre o contexto
                    completo para acelerar
                    o atendimento.
                </p>
            </div>

            <button
                class="close"
                data-close
            >
                ×
            </button>
        </div>

        <form id="newTicketForm">
            <label class="field">
                <span>Assunto</span>

                <input
                    name="title"
                    maxlength="180"
                    placeholder="
                        Ex.: Sistema financeiro
                        não abre
                    "
                    required
                >
            </label>

            <div class="form-grid">
                <label class="field">
                    <span>Categoria</span>

                    <select
                        name="category"
                        required
                    >
                        ${
                            meta.categories
                            .map(c=>`
                                <option>
                                    ${esc(c.name)}
                                </option>
                            `)
                            .join('')
                        }
                    </select>
                </label>

                <label class="field">
                    <span>Prioridade</span>

                    <select name="priority">
                        <option value="low">
                            Baixa
                        </option>

                        <option
                            value="medium"
                            selected
                        >
                            Média
                        </option>

                        <option value="high">
                            Alta
                        </option>

                        <option value="urgent">
                            Crítica
                        </option>
                    </select>
                </label>

                <label class="field">
                    <span>Impacto</span>

                    <select name="impact">
                        <option value="low">
                            Baixo — uma pessoa
                        </option>

                        <option
                            value="medium"
                            selected
                        >
                            Médio — equipe/setor
                        </option>

                        <option value="high">
                            Alto — operação
                        </option>
                    </select>
                </label>

                <label class="field">
                    <span>Local</span>

                    <input
                        name="location"
                        placeholder="
                            Sala, unidade, setor...
                        "
                    >
                </label>
            </div>

            ${
                assetOptions
                ? `
                    <label class="field">
                        <span>
                            Ativo relacionado
                        </span>

                        <select name="assetId">
                            <option value="">
                                Nenhum ativo
                            </option>

                            ${assetOptions}
                        </select>
                    </label>
                `
                : ''
            }

            <label class="field">
                <span>
                    Descrição detalhada
                </span>

                <textarea
                    name="description"
                    rows="6"
                    placeholder="
                        Descreva o problema,
                        quando começou e o
                        que já foi testado.
                    "
                    required
                ></textarea>
            </label>

            <div class="modal-actions">
                <button
                    type="button"
                    class="btn ghost"
                    data-close
                >
                    Cancelar
                </button>

                <button class="btn primary">
                    Registrar chamado
                </button>
            </div>
        </form>
    `);

    $('#newTicketForm').onsubmit=
        async e=>{
            e.preventDefault();

            try{
                const r=await api(
                    '/api/tickets',
                    {
                        method:'POST',
                        body:JSON.stringify(
                            Object.fromEntries(
                                new FormData(
                                    e.target
                                )
                            )
                        )
                    }
                );

                bg.remove();

                toast(
                    `Chamado #${r.id} criado.`
                );

                if(
                    document.body.dataset.page
                    ==='tickets'
                ){
                    loadTickets();
                }else{
                    location.href=
                        `/chamados?ticket=${r.id}`;
                }

            }catch(err){
                toast(
                    err.message,
                    'error'
                );
            }
        };
}
async function openTicket(id){
    const [r,ag,ast]=await Promise.all([
        api('/api/tickets/'+id),
        api('/api/users/agents'),
        loadAssetsForSelect()
    ]);

    const t=r.ticket;
    const can=me.role!=='requester';

    const comments=r.comments.map(c=>`
        <div class="comment">
            <div>
                ${avatar({
                    name:c.author_name,
                    photo_data:c.author_photo
                })}
            </div>

            <div>
                <div class="comment-head">
                    <strong>${esc(c.author_name)}</strong>
                    <span>${roleLabel[c.author_role]||''}</span>
                    <time>${fmt(c.created_at)}</time>
                </div>

                <p>
                    ${esc(c.body).replace(/\n/g,'<br>')}
                </p>
            </div>
        </div>
    `).join('');

    const events=r.events.map(e=>`
        <div class="event">
            <i></i>

            <div>
                <strong>
                    ${eventLabel[e.event_type]||e.event_type}
                </strong>

                <small>
                    ${esc(e.actor_name||'Sistema')}
                    ·
                    ${fmt(e.created_at)}
                </small>
            </div>
        </div>
    `).join('');

    const files=r.attachments.map(a=>`
        <button
            class="attachment"
            data-attachment="${a.id}"
        >
            <span>
                ▱ ${esc(a.file_name)}
            </span>

            <small>
                ${Math.ceil(a.size_bytes/1024)} KB
            </small>
        </button>
    `).join('');

    const bg=modal(`
        <div class="modal-head">
            <div>
                <span class="eyebrow">
                    CHAMADO #${String(t.id).padStart(5,'0')}
                </span>

                <h2>${esc(t.title)}</h2>

                <p>
                    Aberto por
                    ${esc(t.requester_name)}
                    em
                    ${fmt(t.created_at)}
                </p>
            </div>

            <button
                class="close"
                data-close
            >
                ×
            </button>
        </div>

        <div class="ticket-detail-grid">
            <main>
                <div class="ticket-detail-badges">
                    <span class="status ${t.status}">
                        ${ticketStatus[t.status]}
                    </span>

                    <span class="priority ${t.priority}">
                        ${priorityLabel[t.priority]}
                    </span>

                    <span class="impact">
                        Impacto
                        ${impactLabel[t.impact]||'Médio'}
                    </span>
                </div>

                <section class="detail-box">
                    <h3>Descrição</h3>

                    <div class="pre">
                        ${esc(t.description)}
                    </div>

                    ${
                        t.location
                        ? `
                            <div class="detail-meta">
                                <span>Local</span>
                                <strong>
                                    ${esc(t.location)}
                                </strong>
                            </div>
                        `
                        : ''
                    }

                    ${
                        t.asset_tag
                        ? `
                            <div class="detail-meta">
                                <span>Ativo</span>

                                <strong>
                                    ${esc(t.asset_tag)}
                                    ·
                                    ${esc(t.asset_name)}
                                    ${
                                        t.asset_model
                                        ? ` · ${esc(t.asset_model)}`
                                        : ''
                                    }
                                </strong>
                            </div>
                        `
                        : ''
                    }
                </section>

                <section class="detail-box">
                    <div class="detail-title">
                        <h3>Interações</h3>
                        <span>${r.comments.length}</span>
                    </div>

                    ${
                        comments
                        || `
                            <div class="empty-mini">
                                Nenhuma interação registrada.
                            </div>
                        `
                    }

                    <form
                        id="commentForm"
                        class="comment-form"
                    >
                        <textarea
                            name="body"
                            rows="3"
                            placeholder="Registrar atualização, diagnóstico ou orientação..."
                            required
                        ></textarea>

                        <button class="btn primary small">
                            Enviar atualização
                        </button>
                    </form>
                </section>

                <section class="detail-box">
                    <div class="detail-title">
                        <h3>Anexos</h3>

                        <label class="file-label">
                            + Anexar arquivo

                            <input
                                id="attachFile"
                                type="file"
                            >
                        </label>
                    </div>

                    ${
                        files
                        || `
                            <div class="empty-mini">
                                Nenhum anexo.
                            </div>
                        `
                    }
                </section>

                <section class="detail-box">
                    <h3>Linha do tempo</h3>

                    ${
                        events
                        || `
                            <div class="empty-mini">
                                Sem eventos.
                            </div>
                        `
                    }
                </section>
            </main>

            <aside>
                <div class="detail-box sticky">
                    <h3>Gestão do chamado</h3>

                    <label class="field">
                        <span>Status</span>

                        <select
                            id="mStatus"
                            ${can?'':'disabled'}
                        >
                            ${
                                Object.entries(ticketStatus)
                                .map(([k,v])=>`
                                    <option
                                        value="${k}"
                                        ${
                                            t.status===k
                                            ? 'selected'
                                            : ''
                                        }
                                    >
                                        ${v}
                                    </option>
                                `)
                                .join('')
                            }
                        </select>
                    </label>

                    <label class="field">
                        <span>Prioridade</span>

                        <select
                            id="mPriority"
                            ${can?'':'disabled'}
                        >
                            ${
                                Object.entries(priorityLabel)
                                .map(([k,v])=>`
                                    <option
                                        value="${k}"
                                        ${
                                            t.priority===k
                                            ? 'selected'
                                            : ''
                                        }
                                    >
                                        ${v}
                                    </option>
                                `)
                                .join('')
                            }
                        </select>
                    </label>

                    <label class="field">
                        <span>Impacto</span>

                        <select
                            id="mImpact"
                            ${can?'':'disabled'}
                        >
                            ${
                                Object.entries(impactLabel)
                                .map(([k,v])=>`
                                    <option
                                        value="${k}"
                                        ${
                                            t.impact===k
                                            ? 'selected'
                                            : ''
                                        }
                                    >
                                        ${v}
                                    </option>
                                `)
                                .join('')
                            }
                        </select>
                    </label>

                    <label class="field">
                        <span>Responsável</span>

                        <select
                            id="mAssigned"
                            ${can?'':'disabled'}
                        >
                            <option value="">
                                Não atribuído
                            </option>

                            ${
                                ag.users.map(a=>`
                                    <option
                                        value="${a.id}"
                                        ${
                                            Number(t.assigned_to)===a.id
                                            ? 'selected'
                                            : ''
                                        }
                                    >
                                        ${esc(a.name)}
                                    </option>
                                `).join('')
                            }
                        </select>
                    </label>

                    ${
                        can
                        ? `
                            <label class="field">
                                <span>Ativo</span>

                                <select id="mAsset">
                                    <option value="">
                                        Nenhum
                                    </option>

                                    ${
                                        ast.map(a=>`
                                            <option
                                                value="${a.id}"
                                                ${
                                                    Number(t.asset_id)===Number(a.id)
                                                    ? 'selected'
                                                    : ''
                                                }
                                            >
                                                ${esc(a.asset_tag)}
                                                ·
                                                ${esc(a.name)}
                                            </option>
                                        `).join('')
                                    }
                                </select>
                            </label>

                            <label class="field">
                                <span>Local</span>

                                <input
                                    id="mLocation"
                                    value="${esc(t.location||'')}"
                                >
                            </label>
                        `
                        : ''
                    }

                    <div class="sla-box ${isOverdue(t)?'late':''}">
                        <small>SLA de resolução</small>

                        <strong>
                            ${slaText(t)}
                        </strong>

                        <span>
                            Prazo:
                            ${fmt(t.due_at)}
                        </span>
                    </div>

                    ${
                        can
                        ? `
                            <button
                                class="btn primary btn-block"
                                id="saveTicket"
                            >
                                Salvar alterações
                            </button>
                        `
                        : ''
                    }

                    ${
                        me.role==='admin'
                        ? `
                            <button
                                class="btn danger btn-block"
                                id="deleteTicket"
                            >
                                Excluir chamado
                            </button>
                        `
                        : ''
                    }
                </div>
            </aside>
        </div>
    `,true);

    $('#commentForm').onsubmit=async e=>{
        e.preventDefault();

        await api(
            `/api/tickets/${id}/comments`,
            {
                method:'POST',
                body:JSON.stringify({
                    body:e.target.body.value
                })
            }
        );

        bg.remove();

        openTicket(id);

        if($('#ticketList')){
            loadTickets();
        }
    };

    $('#saveTicket')
    ?.addEventListener(
        'click',
        async()=>{
            await api(
                `/api/tickets/${id}`,
                {
                    method:'PATCH',
                    body:JSON.stringify({
                        status:$('#mStatus').value,
                        priority:$('#mPriority').value,
                        impact:$('#mImpact').value,
                        assignedTo:
                            $('#mAssigned').value||null,
                        assetId:
                            $('#mAsset')?.value||null,
                        location:
                            $('#mLocation')?.value||''
                    })
                }
            );

            bg.remove();

            toast('Chamado atualizado.');

            loadTickets();
        }
    );

    $('#deleteTicket')
    ?.addEventListener(
        'click',
        async()=>{
            if(
                confirm(
                    'Excluir este chamado definitivamente?'
                )
            ){
                await api(
                    `/api/tickets/${id}`,
                    {
                        method:'DELETE'
                    }
                );

                bg.remove();

                loadTickets();
            }
        }
    );

    $('#attachFile').onchange=async e=>{
        try{
            const f=e.target.files[0];

            const data=
                await fileToDataUrl(f);

            await api(
                `/api/tickets/${id}/attachments`,
                {
                    method:'POST',
                    body:JSON.stringify({
                        fileName:f.name,
                        mimeType:f.type,
                        data
                    })
                }
            );

            bg.remove();

            openTicket(id);

        }catch(err){
            toast(
                err.message,
                'error'
            );
        }
    };

    $$('[data-attachment]').forEach(b=>{
        b.onclick=async()=>{
            const a=await api(
                '/api/attachments/'+
                b.dataset.attachment
            );

            const link=
                document.createElement('a');

            link.href=a.data;
            link.download=a.fileName;

            link.click();
        };
    });
}

async function initTickets(){
    await loadMe();

    $('#categoryFilter').innerHTML=
        '<option value="">Todas as categorias</option>'+
        meta.categories
        .map(c=>`
            <option>
                ${esc(c.name)}
            </option>
        `)
        .join('');

    await loadTickets();

    $('#newTicketBtn').onclick=
        newTicket;

    [
        'search',
        'statusFilter',
        'priorityFilter',
        'categoryFilter',
        'assignedFilter'
    ].forEach(id=>{
        $('#'+id)
        ?.addEventListener(
            id==='search'
            ? 'input'
            : 'change',
            loadTickets
        );
    });

    $('#overdueFilter').onchange=
        loadTickets;

    const id=
        new URLSearchParams(
            location.search
        ).get('ticket');

    if(id){
        openTicket(
            Number(id)
        );
    }
}

/* ============================================
   ATIVOS
   ============================================ */

async function loadAssets(){
    const r=await api(
        '/api/assets?q='+
        encodeURIComponent(
            $('#assetSearch')?.value||''
        )
    );

    assets=r.assets;

    $('#assetCount').textContent=
        `${assets.length} ativo${
            assets.length===1
            ? ''
            : 's'
        }`;

    $('#assetsGrid').innerHTML=
        assets.length
        ? assets.map(a=>`
            <article
                class="asset-card"
                data-asset="${a.id}"
            >
                <div class="asset-card-top">
                    <span class="asset-type">
                        ${esc(a.asset_type)}
                    </span>

                    <span class="asset-state ${a.status}">
                        ${assetStatus[a.status]}
                    </span>
                </div>

                <h3>
                    ${esc(a.name)}
                </h3>

                <code>
                    ${esc(a.asset_tag)}
                </code>

                <div class="asset-specs">
                    <span>
                        ${
                            esc(
                                [
                                    a.manufacturer,
                                    a.model
                                ]
                                .filter(Boolean)
                                .join(' ')
                                ||
                                'Modelo não informado'
                            )
                        }
                    </span>

                    <span>
                        ${
                            esc(
                                a.assigned_user_name
                                ||
                                'Sem usuário vinculado'
                            )
                        }
                    </span>

                    <span>
                        ${
                            esc(
                                a.location
                                ||
                                a.department
                                ||
                                'Local não informado'
                            )
                        }
                    </span>
                </div>

                <footer>
                    <span>
                        ${a.ticket_count}
                        chamado(s)
                    </span>

                    <button
                        class="btn secondary small"
                    >
                        Gerenciar
                    </button>
                </footer>
            </article>
        `).join('')
        : `
            <div class="empty-state">
                <div class="empty-icon">
                    ▱
                </div>

                <strong>
                    Nenhum ativo cadastrado
                </strong>

                <span>
                    Cadastre computadores,
                    impressoras, dispositivos
                    e outros itens.
                </span>
            </div>
        `;

    $$('[data-asset]').forEach(x=>{
        x.onclick=()=>{
            editAsset(
                Number(x.dataset.asset)
            );
        };
    });
}

async function assetForm(a=null){
    const ur=await api(
        '/api/users/active'
    );

    const u=ur.users;

    const bg=modal(`
        <div class="modal-head">
            <div>
                <span class="eyebrow">
                    CMDB / ATIVOS
                </span>

                <h2>
                    ${
                        a
                        ? 'Gerenciar ativo'
                        : 'Cadastrar ativo'
                    }
                </h2>

                <p>
                    Centralize patrimônio,
                    vínculo, localização
                    e histórico.
                </p>
            </div>

            <button
                class="close"
                data-close
            >
                ×
            </button>
        </div>

        <form id="assetForm">
            <div class="form-grid">
                <label class="field">
                    <span>
                        Patrimônio / TAG
                    </span>

                    <input
                        name="assetTag"
                        value="${esc(a?.asset_tag||'')}"
                        required
                    >
                </label>

                <label class="field">
                    <span>
                        Nome do ativo
                    </span>

                    <input
                        name="name"
                        value="${esc(a?.name||'')}"
                        required
                    >
                </label>

                <label class="field">
                    <span>Tipo</span>

                    <input
                        name="assetType"
                        value="${esc(a?.asset_type||'Notebook')}"
                        required
                    >
                </label>

                <label class="field">
                    <span>Status</span>

                    <select name="status">
                        ${
                            Object.entries(assetStatus)
                            .map(([k,v])=>`
                                <option
                                    value="${k}"
                                    ${
                                        a?.status===k
                                        ? 'selected'
                                        : ''
                                    }
                                >
                                    ${v}
                                </option>
                            `)
                            .join('')
                        }
                    </select>
                </label>

                <label class="field">
                    <span>Fabricante</span>

                    <input
                        name="manufacturer"
                        value="${esc(a?.manufacturer||'')}"
                    >
                </label>

                <label class="field">
                    <span>Modelo</span>

                    <input
                        name="model"
                        value="${esc(a?.model||'')}"
                    >
                </label>

                <label class="field">
                    <span>Nº de série</span>

                    <input
                        name="serialNumber"
                        value="${esc(a?.serial_number||'')}"
                    >
                </label>

                <label class="field">
                    <span>
                        Usuário responsável
                    </span>

                    <select name="assignedUserId">
                        <option value="">
                            Não vinculado
                        </option>

                        ${
                            u.map(x=>`
                                <option
                                    value="${x.id}"
                                    ${
                                        Number(a?.assigned_user_id)===x.id
                                        ? 'selected'
                                        : ''
                                    }
                                >
                                    ${esc(x.name)}
                                </option>
                            `).join('')
                        }
                    </select>
                </label>

                <label class="field">
                    <span>Setor</span>

                    <input
                        name="department"
                        value="${esc(a?.department||'')}"
                    >
                </label>

                <label class="field">
                    <span>Localização</span>

                    <input
                        name="location"
                        value="${esc(a?.location||'')}"
                    >
                </label>
            </div>

            <label class="field">
                <span>Observações</span>

                <textarea
                    name="notes"
                    rows="4"
                >${esc(a?.notes||'')}</textarea>
            </label>

            <div class="modal-actions">
                ${
                    a&&me.role==='admin'
                    ? `
                        <button
                            type="button"
                            class="btn danger"
                            id="deleteAsset"
                        >
                            Excluir
                        </button>
                    `
                    : ''
                }

                <span class="grow"></span>

                <button
                    type="button"
                    class="btn ghost"
                    data-close
                >
                    Cancelar
                </button>

                <button class="btn primary">
                    Salvar ativo
                </button>
            </div>
        </form>
    `);

    $('#assetForm').onsubmit=
        async e=>{
            e.preventDefault();

            await api(
                a
                ? `/api/assets/${a.id}`
                : '/api/assets',
                {
                    method:
                        a
                        ? 'PATCH'
                        : 'POST',

                    body:JSON.stringify(
                        Object.fromEntries(
                            new FormData(
                                e.target
                            )
                        )
                    )
                }
            );

            bg.remove();

            toast(
                a
                ? 'Ativo atualizado.'
                : 'Ativo cadastrado.'
            );

            loadAssets();
        };

    $('#deleteAsset')
    ?.addEventListener(
        'click',
        async()=>{
            if(
                confirm(
                    'Excluir este ativo? O vínculo com chamados será removido.'
                )
            ){
                await api(
                    `/api/assets/${a.id}`,
                    {
                        method:'DELETE'
                    }
                );

                bg.remove();

                loadAssets();
            }
        }
    );
}

function editAsset(id){
    assetForm(
        assets.find(
            x=>Number(x.id)===id
        )
    );
}

async function initAssets(){
    await loadMe();
    await loadAssets();

    $('#newAssetBtn').onclick=
        ()=>assetForm();

    $('#assetSearch')
    .addEventListener(
        'input',
        loadAssets
    );
}

/* ============================================
   BASE DE CONHECIMENTO
   ============================================ */

async function loadKnowledge(){
    const r=await api(
        '/api/knowledge?q='+
        encodeURIComponent(
            $('#kbSearch')?.value||''
        )
    );

    articles=r.articles;

    $('#kbGrid').innerHTML=
        articles.length
        ? articles.map(a=>`
            <article
                class="kb-card"
                data-article="${a.id}"
            >
                <div class="kb-meta">
                    <span>
                        ${esc(a.category||'Geral')}
                    </span>

                    ${
                        !a.published
                        ? '<b>Rascunho</b>'
                        : ''
                    }
                </div>

                <h3>
                    ${esc(a.title)}
                </h3>

                <p>
                    ${
                        esc(
                            a.summary
                            ||
                            a.content.slice(0,150)
                        )
                    }
                </p>

                <footer>
                    <span>
                        ${a.views} visualizações
                    </span>

                    <span>
                        Atualizado
                        ${fmtShort(a.updated_at)}
                    </span>
                </footer>
            </article>
        `).join('')
        : `
            <div class="empty-state">
                <div class="empty-icon">
                    ≡
                </div>

                <strong>
                    Nenhum artigo encontrado
                </strong>

                <span>
                    Documente soluções recorrentes
                    e reduza chamados repetidos.
                </span>
            </div>
        `;

    $$('[data-article]').forEach(x=>{
        x.onclick=()=>{
            openArticle(
                Number(x.dataset.article)
            );
        };
    });
}

async function articleForm(a=null){
    const bg=modal(`
        <div class="modal-head">
            <div>
                <span class="eyebrow">
                    BASE DE CONHECIMENTO
                </span>

                <h2>
                    ${
                        a
                        ? 'Editar artigo'
                        : 'Novo artigo'
                    }
                </h2>
            </div>

            <button
                class="close"
                data-close
            >
                ×
            </button>
        </div>

        <form id="articleForm">
            <label class="field">
                <span>Título</span>

                <input
                    name="title"
                    value="${esc(a?.title||'')}"
                    required
                >
            </label>

            <div class="form-grid">
                <label class="field">
                    <span>Categoria</span>

                    <input
                        name="category"
                        value="${esc(a?.category||'')}"
                    >
                </label>

                <label class="field checkbox-field">
                    <input
                        name="published"
                        type="checkbox"
                        ${
                            a?.published!==false
                            ? 'checked'
                            : ''
                        }
                    >

                    <span>Publicado</span>
                </label>
            </div>

            <label class="field">
                <span>Resumo</span>

                <textarea
                    name="summary"
                    rows="2"
                >${esc(a?.summary||'')}</textarea>
            </label>

            <label class="field">
                <span>Conteúdo</span>

                <textarea
                    name="content"
                    rows="12"
                    required
                >${esc(a?.content||'')}</textarea>
            </label>

            <div class="modal-actions">
                ${
                    a
                    ? `
                        <button
                            type="button"
                            class="btn danger"
                            id="deleteArticle"
                        >
                            Excluir
                        </button>
                    `
                    : ''
                }

                <span class="grow"></span>

                <button
                    type="button"
                    class="btn ghost"
                    data-close
                >
                    Cancelar
                </button>

                <button class="btn primary">
                    Salvar artigo
                </button>
            </div>
        </form>
    `,true);

    $('#articleForm').onsubmit=
        async e=>{
            e.preventDefault();

            const d=Object.fromEntries(
                new FormData(
                    e.target
                )
            );

            d.published=
                e.target
                .published
                .checked;

            await api(
                a
                ? `/api/knowledge/${a.id}`
                : '/api/knowledge',
                {
                    method:
                        a
                        ? 'PATCH'
                        : 'POST',

                    body:JSON.stringify(d)
                }
            );

            bg.remove();

            toast('Artigo salvo.');

            loadKnowledge();
        };

    $('#deleteArticle')
    ?.addEventListener(
        'click',
        async()=>{
            if(
                confirm(
                    'Excluir artigo?'
                )
            ){
                await api(
                    `/api/knowledge/${a.id}`,
                    {
                        method:'DELETE'
                    }
                );

                bg.remove();

                loadKnowledge();
            }
        }
    );
}

async function openArticle(id){
    const {article:a}=
        await api(
            '/api/knowledge/'+id
        );

    const bg=modal(`
        <div class="modal-head">
            <div>
                <span class="eyebrow">
                    ${
                        esc(
                            a.category
                            ||
                            'BASE DE CONHECIMENTO'
                        )
                    }
                </span>

                <h2>
                    ${esc(a.title)}
                </h2>

                <p>
                    Por
                    ${esc(a.author_name||'Equipe')}
                    · atualizado
                    ${fmt(a.updated_at)}
                </p>
            </div>

            <button
                class="close"
                data-close
            >
                ×
            </button>
        </div>

        <article class="article-body">
            ${
                esc(a.content)
                .replace(/\n/g,'<br>')
            }
        </article>

        ${
            me.role==='admin'
            ? `
                <div class="modal-actions">
                    <button
                        class="btn secondary"
                        id="editArticle"
                    >
                        Editar artigo
                    </button>
                </div>
            `
            : ''
        }
    `,true);

    $('#editArticle')
    ?.addEventListener(
        'click',
        ()=>{
            bg.remove();
            articleForm(a);
        }
    );
}

async function initKnowledge(){
    await loadMe();
    await loadKnowledge();

    if($('#newArticleBtn')){
        $('#newArticleBtn').onclick=
            ()=>articleForm();
    }

    $('#kbSearch')
    .addEventListener(
        'input',
        loadKnowledge
    );
}

/* ============================================
   USUÁRIOS
   ============================================ */

async function loadUsers(){
    const r=await api('/api/users');

    users=r.users;

    const counts={
        active:
            users.filter(
                x=>x.status==='active'
            ).length,

        pending:
            users.filter(
                x=>x.status==='pending'
            ).length,

        admin:
            users.filter(
                x=>x.role==='admin'
            ).length,

        agent:
            users.filter(
                x=>x.role==='agent'
            ).length
    };

    $('#userStats').innerHTML=[
        ['Ativos',counts.active],
        ['Pendentes',counts.pending],
        ['Analistas',counts.agent],
        ['Administradores',counts.admin]
    ]
    .map(x=>`
        <div class="mini-stat">
            <strong>${x[1]}</strong>
            <span>${x[0]}</span>
        </div>
    `)
    .join('');

    $('#usersBody').innerHTML=
        users.map(u=>`
            <tr>
                <td>
                    <div class="user-cell">
                        ${avatar(u)}

                        <div>
                            <strong>
                                ${esc(u.name)}
                            </strong>

                            <small>
                                ${
                                    esc(
                                        u.email
                                        ||
                                        'Sem e-mail'
                                    )
                                }
                            </small>
                        </div>
                    </div>
                </td>

                <td>
                    <code>
                        @${esc(u.username)}
                    </code>
                </td>

                <td>
                    <span class="pill">
                        ${roleLabel[u.role]}
                    </span>
                </td>

                <td>
                    <span class="user-status ${u.status}">
                        ${userStatus[u.status]}
                    </span>
                </td>

                <td>
                    ${esc(u.department||'—')}
                </td>

                <td>
                    ${fmt(u.lastLoginAt)}
                </td>

                <td>
                    <button
                        class="btn secondary small"
                        data-edit="${u.id}"
                    >
                        Gerenciar
                    </button>
                </td>
            </tr>
        `)
        .join('');

    $$('[data-edit]').forEach(b=>{
        b.onclick=()=>{
            editUser(
                Number(b.dataset.edit)
            );
        };
    });
}

async function editUser(id){
    const u=users.find(
        x=>x.id===id
    );

    let photo=u.photoData;

    const bg=modal(`
        <div class="modal-head">
            <div>
                <span class="eyebrow">
                    GESTÃO DE ACESSO
                </span>

                <h2>
                    ${esc(u.name)}
                </h2>

                <p>
                    @${esc(u.username)}
                </p>
            </div>

            <button
                class="close"
                data-close
            >
                ×
            </button>
        </div>

        <form id="userEdit">
            <div class="profile-line">
                <div
                    class="photo-preview"
                    id="uPrev"
                >
                    ${
                        photo
                        ? `<img src="${photo}">`
                        : esc(u.name[0])
                    }
                </div>

                <label class="file-label">
                    Trocar foto

                    <input
                        id="uPhoto"
                        type="file"
                        accept="image/*"
                    >
                </label>
            </div>

            <div class="form-grid">
                <label class="field">
                    <span>Nome</span>

                    <input
                        name="name"
                        value="${esc(u.name)}"
                        required
                    >
                </label>

                <label class="field">
                    <span>E-mail</span>

                    <input
                        name="email"
                        value="${esc(u.email||'')}"
                    >
                </label>

                <label class="field">
                    <span>Setor</span>

                    <input
                        name="department"
                        value="${esc(u.department||'')}"
                    >
                </label>

                <label class="field">
                    <span>Perfil</span>

                    <select name="role">
                        ${
                            Object.entries(roleLabel)
                            .map(([k,v])=>`
                                <option
                                    value="${k}"
                                    ${
                                        u.role===k
                                        ? 'selected'
                                        : ''
                                    }
                                >
                                    ${v}
                                </option>
                            `)
                            .join('')
                        }
                    </select>
                </label>

                <label class="field">
                    <span>Status</span>

                    <select name="status">
                        ${
                            Object.entries(userStatus)
                            .map(([k,v])=>`
                                <option
                                    value="${k}"
                                    ${
                                        u.status===k
                                        ? 'selected'
                                        : ''
                                    }
                                >
                                    ${v}
                                </option>
                            `)
                            .join('')
                        }
                    </select>
                </label>

                <label class="field">
                    <span>
                        Redefinir senha (opcional)
                    </span>

                    <input
                        name="password"
                        type="password"
                        minlength="8"
                    >
                </label>
            </div>

            <div class="modal-actions">
                ${
                    u.id!==me.id
                    ? `
                        <button
                            type="button"
                            class="btn danger"
                            id="delUser"
                        >
                            Excluir
                        </button>
                    `
                    : ''
                }

                <span class="grow"></span>

                <button class="btn primary">
                    Salvar alterações
                </button>
            </div>
        </form>
    `);

    $('#uPhoto').onchange=async e=>{
        photo=
            await photoToDataUrl(
                e.target.files[0]
            );

        $('#uPrev').innerHTML=
            `<img src="${photo}">`;
    };

    $('#userEdit').onsubmit=
        async e=>{
            e.preventDefault();

            const d=
                Object.fromEntries(
                    new FormData(
                        e.target
                    )
                );

            d.photoData=photo;

            if(!d.password){
                delete d.password;
            }

            await api(
                '/api/users/'+id,
                {
                    method:'PATCH',
                    body:JSON.stringify(d)
                }
            );

            bg.remove();

            toast(
                'Usuário atualizado.'
            );

            loadUsers();
        };

    $('#delUser')
    ?.addEventListener(
        'click',
        async()=>{
            if(
                confirm(
                    'Excluir este usuário?'
                )
            ){
                try{
                    await api(
                        '/api/users/'+id,
                        {
                            method:'DELETE'
                        }
                    );

                    bg.remove();

                    loadUsers();

                }catch(err){
                    toast(
                        err.message,
                        'error'
                    );
                }
            }
        }
    );
}

async function newUser(){
    const bg=modal(`
        <div class="modal-head">
            <div>
                <span class="eyebrow">
                    GESTÃO DE ACESSO
                </span>

                <h2>Novo usuário</h2>
            </div>

            <button
                class="close"
                data-close
            >
                ×
            </button>
        </div>

        <form id="newUserForm">
            <div class="form-grid">
                <label class="field">
                    <span>Nome</span>
                    <input name="name" required>
                </label>

                <label class="field">
                    <span>Usuário</span>
                    <input name="username" required>
                </label>

                <label class="field">
                    <span>E-mail</span>
                    <input name="email" type="email">
                </label>

                <label class="field">
                    <span>Setor</span>
                    <input name="department">
                </label>

                <label class="field">
                    <span>Perfil</span>

                    <select name="role">
                        <option value="requester">
                            Solicitante
                        </option>

                        <option value="agent">
                            Analista
                        </option>

                        <option value="admin">
                            Administrador
                        </option>
                    </select>
                </label>

                <label class="field">
                    <span>Status</span>

                    <select name="status">
                        <option value="active">
                            Ativo
                        </option>

                        <option value="pending">
                            Pendente
                        </option>

                        <option value="blocked">
                            Bloqueado
                        </option>
                    </select>
                </label>
            </div>

            <label class="field">
                <span>Senha inicial</span>

                <input
                    name="password"
                    type="password"
                    minlength="8"
                    required
                >
            </label>

            <div class="modal-actions">
                <button
                    type="button"
                    class="btn ghost"
                    data-close
                >
                    Cancelar
                </button>

                <button class="btn primary">
                    Cadastrar usuário
                </button>
            </div>
        </form>
    `);

    $('#newUserForm').onsubmit=
        async e=>{
            e.preventDefault();

            await api(
                '/api/users',
                {
                    method:'POST',
                    body:JSON.stringify(
                        Object.fromEntries(
                            new FormData(
                                e.target
                            )
                        )
                    )
                }
            );

            bg.remove();

            toast(
                'Usuário cadastrado.'
            );

            loadUsers();
        };
}

async function openInvite(){
    const bg=modal(`
        <div class="modal-head">
            <div>
                <span class="eyebrow">
                    CONVITE SEGURO
                </span>

                <h2>
                    Convidar usuário
                </h2>

                <p>
                    Gere um link exclusivo
                    para esta empresa.
                </p>
            </div>

            <button
                class="close"
                data-close
            >
                ×
            </button>
        </div>

        <form id="inviteForm">
            <label class="field">
                <span>
                    E-mail (opcional)
                </span>

                <input
                    name="email"
                    type="email"
                >
            </label>

            <div class="form-grid">
                <label class="field">
                    <span>Perfil</span>

                    <select name="role">
                        <option value="requester">
                            Solicitante
                        </option>

                        <option value="agent">
                            Analista
                        </option>

                        <option value="admin">
                            Administrador
                        </option>
                    </select>
                </label>

                <label class="field">
                    <span>Validade</span>

                    <select name="days">
                        <option value="1">
                            1 dia
                        </option>

                        <option
                            value="7"
                            selected
                        >
                            7 dias
                        </option>

                        <option value="30">
                            30 dias
                        </option>
                    </select>
                </label>
            </div>

            <button class="btn primary">
                Gerar convite
            </button>
        </form>

        <div id="inviteResult"></div>
    `);

    $('#inviteForm').onsubmit=
        async e=>{
            e.preventDefault();

            const r=await api(
                '/api/invitations',
                {
                    method:'POST',
                    body:JSON.stringify(
                        Object.fromEntries(
                            new FormData(
                                e.target
                            )
                        )
                    )
                }
            );

            $('#inviteResult').innerHTML=`
                <div class="invite-result">
                    <strong>
                        Link criado
                    </strong>

                    <input
                        id="inviteUrl"
                        value="${esc(r.url)}"
                        readonly
                    >

                    <button
                        class="btn secondary"
                        id="copyInvite"
                        type="button"
                    >
                        Copiar link
                    </button>
                </div>
            `;

            $('#copyInvite').onclick=
                async()=>{
                    await navigator.clipboard.writeText(
                        r.url
                    );

                    toast(
                        'Link copiado.'
                    );
                };
        };
}

async function initUsers(){
    await loadMe();
    await loadUsers();

    const {logs}=
        await api('/api/audit');

    $('#audit').innerHTML=
        logs
        .slice(0,30)
        .map(l=>`
            <div class="audit-row">
                <div>
                    <strong>
                        ${esc(l.actor_name||'Sistema')}
                    </strong>

                    <small>
                        ${esc(l.target_type)}
                        ${
                            l.target_id
                            ? ` #${l.target_id}`
                            : ''
                        }
                    </small>
                </div>

                <span>
                    ${
                        esc(
                            l.action
                            .replaceAll('_',' ')
                        )
                    }
                </span>

                <time>
                    ${fmt(l.created_at)}
                </time>
            </div>
        `)
        .join('');

    $('#newUserBtn').onclick=
        newUser;

    $('#inviteUserBtn')
    ?.addEventListener(
        'click',
        openInvite
    );
}

/* ============================================
   RELATÓRIOS
   ============================================ */

async function initReports(){
    await loadMe();

    const r=
        await api('/api/reports');

    const ks=[
        [
            'Volume total',
            r.kpis.total,
            'Chamados registrados'
        ],
        [
            'Backlog',
            Number(r.kpis.open)+
            Number(r.kpis.progress),
            'Pendências atuais'
        ],
        [
            'SLA vencido',
            r.kpis.overdue,
            'Fora do prazo'
        ],
        [
            'SLA cumprido',
            `${r.kpis.sla_compliance}%`,
            'Resolvidos no prazo'
        ],
        [
            'Tempo resolução',
            `${r.kpis.avg_hours}h`,
            'Média geral'
        ],
        [
            '1ª resposta',
            `${r.kpis.avg_first_response_min}m`,
            'Tempo médio'
        ]
    ];

    $('#kpis').innerHTML=
        ks.map(x=>`
            <div class="metric-card">
                <div class="metric-top">
                    <span>
                        ${x[0]}
                    </span>
                </div>

                <strong>
                    ${x[1]}
                </strong>

                <small>
                    ${x[2]}
                </small>
            </div>
        `).join('');

    function bars(id,data,key,label){
        const max=
            Math.max(
                1,
                ...data.map(
                    x=>Number(x.total)
                )
            );

        $(id).innerHTML=
            data.map(x=>`
                <div class="bar-row">
                    <div>
                        <span>
                            ${
                                esc(
                                    label
                                    ? label[x[key]]
                                        ||x[key]
                                    : x[key]
                                        ||'Não atribuído'
                                )
                            }
                        </span>

                        <strong>
                            ${x.total}
                        </strong>
                    </div>

                    <div class="bar">
                        <i
                            style="
                                width:
                                ${pct(x.total,max)}%
                            "
                        ></i>
                    </div>
                </div>
            `).join('');
    }

    bars(
        '#statusBars',
        r.status,
        'status',
        ticketStatus
    );

    bars(
        '#priorityBars',
        r.priority,
        'priority',
        priorityLabel
    );

    bars(
        '#categoryBars',
        r.category,
        'category'
    );

    bars(
        '#agentBars',
        r.agents,
        'name'
    );

    bars(
        '#dailyBars',
        r.daily,
        'day'
    );

    bars(
        '#impactBars',
        r.impact,
        'impact',
        impactLabel
    );

    $('#aging').innerHTML=`
        <div class="aging-item">
            <strong>
                ${r.aging.under24}
            </strong>

            <span>
                Até 24h
            </span>
        </div>

        <div class="aging-item">
            <strong>
                ${r.aging.h24_72}
            </strong>

            <span>
                24–72h
            </span>
        </div>

        <div class="aging-item danger">
            <strong>
                ${r.aging.over72}
            </strong>

            <span>
                Acima de 72h
            </span>
        </div>
    `;
}

/* ============================================
   CONFIGURAÇÕES
   ============================================ */

async function initConfig(){
    await loadMe();

    let cfg=
        await api('/api/config');

    function render(){
        const s=cfg.settings;
        const f=$('#settingsForm');

        [
            'brand_name',
            'company_name',
            'brand_tagline',
            'support_email',
            'sla_low',
            'sla_medium',
            'sla_high',
            'sla_urgent'
        ].forEach(k=>{
            if(f[k]){
                f[k].value=
                    s[k]||'';
            }
        });

        $('#catList').innerHTML=
            cfg.categories
            .map(c=>`
                <div class="config-row">
                    <input
                        value="${esc(c.name)}"
                        data-cat-name="${c.id}"
                    >

                    <label class="switch">
                        <input
                            type="checkbox"
                            data-cat-active="${c.id}"
                            ${
                                c.active
                                ? 'checked'
                                : ''
                            }
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
            `)
            .join('');

        $('#depList').innerHTML=
            cfg.departments
            .map(c=>`
                <div class="config-row">
                    <input
                        value="${esc(c.name)}"
                        data-dep-name="${c.id}"
                    >

                    <label class="switch">
                        <input
                            type="checkbox"
                            data-dep-active="${c.id}"
                            ${
                                c.active
                                ? 'checked'
                                : ''
                            }
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
            `)
            .join('');

        $$('[data-cat-save]').forEach(b=>{
            b.onclick=async()=>{
                const id=
                    b.dataset.catSave;

                await api(
                    '/api/config/categories/'+id,
                    {
                        method:'PATCH',
                        body:JSON.stringify({
                            name:
                                $(
                                    `[data-cat-name="${id}"]`
                                ).value,

                            active:
                                $(
                                    `[data-cat-active="${id}"]`
                                ).checked
                        })
                    }
                );

                cfg=
                    await api('/api/config');

                render();
            };
        });

        $$('[data-dep-save]').forEach(b=>{
            b.onclick=async()=>{
                const id=
                    b.dataset.depSave;

                await api(
                    '/api/config/departments/'+id,
                    {
                        method:'PATCH',
                        body:JSON.stringify({
                            name:
                                $(
                                    `[data-dep-name="${id}"]`
                                ).value,

                            active:
                                $(
                                    `[data-dep-active="${id}"]`
                                ).checked
                        })
                    }
                );

                cfg=
                    await api('/api/config');

                render();
            };
        });
    }

    render();

    $('#settingsForm').onsubmit=
        async e=>{
            e.preventDefault();

            await api(
                '/api/config/settings',
                {
                    method:'PATCH',
                    body:JSON.stringify(
                        Object.fromEntries(
                            new FormData(
                                e.target
                            )
                        )
                    )
                }
            );

            toast(
                'Configurações salvas.'
            );

            setTimeout(
                ()=>location.reload(),
                500
            );
        };

    $('#addCat').onsubmit=
        async e=>{
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

            cfg=
                await api('/api/config');

            render();
        };

    $('#addDep').onsubmit=
        async e=>{
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

            cfg=
                await api('/api/config');

            render();
        };
}

/* ============================================
   PLATAFORMA / MULTIEMPRESA
   ============================================ */

async function initPlatform(){
    await loadMe();

    if(!me.isSuperAdmin){
        return location.href='/dashboard';
    }

    const load=async()=>{
        const [sum,data]=
            await Promise.all([
                api('/api/platform/summary'),
                api('/api/platform/organizations')
            ]);

        $('#platformKpis').innerHTML=[
            [
                'Empresas',
                sum.organizations
            ],
            [
                'Ativas',
                sum.active
            ],
            [
                'Usuários',
                sum.users
            ],
            [
                'Chamados',
                sum.tickets
            ],
            [
                'Backlog',
                sum.backlog
            ]
        ]
        .map(x=>`
            <div class="metric-card">
                <span>
                    ${x[0]}
                </span>

                <strong>
                    ${x[1]}
                </strong>
            </div>
        `)
        .join('');

        $('#orgBody').innerHTML=
            data.organizations
            .map(o=>`
                <tr>
                    <td>
                        <strong>
                            ${esc(o.name)}
                        </strong>

                        <small class="table-sub">
                            ${esc(o.slug)}
                        </small>
                    </td>

                    <td>
                        <span class="pill">
                            ${esc(o.plan)}
                        </span>
                    </td>

                    <td>
                        ${o.users}/${o.user_limit}
                    </td>

                    <td>
                        ${o.tickets}
                    </td>

                    <td>
                        ${o.backlog}
                    </td>

                    <td>
                        <span
                            class="status-dot ${o.status}"
                        >
                            ${esc(o.status)}
                        </span>
                    </td>

                    <td>
                        <button
                            class="btn secondary small"
                            data-enter-org="${o.id}"
                        >
                            Acessar
                        </button>

                        <button
                            class="btn ghost small"
                            data-edit-org="${o.id}"
                        >
                            Editar
                        </button>
                    </td>
                </tr>
            `)
            .join('');

        $$('[data-enter-org]').forEach(b=>{
            b.onclick=()=>{
                localStorage.setItem(
                    'activeOrganizationId',
                    b.dataset.enterOrg
                );

                location.href='/dashboard';
            };
        });

        $$('[data-edit-org]').forEach(b=>{
            b.onclick=()=>{
                editOrganization(
                    data.organizations.find(
                        o=>
                            String(o.id)
                            ===
                            b.dataset.editOrg
                    ),
                    load
                );
            };
        });
    };

    await load();

    $('#newOrgBtn').onclick=
        ()=>newOrganization(load);

    $('#clearTenant')
    ?.addEventListener(
        'click',
        ()=>{
            localStorage.removeItem(
                'activeOrganizationId'
            );

            location.href='/plataforma';
        }
    );
}

function newOrganization(reload){
    const bg=modal(`
        <div class="modal-head">
            <div>
                <span class="eyebrow">
                    NOVO CLIENTE
                </span>

                <h2>
                    Cadastrar empresa
                </h2>

                <p>
                    Cria um tenant isolado
                    e o primeiro administrador.
                </p>
            </div>

            <button
                class="close"
                data-close
            >
                ×
            </button>
        </div>

        <form id="orgForm">
            <div class="form-grid">
                <label class="field">
                    <span>Empresa</span>

                    <input
                        name="name"
                        required
                    >
                </label>

                <label class="field">
                    <span>Slug</span>

                    <input
                        name="slug"
                        placeholder="empresa-abc"
                        required
                    >
                </label>

                <label class="field">
                    <span>Plano</span>

                    <select name="plan">
                        <option value="start">
                            Start
                        </option>

                        <option value="business">
                            Business
                        </option>

                        <option value="pro">
                            Pro
                        </option>
                    </select>
                </label>

                <label class="field">
                    <span>
                        Limite de usuários
                    </span>

                    <input
                        name="userLimit"
                        type="number"
                        value="5"
                        min="1"
                    >
                </label>
            </div>

            <h3>
                Administrador da empresa
            </h3>

            <div class="form-grid">
                <label class="field">
                    <span>Nome</span>

                    <input
                        name="adminName"
                        required
                    >
                </label>

                <label class="field">
                    <span>Usuário</span>

                    <input
                        name="adminUsername"
                        required
                    >
                </label>

                <label class="field">
                    <span>E-mail</span>

                    <input
                        name="adminEmail"
                        type="email"
                    >
                </label>

                <label class="field">
                    <span>Senha inicial</span>

                    <input
                        name="adminPassword"
                        type="password"
                        minlength="8"
                        required
                    >
                </label>
            </div>

            <button class="btn primary">
                Criar empresa
            </button>
        </form>
    `);

    $('#orgForm').onsubmit=
        async e=>{
            e.preventDefault();

            await api(
                '/api/platform/organizations',
                {
                    method:'POST',
                    body:JSON.stringify(
                        Object.fromEntries(
                            new FormData(
                                e.target
                            )
                        )
                    )
                }
            );

            bg.remove();

            toast(
                'Empresa criada com isolamento de dados.'
            );

            reload();
        };
}

function editOrganization(o,reload){
    const bg=modal(`
        <div class="modal-head">
            <div>
                <span class="eyebrow">
                    TENANT
                </span>

                <h2>
                    ${esc(o.name)}
                </h2>
            </div>

            <button
                class="close"
                data-close
            >
                ×
            </button>
        </div>

        <form id="editOrg">
            <label class="field">
                <span>Nome</span>

                <input
                    name="name"
                    value="${esc(o.name)}"
                >
            </label>

            <div class="form-grid">
                <label class="field">
                    <span>Plano</span>

                    <select name="plan">
                        ${
                            [
                                'start',
                                'business',
                                'pro'
                            ]
                            .map(x=>`
                                <option
                                    ${
                                        o.plan===x
                                        ? 'selected'
                                        : ''
                                    }
                                >
                                    ${x}
                                </option>
                            `)
                            .join('')
                        }
                    </select>
                </label>

                <label class="field">
                    <span>Status</span>

                    <select name="status">
                        ${
                            [
                                'active',
                                'trial',
                                'suspended'
                            ]
                            .map(x=>`
                                <option
                                    ${
                                        o.status===x
                                        ? 'selected'
                                        : ''
                                    }
                                >
                                    ${x}
                                </option>
                            `)
                            .join('')
                        }
                    </select>
                </label>
            </div>

            <label class="field">
                <span>
                    Limite de usuários
                </span>

                <input
                    name="userLimit"
                    type="number"
                    value="${o.user_limit}"
                >
            </label>

            <button class="btn primary">
                Salvar
            </button>
        </form>
    `);

    $('#editOrg').onsubmit=
        async e=>{
            e.preventDefault();

            await api(
                '/api/platform/organizations/'+
                o.id,
                {
                    method:'PATCH',
                    body:JSON.stringify(
                        Object.fromEntries(
                            new FormData(
                                e.target
                            )
                        )
                    )
                }
            );

            bg.remove();

            reload();
        };
}

/* ============================================
   INICIALIZAÇÃO
   ============================================ */

document.addEventListener(
    'DOMContentLoaded',
    async()=>{
        try{
            const p=
                document.body.dataset.page;

            const pages={
                login:initLogin,
                register:initRegister,
                dashboard:initDashboard,
                tickets:initTickets,
                assets:initAssets,
                knowledge:initKnowledge,
                users:initUsers,
                reports:initReports,
                config:initConfig,
                platform:initPlatform
            };

            const init=pages[p];

            if(typeof init==='function'){
                await init();
            }

        }catch(e){
            console.error(e);

            feedback(
                e.message,
                'error'
            );

            toast(
                e.message,
                'error'
            );
        }
    }
);