const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { query } = require('./db');

async function initDatabase() {
  // Base V6 first: tables are intentionally compatible with previous versions.
  await query(`
    CREATE TABLE IF NOT EXISTS organizations (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(160) NOT NULL,
      slug VARCHAR(80) UNIQUE NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','trial','suspended')),
      plan VARCHAR(30) NOT NULL DEFAULT 'start',
      user_limit INTEGER NOT NULL DEFAULT 5,
      trial_ends_at TIMESTAMPTZ,
      logo_data TEXT,
      primary_color VARCHAR(20),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY, name VARCHAR(120) NOT NULL, username VARCHAR(60) UNIQUE NOT NULL,
      email VARCHAR(160), department VARCHAR(100), role VARCHAR(20) NOT NULL DEFAULT 'requester' CHECK (role IN ('admin','agent','requester')),
      status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('active','pending','blocked')),
      password_hash TEXT NOT NULL, photo_data TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_login_at TIMESTAMPTZ
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES organizations(id);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS billing_email VARCHAR(160);
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMPTZ;
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS commercial_notes TEXT;
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_days INTEGER NOT NULL DEFAULT 14;

    CREATE TABLE IF NOT EXISTS assets (
      id BIGSERIAL PRIMARY KEY, asset_tag VARCHAR(60) NOT NULL, name VARCHAR(140) NOT NULL,
      asset_type VARCHAR(80) NOT NULL DEFAULT 'Equipamento', manufacturer VARCHAR(100), model VARCHAR(120), serial_number VARCHAR(120),
      status VARCHAR(30) NOT NULL DEFAULT 'active' CHECK (status IN ('active','maintenance','stock','retired')),
      assigned_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL, department VARCHAR(100), location VARCHAR(140), notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES organizations(id);

    CREATE TABLE IF NOT EXISTS tickets (
      id BIGSERIAL PRIMARY KEY, title VARCHAR(180) NOT NULL, category VARCHAR(80) NOT NULL,
      priority VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
      status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','progress','resolved','closed')),
      description TEXT NOT NULL, requester_id BIGINT NOT NULL REFERENCES users(id), assigned_to BIGINT REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), resolved_at TIMESTAMPTZ
    );
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ;
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS asset_id BIGINT REFERENCES assets(id) ON DELETE SET NULL;
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS impact VARCHAR(20) NOT NULL DEFAULT 'medium';
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS channel VARCHAR(30) NOT NULL DEFAULT 'portal';
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS location VARCHAR(140);
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ;
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES organizations(id);

    CREATE TABLE IF NOT EXISTS comments (id BIGSERIAL PRIMARY KEY,ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,author_id BIGINT NOT NULL REFERENCES users(id),body TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS ticket_events (id BIGSERIAL PRIMARY KEY,ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,actor_id BIGINT REFERENCES users(id),event_type VARCHAR(60) NOT NULL,details JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS attachments (id BIGSERIAL PRIMARY KEY,ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,uploaded_by BIGINT NOT NULL REFERENCES users(id),file_name VARCHAR(180) NOT NULL,mime_type VARCHAR(120) NOT NULL,file_data TEXT NOT NULL,size_bytes INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS notifications (id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,ticket_id BIGINT REFERENCES tickets(id) ON DELETE CASCADE,title VARCHAR(160) NOT NULL,body VARCHAR(400),is_read BOOLEAN NOT NULL DEFAULT FALSE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS categories (id BIGSERIAL PRIMARY KEY,name VARCHAR(80) NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS departments (id BIGSERIAL PRIMARY KEY,name VARCHAR(100) NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS knowledge_articles (id BIGSERIAL PRIMARY KEY,title VARCHAR(180) NOT NULL,summary VARCHAR(320),category VARCHAR(80),content TEXT NOT NULL,published BOOLEAN NOT NULL DEFAULT TRUE,author_id BIGINT REFERENCES users(id) ON DELETE SET NULL,views INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS system_settings (key VARCHAR(80) PRIMARY KEY,value TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS audit_logs (id BIGSERIAL PRIMARY KEY,actor_id BIGINT REFERENCES users(id),action VARCHAR(80) NOT NULL,target_type VARCHAR(40) NOT NULL,target_id BIGINT,details JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());

    ALTER TABLE comments ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES organizations(id);
    ALTER TABLE ticket_events ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES organizations(id);
    ALTER TABLE attachments ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES organizations(id);
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES organizations(id);
    ALTER TABLE categories ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES organizations(id);
    ALTER TABLE departments ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES organizations(id);
    ALTER TABLE knowledge_articles ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES organizations(id);
    ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES organizations(id);

    CREATE TABLE IF NOT EXISTS organization_settings (
      organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      key VARCHAR(80) NOT NULL, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (organization_id,key)
    );
    CREATE TABLE IF NOT EXISTS invitations (
      id BIGSERIAL PRIMARY KEY, organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      token VARCHAR(96) UNIQUE NOT NULL, email VARCHAR(160), role VARCHAR(20) NOT NULL DEFAULT 'requester' CHECK(role IN ('admin','agent','requester')),
      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL, expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  let org = (await query("SELECT * FROM organizations ORDER BY id LIMIT 1")).rows[0];
  if (!org) org = (await query("INSERT INTO organizations(name,slug,status,plan,user_limit) VALUES($1,$2,'active','business',50) RETURNING *", [process.env.DEFAULT_ORG_NAME || 'Minha Empresa','minha-empresa'])).rows[0];
  const oid = Number(org.id);

  // Backfill all V6 data into the first organization. This preserves the live installation.
  await query('UPDATE users SET organization_id=$1 WHERE organization_id IS NULL',[oid]);
  await query('UPDATE tickets t SET organization_id=u.organization_id FROM users u WHERE t.requester_id=u.id AND t.organization_id IS NULL');
  await query('UPDATE assets SET organization_id=$1 WHERE organization_id IS NULL',[oid]);
  await query('UPDATE comments c SET organization_id=t.organization_id FROM tickets t WHERE c.ticket_id=t.id AND c.organization_id IS NULL');
  await query('UPDATE ticket_events e SET organization_id=t.organization_id FROM tickets t WHERE e.ticket_id=t.id AND e.organization_id IS NULL');
  await query('UPDATE attachments a SET organization_id=t.organization_id FROM tickets t WHERE a.ticket_id=t.id AND a.organization_id IS NULL');
  await query('UPDATE notifications n SET organization_id=u.organization_id FROM users u WHERE n.user_id=u.id AND n.organization_id IS NULL');
  await query('UPDATE categories SET organization_id=$1 WHERE organization_id IS NULL',[oid]);
  await query('UPDATE departments SET organization_id=$1 WHERE organization_id IS NULL',[oid]);
  await query('UPDATE knowledge_articles k SET organization_id=COALESCE((SELECT organization_id FROM users u WHERE u.id=k.author_id),$1) WHERE organization_id IS NULL',[oid]);
  await query('UPDATE audit_logs a SET organization_id=COALESCE((SELECT organization_id FROM users u WHERE u.id=a.actor_id),$1) WHERE organization_id IS NULL',[oid]);

  // Remove V6 global uniqueness where it would prevent two companies using the same labels/tags.
  await query(`DO $$ DECLARE r record; BEGIN
    FOR r IN SELECT conname, conrelid::regclass tbl FROM pg_constraint WHERE contype='u' AND conrelid IN ('categories'::regclass,'departments'::regclass,'assets'::regclass)
    LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tbl, r.conname); END LOOP;
  END $$;`);
  await query('CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_org_name ON categories(organization_id,LOWER(name))');
  await query('CREATE UNIQUE INDEX IF NOT EXISTS uq_departments_org_name ON departments(organization_id,LOWER(name))');
  await query('CREATE UNIQUE INDEX IF NOT EXISTS uq_assets_org_tag ON assets(organization_id,LOWER(asset_tag))');
  await query('CREATE INDEX IF NOT EXISTS idx_users_org ON users(organization_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_tickets_org ON tickets(organization_id,created_at DESC)');
  await query('CREATE INDEX IF NOT EXISTS idx_assets_org ON assets(organization_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_knowledge_org ON knowledge_articles(organization_id,published)');
  await query('CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_logs(organization_id,created_at DESC)');

  const defaults={brand_name:'Central de Serviços',company_name:org.name,brand_tagline:'Service Management & Support',support_email:'',sla_low:'72',sla_medium:'48',sla_high:'24',sla_urgent:'4'};
  for(const [key,value] of Object.entries(defaults)) await query('INSERT INTO organization_settings(organization_id,key,value) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[oid,key,value]);
  const old=await query('SELECT key,value FROM system_settings');
  for(const row of old.rows) await query('INSERT INTO organization_settings(organization_id,key,value) VALUES($1,$2,$3) ON CONFLICT(organization_id,key) DO UPDATE SET value=EXCLUDED.value',[oid,row.key,row.value]);

  const baseCats=['Hardware','Software','Rede','Acesso','Impressora','Segurança','Telefonia','Sistemas internos','Outro'];
  const baseDeps=['Administração','TI','Financeiro','RH','Operação','Comercial','Logística','Diretoria'];
  for(const name of baseCats) await query('INSERT INTO categories(organization_id,name) VALUES($1,$2) ON CONFLICT DO NOTHING',[oid,name]);
  for(const name of baseDeps) await query('INSERT INTO departments(organization_id,name) VALUES($1,$2) ON CONFLICT DO NOTHING',[oid,name]);
  await query("UPDATE tickets SET due_at=created_at+INTERVAL '48 hours' WHERE due_at IS NULL");

  const adminUsername=(process.env.ADMIN_USERNAME||'renato').trim().toLowerCase();
  let admin=(await query('SELECT id FROM users WHERE username=$1',[adminUsername])).rows[0];
  if(!admin){const hash=await bcrypt.hash(process.env.ADMIN_PASSWORD||'TroqueEstaSenha@123',12);admin=(await query("INSERT INTO users(organization_id,name,username,email,department,role,status,password_hash,is_super_admin) VALUES($1,$2,$3,$4,'Administração','admin','active',$5,true) RETURNING id",[oid,process.env.ADMIN_NAME||'Renato Costa',adminUsername,process.env.ADMIN_EMAIL||null,hash])).rows[0];}
  await query('UPDATE users SET is_super_admin=true,role=\'admin\',status=\'active\',organization_id=COALESCE(organization_id,$2) WHERE id=$1',[admin.id,oid]);
}
module.exports={initDatabase};
