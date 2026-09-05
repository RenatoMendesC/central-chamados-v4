require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const { query, withTransaction } = require('./db');
const { initDatabase } = require('./schema');
const { setAuthCookie, clearAuthCookie, loadUser, requireAuth, requireRole } = require('./auth');

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não configurada.');
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 20) throw new Error('JWT_SECRET precisa ter pelo menos 20 caracteres.');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = path.join(__dirname, '..');

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));
app.use(cookieParser());
app.use('/assets', express.static(path.join(ROOT, 'public')));

function page(file) { return path.join(ROOT, 'views', file); }
function cleanText(value, max = 300) { return String(value || '').trim().slice(0, max); }
function publicUser(u) {
  return {
    id: Number(u.id), name: u.name, username: u.username, email: u.email,
    department: u.department, role: u.role, status: u.status, photoData: u.photo_data || null,
    createdAt: u.created_at, lastLoginAt: u.last_login_at,
  };
}
async function audit(actorId, action, targetType, targetId, details = {}) {
  await query('INSERT INTO audit_logs(actor_id,action,target_type,target_id,details) VALUES($1,$2,$3,$4,$5)',
    [actorId || null, action, targetType, targetId || null, JSON.stringify(details)]);
}

app.get('/', async (req, res) => {
  const user = await loadUser(req);
  if (user) return res.redirect('/chamados');
  res.sendFile(page('index.html'));
});
app.get('/criar-conta', async (req, res) => {
  const user = await loadUser(req);
  if (user) return res.redirect('/chamados');
  res.sendFile(page('criar-conta.html'));
});
app.get('/chamados', requireAuth, (req, res) => res.sendFile(page('chamados.html')));
app.get('/relatorios', requireAuth, requireRole('admin'), (req, res) => res.sendFile(page('relatorios.html')));
app.get('/usuarios', requireAuth, requireRole('admin'), (req, res) => res.sendFile(page('usuarios.html')));

