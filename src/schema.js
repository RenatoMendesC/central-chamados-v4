const bcrypt = require('bcryptjs');
const { query } = require('./db');

async function initDatabase() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      username VARCHAR(60) UNIQUE NOT NULL,
      email VARCHAR(160),
      department VARCHAR(100),
      role VARCHAR(20) NOT NULL DEFAULT 'requester' CHECK (role IN ('admin','agent','requester')),
      status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('active','pending','blocked')),
      password_hash TEXT NOT NULL,
      photo_data TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id BIGSERIAL PRIMARY KEY,
      title VARCHAR(180) NOT NULL,
      category VARCHAR(80) NOT NULL,
      priority VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
      status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','progress','resolved','closed')),
      description TEXT NOT NULL,
      requester_id BIGINT NOT NULL REFERENCES users(id),
      assigned_to BIGINT REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    );

    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ;

    CREATE TABLE IF NOT EXISTS comments (
      id BIGSERIAL PRIMARY KEY,
      ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      author_id BIGINT NOT NULL REFERENCES users(id),
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ticket_events (
      id BIGSERIAL PRIMARY KEY,
      ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      actor_id BIGINT REFERENCES users(id),
      event_type VARCHAR(60) NOT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id BIGSERIAL PRIMARY KEY,
      ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      uploaded_by BIGINT NOT NULL REFERENCES users(id),
      file_name VARCHAR(180) NOT NULL,
      mime_type VARCHAR(120) NOT NULL,
      file_data TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ticket_id BIGINT REFERENCES tickets(id) ON DELETE CASCADE,
      title VARCHAR(160) NOT NULL,
      body VARCHAR(400),
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS categories (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(80) UNIQUE NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS departments (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(100) UNIQUE NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key VARCHAR(80) PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY,
      actor_id BIGINT REFERENCES users(id),
      action VARCHAR(80) NOT NULL,
      target_type VARCHAR(40) NOT NULL,
      target_id BIGINT,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
    CREATE INDEX IF NOT EXISTS idx_tickets_requester ON tickets(requester_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_assigned ON tickets(assigned_to);
    CREATE INDEX IF NOT EXISTS idx_tickets_due ON tickets(due_at);
    CREATE INDEX IF NOT EXISTS idx_comments_ticket ON comments(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_events_ticket ON ticket_events(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
  `);

  for (const name of ['Hardware','Software','Rede','Acesso','Impressora','Outro']) {
    await query('INSERT INTO categories(name) VALUES($1) ON CONFLICT(name) DO NOTHING', [name]);
  }
  for (const name of ['Administração','TI','Financeiro','RH','Operação','Comercial']) {
    await query('INSERT INTO departments(name) VALUES($1) ON CONFLICT(name) DO NOTHING', [name]);
  }
  const defaults = {
    brand_name: 'Central de Chamados',
    sla_low: '72', sla_medium: '48', sla_high: '24', sla_urgent: '4'
  };
  for (const [key, value] of Object.entries(defaults)) {
    await query('INSERT INTO system_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING', [key, value]);
  }

  // Preenche prazo para chamados antigos ainda sem SLA.
  await query(`UPDATE tickets SET due_at = created_at + INTERVAL '48 hours' WHERE due_at IS NULL`);

  const adminUsername = (process.env.ADMIN_USERNAME || 'renato').trim().toLowerCase();
  const existing = await query('SELECT id FROM users WHERE username=$1', [adminUsername]);
  if (!existing.rowCount) {
    const password = process.env.ADMIN_PASSWORD || 'TroqueEstaSenha@123';
    const hash = await bcrypt.hash(password, 12);
    await query(`INSERT INTO users(name,username,email,department,role,status,password_hash)
      VALUES($1,$2,$3,$4,'admin','active',$5)`, [
      process.env.ADMIN_NAME || 'Renato Costa', adminUsername,
      process.env.ADMIN_EMAIL || null, 'Administração', hash
    ]);
    console.log(`Administrador inicial criado: ${adminUsername}`);
  }
}
module.exports = { initDatabase };
