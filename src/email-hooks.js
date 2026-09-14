const db = require('./db');

const originalQuery = db.query.bind(db);
const APP_URL = String(process.env.APP_URL || '').replace(/\/$/, '');
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || 'Central de Chamados <onboarding@resend.dev>';

const statusLabel = { open: 'Aberto', progress: 'Em andamento', resolved: 'Resolvido', closed: 'Fechado' };
const priorityLabel = { low: 'Baixa', medium: 'Média', high: 'Alta', urgent: 'Urgente' };

function esc(value='') {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function sendEmail(to, subject, data) {
  if (!RESEND_API_KEY || !to) return;
  const link = APP_URL ? `${APP_URL}/chamados?ticket=${data.id}` : '';
  const html = `<!doctype html><html><body style="margin:0;background:#f5f5f5;font-family:Arial,sans-serif;color:#171717"><div style="max-width:620px;margin:32px auto;background:#fff;border:1px solid #e5e5e5;border-radius:10px;overflow:hidden"><div style="background:#b94700;padding:22px 28px;color:#fff"><div style="font-size:22px;font-weight:700">Central de Chamados</div><div style="opacity:.9;margin-top:4px">Atualização do chamado #${esc(data.id)}</div></div><div style="padding:28px"><h2 style="margin:0 0 16px">${esc(subject)}</h2><p>Olá, ${esc(data.name || 'usuário')}.</p><p>${esc(data.message || 'Seu chamado recebeu uma atualização.')}</p><div style="background:#fafafa;border-left:4px solid #b94700;padding:14px 16px;margin:20px 0"><strong>#${esc(data.id)} — ${esc(data.title || 'Chamado')}</strong><br>Status: ${esc(statusLabel[data.status] || data.status || '-')}<br>Prioridade: ${esc(priorityLabel[data.priority] || data.priority || '-')}</div>${data.detail ? `<p><strong>Detalhes:</strong><br>${esc(data.detail).replace(/\n/g,'<br>')}</p>` : ''}${link ? `<p style="margin-top:24px"><a href="${esc(link)}" style="background:#b94700;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px;display:inline-block">Ver chamado</a></p>` : ''}<p style="font-size:12px;color:#777;margin-top:28px">Mensagem automática. Você recebeu este e-mail porque seu endereço está cadastrado na Central de Chamados.</p></div></div></body></html>`;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html })
    });
    if (!response.ok) console.error('Falha ao enviar e-mail:', response.status, await response.text());
  } catch (error) {
    console.error('Falha ao enviar e-mail:', error.message);
  }
}

async function ticketInfo(id, oid) {
  const r = await originalQuery(`SELECT t.id,t.title,t.status,t.priority,t.requester_id,u.name,u.email FROM tickets t JOIN users u ON u.id=t.requester_id WHERE t.id=$1 AND t.organization_id=$2`, [id, oid]);
  return r.rows[0];
}

async function notifyRequester(id, oid, subject, message, detail='') {
  const t = await ticketInfo(id, oid);
  if (t?.email) await sendEmail(t.email, subject, { ...t, message, detail });
}

async function notifyTeam(id, oid, subject, message) {
  const t = await ticketInfo(id, oid);
  if (!t) return;
  const r = await originalQuery("SELECT name,email FROM users WHERE organization_id=$1 AND status='active' AND role IN ('admin','agent') AND email IS NOT NULL", [oid]);
  await Promise.all(r.rows.map(u => sendEmail(u.email, subject, { ...t, name:u.name, message })));
}

db.query = async function(sql, params=[]) {
  const result = await originalQuery(sql, params);
  const normalized = String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
  try {
    if (normalized.startsWith('insert into tickets(') && result.rows?.[0]?.id) {
      const id = Number(result.rows[0].id), oid = Number(params[0]);
      setImmediate(() => {
        notifyRequester(id, oid, `Chamado #${id} aberto`, 'Seu chamado foi registrado com sucesso.').catch(console.error);
        notifyTeam(id, oid, `Novo chamado #${id}`, 'Um novo chamado foi aberto e está aguardando atendimento.').catch(console.error);
      });
    } else if (normalized.startsWith('update tickets set status=')) {
      const id = Number(params[8]), oid = Number(params[9]), st = params[0];
      setImmediate(() => notifyRequester(id, oid, ['resolved','closed'].includes(st) ? `Chamado #${id} finalizado` : `Chamado #${id} atualizado`, ['resolved','closed'].includes(st) ? 'Seu chamado foi finalizado.' : 'Seu chamado recebeu uma atualização de status, prioridade ou responsável.').catch(console.error));
    } else if (normalized.startsWith('insert into comments(')) {
      const oid = Number(params[0]), id = Number(params[1]), authorId = Number(params[2]), body = String(params[3] || '');
      setImmediate(async () => {
        const t = await ticketInfo(id, oid); if (!t) return;
        if (authorId !== Number(t.requester_id)) await notifyRequester(id, oid, `Nova resposta no chamado #${id}`, 'A equipe de suporte respondeu ao seu chamado.', body);
        else await notifyTeam(id, oid, `Nova interação no chamado #${id}`, 'O solicitante adicionou uma nova mensagem ao chamado.');
      });
    }
  } catch (error) {
    console.error('Erro no gatilho de e-mail:', error.message);
  }
  return result;
};

if (!RESEND_API_KEY) console.warn('RESEND_API_KEY não configurada: notificações por e-mail estão desativadas até a variável ser adicionada.');