app.post('/api/auth/login', async (req, res) => {
  const username = cleanText(req.body.username, 60).toLowerCase();
  const password = String(req.body.password || '');
  const result = await query('SELECT * FROM users WHERE username=$1', [username]);
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
  }
  if (user.status === 'pending') return res.status(403).json({ error: 'Sua conta ainda aguarda aprovação do administrador.' });
  if (user.status === 'blocked') return res.status(403).json({ error: 'Sua conta está bloqueada.' });
  await query('UPDATE users SET last_login_at=NOW() WHERE id=$1', [user.id]);
  setAuthCookie(res, user);
  await audit(user.id, 'login', 'user', user.id, {});
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/register', async (req, res) => {
  const name = cleanText(req.body.name, 120);
  const username = cleanText(req.body.username, 60).toLowerCase();
  const email = cleanText(req.body.email, 160) || null;
  const department = cleanText(req.body.department, 100) || null;
  const password = String(req.body.password || '');
  if (name.length < 3 || username.length < 3 || password.length < 8) {
    return res.status(400).json({ error: 'Preencha nome, usuário e uma senha com pelo menos 8 caracteres.' });
  }
  if (!/^[a-z0-9._-]+$/.test(username)) return res.status(400).json({ error: 'Usuário pode ter apenas letras minúsculas, números, ponto, hífen e underline.' });
  const exists = await query('SELECT 1 FROM users WHERE username=$1', [username]);
  if (exists.rowCount) return res.status(409).json({ error: 'Esse nome de usuário já existe.' });
  const hash = await bcrypt.hash(password, 12);
  const inserted = await query(`INSERT INTO users(name,username,email,department,role,status,password_hash)
    VALUES($1,$2,$3,$4,'requester','pending',$5) RETURNING id`, [name, username, email, department, hash]);
  await audit(null, 'registration_requested', 'user', inserted.rows[0].id, { username });
  res.status(201).json({ message: 'Conta criada. Aguarde a aprovação do administrador.' });
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  await audit(req.user.id, 'logout', 'user', req.user.id, {});
  clearAuthCookie(res);
  res.json({ ok: true });
});
app.get('/api/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

app.patch('/api/me', requireAuth, async (req, res) => {
  const name = cleanText(req.body.name, 120);
  const email = cleanText(req.body.email, 160) || null;
  const department = cleanText(req.body.department, 100) || null;
  const photoData = req.body.photoData ? String(req.body.photoData) : null;
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório.' });
  if (photoData && (!photoData.startsWith('data:image/') || photoData.length > 1500000)) {
    return res.status(400).json({ error: 'Foto inválida ou muito grande.' });
  }
  const result = await query(`UPDATE users SET name=$1,email=$2,department=$3,photo_data=$4,updated_at=NOW()
    WHERE id=$5 RETURNING id,name,username,email,department,role,status,photo_data,created_at,last_login_at`,
    [name, email, department, photoData, req.user.id]);
  await audit(req.user.id, 'profile_updated', 'user', req.user.id, {});
  res.json({ user: publicUser(result.rows[0]) });
});

app.patch('/api/me/password', requireAuth, async (req, res) => {
  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = String(req.body.newPassword || '');
  if (newPassword.length < 8) return res.status(400).json({ error: 'A nova senha deve ter pelo menos 8 caracteres.' });
  const r = await query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
  if (!(await bcrypt.compare(currentPassword, r.rows[0].password_hash))) return res.status(400).json({ error: 'Senha atual incorreta.' });
  const hash = await bcrypt.hash(newPassword, 12);
  await query('UPDATE users SET password_hash=$1,updated_at=NOW() WHERE id=$2', [hash, req.user.id]);
  await audit(req.user.id, 'password_changed', 'user', req.user.id, {});
  res.json({ ok: true });
});

app.get('/api/users/agents', requireAuth, async (req, res) => {
  const r = await query("SELECT id,name,photo_data FROM users WHERE status='active' AND role IN ('admin','agent') ORDER BY name");
  res.json({ users: r.rows.map(u => ({ id:Number(u.id), name:u.name, photoData:u.photo_data || null })) });
});

app.get('/api/users', requireAuth, requireRole('admin'), async (req, res) => {
  const r = await query('SELECT id,name,username,email,department,role,status,photo_data,created_at,last_login_at FROM users ORDER BY created_at DESC');
  res.json({ users: r.rows.map(publicUser) });
});

app.post('/api/users', requireAuth, requireRole('admin'), async (req, res) => {
  const name = cleanText(req.body.name, 120);
  const username = cleanText(req.body.username, 60).toLowerCase();
  const email = cleanText(req.body.email, 160) || null;
  const department = cleanText(req.body.department, 100) || null;
  const role = ['admin','agent','requester'].includes(req.body.role) ? req.body.role : 'requester';
  const status = ['active','pending','blocked'].includes(req.body.status) ? req.body.status : 'active';
  const password = String(req.body.password || '');
  if (!name || username.length < 3 || password.length < 8) return res.status(400).json({ error: 'Dados inválidos.' });
  if (!/^[a-z0-9._-]+$/.test(username)) return res.status(400).json({ error: 'Usuário inválido.' });
  const hash = await bcrypt.hash(password, 12);
  try {
    const r = await query(`INSERT INTO users(name,username,email,department,role,status,password_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [name,username,email,department,role,status,hash]);
    await audit(req.user.id, 'user_created', 'user', r.rows[0].id, { username, role, status });
    res.status(201).json({ id: Number(r.rows[0].id) });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Esse usuário já existe.' });
    throw e;
  }
});

app.patch('/api/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const id = Number(req.params.id);
  const targetR = await query('SELECT * FROM users WHERE id=$1', [id]);
  const target = targetR.rows[0];
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
  const name = cleanText(req.body.name ?? target.name, 120);
  const email = cleanText(req.body.email ?? target.email, 160) || null;
  const department = cleanText(req.body.department ?? target.department, 100) || null;
  const role = ['admin','agent','requester'].includes(req.body.role) ? req.body.role : target.role;
  const status = ['active','pending','blocked'].includes(req.body.status) ? req.body.status : target.status;
  const photoData = req.body.photoData === undefined ? target.photo_data : (req.body.photoData || null);
  if (photoData && (!String(photoData).startsWith('data:image/') || String(photoData).length > 1500000)) return res.status(400).json({ error: 'Foto inválida ou muito grande.' });
  if (id === req.user.id && (status !== 'active' || role !== 'admin')) return res.status(400).json({ error: 'Você não pode remover seu próprio acesso administrativo.' });
  if (target.role === 'admin' && target.status === 'active' && (role !== 'admin' || status !== 'active')) {
    const admins = await query("SELECT COUNT(*)::int AS total FROM users WHERE role='admin' AND status='active'");
    if (admins.rows[0].total <= 1) return res.status(400).json({ error: 'O sistema precisa manter pelo menos um administrador ativo.' });
  }
  await query(`UPDATE users SET name=$1,email=$2,department=$3,role=$4,status=$5,photo_data=$6,updated_at=NOW() WHERE id=$7`,
    [name,email,department,role,status,photoData,id]);
  if (req.body.password) {
    const p = String(req.body.password);
    if (p.length < 8) return res.status(400).json({ error: 'A nova senha deve ter pelo menos 8 caracteres.' });
    await query('UPDATE users SET password_hash=$1,updated_at=NOW() WHERE id=$2', [await bcrypt.hash(p,12), id]);
  }
  await audit(req.user.id, 'user_updated', 'user', id, { role, status });
  res.json({ ok: true });
});

app.delete('/api/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Você não pode excluir sua própria conta.' });
  const targetR = await query('SELECT role,status,username FROM users WHERE id=$1', [id]);
  const target = targetR.rows[0];
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
  if (target.role === 'admin' && target.status === 'active') {
    const admins = await query("SELECT COUNT(*)::int AS total FROM users WHERE role='admin' AND status='active'");
    if (admins.rows[0].total <= 1) return res.status(400).json({ error: 'O sistema precisa manter pelo menos um administrador ativo.' });
  }
  try {
    await query('DELETE FROM users WHERE id=$1', [id]);
  } catch (e) {
    if (e.code === '23503') return res.status(409).json({ error: 'Este usuário possui chamados ou histórico. Bloqueie a conta em vez de excluir.' });
    throw e;
  }
  await audit(req.user.id, 'user_deleted', 'user', id, { username: target.username });
  res.json({ ok: true });
});

app.get('/api/tickets', requireAuth, async (req, res) => {
  const params=[]; let where='WHERE 1=1';
  if (req.user.role === 'requester') { params.push(req.user.id); where += ` AND t.requester_id=$${params.length}`; }
  if (req.query.status && ['open','progress','resolved','closed'].includes(req.query.status)) { params.push(req.query.status); where += ` AND t.status=$${params.length}`; }
  if (req.query.priority && ['low','medium','high','urgent'].includes(req.query.priority)) { params.push(req.query.priority); where += ` AND t.priority=$${params.length}`; }
  if (req.query.q) { params.push(`%${cleanText(req.query.q,100)}%`); where += ` AND (t.title ILIKE $${params.length} OR ru.name ILIKE $${params.length})`; }
  const r = await query(`SELECT t.*, ru.name requester_name, au.name assigned_name, au.photo_data assigned_photo,
    (SELECT COUNT(*)::int FROM comments c WHERE c.ticket_id=t.id) comment_count
    FROM tickets t JOIN users ru ON ru.id=t.requester_id LEFT JOIN users au ON au.id=t.assigned_to
    ${where} ORDER BY CASE t.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC, t.created_at DESC`, params);
  res.json({ tickets: r.rows });
});

app.post('/api/tickets', requireAuth, async (req,res) => {
  const title=cleanText(req.body.title,180), category=cleanText(req.body.category,80), description=cleanText(req.body.description,5000);
  const priority=['low','medium','high','urgent'].includes(req.body.priority)?req.body.priority:'medium';
  if (!title || !category || !description) return res.status(400).json({error:'Preencha título, categoria e descrição.'});
  const r=await query(`INSERT INTO tickets(title,category,priority,description,requester_id) VALUES($1,$2,$3,$4,$5) RETURNING id`,[title,category,priority,description,req.user.id]);
  await audit(req.user.id,'ticket_created','ticket',r.rows[0].id,{title});
  res.status(201).json({id:Number(r.rows[0].id)});
});

app.get('/api/tickets/:id', requireAuth, async (req,res) => {
  const id=Number(req.params.id);
  const r=await query(`SELECT t.*,ru.name requester_name,ru.photo_data requester_photo,au.name assigned_name,au.photo_data assigned_photo
    FROM tickets t JOIN users ru ON ru.id=t.requester_id LEFT JOIN users au ON au.id=t.assigned_to WHERE t.id=$1`,[id]);
  const ticket=r.rows[0];
  if (!ticket) return res.status(404).json({error:'Chamado não encontrado.'});
  if (req.user.role==='requester' && Number(ticket.requester_id)!==req.user.id) return res.status(403).json({error:'Sem permissão.'});
  const comments=await query(`SELECT c.id,c.body,c.created_at,u.id author_id,u.name author_name,u.photo_data author_photo
    FROM comments c JOIN users u ON u.id=c.author_id WHERE c.ticket_id=$1 ORDER BY c.created_at`,[id]);
  res.json({ticket,comments:comments.rows});
});

app.patch('/api/tickets/:id', requireAuth, requireRole('admin','agent'), async (req,res) => {
  const id=Number(req.params.id);
  const oldR=await query('SELECT * FROM tickets WHERE id=$1',[id]);
  const old=oldR.rows[0]; if(!old) return res.status(404).json({error:'Chamado não encontrado.'});
  const status=['open','progress','resolved','closed'].includes(req.body.status)?req.body.status:old.status;
  const priority=['low','medium','high','urgent'].includes(req.body.priority)?req.body.priority:old.priority;
  const assignedTo = (req.body.assignedTo === null || req.body.assignedTo === '') ? null : (req.body.assignedTo !== undefined ? Number(req.body.assignedTo) : (old.assigned_to ? Number(old.assigned_to) : null));
  if (assignedTo) {
    const valid=await query("SELECT 1 FROM users WHERE id=$1 AND status='active' AND role IN ('admin','agent')",[assignedTo]);
    if(!valid.rowCount) return res.status(400).json({error:'Responsável inválido.'});
  }
  await query(`UPDATE tickets SET status=$1,priority=$2,assigned_to=$3,updated_at=NOW(),resolved_at=CASE WHEN $1 IN ('resolved','closed') THEN COALESCE(resolved_at,NOW()) ELSE NULL END WHERE id=$4`,[status,priority,assignedTo,id]);
  await audit(req.user.id,'ticket_updated','ticket',id,{status,priority,assignedTo});
  res.json({ok:true});
});

app.post('/api/tickets/:id/comments', requireAuth, async (req,res) => {
  const id=Number(req.params.id), body=cleanText(req.body.body,3000);
  if(!body) return res.status(400).json({error:'Comentário vazio.'});
  const t=await query('SELECT requester_id FROM tickets WHERE id=$1',[id]); if(!t.rowCount) return res.status(404).json({error:'Chamado não encontrado.'});
  if(req.user.role==='requester' && Number(t.rows[0].requester_id)!==req.user.id) return res.status(403).json({error:'Sem permissão.'});
  await query('INSERT INTO comments(ticket_id,author_id,body) VALUES($1,$2,$3)',[id,req.user.id,body]);
  await query('UPDATE tickets SET updated_at=NOW() WHERE id=$1',[id]);
  await audit(req.user.id,'comment_added','ticket',id,{});
  res.status(201).json({ok:true});
});

app.delete('/api/tickets/:id', requireAuth, requireRole('admin'), async (req,res) => {
  const id=Number(req.params.id); await query('DELETE FROM tickets WHERE id=$1',[id]);
  await audit(req.user.id,'ticket_deleted','ticket',id,{}); res.json({ok:true});
});

app.get('/api/reports', requireAuth, requireRole('admin'), async (req,res) => {
  const [kpis,status,priority,category,agents,daily] = await Promise.all([
    query(`SELECT COUNT(*)::int total, COUNT(*) FILTER(WHERE status='open')::int open, COUNT(*) FILTER(WHERE status='progress')::int progress, COUNT(*) FILTER(WHERE status IN ('resolved','closed'))::int finished FROM tickets`),
    query('SELECT status,COUNT(*)::int total FROM tickets GROUP BY status'),
    query('SELECT priority,COUNT(*)::int total FROM tickets GROUP BY priority'),
    query('SELECT category,COUNT(*)::int total FROM tickets GROUP BY category ORDER BY total DESC'),
    query(`SELECT COALESCE(u.name,'Não atribuído') name,COUNT(*)::int total FROM tickets t LEFT JOIN users u ON u.id=t.assigned_to GROUP BY u.name ORDER BY total DESC`),
    query(`SELECT d::date day,COUNT(t.id)::int total FROM generate_series(CURRENT_DATE-13,CURRENT_DATE,'1 day') d LEFT JOIN tickets t ON t.created_at::date=d::date GROUP BY d ORDER BY d`)
  ]);
  res.json({kpis:kpis.rows[0],status:status.rows,priority:priority.rows,category:category.rows,agents:agents.rows,daily:daily.rows});
});

app.get('/api/audit', requireAuth, requireRole('admin'), async (req,res) => {
  const r=await query(`SELECT a.*,u.name actor_name FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 100`);
  res.json({logs:r.rows});
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

initDatabase().then(() => {
  app.listen(PORT, () => console.log(`Central de Chamados em http://localhost:${PORT}`));
}).catch(err => { console.error('Falha ao iniciar:', err); process.exit(1); });
