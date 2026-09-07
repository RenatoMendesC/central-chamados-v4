require('dotenv').config();
const path=require('path'),express=require('express'),cookieParser=require('cookie-parser'),helmet=require('helmet'),bcrypt=require('bcryptjs'),rateLimit=require('express-rate-limit'),crypto=require('crypto');
const {query}=require('./db'); const {initDatabase}=require('./schema'); const {setAuthCookie,clearAuthCookie,loadUser,requireAuth,requireRole,requireSuperAdmin}=require('./auth');
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL nÃ£o configurada.'); if(!process.env.JWT_SECRET||process.env.JWT_SECRET.length<20)throw new Error('JWT_SECRET precisa ter pelo menos 20 caracteres.');
const app=express(),PORT=Number(process.env.PORT||3000),ROOT=path.join(__dirname,'..'); app.disable('x-powered-by');app.set('trust proxy',1);app.use(helmet({contentSecurityPolicy:false}));app.use(express.json({limit:'3mb'}));app.use(express.urlencoded({extended:false,limit:'3mb'}));app.use(cookieParser());app.use('/assets',express.static(path.join(ROOT,'public'),{etag:false,maxAge:0,setHeaders:(res)=>{res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');res.setHeader('Pragma','no-cache');res.setHeader('Expires','0');}}));
const limiter=rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:true,legacyHeaders:false,message:{error:'Muitas tentativas. Aguarde alguns minutos.'}}),page=f=>path.join(ROOT,'views',f),clean=(v,m=300)=>String(v||'').trim().slice(0,m),priority=p=>['low','medium','high','urgent'].includes(p)?p:'medium',status=s=>['open','progress','resolved','closed'].includes(s)?s:'open',impact=s=>['low','medium','high'].includes(s)?s:'medium';
const pub=u=>({id:Number(u.id),organizationId:Number(u.organization_id),organizationName:u.organization_name||null,isSuperAdmin:Boolean(u.is_super_admin),name:u.name,username:u.username,email:u.email,department:u.department,role:u.role,status:u.status,photoData:u.photo_data||null,createdAt:u.created_at,lastLoginAt:u.last_login_at});
function tenant(req){if(req.user.is_super_admin){const h=Number(req.get('x-organization-id'));if(h>0)return h;}return Number(req.user.organization_id);}
async function assertTenant(req){const oid=tenant(req),r=await query("SELECT * FROM organizations WHERE id=$1",[oid]);const o=r.rows[0];if(!o)throw Object.assign(new Error('Empresa nÃ£o encontrada.'),{status:404});if(o.status==='suspended'&&!req.user.is_super_admin)throw Object.assign(new Error('Empresa suspensa.'),{status:403});return o;}
async function audit(req,action,type,id,details={}){await query('INSERT INTO audit_logs(organization_id,actor_id,action,target_type,target_id,details) VALUES($1,$2,$3,$4,$5,$6)',[tenant(req),req.user?.id||null,action,type,id||null,JSON.stringify(details)]);}
async function event(req,ticketId,type,details={}){await query('INSERT INTO ticket_events(organization_id,ticket_id,actor_id,event_type,details) VALUES($1,$2,$3,$4,$5)',[tenant(req),ticketId,req.user?.id||null,type,JSON.stringify(details)]);}
async function notify(oid,uid,tid,title,body){if(uid)await query('INSERT INTO notifications(organization_id,user_id,ticket_id,title,body) VALUES($1,$2,$3,$4,$5)',[oid,uid,tid,title,body]);}
async function setting(oid,key,fallback=''){const r=await query('SELECT value FROM organization_settings WHERE organization_id=$1 AND key=$2',[oid,key]);return r.rows[0]?.value??fallback;}
async function dueFor(oid,p){const h=Number(await setting(oid,`sla_${p}`,{low:72,medium:48,high:24,urgent:4}[p]));return new Date(Date.now()+Math.max(1,h)*3600000).toISOString();}
const canSee=(u,t)=>u.role!=='requester'||Number(t.requester_id)===Number(u.id);
function pickChanges(before,after,fields){
  const changes={};
  for(const field of fields){
    const a=before?.[field]??null,b=after?.[field]??null;
    if(String(a)!==String(b))changes[field]={from:a,to:b};
  }
  return changes;
}


// Pages
app.get('/',async(req,res)=>{const u=await loadUser(req);if(u)return res.redirect(u.is_super_admin?'/plataforma':'/dashboard');res.sendFile(page('index.html'));});
app.get('/apresentacao',(req,res)=>res.sendFile(page('apresentacao.html')));
app.get('/criar-conta',async(req,res)=>{const u=await loadUser(req);if(u)return res.redirect('/dashboard');res.sendFile(page('criar-conta.html'));});
for(const [url,file,roles] of [['/dashboard','dashboard.html',[]],['/chamados','chamados.html',[]],['/ativos','ativos.html',['admin','agent']],['/base-conhecimento','base-conhecimento.html',[]],['/relatorios','relatorios.html',['admin']],['/historico','historico.html',['admin','agent']],['/usuarios','usuarios.html',['admin']],['/assinatura','assinatura.html',[]],['/configuracoes','configuracoes.html',['admin']]])app.get(url,requireAuth,...(roles.length?[requireRole(...roles)]:[]),(req,res)=>res.sendFile(page(file)));
app.get('/plataforma',requireAuth,requireSuperAdmin,(req,res)=>res.sendFile(page('plataforma.html')));

// Auth + invitation-only signup
app.post('/api/auth/login',limiter,async(req,res)=>{const username=clean(req.body.username,60).toLowerCase(),password=String(req.body.password||''),r=await query('SELECT u.*,o.name organization_name,o.status organization_status FROM users u LEFT JOIN organizations o ON o.id=u.organization_id WHERE u.username=$1',[username]),u=r.rows[0];if(!u||!(await bcrypt.compare(password,u.password_hash)))return res.status(401).json({error:'UsuÃ¡rio ou senha invÃ¡lidos.'});if(u.status!=='active')return res.status(403).json({error:u.status==='pending'?'Sua conta aguarda aprovaÃ§Ã£o.':'Sua conta estÃ¡ bloqueada.'});if(!u.is_super_admin&&u.organization_status==='suspended')return res.status(403).json({error:'O acesso da empresa estÃ¡ suspenso.'});await query('UPDATE users SET last_login_at=NOW() WHERE id=$1',[u.id]);setAuthCookie(res,u);res.json({user:pub(u)});});
app.get('/api/public/invite/:token',async(req,res)=>{const r=await query(`SELECT i.email,i.role,i.expires_at,o.name organization_name FROM invitations i JOIN organizations o ON o.id=i.organization_id WHERE i.token=$1 AND i.used_at IS NULL AND i.expires_at>NOW() AND o.status!='suspended'`,[clean(req.params.token,96)]);if(!r.rowCount)return res.status(404).json({error:'Convite invÃ¡lido ou expirado.'});res.json({invite:r.rows[0]});});
app.post('/api/auth/register',limiter,async(req,res)=>{const token=clean(req.body.inviteToken,96),inv=(await query(`SELECT i.* FROM invitations i JOIN organizations o ON o.id=i.organization_id WHERE i.token=$1 AND i.used_at IS NULL AND i.expires_at>NOW() AND o.status!='suspended'`,[token])).rows[0];if(!inv)return res.status(400).json({error:'Cadastro permitido somente por convite vÃ¡lido.'});const name=clean(req.body.name,120),username=clean(req.body.username,60).toLowerCase(),email=clean(req.body.email,160)||inv.email||null,department=clean(req.body.department,100)||null,password=String(req.body.password||'');if(name.length<3||username.length<3||password.length<8)return res.status(400).json({error:'Preencha os dados e use senha de pelo menos 8 caracteres.'});if(!/^[a-z0-9._-]+$/.test(username))return res.status(400).json({error:'UsuÃ¡rio invÃ¡lido.'});if((await query('SELECT 1 FROM users WHERE username=$1',[username])).rowCount)return res.status(409).json({error:'Esse usuÃ¡rio jÃ¡ existe.'});const lim=(await query('SELECT user_limit FROM organizations WHERE id=$1',[inv.organization_id])).rows[0].user_limit,count=(await query("SELECT COUNT(*)::int n FROM users WHERE organization_id=$1 AND status!='blocked'",[inv.organization_id])).rows[0].n;if(count>=lim)return res.status(403).json({error:'A empresa atingiu o limite de usuÃ¡rios do plano.'});const r=await query("INSERT INTO users(organization_id,name,username,email,department,role,status,password_hash) VALUES($1,$2,$3,$4,$5,$6,'active',$7) RETURNING id",[inv.organization_id,name,username,email,department,inv.role,await bcrypt.hash(password,12)]);await query('UPDATE invitations SET used_at=NOW() WHERE id=$1',[inv.id]);res.status(201).json({message:'Conta criada. VocÃª jÃ¡ pode entrar.',id:Number(r.rows[0].id)});});
app.post('/api/auth/logout',requireAuth,async(req,res)=>{clearAuthCookie(res);res.json({ok:true});});
app.get('/api/me', requireAuth, (req, res) => {
  const user = pub(req.user);

  user.organizationStatus =
    req.user.organization_status || null;

  user.organizationPlan =
    req.user.organization_plan || null;

  user.organizationTrialDays =
    req.user.organization_trial_days || null;

  user.organizationTrialEndsAt =
    req.user.organization_trial_ends_at || null;

  user.organizationBillingStatus =
    req.user.organization_billing_status || null;

  user.organizationSubscriptionEndsAt =
    req.user.organization_subscription_ends_at || null;

  user.trialExpired =
    Boolean(req.user.trial_expired);

  user.subscriptionExpired =
    Boolean(req.user.subscription_expired);

  user.billingRequired =
    Boolean(req.user.billing_required);

  res.json({ user });
});
app.patch('/api/me',requireAuth,async(req,res)=>{const photo=req.body.photoData?String(req.body.photoData):null;if(photo&&(!photo.startsWith('data:image/')||photo.length>1500000))return res.status(400).json({error:'Foto invÃ¡lida.'});const r=await query('UPDATE users SET name=$1,email=$2,department=$3,photo_data=$4,updated_at=NOW() WHERE id=$5 RETURNING *',[clean(req.body.name,120),clean(req.body.email,160)||null,clean(req.body.department,100)||null,photo,req.user.id]);res.json({user:pub({...r.rows[0],organization_name:req.user.organization_name})});});
app.patch('/api/me/password',requireAuth,async(req,res)=>{const r=await query('SELECT password_hash FROM users WHERE id=$1',[req.user.id]),next=String(req.body.newPassword||'');if(next.length<8||!(await bcrypt.compare(String(req.body.currentPassword||''),r.rows[0].password_hash)))return res.status(400).json({error:'Senha atual incorreta ou nova senha invÃ¡lida.'});await query('UPDATE users SET password_hash=$1 WHERE id=$2',[await bcrypt.hash(next,12),req.user.id]);res.json({ok:true});});

// Tenant metadata
app.get('/api/meta',requireAuth,async(req,res)=>{const oid=tenant(req);await assertTenant(req);const [cats,deps,sets,org]=await Promise.all([query('SELECT id,name FROM categories WHERE organization_id=$1 AND active=true ORDER BY name',[oid]),query('SELECT id,name FROM departments WHERE organization_id=$1 AND active=true ORDER BY name',[oid]),query('SELECT key,value FROM organization_settings WHERE organization_id=$1',[oid]),query('SELECT name,plan,user_limit,status,logo_data,primary_color FROM organizations WHERE id=$1',[oid])]);const s=Object.fromEntries(sets.rows.map(x=>[x.key,x.value])),o=org.rows[0];res.json({categories:cats.rows,departments:deps.rows,brandName:s.brand_name||'Central de ServiÃ§os',companyName:s.company_name||o.name,tagline:s.brand_tagline||'Service Management & Support',supportEmail:s.support_email||'',organization:o});});
app.get('/api/users/agents',requireAuth,async(req,res)=>{const r=await query("SELECT id,name,photo_data FROM users WHERE organization_id=$1 AND status='active' AND role IN ('admin','agent') ORDER BY name",[tenant(req)]);res.json({users:r.rows.map(u=>({id:Number(u.id),name:u.name,photoData:u.photo_data||null}))});});
app.get('/api/users/active',requireAuth,requireRole('admin','agent'),async(req,res)=>{const r=await query("SELECT id,name,department,role FROM users WHERE organization_id=$1 AND status='active' ORDER BY name",[tenant(req)]);res.json({users:r.rows.map(u=>({...u,id:Number(u.id)}))});});

// Users + invitations
app.get('/api/users',requireAuth,requireRole('admin'),async(req,res)=>{const r=await query('SELECT * FROM users WHERE organization_id=$1 ORDER BY created_at DESC',[tenant(req)]);res.json({users:r.rows.map(pub)});});
app.post('/api/users',requireAuth,requireRole('admin'),async(req,res)=>{const oid=tenant(req),org=(await query('SELECT user_limit FROM organizations WHERE id=$1',[oid])).rows[0],count=(await query("SELECT COUNT(*)::int n FROM users WHERE organization_id=$1 AND status!='blocked'",[oid])).rows[0].n;if(count>=org.user_limit)return res.status(403).json({error:'Limite de usuÃ¡rios do plano atingido.'});const username=clean(req.body.username,60).toLowerCase(),password=String(req.body.password||''),role=['admin','agent','requester'].includes(req.body.role)?req.body.role:'requester',st=['active','pending','blocked'].includes(req.body.status)?req.body.status:'active';if(clean(req.body.name,120).length<3||username.length<3||password.length<8)return res.status(400).json({error:'Dados invÃ¡lidos.'});try{const r=await query('INSERT INTO users(organization_id,name,username,email,department,role,status,password_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',[oid,clean(req.body.name,120),username,clean(req.body.email,160)||null,clean(req.body.department,100)||null,role,st,await bcrypt.hash(password,12)]);await audit(req,'user_created','user',r.rows[0].id,{username});res.status(201).json({id:Number(r.rows[0].id)});}catch(e){if(e.code==='23505')return res.status(409).json({error:'UsuÃ¡rio jÃ¡ existe.'});throw e;}});
app.patch('/api/users/:id',requireAuth,requireRole('admin'),async(req,res)=>{const oid=tenant(req),id=Number(req.params.id),t=(await query('SELECT * FROM users WHERE id=$1 AND organization_id=$2',[id,oid])).rows[0];if(!t)return res.status(404).json({error:'UsuÃ¡rio nÃ£o encontrado.'});const role=['admin','agent','requester'].includes(req.body.role)?req.body.role:t.role,st=['active','pending','blocked'].includes(req.body.status)?req.body.status:t.status;if(id===Number(req.user.id)&&(role!=='admin'||st!=='active'))return res.status(400).json({error:'VocÃª nÃ£o pode remover seu prÃ³prio acesso.'});if(t.role==='admin'&&t.status==='active'&&(role!=='admin'||st!=='active')){const n=(await query("SELECT COUNT(*)::int n FROM users WHERE organization_id=$1 AND role='admin' AND status='active'",[oid])).rows[0].n;if(n<=1)return res.status(400).json({error:'Mantenha pelo menos um administrador ativo.'});}await query('UPDATE users SET name=$1,email=$2,department=$3,role=$4,status=$5,updated_at=NOW() WHERE id=$6 AND organization_id=$7',[clean(req.body.name??t.name,120),clean(req.body.email??t.email,160)||null,clean(req.body.department??t.department,100)||null,role,st,id,oid]);if(req.body.password){if(String(req.body.password).length<8)return res.status(400).json({error:'Senha muito curta.'});await query('UPDATE users SET password_hash=$1 WHERE id=$2 AND organization_id=$3',[await bcrypt.hash(String(req.body.password),12),id,oid]);}await audit(req,'user_updated','user',id,{role,status:st});res.json({ok:true});});
app.delete('/api/users/:id',requireAuth,requireRole('admin'),async(req,res)=>{const oid=tenant(req),id=Number(req.params.id);if(id===Number(req.user.id))return res.status(400).json({error:'VocÃª nÃ£o pode excluir sua conta.'});const linked=(await query('SELECT COUNT(*)::int n FROM tickets WHERE organization_id=$1 AND (requester_id=$2 OR assigned_to=$2)',[oid,id])).rows[0].n;if(linked)return res.status(400).json({error:'UsuÃ¡rio possui chamados. Bloqueie em vez de excluir.'});await query('DELETE FROM users WHERE id=$1 AND organization_id=$2',[id,oid]);res.json({ok:true});});
app.get('/api/invitations',requireAuth,requireRole('admin'),async(req,res)=>{const r=await query('SELECT * FROM invitations WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 50',[tenant(req)]);res.json({invitations:r.rows});});
app.post('/api/invitations',requireAuth,requireRole('admin'),async(req,res)=>{const oid=tenant(req),token=crypto.randomBytes(24).toString('hex'),role=['admin','agent','requester'].includes(req.body.role)?req.body.role:'requester',days=Math.max(1,Math.min(30,Number(req.body.days)||7));const r=await query("INSERT INTO invitations(organization_id,token,email,role,created_by,expires_at) VALUES($1,$2,$3,$4,$5,NOW()+($6||' days')::interval) RETURNING *",[oid,token,clean(req.body.email,160)||null,role,req.user.id,String(days)]);res.status(201).json({invitation:r.rows[0],url:`${req.protocol}://${req.get('host')}/criar-conta?invite=${token}`});});

// Tickets
app.get('/api/tickets',requireAuth,async(req,res)=>{const oid=tenant(req),args=[oid],where=['t.organization_id=$1'],q=clean(req.query.q,100);if(req.user.role==='requester'){args.push(req.user.id);where.push(`t.requester_id=$${args.length}`);}if(q){args.push(`%${q}%`);where.push(`(t.title ILIKE $${args.length} OR CAST(t.id AS TEXT) ILIKE $${args.length} OR r.name ILIKE $${args.length})`);}for(const [key,vals,col] of [['status',['open','progress','resolved','closed'],'status'],['priority',['low','medium','high','urgent'],'priority']])if(vals.includes(req.query[key])){args.push(req.query[key]);where.push(`t.${col}=$${args.length}`);}if(clean(req.query.category,80)){args.push(clean(req.query.category,80));where.push(`t.category=$${args.length}`);}if(req.query.overdue==='1')where.push("t.due_at<NOW() AND t.status NOT IN ('resolved','closed')");if(req.query.assigned==='me'){args.push(req.user.id);where.push(`t.assigned_to=$${args.length}`);}if(req.query.assigned==='unassigned')where.push('t.assigned_to IS NULL');const r=await query(`SELECT t.*,r.name requester_name,r.photo_data requester_photo,a.name assigned_name,a.photo_data assigned_photo,ast.asset_tag,ast.name asset_name FROM tickets t JOIN users r ON r.id=t.requester_id LEFT JOIN users a ON a.id=t.assigned_to LEFT JOIN assets ast ON ast.id=t.asset_id WHERE ${where.join(' AND ')} ORDER BY CASE t.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,t.created_at DESC LIMIT 500`,args);res.json({tickets:r.rows});});
app.post('/api/tickets',requireAuth,async(req,res)=>{const oid=tenant(req),title=clean(req.body.title,180),cat=clean(req.body.category,80),p=priority(req.body.priority),imp=impact(req.body.impact),desc=clean(req.body.description,5000),asset=req.body.assetId?Number(req.body.assetId):null;if(title.length<3||!cat||desc.length<5)return res.status(400).json({error:'Preencha tÃ­tulo, categoria e descriÃ§Ã£o.'});if(asset&&!(await query('SELECT 1 FROM assets WHERE id=$1 AND organization_id=$2',[asset,oid])).rowCount)return res.status(400).json({error:'Ativo invÃ¡lido.'});const due=await dueFor(oid,p),r=await query('INSERT INTO tickets(organization_id,title,category,priority,impact,description,requester_id,due_at,asset_id,location) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',[oid,title,cat,p,imp,desc,req.user.id,due,asset,clean(req.body.location,140)||null]),id=Number(r.rows[0].id);await event(req,id,'created',{priority:p,impact:imp});await audit(req,'ticket_created','ticket',id,{title,category:cat,priority:p,impact:imp});const agents=await query("SELECT id FROM users WHERE organization_id=$1 AND status='active' AND role IN ('admin','agent')",[oid]);for(const u of agents.rows)if(Number(u.id)!==Number(req.user.id))await notify(oid,u.id,id,`Novo chamado #${id}`,title);res.status(201).json({id});});
app.get('/api/tickets/:id',requireAuth,async(req,res)=>{const oid=tenant(req),id=Number(req.params.id),t=(await query('SELECT t.*,r.name requester_name,r.photo_data requester_photo,a.name assigned_name,a.photo_data assigned_photo,ast.asset_tag,ast.name asset_name,ast.model asset_model FROM tickets t JOIN users r ON r.id=t.requester_id LEFT JOIN users a ON a.id=t.assigned_to LEFT JOIN assets ast ON ast.id=t.asset_id WHERE t.id=$1 AND t.organization_id=$2',[id,oid])).rows[0];if(!t||!canSee(req.user,t))return res.status(404).json({error:'Chamado nÃ£o encontrado.'});const [c,e,a]=await Promise.all([query('SELECT c.*,u.name author_name,u.photo_data author_photo,u.role author_role FROM comments c JOIN users u ON u.id=c.author_id WHERE c.ticket_id=$1 AND c.organization_id=$2 ORDER BY c.created_at',[id,oid]),query('SELECT e.*,u.name actor_name FROM ticket_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.ticket_id=$1 AND e.organization_id=$2 ORDER BY e.created_at DESC LIMIT 100',[id,oid]),query('SELECT id,file_name,mime_type,size_bytes,created_at FROM attachments WHERE ticket_id=$1 AND organization_id=$2 ORDER BY created_at DESC',[id,oid])]);res.json({ticket:t,comments:c.rows,events:e.rows,attachments:a.rows});});
app.patch('/api/tickets/:id',requireAuth,requireRole('admin','agent'),async(req,res)=>{const oid=tenant(req),id=Number(req.params.id),t=(await query('SELECT * FROM tickets WHERE id=$1 AND organization_id=$2',[id,oid])).rows[0];if(!t)return res.status(404).json({error:'Chamado nÃ£o encontrado.'});const st=status(req.body.status??t.status),p=priority(req.body.priority??t.priority),imp=impact(req.body.impact??t.impact),assigned=req.body.assignedTo?Number(req.body.assignedTo):null,asset=req.body.assetId?Number(req.body.assetId):null;if(assigned&&!(await query("SELECT 1 FROM users WHERE id=$1 AND organization_id=$2 AND status='active'",[assigned,oid])).rowCount)return res.status(400).json({error:'ResponsÃ¡vel invÃ¡lido.'});const due=p!==t.priority?await dueFor(oid,p):t.due_at,resolved=['resolved','closed'].includes(st)?(t.resolved_at||new Date().toISOString()):null;const nextLocation=clean(req.body.location??t.location,140)||null;await query('UPDATE tickets SET status=$1,priority=$2,impact=$3,assigned_to=$4,asset_id=$5,location=$6,due_at=$7,resolved_at=$8,updated_at=NOW() WHERE id=$9 AND organization_id=$10',[st,p,imp,assigned,asset,nextLocation,due,resolved,id,oid]);await audit(req,'ticket_updated','ticket',id,{changes:pickChanges(t,{...t,status:st,priority:p,impact:imp,assigned_to:assigned,asset_id:asset,location:nextLocation},['status','priority','impact','assigned_to','asset_id','location'])});await event(req,id,'updated',{status:st,priority:p});await notify(oid,t.requester_id,id,`Chamado #${id} atualizado`,'O chamado recebeu uma atualizaÃ§Ã£o.');res.json({ok:true});});
app.delete('/api/tickets/:id',requireAuth,requireRole('admin'),async(req,res)=>{const oid=tenant(req),id=Number(req.params.id),t=(await query('SELECT title,status,priority FROM tickets WHERE id=$1 AND organization_id=$2',[id,oid])).rows[0];await query('DELETE FROM tickets WHERE id=$1 AND organization_id=$2',[id,oid]);await audit(req,'ticket_deleted','ticket',id,t||{});res.json({ok:true});});
app.post('/api/tickets/:id/comments',requireAuth,async(req,res)=>{const oid=tenant(req),id=Number(req.params.id),t=(await query('SELECT * FROM tickets WHERE id=$1 AND organization_id=$2',[id,oid])).rows[0],body=clean(req.body.body,3000);if(!t||!canSee(req.user,t))return res.status(404).json({error:'Chamado nÃ£o encontrado.'});if(body.length<2)return res.status(400).json({error:'ComentÃ¡rio muito curto.'});await query('INSERT INTO comments(organization_id,ticket_id,author_id,body) VALUES($1,$2,$3,$4)',[oid,id,req.user.id,body]);if(req.user.role!=='requester'&&!t.first_response_at)await query('UPDATE tickets SET first_response_at=NOW() WHERE id=$1 AND organization_id=$2',[id,oid]);await event(req,id,'commented');await audit(req,'ticket_comment_added','ticket',id,{preview:body.slice(0,180)});res.status(201).json({ok:true});});
app.post('/api/tickets/:id/attachments',requireAuth,async(req,res)=>{const oid=tenant(req),id=Number(req.params.id),t=(await query('SELECT * FROM tickets WHERE id=$1 AND organization_id=$2',[id,oid])).rows[0],data=String(req.body.data||'');if(!t||!canSee(req.user,t))return res.status(404).json({error:'Chamado nÃ£o encontrado.'});if(!data.startsWith('data:')||data.length>1500000)return res.status(400).json({error:'Arquivo invÃ¡lido ou muito grande.'});const r=await query('INSERT INTO attachments(organization_id,ticket_id,uploaded_by,file_name,mime_type,file_data,size_bytes) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[oid,id,req.user.id,clean(req.body.fileName,180),clean(req.body.mimeType,120)||'application/octet-stream',data,Math.round(data.length*.75)]);res.status(201).json({id:Number(r.rows[0].id)});});
app.get('/api/attachments/:id',requireAuth,async(req,res)=>{const oid=tenant(req),a=(await query('SELECT a.*,t.requester_id FROM attachments a JOIN tickets t ON t.id=a.ticket_id WHERE a.id=$1 AND a.organization_id=$2',[Number(req.params.id),oid])).rows[0];if(!a||!canSee(req.user,a))return res.status(404).json({error:'Arquivo nÃ£o encontrado.'});res.json({fileName:a.file_name,mimeType:a.mime_type,data:a.file_data});});

// Assets
app.get('/api/assets',requireAuth,requireRole('admin','agent'),async(req,res)=>{const oid=tenant(req),q=clean(req.query.q,100),args=[oid],extra=q?(args.push(`%${q}%`),`AND (a.asset_tag ILIKE $2 OR a.name ILIKE $2 OR a.model ILIKE $2 OR a.serial_number ILIKE $2)`):'';const r=await query(`SELECT a.*,u.name assigned_user_name,(SELECT COUNT(*)::int FROM tickets t WHERE t.asset_id=a.id AND t.organization_id=$1) ticket_count FROM assets a LEFT JOIN users u ON u.id=a.assigned_user_id WHERE a.organization_id=$1 ${extra} ORDER BY a.updated_at DESC LIMIT 500`,args);res.json({assets:r.rows});});
app.post('/api/assets',requireAuth,requireRole('admin','agent'),async(req,res)=>{const oid=tenant(req),tag=clean(req.body.assetTag,60),name=clean(req.body.name,140);if(!tag||!name)return res.status(400).json({error:'PatrimÃ´nio e nome sÃ£o obrigatÃ³rios.'});try{const r=await query('INSERT INTO assets(organization_id,asset_tag,name,asset_type,manufacturer,model,serial_number,status,assigned_user_id,department,location,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id',[oid,tag,name,clean(req.body.assetType,80)||'Equipamento',clean(req.body.manufacturer,100)||null,clean(req.body.model,120)||null,clean(req.body.serialNumber,120)||null,['active','maintenance','stock','retired'].includes(req.body.status)?req.body.status:'active',req.body.assignedUserId?Number(req.body.assignedUserId):null,clean(req.body.department,100)||null,clean(req.body.location,140)||null,clean(req.body.notes,2000)||null]);const id=Number(r.rows[0].id);await audit(req,'asset_created','asset',id,{assetTag:tag,name});res.status(201).json({id});}catch(e){if(e.code==='23505')return res.status(409).json({error:'PatrimÃ´nio jÃ¡ existe nesta empresa.'});throw e;}});
app.patch('/api/assets/:id',requireAuth,requireRole('admin','agent'),async(req,res)=>{const oid=tenant(req),id=Number(req.params.id),o=(await query('SELECT * FROM assets WHERE id=$1 AND organization_id=$2',[id,oid])).rows[0];if(!o)return res.status(404).json({error:'Ativo nÃ£o encontrado.'});const next={asset_tag:clean(req.body.assetTag??o.asset_tag,60),name:clean(req.body.name??o.name,140),asset_type:clean(req.body.assetType??o.asset_type,80),manufacturer:clean(req.body.manufacturer??o.manufacturer,100)||null,model:clean(req.body.model??o.model,120)||null,serial_number:clean(req.body.serialNumber??o.serial_number,120)||null,status:['active','maintenance','stock','retired'].includes(req.body.status)?req.body.status:o.status,assigned_user_id:req.body.assignedUserId?Number(req.body.assignedUserId):null,department:clean(req.body.department??o.department,100)||null,location:clean(req.body.location??o.location,140)||null,notes:clean(req.body.notes??o.notes,2000)||null};await query('UPDATE assets SET asset_tag=$1,name=$2,asset_type=$3,manufacturer=$4,model=$5,serial_number=$6,status=$7,assigned_user_id=$8,department=$9,location=$10,notes=$11,updated_at=NOW() WHERE id=$12 AND organization_id=$13',[next.asset_tag,next.name,next.asset_type,next.manufacturer,next.model,next.serial_number,next.status,next.assigned_user_id,next.department,next.location,next.notes,id,oid]);await audit(req,'asset_updated','asset',id,{changes:pickChanges(o,{...o,...next},['asset_tag','name','asset_type','manufacturer','model','serial_number','status','assigned_user_id','department','location'])});res.json({ok:true});});
app.delete('/api/assets/:id',requireAuth,requireRole('admin'),async(req,res)=>{const oid=tenant(req),id=Number(req.params.id),a=(await query('SELECT asset_tag,name,status FROM assets WHERE id=$1 AND organization_id=$2',[id,oid])).rows[0];await query('UPDATE tickets SET asset_id=NULL WHERE asset_id=$1 AND organization_id=$2',[id,oid]);await query('DELETE FROM assets WHERE id=$1 AND organization_id=$2',[id,oid]);await audit(req,'asset_deleted','asset',id,a||{});res.json({ok:true});});

// Knowledge
app.get('/api/knowledge',requireAuth,async(req,res)=>{const oid=tenant(req),args=[oid],where=['k.organization_id=$1'];if(req.user.role!=='admin'&&!req.user.is_super_admin)where.push('k.published=true');const q=clean(req.query.q,100);if(q){args.push(`%${q}%`);where.push(`(k.title ILIKE $2 OR k.summary ILIKE $2 OR k.content ILIKE $2)`);}const r=await query(`SELECT k.*,u.name author_name FROM knowledge_articles k LEFT JOIN users u ON u.id=k.author_id WHERE ${where.join(' AND ')} ORDER BY k.updated_at DESC LIMIT 200`,args);res.json({articles:r.rows});});
app.get('/api/knowledge/:id',requireAuth,async(req,res)=>{const oid=tenant(req),a=(await query('SELECT k.*,u.name author_name FROM knowledge_articles k LEFT JOIN users u ON u.id=k.author_id WHERE k.id=$1 AND k.organization_id=$2',[Number(req.params.id),oid])).rows[0];if(!a||(!a.published&&req.user.role!=='admin'&&!req.user.is_super_admin))return res.status(404).json({error:'Artigo nÃ£o encontrado.'});await query('UPDATE knowledge_articles SET views=views+1 WHERE id=$1 AND organization_id=$2',[a.id,oid]);res.json({article:a});});
app.post('/api/knowledge',requireAuth,requireRole('admin'),async(req,res)=>{const oid=tenant(req),title=clean(req.body.title,180),content=clean(req.body.content,12000);if(title.length<3||content.length<20)return res.status(400).json({error:'TÃ­tulo e conteÃºdo sÃ£o obrigatÃ³rios.'});const r=await query('INSERT INTO knowledge_articles(organization_id,title,summary,category,content,published,author_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[oid,title,clean(req.body.summary,320)||null,clean(req.body.category,80)||null,content,req.body.published!==false,req.user.id]);const id=Number(r.rows[0].id);await audit(req,'knowledge_created','knowledge',id,{title});res.status(201).json({id});});
app.patch('/api/knowledge/:id',requireAuth,requireRole('admin'),async(req,res)=>{const oid=tenant(req),id=Number(req.params.id),o=(await query('SELECT * FROM knowledge_articles WHERE id=$1 AND organization_id=$2',[id,oid])).rows[0];if(!o)return res.status(404).json({error:'Artigo nÃ£o encontrado.'});const next={title:clean(req.body.title??o.title,180),summary:clean(req.body.summary??o.summary,320)||null,category:clean(req.body.category??o.category,80)||null,content:clean(req.body.content??o.content,12000),published:req.body.published===undefined?o.published:Boolean(req.body.published)};await query('UPDATE knowledge_articles SET title=$1,summary=$2,category=$3,content=$4,published=$5,updated_at=NOW() WHERE id=$6 AND organization_id=$7',[next.title,next.summary,next.category,next.content,next.published,id,oid]);await audit(req,'knowledge_updated','knowledge',id,{changes:pickChanges(o,{...o,...next},['title','summary','category','published'])});res.json({ok:true});});
app.delete('/api/knowledge/:id',requireAuth,requireRole('admin'),async(req,res)=>{const oid=tenant(req),id=Number(req.params.id),a=(await query('SELECT title,category FROM knowledge_articles WHERE id=$1 AND organization_id=$2',[id,oid])).rows[0];await query('DELETE FROM knowledge_articles WHERE id=$1 AND organization_id=$2',[id,oid]);await audit(req,'knowledge_deleted','knowledge',id,a||{});res.json({ok:true});});

// Notifications / Dashboard / Reports
app.get('/api/notifications',requireAuth,async(req,res)=>{const r=await query('SELECT * FROM notifications WHERE organization_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 30',[tenant(req),req.user.id]);res.json({notifications:r.rows,unread:r.rows.filter(x=>!x.is_read).length});});
app.patch('/api/notifications/:id/read',requireAuth,async(req,res)=>{await query('UPDATE notifications SET is_read=true WHERE id=$1 AND organization_id=$2 AND user_id=$3',[Number(req.params.id),tenant(req),req.user.id]);res.json({ok:true});});
app.post('/api/notifications/read-all',requireAuth,async(req,res)=>{await query('UPDATE notifications SET is_read=true WHERE organization_id=$1 AND user_id=$2',[tenant(req),req.user.id]);res.json({ok:true});});
app.get('/api/dashboard',requireAuth,async(req,res)=>{const oid=tenant(req),requester=req.user.role==='requester',args=requester?[oid,req.user.id]:[oid],where=requester?'organization_id=$1 AND requester_id=$2':'organization_id=$1';const k=(await query(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE status='open')::int open,COUNT(*) FILTER(WHERE status='progress')::int progress,COUNT(*) FILTER(WHERE priority='urgent' AND status NOT IN ('resolved','closed'))::int urgent,COUNT(*) FILTER(WHERE assigned_to IS NULL AND status NOT IN ('resolved','closed'))::int unassigned,COUNT(*) FILTER(WHERE due_at<NOW() AND status NOT IN ('resolved','closed'))::int overdue,COUNT(*) FILTER(WHERE resolved_at::date=CURRENT_DATE)::int resolved_today,ROUND(COALESCE(AVG(EXTRACT(EPOCH FROM(resolved_at-created_at))/3600) FILTER(WHERE resolved_at IS NOT NULL),0)::numeric,1) avg_hours,ROUND(COALESCE(AVG(EXTRACT(EPOCH FROM(first_response_at-created_at))/60) FILTER(WHERE first_response_at IS NOT NULL),0)::numeric,0) avg_first_response_min FROM tickets WHERE ${where}`,args)).rows[0];const recent=(await query(`SELECT t.id,t.title,t.status,t.priority,t.due_at,t.created_at,a.name assigned_name FROM tickets t LEFT JOIN users a ON a.id=t.assigned_to WHERE t.${where} ORDER BY t.created_at DESC LIMIT 8`,args)).rows;let workload=[],health={sla_compliance:100,active_agents:0,assets:0,articles:0};if(!requester){workload=(await query("SELECT u.name,COUNT(t.id)::int total FROM users u LEFT JOIN tickets t ON t.assigned_to=u.id AND t.organization_id=$1 AND t.status NOT IN ('resolved','closed') WHERE u.organization_id=$1 AND u.role IN ('admin','agent') AND u.status='active' GROUP BY u.id,u.name ORDER BY total DESC",[oid])).rows;health=(await query("SELECT ROUND(COALESCE(100.0*COUNT(*) FILTER(WHERE resolved_at IS NOT NULL AND resolved_at<=due_at)/NULLIF(COUNT(*) FILTER(WHERE resolved_at IS NOT NULL),0),100)::numeric,1) sla_compliance,(SELECT COUNT(*)::int FROM users WHERE organization_id=$1 AND role IN ('admin','agent') AND status='active') active_agents,(SELECT COUNT(*)::int FROM assets WHERE organization_id=$1 AND status!='retired') assets,(SELECT COUNT(*)::int FROM knowledge_articles WHERE organization_id=$1 AND published=true) articles FROM tickets WHERE organization_id=$1",[oid])).rows[0];}res.json({kpis:k,recent,workload,health});});
app.get('/api/reports',requireAuth,requireRole('admin'),async(req,res)=>{const oid=tenant(req),k=(await query("SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE status='open')::int open,COUNT(*) FILTER(WHERE status='progress')::int progress,COUNT(*) FILTER(WHERE status IN ('resolved','closed'))::int finished,COUNT(*) FILTER(WHERE due_at<NOW() AND status NOT IN ('resolved','closed'))::int overdue,ROUND(COALESCE(AVG(EXTRACT(EPOCH FROM(resolved_at-created_at))/3600) FILTER(WHERE resolved_at IS NOT NULL),0)::numeric,1) avg_hours,ROUND(COALESCE(AVG(EXTRACT(EPOCH FROM(first_response_at-created_at))/60) FILTER(WHERE first_response_at IS NOT NULL),0)::numeric,0) avg_first_response_min,ROUND(COALESCE(100.0*COUNT(*) FILTER(WHERE resolved_at IS NOT NULL AND resolved_at<=due_at)/NULLIF(COUNT(*) FILTER(WHERE resolved_at IS NOT NULL),0),0)::numeric,1) sla_compliance FROM tickets WHERE organization_id=$1",[oid])).rows[0],group=async col=>(await query(`SELECT ${col},COUNT(*)::int total FROM tickets WHERE organization_id=$1 GROUP BY ${col} ORDER BY total DESC`,[oid])).rows,agents=(await query("SELECT COALESCE(u.name,'NÃ£o atribuÃ­do') name,COUNT(*)::int total,COUNT(*) FILTER(WHERE t.status IN ('resolved','closed'))::int finished FROM tickets t LEFT JOIN users u ON u.id=t.assigned_to WHERE t.organization_id=$1 GROUP BY u.name ORDER BY total DESC",[oid])).rows,daily=(await query("SELECT TO_CHAR(d,'DD/MM') day,COUNT(t.id)::int total FROM generate_series(CURRENT_DATE-INTERVAL '13 days',CURRENT_DATE,INTERVAL '1 day') d LEFT JOIN tickets t ON t.created_at::date=d::date AND t.organization_id=$1 GROUP BY d ORDER BY d",[oid])).rows,aging=(await query("SELECT COUNT(*) FILTER(WHERE status NOT IN ('resolved','closed') AND NOW()-created_at<INTERVAL '24 hours')::int under24,COUNT(*) FILTER(WHERE status NOT IN ('resolved','closed') AND NOW()-created_at BETWEEN INTERVAL '24 hours' AND INTERVAL '72 hours')::int h24_72,COUNT(*) FILTER(WHERE status NOT IN ('resolved','closed') AND NOW()-created_at>INTERVAL '72 hours')::int over72 FROM tickets WHERE organization_id=$1",[oid])).rows[0];res.json({kpis:k,status:await group('status'),priority:await group('priority'),category:await group('category'),impact:await group('impact'),agents,daily,aging});});
app.get('/api/audit',requireAuth,requireRole('admin'),async(req,res)=>{const r=await query('SELECT a.*,u.name actor_name FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id WHERE a.organization_id=$1 ORDER BY a.created_at DESC LIMIT 120',[tenant(req)]);res.json({logs:r.rows});});

// V9 - HistÃ³rico de atividades da empresa
app.get('/api/activity',requireAuth,requireRole('admin','agent'),async(req,res)=>{
  const oid=tenant(req),args=[oid],where=['a.organization_id=$1'];
  const action=clean(req.query.action,80),type=clean(req.query.type,40),q=clean(req.query.q,120);
  const actor=Number(req.query.actor||0),from=clean(req.query.from,20),to=clean(req.query.to,20);
  if(action){args.push(action);where.push(`a.action=$${args.length}`);}
  if(type){args.push(type);where.push(`a.target_type=$${args.length}`);}
  if(actor>0){args.push(actor);where.push(`a.actor_id=$${args.length}`);}
  if(from){args.push(from);where.push(`a.created_at >= $${args.length}::date`);}
  if(to){args.push(to);where.push(`a.created_at < ($${args.length}::date + INTERVAL '1 day')`);}
  if(q){args.push(`%${q}%`);where.push(`(COALESCE(u.name,'Sistema') ILIKE $${args.length} OR a.action ILIKE $${args.length} OR a.target_type ILIKE $${args.length} OR CAST(a.target_id AS TEXT) ILIKE $${args.length} OR a.details::text ILIKE $${args.length})`);}
  const logs=(await query(`SELECT a.*,COALESCE(u.name,'Sistema') actor_name,u.username actor_username FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id WHERE ${where.join(' AND ')} ORDER BY a.created_at DESC LIMIT 300`,args)).rows;
  const actors=(await query("SELECT id,name FROM users WHERE organization_id=$1 ORDER BY name",[oid])).rows;
  res.json({logs,actors});
});


// Tenant configuration
app.get('/api/config',requireAuth,requireRole('admin'),async(req,res)=>{const oid=tenant(req),[c,d,s,o]=await Promise.all([query('SELECT * FROM categories WHERE organization_id=$1 ORDER BY name',[oid]),query('SELECT * FROM departments WHERE organization_id=$1 ORDER BY name',[oid]),query('SELECT key,value FROM organization_settings WHERE organization_id=$1',[oid]),query('SELECT * FROM organizations WHERE id=$1',[oid])]);res.json({categories:c.rows,departments:d.rows,settings:Object.fromEntries(s.rows.map(x=>[x.key,x.value])),organization:o.rows[0]});});
app.post('/api/config/categories',requireAuth,requireRole('admin'),async(req,res)=>{try{await query('INSERT INTO categories(organization_id,name) VALUES($1,$2)',[tenant(req),clean(req.body.name,80)]);res.status(201).json({ok:true});}catch(e){if(e.code==='23505')return res.status(409).json({error:'Categoria jÃ¡ existe.'});throw e;}});
app.patch('/api/config/categories/:id',requireAuth,requireRole('admin'),async(req,res)=>{await query('UPDATE categories SET name=$1,active=$2 WHERE id=$3 AND organization_id=$4',[clean(req.body.name,80),Boolean(req.body.active),Number(req.params.id),tenant(req)]);res.json({ok:true});});
app.post('/api/config/departments',requireAuth,requireRole('admin'),async(req,res)=>{try{await query('INSERT INTO departments(organization_id,name) VALUES($1,$2)',[tenant(req),clean(req.body.name,100)]);res.status(201).json({ok:true});}catch(e){if(e.code==='23505')return res.status(409).json({error:'Setor jÃ¡ existe.'});throw e;}});
app.patch('/api/config/departments/:id',requireAuth,requireRole('admin'),async(req,res)=>{await query('UPDATE departments SET name=$1,active=$2 WHERE id=$3 AND organization_id=$4',[clean(req.body.name,100),Boolean(req.body.active),Number(req.params.id),tenant(req)]);res.json({ok:true});});
app.patch('/api/config/settings',requireAuth,requireRole('admin'),async(req,res)=>{const oid=tenant(req),allowed=['brand_name','company_name','brand_tagline','support_email','sla_low','sla_medium','sla_high','sla_urgent','primary_color','brand_logo'];for(const key of allowed)if(req.body[key]!==undefined){let v=clean(req.body[key],160);if(key.startsWith('sla_'))v=String(Math.max(1,Math.min(720,Number(v)||1)));if(key==='primary_color'&&!/^#[0-9a-fA-F]{6}$/.test(v))v='#56d4c4';await query('INSERT INTO organization_settings(organization_id,key,value,updated_at) VALUES($1,$2,$3,NOW()) ON CONFLICT(organization_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()',[oid,key,v]);if(key==='primary_color')await query('UPDATE organizations SET primary_color=$1,updated_at=NOW() WHERE id=$2',[v,oid]);}await audit(req,'settings_updated','settings',oid,{keys:Object.keys(req.body||{})});res.json({ok:true});});

// SaaS Platform / Super Admin
app.get('/api/platform/plans',requireAuth,requireSuperAdmin,(req,res)=>res.json({plans:[
  {id:'start',name:'Start',price:14900,userLimit:5,features:['Chamados e SLA','Base de conhecimento','AtÃ© 5 usuÃ¡rios']},
  {id:'business',name:'Business',price:29900,userLimit:20,features:['Tudo do Start','Ativos / CMDB','RelatÃ³rios e auditoria','AtÃ© 20 usuÃ¡rios']},
  {id:'pro',name:'Pro',price:49900,userLimit:50,features:['Tudo do Business','OperaÃ§Ã£o avanÃ§ada','Prioridade de suporte','AtÃ© 50 usuÃ¡rios']}
]}));
app.get('/api/platform/organizations',requireAuth,requireSuperAdmin,async(req,res)=>{const r=await query(`SELECT o.*,COUNT(DISTINCT u.id)::int users,COUNT(DISTINCT t.id)::int tickets,COUNT(DISTINCT t.id) FILTER(WHERE t.status NOT IN ('resolved','closed'))::int backlog,MAX(u.last_login_at) last_activity_at FROM organizations o LEFT JOIN users u ON u.organization_id=o.id LEFT JOIN tickets t ON t.organization_id=o.id GROUP BY o.id ORDER BY o.created_at DESC`);res.json({organizations:r.rows});});
app.get('/api/platform/summary',requireAuth,requireSuperAdmin,async(req,res)=>{const r=(await query(`SELECT (SELECT COUNT(*)::int FROM organizations) organizations,(SELECT COUNT(*)::int FROM organizations WHERE status='active') active,(SELECT COUNT(*)::int FROM organizations WHERE status='trial') trials,(SELECT COUNT(*)::int FROM organizations WHERE status='suspended') suspended,(SELECT COUNT(*)::int FROM users WHERE status='active') users,(SELECT COUNT(*)::int FROM tickets) tickets,(SELECT COUNT(*)::int FROM tickets WHERE status NOT IN ('resolved','closed')) backlog`)).rows[0];const prices={start:14900,business:29900,pro:49900};const plans=(await query("SELECT plan,COUNT(*)::int n FROM organizations WHERE status='active' GROUP BY plan")).rows;r.mrr_cents=plans.reduce((sum,x)=>sum+(prices[x.plan]||0)*Number(x.n),0);res.json(r);});
app.post('/api/platform/organizations',requireAuth,requireSuperAdmin,async(req,res)=>{const name=clean(req.body.name,160),slug=clean(req.body.slug,80).toLowerCase().replace(/[^a-z0-9-]/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,''),plan=['start','business','pro'].includes(req.body.plan)?req.body.plan:'start',defaults={start:5,business:20,pro:50},limit=Math.max(1,Math.min(1000,Number(req.body.userLimit)||defaults[plan])),trialDays=Math.max(0,Math.min(90,Number(req.body.trialDays)||0)),adminName=clean(req.body.adminName,120),username=clean(req.body.adminUsername,60).toLowerCase(),password=String(req.body.adminPassword||''),billingEmail=clean(req.body.billingEmail,160)||null,contactName=clean(req.body.contactName,120)||null,contactPhone=clean(req.body.contactPhone,40)||null,notes=clean(req.body.commercialNotes,3000)||null;if(name.length<2||slug.length<2||adminName.length<3||username.length<3||password.length<8)return res.status(400).json({error:'Preencha empresa e administrador corretamente.'});if(!/^[a-z0-9._-]+$/.test(username))return res.status(400).json({error:'UsuÃ¡rio do administrador invÃ¡lido.'});try{const status=trialDays>0?'trial':'active',trialEnds=trialDays>0?new Date(Date.now()+trialDays*86400000).toISOString():null;const o=(await query("INSERT INTO organizations(name,slug,status,plan,user_limit,trial_days,trial_ends_at,billing_email,contact_name,contact_phone,commercial_notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",[name,slug,status,plan,limit,trialDays,trialEnds,billingEmail,contactName,contactPhone,notes])).rows[0];for(const [k,v] of Object.entries({brand_name:'Central de ServiÃ§os',company_name:name,brand_tagline:'Service Management & Support',support_email:billingEmail||'',primary_color:'#56d4c4',sla_low:'72',sla_medium:'48',sla_high:'24',sla_urgent:'4'}))await query('INSERT INTO organization_settings(organization_id,key,value) VALUES($1,$2,$3)',[o.id,k,v]);for(const c of ['Hardware','Software','Rede','Acesso','SeguranÃ§a','Outro'])await query('INSERT INTO categories(organization_id,name) VALUES($1,$2)',[o.id,c]);for(const d of ['AdministraÃ§Ã£o','TI','Financeiro','RH','OperaÃ§Ã£o','Comercial'])await query('INSERT INTO departments(organization_id,name) VALUES($1,$2)',[o.id,d]);const u=(await query("INSERT INTO users(organization_id,name,username,email,department,role,status,password_hash) VALUES($1,$2,$3,$4,'AdministraÃ§Ã£o','admin','active',$5) RETURNING id",[o.id,adminName,username,clean(req.body.adminEmail,160)||billingEmail,await bcrypt.hash(password,12)])).rows[0];await query('INSERT INTO audit_logs(organization_id,actor_id,action,target_type,target_id,details) VALUES($1,$2,$3,$4,$5,$6)',[o.id,req.user.id,'organization_created','organization',o.id,JSON.stringify({plan,status,trialDays})]);res.status(201).json({organizationId:Number(o.id),adminId:Number(u.id),status,trialEnds});}catch(e){if(e.code==='23505')return res.status(409).json({error:'Slug ou usuÃ¡rio jÃ¡ estÃ¡ em uso.'});throw e;}});
app.patch('/api/platform/organizations/:id',requireAuth,requireSuperAdmin,async(req,res)=>{const id=Number(req.params.id),o=(await query('SELECT * FROM organizations WHERE id=$1',[id])).rows[0];if(!o)return res.status(404).json({error:'Empresa nÃ£o encontrada.'});const st=['active','trial','suspended'].includes(req.body.status)?req.body.status:o.status,plan=['start','business','pro'].includes(req.body.plan)?req.body.plan:o.plan,limit=Math.max(1,Math.min(1000,Number(req.body.userLimit)||o.user_limit)),trialDays=Math.max(0,Math.min(90,Number(req.body.trialDays??o.trial_days)||0)),trialEnds=req.body.trialEndsAt?new Date(req.body.trialEndsAt).toISOString():o.trial_ends_at,subEnds=req.body.subscriptionEndsAt?new Date(req.body.subscriptionEndsAt).toISOString():null;await query('UPDATE organizations SET name=$1,status=$2,plan=$3,user_limit=$4,trial_days=$5,trial_ends_at=$6,subscription_ends_at=$7,billing_email=$8,contact_name=$9,contact_phone=$10,commercial_notes=$11,updated_at=NOW() WHERE id=$12',[clean(req.body.name??o.name,160),st,plan,limit,trialDays,trialEnds,subEnds,clean(req.body.billingEmail??o.billing_email,160)||null,clean(req.body.contactName??o.contact_name,120)||null,clean(req.body.contactPhone??o.contact_phone,40)||null,clean(req.body.commercialNotes??o.commercial_notes,3000)||null,id]);res.json({ok:true});});
/* ============================================
   BILLING / MERCADO PAGO
   ============================================ */

const BILLING_PLANS = {
  start: {
    id: 'start',
    name: 'Start',
    price: 1,
    priceCents: 100,
    userLimit: 5
  },
  business: {
    id: 'business',
    name: 'Business',
    price: 299,
    priceCents: 29900,
    userLimit: 20
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 499,
    priceCents: 49900,
    userLimit: 50
  }
};

function mercadoPagoAccessToken() {
  const mode = String(process.env.MP_MODE || 'production').toLowerCase();
  const token = mode === 'test'
    ? process.env.MP_TEST_ACCESS_TOKEN
    : process.env.MP_ACCESS_TOKEN;

  if (!token) {
    const error = new Error(
      mode === 'test'
        ? 'MP_TEST_ACCESS_TOKEN nÃ£o configurado.'
        : 'MP_ACCESS_TOKEN nÃ£o configurado.'
    );
    error.status = 503;
    throw error;
  }
  return token;
}

async function mercadoPagoRequest(apiPath, options = {}) {
  const accessToken = mercadoPagoAccessToken();

  const response = await fetch(
    `https://api.mercadopago.com${apiPath}`,
    {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error(
      'Erro Mercado Pago:',
      response.status,
      JSON.stringify(data)
    );

    const error = new Error(
      data.message ||
      data.error ||
      'Erro na comunicaÃ§Ã£o com o Mercado Pago.'
    );

    error.status = 502;
    throw error;
  }

  return data;
}



/* --------------------------------------------
   V9 - VISÃƒO LOCAL DA ASSINATURA
   -------------------------------------------- */
app.get('/api/billing/overview',requireAuth,async(req,res)=>{
  const oid=tenant(req);
  const org=(await query(`SELECT id,name,status,plan,user_limit,trial_days,trial_ends_at,billing_email,billing_status,mp_subscription_id,billing_updated_at,last_payment_at,next_payment_at,subscription_ends_at,created_at FROM organizations WHERE id=$1`,[oid])).rows[0];
  if(!org)return res.status(404).json({error:'Empresa nÃ£o encontrada.'});
  const users=(await query("SELECT COUNT(*)::int n FROM users WHERE organization_id=$1 AND status!='blocked'",[oid])).rows[0].n;
  const trialEnd=org.trial_ends_at?new Date(org.trial_ends_at):null;
  const trialRemaining=trialEnd?Math.max(0,Math.ceil((trialEnd.getTime()-Date.now())/86400000)):null;
  res.json({organization:org,usersUsed:users,trialDaysRemaining:trialRemaining,plans:Object.values(BILLING_PLANS)});
});

/* --------------------------------------------
   LISTAR PLANOS
   -------------------------------------------- */

app.get(
  '/api/billing/plans',
  requireAuth,
  (req, res) => {
    res.json({
      currency: 'BRL',
      frequency: 1,
      frequencyType: 'months',
      plans: Object.values(BILLING_PLANS)
    });
  }
);


/* --------------------------------------------
   CRIAR ASSINATURA
   -------------------------------------------- */

app.post(
  '/api/billing/subscribe',
  requireAuth,
  requireRole('admin'),
  async (req, res) => {
    const organizationId = tenant(req);

    const planId = clean(
      req.body.plan,
      30
    ).toLowerCase();

    const plan = BILLING_PLANS[planId];

    if (!plan) {
      return res.status(400).json({
        error: 'Plano invÃ¡lido.'
      });
    }

    const organization = (
      await query(
        `
        SELECT *
        FROM organizations
        WHERE id=$1
        `,
        [organizationId]
      )
    ).rows[0];

    if (!organization) {
      return res.status(404).json({
        error: 'Empresa nÃ£o encontrada.'
      });
    }

    /*
      NOVO FLUXO:
      Em vez de criar uma assinatura diretamente em /preapproval,
      criamos/reutilizamos um plano em /preapproval_plan e devolvemos
      o init_point do prÃ³prio Mercado Pago.

      O comprador escolhe o meio de pagamento no checkout do Mercado Pago.
      Isso evita exigir card_token_id no nosso backend.
    */

    const baseUrl = String(
      process.env.APP_URL ||
      'https://central-chamados-v4.onrender.com'
    ).replace(/\/+$/, '');

    const backUrl =
      `${baseUrl}/assinatura?billing=return`;

    /*
      IDs podem ser configurados no Render para evitar criar planos repetidos.
      Ex.:
        MP_PLAN_STARTER_ID
        MP_PLAN_PRO_ID
        MP_PLAN_BUSINESS_ID

      Se o ID nÃ£o existir, o backend cria o plano automaticamente.
    */
    const envPlanKey =
      `MP_PLAN_${planId.toUpperCase()}_ID`;

    let mpPlanId = clean(
      process.env[envPlanKey],
      120
    );

    let mpPlan = null;

    if (mpPlanId) {
      try {
        mpPlan = await mercadoPagoRequest(
          `/preapproval_plan/${encodeURIComponent(mpPlanId)}`
        );
      } catch (error) {
        console.warn(
          `Plano Mercado Pago ${mpPlanId} nÃ£o pÃ´de ser consultado; serÃ¡ recriado.`,
          error.message
        );
        mpPlanId = '';
      }
    }

    if (!mpPlanId) {
      mpPlan = await mercadoPagoRequest(
        '/preapproval_plan',
        {
          method: 'POST',
          body: JSON.stringify({
            reason:
              `Central de ServiÃ§os - Plano ${plan.name}`,

            auto_recurring: {
              frequency: 1,
              frequency_type: 'months',
              transaction_amount: plan.price,
              currency_id: 'BRL'
            },

            back_url: backUrl
          })
        }
      );

      mpPlanId = mpPlan.id || '';

      if (!mpPlanId) {
        throw new Error(
          'Mercado Pago nÃ£o retornou o ID do plano.'
        );
      }

      console.log(
        `[BILLING] Plano ${planId} criado no Mercado Pago: ${mpPlanId}. ` +
        `Adicione ${envPlanKey}=${mpPlanId} no Render para reutilizÃ¡-lo.`
      );
    }

    /*
      GET /preapproval_plan/{id} e POST /preapproval_plan retornam init_point.
      Se por algum motivo a primeira resposta nÃ£o trouxer, consultamos novamente.
    */
    if (!mpPlan?.init_point) {
      mpPlan = await mercadoPagoRequest(
        `/preapproval_plan/${encodeURIComponent(mpPlanId)}`
      );
    }

    const checkoutUrl =
      mpPlan?.init_point || null;

    if (!checkoutUrl) {
      throw new Error(
        'Mercado Pago criou o plano, mas nÃ£o retornou o link de checkout.'
      );
    }

    await ensureBillingCheckoutMap();

    await query(
      `
      INSERT INTO billing_checkout_map
        (mp_plan_id, organization_id, plan_id, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (mp_plan_id)
      DO UPDATE SET
        organization_id=EXCLUDED.organization_id,
        plan_id=EXCLUDED.plan_id,
        updated_at=NOW()
      `,
      [mpPlanId, organizationId, planId]
    );

    /*
      Ainda nÃ£o existe uma assinatura individual neste momento.
      Ela serÃ¡ criada pelo Mercado Pago quando o comprador concluir
      o checkout do plano.
    */
    await query(
      `
      UPDATE organizations
      SET
        billing_status='pending',
        billing_updated_at=NOW(),
        updated_at=NOW()
      WHERE id=$1
      `,
      [organizationId]
    );

    await audit(
      req,
      'billing_checkout_started',
      'billing',
      organizationId,
      {
        plan: planId,
        mpPlanId,
        status: 'pending'
      }
    );

    res.status(201).json({
      ok: true,
      subscriptionId: null,
      mpPlanId,
      status: 'pending',
      checkoutUrl,
      plan: planId,
      envPlanKey
    });
  }
);

/* --------------------------------------------
   CONSULTAR ASSINATURA
   -------------------------------------------- */

app.get(
  '/api/billing/subscription',
  requireAuth,
  async (req, res) => {

    const organizationId = tenant(req);

    const organization = (
      await query(
        `
        SELECT
          id,
          name,
          plan,
          user_limit,
          billing_email,
          billing_status,
          mp_subscription_id,
          billing_updated_at,
          last_payment_at,
          next_payment_at
        FROM organizations
        WHERE id=$1
        `,
        [organizationId]
      )
    ).rows[0];

    if (!organization) {
      return res.status(404).json({
        error: 'Empresa nÃ£o encontrada.'
      });
    }

    if (!organization.mp_subscription_id) {
      return res.json({
        organization,
        subscription: null
      });
    }

    const subscription =
      await mercadoPagoRequest(
        `/preapproval/${encodeURIComponent(
          organization.mp_subscription_id
        )}`
      );

    /*
      Sincroniza o status local com o Mercado Pago.
    */

    await query(
      `
      UPDATE organizations
      SET
        billing_status=$1,
        next_payment_at=$2,
        billing_updated_at=NOW()
      WHERE id=$3
      `,
      [
        subscription.status || 'pending',
        subscription.next_payment_date || null,
        organizationId
      ]
    );

    res.json({
      organization: {
        ...organization,
        billing_status:
          subscription.status ||
          organization.billing_status
      },

      subscription: {
        id: subscription.id,
        status: subscription.status,
        payerEmail: subscription.payer_email,

        nextPaymentDate:
          subscription.next_payment_date || null,

        amount:
          subscription.auto_recurring
            ?.transaction_amount || null,

        currency:
          subscription.auto_recurring
            ?.currency_id || 'BRL',

        externalReference:
          subscription.external_reference || null
      }
    });
  }
);


/* --------------------------------------------
   MAPA CHECKOUT MP -> EMPRESA/PLANO
   -------------------------------------------- */

async function ensureBillingCheckoutMap() {
  await query(`
    CREATE TABLE IF NOT EXISTS billing_checkout_map (
      mp_plan_id VARCHAR(120) PRIMARY KEY,
      organization_id INTEGER NOT NULL,
      plan_id VARCHAR(30) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

/* --------------------------------------------
   SINCRONIZAR ASSINATURA
   -------------------------------------------- */

async function syncMercadoPagoSubscription(
  subscriptionId
) {
  if (!subscriptionId) return;

  const subscription =
    await mercadoPagoRequest(
      `/preapproval/${encodeURIComponent(
        subscriptionId
      )}`
    );

  const reference =
    String(
      subscription.external_reference || ''
    );

  let organizationId = null;
  let planId = null;

  /*
    Compatibilidade com o fluxo antigo:
    external_reference = org:1:plan:business
  */
  const match =
    reference.match(
      /^org:(\d+):plan:(start|business|pro)$/
    );

  if (match) {
    organizationId = Number(match[1]);
    planId = match[2];
  }

  /*
    Fluxo novo com preapproval_plan:
    o Mercado Pago informa preapproval_plan_id na assinatura.
    Usamos o mapa salvo quando o checkout foi iniciado.
  */
  if (!organizationId || !planId) {
    const mpPlanId =
      String(
        subscription.preapproval_plan_id ||
        subscription.preapproval_plan?.id ||
        ''
      );

    if (mpPlanId) {
      await ensureBillingCheckoutMap();

      const mapped = (
        await query(
          `
          SELECT organization_id, plan_id
          FROM billing_checkout_map
          WHERE mp_plan_id=$1
          LIMIT 1
          `,
          [mpPlanId]
        )
      ).rows[0];

      if (mapped) {
        organizationId = Number(mapped.organization_id);
        planId = String(mapped.plan_id);
      }
    }
  }

  if (!organizationId || !planId) {
    console.warn(
      '[Mercado Pago] NÃ£o foi possÃ­vel associar a assinatura Ã  empresa.',
      {
        subscriptionId: subscription.id,
        externalReference: reference || null,
        preapprovalPlanId:
          subscription.preapproval_plan_id ||
          subscription.preapproval_plan?.id ||
          null
      }
    );
    return;
  }

  const plan =
    BILLING_PLANS[planId];

  if (!plan) return;

  const mpStatus =
    subscription.status || 'pending';

  /*
    SÃ³ liberamos efetivamente o plano quando
    o Mercado Pago informar que a assinatura
    estÃ¡ autorizada.
  */

  if (mpStatus === 'authorized') {

    await query(
      `
      UPDATE organizations
      SET
        plan=$1,
        user_limit=$2,
        status='active',
        mp_subscription_id=$3,
        billing_status=$4,
        next_payment_at=$5,
        billing_updated_at=NOW(),
        updated_at=NOW()
      WHERE id=$6
      `,
      [
        planId,
        plan.userLimit,
        subscription.id,
        mpStatus,
        subscription.next_payment_date || null,
        organizationId
      ]
    );
    await query('INSERT INTO audit_logs(organization_id,actor_id,action,target_type,target_id,details) VALUES($1,NULL,$2,$3,$4,$5)',[organizationId,'billing_authorized','billing',organizationId,JSON.stringify({plan:planId,status:mpStatus,subscriptionId:subscription.id})]);

  } else {

    await query(
      `
      UPDATE organizations
      SET
        mp_subscription_id=$1,
        billing_status=$2,
        next_payment_at=$3,
        billing_updated_at=NOW(),
        updated_at=NOW()
      WHERE id=$4
      `,
      [
        subscription.id,
        mpStatus,
        subscription.next_payment_date || null,
        organizationId
      ]
    );
  }
}


/* ============================================
   MERCADO PAGO - WEBHOOK
   ============================================ */

function validateMercadoPagoWebhook(req) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  const xSignature = String(req.get('x-signature') || '');
  const xRequestId = String(req.get('x-request-id') || '');

  // O teste do painel pode chegar sem os cabeÃ§alhos reais.
  // Respondemos 200, mas nÃ£o usamos o payload para alterar planos.
  if (!xSignature || !xRequestId) {
    return { valid: false, testOrUnsigned: true };
  }

  if (!secret) {
    console.error('[Mercado Pago] MP_WEBHOOK_SECRET nÃ£o configurado.');
    return { valid: false, testOrUnsigned: false };
  }

  const dataId = String(
    req.query?.['data.id'] ||
    req.body?.data?.id ||
    req.query?.id ||
    req.body?.id ||
    ''
  ).toLowerCase();

  if (!dataId) {
    return { valid: false, testOrUnsigned: false };
  }

  const parts = {};

  xSignature.split(',').forEach(part => {
    const [key, value] = part.split('=');
    if (key && value) parts[key.trim()] = value.trim();
  });

  const ts = parts.ts;
  const receivedHash = parts.v1;

  if (!ts || !receivedHash) {
    return { valid: false, testOrUnsigned: false };
  }

  const manifest =
    `id:${dataId};` +
    `request-id:${xRequestId};` +
    `ts:${ts};`;

  const calculatedHash = crypto
    .createHmac('sha256', secret)
    .update(manifest)
    .digest('hex');

  try {
    const receivedBuffer = Buffer.from(receivedHash, 'hex');
    const calculatedBuffer = Buffer.from(calculatedHash, 'hex');

    if (
      receivedBuffer.length === 0 ||
      receivedBuffer.length !== calculatedBuffer.length
    ) {
      return { valid: false, testOrUnsigned: false };
    }

    return {
      valid: crypto.timingSafeEqual(
        receivedBuffer,
        calculatedBuffer
      ),
      testOrUnsigned: false
    };
  } catch (error) {
    console.error(
      '[Mercado Pago] Falha ao validar assinatura:',
      error
    );
    return { valid: false, testOrUnsigned: false };
  }
}

app.post('/api/billing/webhook', async (req, res) => {
  const type =
    req.body?.type ||
    req.body?.topic ||
    req.query?.type ||
    req.query?.topic ||
    '';

  const dataId =
    req.body?.data?.id ||
    req.query?.['data.id'] ||
    req.query?.id ||
    req.body?.id ||
    null;

  /*
    Log ANTES da resposta para ficar visÃ­vel no Render inclusive
    durante a simulaÃ§Ã£o de Webhook do painel do Mercado Pago.
    Nunca registramos Access Token ou outros segredos.
  */
  console.log(
    `[MP WEBHOOK RECEBIDO] type=${type || 'sem-tipo'} id=${dataId || 'sem-id'}`
  );

  // Confirma rapidamente o recebimento para o Mercado Pago.
  res.status(200).json({ received: true });

  try {

    const signature = validateMercadoPagoWebhook(req);

    if (!signature.valid) {
      if (signature.testOrUnsigned) {
        console.log(
          '[Mercado Pago] Teste/evento sem assinatura recebido. Nenhuma alteraÃ§Ã£o aplicada.'
        );
        return;
      }

      console.warn(
        '[Mercado Pago] Assinatura do webhook invÃ¡lida. Evento ignorado.'
      );
      return;
    }

    if (
      type === 'subscription_preapproval' ||
      type === 'preapproval'
    ) {
      if (!dataId) {
        console.log(
          '[Mercado Pago] Webhook de assinatura sem ID.'
        );
        return;
      }

      await syncMercadoPagoSubscription(String(dataId));

      console.log(
        `[Mercado Pago] Assinatura ${dataId} sincronizada.`
      );

      return;
    }

    if (type === 'subscription_authorized_payment') {
      console.log(
        '[Mercado Pago] Pagamento recorrente recebido:',
        dataId
      );
      return;
    }

    if (
      type === 'payment' ||
      type === 'payments'
    ) {
      if (!dataId) {
        console.log(
          '[Mercado Pago] Webhook de pagamento sem ID.'
        );
        return;
      }

      const payment = await mercadoPagoRequest(
        `/v1/payments/${encodeURIComponent(dataId)}`
      );

      console.log('[Mercado Pago] Pagamento:', {
        id: payment.id,
        status: payment.status,
        externalReference: payment.external_reference
      });

      return;
    }

    console.log(
      '[Mercado Pago] Evento ignorado:',
      type
    );
  } catch (error) {
    console.error(
      '[Mercado Pago Webhook] Erro:',
      error
    );
  }
});

app.get('/health',(req,res)=>res.json({ok:true,version:'9.0.0',mode:'multi-tenant-saas',time:new Date().toISOString()}));app.use('/api',(req,res)=>res.status(404).json({error:'Rota nÃ£o encontrada.'}));app.use((err,req,res,next)=>{console.error(err);res.status(err.status||500).json({error:err.status?err.message:'Erro interno do servidor.'});});
initDatabase().then(()=>app.listen(PORT,'0.0.0.0',()=>console.log(`Central de ServiÃ§os V8 Clean em http://localhost:${PORT}`))).catch(e=>{console.error('Falha ao iniciar:',e);process.exit(1);});


