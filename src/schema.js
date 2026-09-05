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

    CREATE TABLE IF NOT EXISTS comments (
      id BIGSERIAL PRIMARY KEY,
      ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      author_id BIGINT NOT NULL REFERENCES users(id),
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    CREATE INDEX IF NOT EXISTS idx_comments_ticket ON comments(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
  `);

  const adminUsername = (process.env.ADMIN_USERNAME || 'renato').trim().toLowerCase();
  const existing = await query('SELECT id FROM users WHERE username=$1', [adminUsername]);
  if (!existing.rowCount) {
    const password = process.env.ADMIN_PASSWORD || 'TroqueEstaSenha@123';
    const hash = await bcrypt.hash(password, 12);
    await query(`
      INSERT INTO users (name, username, email, department, role, status, password_hash)
      VALUES ($1,$2,$3,$4,'admin','active',$5)
    `, [
      process.env.ADMIN_NAME || 'Renato Costa',
      adminUsername,
      process.env.ADMIN_EMAIL || null,
      'Administração',
      hash,
    ]);
    console.log(`Administrador inicial criado: ${adminUsername}`);
  }
}

module.exports = { initDatabase };
