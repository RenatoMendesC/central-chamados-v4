require('dotenv').config();

const express=require('express');
const path=require('path');
const bcrypt=require('bcryptjs');
const jwt=require('jsonwebtoken');
const crypto=require('crypto');

const {query}=require('./db');
const {initDatabase}=require('./schema');

require('dotenv').config();

if(!process.env.DATABASE_URL){
  throw new Error('DATABASE_URL não configurada.');
}

if(!process.env.JWT_SECRET||process.env.JWT_SECRET.length<20){
  throw new Error('JWT_SECRET precisa ter pelo menos 20 caracteres.');
}

const app=express();
const PORT=process.env.PORT||3000;

app.disable('x-powered-by');

app.use(express.json({limit:'8mb'}));
app.use(express.urlencoded({
  extended:true,
  limit:'8mb'
}));

app.use(
  '/assets',
  express.static(
    path.join(__dirname,'..','public'),
    {
      etag:false,
      lastModified:false,
      setHeaders:r=>{
        r.setHeader(
          'Cache-Control',
          'no-store,max-age=0'
        );
      }
    }
  )
);

const page=f=>
  path.join(
    __dirname,
    '..',
    'views',
    f
  );

const clean=(v,n=4000)=>
  String(v??'')
    .trim()
    .slice(0,n);

const iso=v=>{
  if(!v)return null;

  const d=new Date(v);

  return Number.isNaN(d.getTime())
    ?null
    :d.toISOString();
};

const lower=v=>
  clean(v,200).toLowerCase();

const SLA_DEFAULT={
  low:72,
  medium:48,
  high:24,
  urgent:4
};


/* ============================================
   AUTH
   ============================================ */

const tokenFor=u=>
  jwt.sign(
    {
      id:Number(u.id),
      organizationId:Number(u.organization_id),
      isSuperAdmin:!!u.is_super_admin
    },
    process.env.JWT_SECRET,
    {
      expiresIn:'12h'
    }
  );


function cookieToken(req){
  const raw=req.headers.cookie||'';

  const m=raw.match(
    /(?:^|;\s*)token=([^;]+)/
  );

  return m
    ?decodeURIComponent(m[1])
    :null;
}


function tenant(req){
  const id=Number(
    req.user?.organizationId
  );

  if(!id){
    throw Object.assign(
      new Error('Empresa inválida.'),
      {
        status:403
      }
    );
  }

  return id;
}


async function currentUser(req){
  const token=cookieToken(req);

  if(!token){
    return null;
  }

  try{
    const p=jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    const r=await query(
      `
      SELECT
        u.*,
        o.name organization_name,
        o.status organization_status,
        o.plan organization_plan,
        o.user_limit organization_user_limit
      FROM users u
      JOIN organizations o
        ON o.id=u.organization_id
      WHERE
        u.id=$1
        AND u.organization_id=$2
      `,
      [
        p.id,
        p.organizationId
      ]
    );

    const u=r.rows[0];

    if(
      !u ||
      u.status!=='active' ||
      u.organization_status==='suspended'
    ){
      return null;
    }

    return{
      id:Number(u.id),

      organizationId:
        Number(u.organization_id),

      organizationName:
        u.organization_name,

      organizationPlan:
        u.organization_plan,

      organizationUserLimit:
        Number(
          u.organization_user_limit||0
        ),

      isSuperAdmin:
        !!u.is_super_admin,

      name:u.name,
      username:u.username,
      email:u.email,
      department:u.department,
      role:u.role,
      status:u.status,
      photoData:u.photo_data,
      createdAt:u.created_at,
      lastLoginAt:u.last_login_at
    };

  }catch{
    return null;
  }
}


async function requireAuth(
  req,
  res,
  next
){
  const u=
    await currentUser(req);

  if(!u){
    return res
      .status(401)
      .json({
        error:'Não autenticado.'
      });
  }

  req.user=u;

  next();
}


function requireRole(...roles){
  return(
    req,
    res,
    next
  )=>{
    if(
      roles.includes(
        req.user.role
      )
    ){
      return next();
    }

    return res
      .status(403)
      .json({
        error:'Sem permissão.'
      });
  };
}


function requireSuperAdmin(
  req,
  res,
  next
){
  if(
    req.user?.isSuperAdmin
  ){
    return next();
  }

  return res
    .status(403)
    .json({
      error:
        'Acesso restrito ao Super Admin.'
    });
}


/* ============================================
   HELPERS
   ============================================ */

async function settingsFor(
  orgId
){
  const r=await query(
    `
    SELECT
      key,
      value
    FROM organization_settings
    WHERE organization_id=$1
    `,
    [orgId]
  );

  return Object.fromEntries(
    r.rows.map(
      x=>[
        x.key,
        x.value
      ]
    )
  );
}


async function slaHours(
  orgId,
  priority
){
  const s=
    await settingsFor(orgId);

  return Number(
    s['sla_'+priority] ||
    SLA_DEFAULT[priority] ||
    48
  );
}


async function dueFor(
  orgId,
  p
){
  const hours=
    await slaHours(
      orgId,
      p
    );

  return new Date(
    Date.now()+
    hours*60*60*1000
  ).toISOString();
}


async function notify(
  orgId,
  userId,
  ticketId,
  title,
  body
){
  if(!userId){
    return;
  }

  await query(
    `
    INSERT INTO notifications(
      organization_id,
      user_id,
      ticket_id,
      title,
      body
    )
    VALUES(
      $1,$2,$3,$4,$5
    )
    `,
    [
      orgId,
      userId,
      ticketId,
      title,
      body||''
    ]
  );
}


async function event(
  req,
  ticketId,
  eventType,
  details={}
){
  await query(
    `
    INSERT INTO ticket_events(
      organization_id,
      ticket_id,
      actor_id,
      event_type,
      details
    )
    VALUES(
      $1,$2,$3,$4,$5
    )
    `,
    [
      tenant(req),
      ticketId,
      req.user.id,
      eventType,
      JSON.stringify(details)
    ]
  );
}


async function audit(
  orgId,
  actorId,
  action,
  targetType,
  targetId,
  details={}
){
  await query(
    `
    INSERT INTO audit_logs(
      organization_id,
      actor_id,
      action,
      target_type,
      target_id,
      details
    )
    VALUES(
      $1,$2,$3,$4,$5,$6
    )
    `,
    [
      orgId,
      actorId,
      action,
      targetType,
      targetId,
      JSON.stringify(details)
    ]
  );
}


function priority(v){
  return[
    'low',
    'medium',
    'high',
    'urgent'
  ].includes(v)
    ?v
    :'medium';
}


function impact(v){
  return[
    'low',
    'medium',
    'high'
  ].includes(v)
    ?v
    :'medium';
}


function status(v){
  return[
    'open',
    'progress',
    'resolved',
    'closed'
  ].includes(v)
    ?v
    :'open';
}


function canSee(
  user,
  ticket
){
  if(
    user.role==='admin' ||
    user.role==='agent'
  ){
    return true;
  }

  return Number(
    ticket.requester_id
  )===Number(
    user.id
  );
}


/* ============================================
   PAGES
   ============================================ */

app.get(
  '/',
  (req,res)=>
    res.sendFile(
      page('index.html')
    )
);

app.get(
  '/dashboard',
  (req,res)=>
    res.sendFile(
      page('dashboard.html')
    )
);

app.get(
  '/chamados',
  (req,res)=>
    res.sendFile(
      page('chamados.html')
    )
);

app.get(
  '/usuarios',
  (req,res)=>
    res.sendFile(
      page('usuarios.html')
    )
);

app.get(
  '/ativos',
  (req,res)=>
    res.sendFile(
      page('ativos.html')
    )
);

app.get(
  '/relatorios',
  (req,res)=>
    res.sendFile(
      page('relatorios.html')
    )
);

app.get(
  '/configuracoes',
  (req,res)=>
    res.sendFile(
      page('configuracoes.html')
    )
);

app.get(
  '/base-conhecimento',
  (req,res)=>
    res.sendFile(
      page(
        'base-conhecimento.html'
      )
    )
);

app.get(
  '/criar-conta',
  (req,res)=>
    res.sendFile(
      page('criar-conta.html')
    )
);

app.get(
  '/plataforma',
  (req,res)=>
    res.sendFile(
      page('plataforma.html')
    )
);

app.get(
  '/apresentacao',
  (req,res)=>
    res.sendFile(
      page('apresentacao.html')
    )
);


/* ============================================
   AUTH API
   ============================================ */

app.post(
  '/api/auth/login',
  async(req,res)=>{
    const username=
      lower(req.body.username);

    const password=
      String(
        req.body.password||''
      );

    const r=await query(
      `
      SELECT
        u.*,
        o.status organization_status
      FROM users u
      JOIN organizations o
        ON o.id=u.organization_id
      WHERE LOWER(u.username)=$1
      `,
      [username]
    );

    const u=r.rows[0];

    if(
      !u ||
      u.status!=='active' ||
      u.organization_status==='suspended' ||
      !(
        await bcrypt.compare(
          password,
          u.password_hash
        )
      )
    ){
      return res
        .status(401)
        .json({
          error:
            'Usuário ou senha inválidos.'
        });
    }

    await query(
      `
      UPDATE users
      SET last_login_at=NOW()
      WHERE id=$1
      `,
      [u.id]
    );

    res.cookie(
      'token',
      tokenFor(u),
      {
        httpOnly:true,
        sameSite:'lax',
        secure:
          process.env.NODE_ENV===
          'production',
        maxAge:
          12*60*60*1000
      }
    );

    res.json({
      ok:true
    });
  }
);


app.post(
  '/api/auth/logout',
  (req,res)=>{
    res.clearCookie('token');

    res.json({
      ok:true
    });
  }
);


app.get(
  '/api/auth/me',
  requireAuth,
  (req,res)=>{
    res.json({
      user:req.user
    });
  }
);


/* ============================================
   USERS
   ============================================ */

app.get(
  '/api/users',
  requireAuth,
  async(req,res)=>{
    const r=await query(
      `
      SELECT
        id,
        name,
        username,
        email,
        department,
        role,
        status,
        photo_data,
        created_at,
        last_login_at
      FROM users
      WHERE organization_id=$1
      ORDER BY
        CASE role
          WHEN 'admin' THEN 1
          WHEN 'agent' THEN 2
          ELSE 3
        END,
        name
      `,
      [tenant(req)]
    );

    res.json({
      users:r.rows
    });
  }
);


app.post(
  '/api/users',
  requireAuth,
  requireRole('admin'),
  async(req,res)=>{
    const oid=
      tenant(req);

    const org=(
      await query(
        `
        SELECT user_limit
        FROM organizations
        WHERE id=$1
        `,
        [oid]
      )
    ).rows[0];

    const count=
      Number(
        (
          await query(
            `
            SELECT COUNT(*) n
            FROM users
            WHERE organization_id=$1
              AND status<>'blocked'
            `,
            [oid]
          )
        ).rows[0].n
      );

    if(
      count>=
      Number(
        org.user_limit
      )
    ){
      return res
        .status(409)
        .json({
          error:
            'Limite de usuários do plano atingido.'
        });
    }

    const name=
      clean(
        req.body.name,
        120
      );

    const username=
      lower(
        req.body.username
      );

    const password=
      String(
        req.body.password||''
      );

    const role=[
      'admin',
      'agent',
      'requester'
    ].includes(
      req.body.role
    )
      ?req.body.role
      :'requester';

    const userStatus=[
      'active',
      'pending',
      'blocked'
    ].includes(
      req.body.status
    )
      ?req.body.status
      :'active';

    if(
      name.length<3 ||
      username.length<3 ||
      password.length<8 ||
      !/^[a-z0-9._-]+$/.test(
        username
      )
    ){
      return res
        .status(400)
        .json({
          error:'Dados inválidos.'
        });
    }

    try{
      const r=
        await query(
          `
          INSERT INTO users(
            organization_id,
            name,
            username,
            email,
            department,
            role,
            status,
            password_hash
          )
          VALUES(
            $1,$2,$3,$4,
            $5,$6,$7,$8
          )
          RETURNING
            id,
            name,
            username,
            email,
            department,
            role,
            status
          `,
          [
            oid,
            name,
            username,
            clean(
              req.body.email,
              160
            ),
            clean(
              req.body.department,
              100
            ),
            role,
            userStatus,
            await bcrypt.hash(
              password,
              12
            )
          ]
        );

      await audit(
        oid,
        req.user.id,
        'user_created',
        'user',
        r.rows[0].id,
        {
          role
        }
      );

      res
        .status(201)
        .json({
          user:r.rows[0]
        });

    }catch(e){
      if(e.code==='23505'){
        return res
          .status(409)
          .json({
            error:
              'Usuário já existe.'
          });
      }

      throw e;
    }
  }
);


/* ============================================
   TICKETS
   ============================================ */

app.get(
  '/api/tickets',
  requireAuth,
  async(req,res)=>{
    const oid=
      tenant(req);

    const args=[oid];

    const where=[
      't.organization_id=$1'
    ];

    const q=
      clean(
        req.query.q,
        100
      );

    if(
      req.user.role===
      'requester'
    ){
      args.push(
        req.user.id
      );

      where.push(
        `t.requester_id=$${args.length}`
      );
    }

    if(q){
      args.push(
        `%${q}%`
      );

      where.push(
        `(t.title ILIKE $${args.length}
        OR CAST(t.id AS TEXT) ILIKE $${args.length}
        OR r.name ILIKE $${args.length})`
      );
    }

    const r=
      await query(
        `
        SELECT
          t.*,
          r.name requester_name,
          a.name assigned_name
        FROM tickets t
        JOIN users r
          ON r.id=t.requester_id
        LEFT JOIN users a
          ON a.id=t.assigned_to
        WHERE
          ${where.join(' AND ')}
        ORDER BY
          t.created_at DESC
        LIMIT 500
        `,
        args
      );

    res.json({
      tickets:r.rows
    });
  }
);


app.post(
  '/api/tickets',
  requireAuth,
  async(req,res)=>{
    const oid=
      tenant(req);

    const title=
      clean(
        req.body.title,
        180
      );

    const category=
      clean(
        req.body.category,
        80
      );

    const p=
      priority(
        req.body.priority
      );

    const imp=
      impact(
        req.body.impact
      );

    const description=
      clean(
        req.body.description,
        5000
      );

    if(
      title.length<3 ||
      !category ||
      description.length<5
    ){
      return res
        .status(400)
        .json({
          error:
            'Preencha título, categoria e descrição.'
        });
    }

    const due=
      await dueFor(
        oid,
        p
      );

    const r=
      await query(
        `
        INSERT INTO tickets(
          organization_id,
          title,
          category,
          priority,
          impact,
          description,
          requester_id,
          due_at,
          location
        )
        VALUES(
          $1,$2,$3,$4,$5,
          $6,$7,$8,$9
        )
        RETURNING id
        `,
        [
          oid,
          title,
          category,
          p,
          imp,
          description,
          req.user.id,
          due,
          clean(
            req.body.location,
            140
          )||null
        ]
      );

    const id=
      Number(
        r.rows[0].id
      );

    await event(
      req,
      id,
      'created',
      {
        priority:p,
        impact:imp
      }
    );

    res
      .status(201)
      .json({
        id
      });
  }
);


app.get(
  '/api/tickets/:id',
  requireAuth,
  async(req,res)=>{
    const oid=
      tenant(req);

    const id=
      Number(
        req.params.id
      );

    const t=(
      await query(
        `
        SELECT
          t.*,
          r.name requester_name,
          a.name assigned_name
        FROM tickets t
        JOIN users r
          ON r.id=t.requester_id
        LEFT JOIN users a
          ON a.id=t.assigned_to
        WHERE
          t.id=$1
          AND t.organization_id=$2
        `,
        [
          id,
          oid
        ]
      )
    ).rows[0];

    if(
      !t ||
      !canSee(
        req.user,
        t
      )
    ){
      return res
        .status(404)
        .json({
          error:
            'Chamado não encontrado.'
        });
    }

    const comments=
      await query(
        `
        SELECT
          c.*,
          u.name author_name,
          u.role author_role
        FROM comments c
        JOIN users u
          ON u.id=c.author_id
        WHERE
          c.ticket_id=$1
          AND c.organization_id=$2
        ORDER BY
          c.created_at
        `,
        [
          id,
          oid
        ]
      );

    res.json({
      ticket:t,
      comments:comments.rows
    });
  }
);


app.patch(
  '/api/tickets/:id',
  requireAuth,
  requireRole(
    'admin',
    'agent'
  ),
  async(req,res)=>{
    const oid=
      tenant(req);

    const id=
      Number(
        req.params.id
      );

    const t=(
      await query(
        `
        SELECT *
        FROM tickets
        WHERE
          id=$1
          AND organization_id=$2
        `,
        [
          id,
          oid
        ]
      )
    ).rows[0];

    if(!t){
      return res
        .status(404)
        .json({
          error:
            'Chamado não encontrado.'
        });
    }

    const st=
      status(
        req.body.status??
        t.status
      );

    const p=
      priority(
        req.body.priority??
        t.priority
      );

    const imp=
      impact(
        req.body.impact??
        t.impact
      );

    const assigned=
      req.body.assignedTo
        ?Number(
            req.body.assignedTo
          )
        :null;

    const due=
      p!==t.priority
        ?await dueFor(
            oid,
            p
          )
        :t.due_at;

    const resolved=
      [
        'resolved',
        'closed'
      ].includes(st)
        ?(
          t.resolved_at||
          new Date()
            .toISOString()
        )
        :null;

    await query(
      `
      UPDATE tickets
      SET
        status=$1,
        priority=$2,
        impact=$3,
        assigned_to=$4,
        location=$5,
        due_at=$6,
        resolved_at=$7,
        updated_at=NOW()
      WHERE
        id=$8
        AND organization_id=$9
      `,
      [
        st,
        p,
        imp,
        assigned,
        clean(
          req.body.location??
          t.location,
          140
        )||null,
        due,
        resolved,
        id,
        oid
      ]
    );

    await event(
      req,
      id,
      'updated',
      {
        status:st,
        priority:p
      }
    );

    await notify(
      oid,
      t.requester_id,
      id,
      `Chamado #${id} atualizado`,
      'O chamado recebeu uma atualização.'
    );

    res.json({
      ok:true
    });
  }
);


/* ============================================
   COMMENTS
   ============================================ */

app.post(
  '/api/tickets/:id/comments',
  requireAuth,
  async(req,res)=>{
    const oid=
      tenant(req);

    const id=
      Number(
        req.params.id
      );

    const t=(
      await query(
        `
        SELECT *
        FROM tickets
        WHERE
          id=$1
          AND organization_id=$2
        `,
        [
          id,
          oid
        ]
      )
    ).rows[0];

    const body=
      clean(
        req.body.body,
        3000
      );

    if(
      !t ||
      !canSee(
        req.user,
        t
      )
    ){
      return res
        .status(404)
        .json({
          error:
            'Chamado não encontrado.'
        });
    }

    if(body.length<2){
      return res
        .status(400)
        .json({
          error:
            'Comentário muito curto.'
        });
    }

    await query(
      `
      INSERT INTO comments(
        organization_id,
        ticket_id,
        author_id,
        body
      )
      VALUES(
        $1,$2,$3,$4
      )
      `,
      [
        oid,
        id,
        req.user.id,
        body
      ]
    );

    if(
      req.user.role!==
        'requester' &&
      !t.first_response_at
    ){
      await query(
        `
        UPDATE tickets
        SET first_response_at=NOW()
        WHERE
          id=$1
          AND organization_id=$2
        `,
        [
          id,
          oid
        ]
      );
    }

    await event(
      req,
      id,
      'commented'
    );

    res
      .status(201)
      .json({
        ok:true
      });
  }
);


/* ============================================
   ASSETS
   ============================================ */

app.get(
  '/api/assets',
  requireAuth,
  requireRole(
    'admin',
    'agent'
  ),
  async(req,res)=>{
    const oid=
      tenant(req);

    const r=
      await query(
        `
        SELECT
          a.*,
          u.name assigned_user_name
        FROM assets a
        LEFT JOIN users u
          ON u.id=a.assigned_user_id
        WHERE
          a.organization_id=$1
        ORDER BY
          a.updated_at DESC
        LIMIT 500
        `,
        [oid]
      );

    res.json({
      assets:r.rows
    });
  }
);


app.post(
  '/api/assets',
  requireAuth,
  requireRole(
    'admin',
    'agent'
  ),
  async(req,res)=>{
    const oid=
      tenant(req);

    const tag=
      clean(
        req.body.assetTag,
        60
      );

    const name=
      clean(
        req.body.name,
        140
      );

    if(
      !tag ||
      !name
    ){
      return res
        .status(400)
        .json({
          error:
            'Patrimônio e nome são obrigatórios.'
        });
    }

    try{
      const r=
        await query(
          `
          INSERT INTO assets(
            organization_id,
            asset_tag,
            name,
            asset_type,
            manufacturer,
            model,
            serial_number,
            status,
            assigned_user_id,
            department,
            location,
            notes
          )
          VALUES(
            $1,$2,$3,$4,
            $5,$6,$7,$8,
            $9,$10,$11,$12
          )
          RETURNING id
          `,
          [
            oid,
            tag,
            name,
            clean(
              req.body.assetType,
              80
            )||
              'Equipamento',

            clean(
              req.body.manufacturer,
              100
            )||null,

            clean(
              req.body.model,
              120
            )||null,

            clean(
              req.body.serialNumber,
              120
            )||null,

            [
              'active',
              'maintenance',
              'stock',
              'retired'
            ].includes(
              req.body.status
            )
              ?req.body.status
              :'active',

            req.body.assignedUserId
              ?Number(
                  req.body.assignedUserId
                )
              :null,

            clean(
              req.body.department,
              100
            )||null,

            clean(
              req.body.location,
              140
            )||null,

            clean(
              req.body.notes,
              2000
            )||null
          ]
        );

      res
        .status(201)
        .json({
          id:Number(
            r.rows[0].id
          )
        });

    }catch(e){
      if(e.code==='23505'){
        return res
          .status(409)
          .json({
            error:
              'Patrimônio já existe nesta empresa.'
          });
      }

      throw e;
    }
  }
);


/* ============================================
   KNOWLEDGE
   ============================================ */

app.get(
  '/api/knowledge',
  requireAuth,
  async(req,res)=>{
    const oid=
      tenant(req);

    const args=[oid];

    const where=[
      'k.organization_id=$1'
    ];

    if(
      req.user.role!==
        'admin' &&
      !req.user.isSuperAdmin
    ){
      where.push(
        'k.published=true'
      );
    }

    const q=
      clean(
        req.query.q,
        100
      );

    if(q){
      args.push(
        `%${q}%`
      );

      where.push(
        `(k.title ILIKE $${args.length}
        OR k.summary ILIKE $${args.length}
        OR k.content ILIKE $${args.length})`
      );
    }

    const r=
      await query(
        `
        SELECT
          k.*,
          u.name author_name
        FROM knowledge_articles k
        LEFT JOIN users u
          ON u.id=k.author_id
        WHERE
          ${where.join(' AND ')}
        ORDER BY
          k.updated_at DESC
        LIMIT 200
        `,
        args
      );

    res.json({
      articles:r.rows
    });
  }
);


/* ============================================
   NOTIFICATIONS
   ============================================ */

app.get(
  '/api/notifications',
  requireAuth,
  async(req,res)=>{
    const r=
      await query(
        `
        SELECT *
        FROM notifications
        WHERE
          organization_id=$1
          AND user_id=$2
        ORDER BY
          created_at DESC
        LIMIT 30
        `,
        [
          tenant(req),
          req.user.id
        ]
      );

    res.json({
      notifications:r.rows,

      unread:
        r.rows.filter(
          x=>!x.is_read
        ).length
    });
  }
);


app.patch(
  '/api/notifications/:id/read',
  requireAuth,
  async(req,res)=>{
    await query(
      `
      UPDATE notifications
      SET is_read=true
      WHERE
        id=$1
        AND organization_id=$2
        AND user_id=$3
      `,
      [
        Number(
          req.params.id
        ),
        tenant(req),
        req.user.id
      ]
    );

    res.json({
      ok:true
    });
  }
);


app.post(
  '/api/notifications/read-all',
  requireAuth,
  async(req,res)=>{
    await query(
      `
      UPDATE notifications
      SET is_read=true
      WHERE
        organization_id=$1
        AND user_id=$2
      `,
      [
        tenant(req),
        req.user.id
      ]
    );

    res.json({
      ok:true
    });
  }
);


/* ============================================
   DASHBOARD
   ============================================ */

app.get(
  '/api/dashboard',
  requireAuth,
  async(req,res)=>{
    const oid=
      tenant(req);

    const requester=
      req.user.role===
      'requester';

    const args=
      requester
        ?[
          oid,
          req.user.id
        ]
        :[oid];

    const where=
      requester
        ?'organization_id=$1 AND requester_id=$2'
        :'organization_id=$1';

    const k=(
      await query(
        `
        SELECT
          COUNT(*)::int total,

          COUNT(*) FILTER(
            WHERE status='open'
          )::int open,

          COUNT(*) FILTER(
            WHERE status='progress'
          )::int progress,

          COUNT(*) FILTER(
            WHERE priority='urgent'
            AND status NOT IN(
              'resolved',
              'closed'
            )
          )::int urgent,

          COUNT(*) FILTER(
            WHERE assigned_to IS NULL
            AND status NOT IN(
              'resolved',
              'closed'
            )
          )::int unassigned,

          COUNT(*) FILTER(
            WHERE due_at<NOW()
            AND status NOT IN(
              'resolved',
              'closed'
            )
          )::int overdue,

          COUNT(*) FILTER(
            WHERE resolved_at::date=
              CURRENT_DATE
          )::int resolved_today

        FROM tickets
        WHERE ${where}
        `,
        args
      )
    ).rows[0];

    res.json({
      kpis:k
    });
  }
);


/* ============================================
   REPORTS
   ============================================ */

app.get(
  '/api/reports',
  requireAuth,
  requireRole('admin'),
  async(req,res)=>{
    const oid=
      tenant(req);

    const k=(
      await query(
        `
        SELECT
          COUNT(*)::int total,

          COUNT(*) FILTER(
            WHERE status='open'
          )::int open,

          COUNT(*) FILTER(
            WHERE status='progress'
          )::int progress,

          COUNT(*) FILTER(
            WHERE status IN(
              'resolved',
              'closed'
            )
          )::int finished,

          COUNT(*) FILTER(
            WHERE due_at<NOW()
            AND status NOT IN(
              'resolved',
              'closed'
            )
          )::int overdue

        FROM tickets
        WHERE organization_id=$1
        `,
        [oid]
      )
    ).rows[0];

    res.json({
      kpis:k
    });
  }
);


/* ============================================
   CONFIGURAÇÕES
   ============================================ */

app.get(
  '/api/config',
  requireAuth,
  requireRole('admin'),
  async(req,res)=>{
    const oid=
      tenant(req);

    const[
      categories,
      departments,
      settings,
      organization
    ]=await Promise.all([
      query(
        `
        SELECT *
        FROM categories
        WHERE organization_id=$1
        ORDER BY name
        `,
        [oid]
      ),

      query(
        `
        SELECT *
        FROM departments
        WHERE organization_id=$1
        ORDER BY name
        `,
        [oid]
      ),

      query(
        `
        SELECT
          key,
          value
        FROM organization_settings
        WHERE organization_id=$1
        `,
        [oid]
      ),

      query(
        `
        SELECT *
        FROM organizations
        WHERE id=$1
        `,
        [oid]
      )
    ]);

    res.json({
      categories:
        categories.rows,

      departments:
        departments.rows,

      settings:
        Object.fromEntries(
          settings.rows.map(
            x=>[
              x.key,
              x.value
            ]
          )
        ),

      organization:
        organization.rows[0]
    });
  }
);


app.post(
  '/api/config/categories',
  requireAuth,
  requireRole('admin'),
  async(req,res)=>{
    try{
      await query(
        `
        INSERT INTO categories(
          organization_id,
          name
        )
        VALUES(
          $1,$2
        )
        `,
        [
          tenant(req),
          clean(
            req.body.name,
            80
          )
        ]
      );

      res
        .status(201)
        .json({
          ok:true
        });

    }catch(e){
      if(e.code==='23505'){
        return res
          .status(409)
          .json({
            error:
              'Categoria já existe.'
          });
      }

      throw e;
    }
  }
);


app.patch(
  '/api/config/categories/:id',
  requireAuth,
  requireRole('admin'),
  async(req,res)=>{
    await query(
      `
      UPDATE categories
      SET
        name=$1,
        active=$2
      WHERE
        id=$3
        AND organization_id=$4
      `,
      [
        clean(
          req.body.name,
          80
        ),

        Boolean(
          req.body.active
        ),

        Number(
          req.params.id
        ),

        tenant(req)
      ]
    );

    res.json({
      ok:true
    });
  }
);


app.post(
  '/api/config/departments',
  requireAuth,
  requireRole('admin'),
  async(req,res)=>{
    try{
      await query(
        `
        INSERT INTO departments(
          organization_id,
          name
        )
        VALUES(
          $1,$2
        )
        `,
        [
          tenant(req),

          clean(
            req.body.name,
            100
          )
        ]
      );

      res
        .status(201)
        .json({
          ok:true
        });

    }catch(e){
      if(e.code==='23505'){
        return res
          .status(409)
          .json({
            error:
              'Setor já existe.'
          });
      }

      throw e;
    }
  }
);


app.patch(
  '/api/config/departments/:id',
  requireAuth,
  requireRole('admin'),
  async(req,res)=>{
    await query(
      `
      UPDATE departments
      SET
        name=$1,
        active=$2
      WHERE
        id=$3
        AND organization_id=$4
      `,
      [
        clean(
          req.body.name,
          100
        ),

        Boolean(
          req.body.active
        ),

        Number(
          req.params.id
        ),

        tenant(req)
      ]
    );

    res.json({
      ok:true
    });
  }
);


app.patch(
  '/api/config/settings',
  requireAuth,
  requireRole('admin'),
  async(req,res)=>{
    const oid=
      tenant(req);

    const allowed=[
      'brand_name',
      'company_name',
      'brand_tagline',
      'support_email',
      'sla_low',
      'sla_medium',
      'sla_high',
      'sla_urgent',
      'primary_color',
      'brand_logo'
    ];

    for(
      const key
      of allowed
    ){
      if(
        req.body[key]===
        undefined
      ){
        continue;
      }

      let v=
        clean(
          req.body[key],
          160
        );

      if(
        key.startsWith(
          'sla_'
        )
      ){
        v=String(
          Math.max(
            1,
            Math.min(
              720,
              Number(v)||1
            )
          )
        );
      }

      if(
        key===
          'primary_color' &&
        !/^#[0-9a-fA-F]{6}$/.test(
          v
        )
      ){
        v='#56d4c4';
      }

      await query(
        `
        INSERT INTO organization_settings(
          organization_id,
          key,
          value,
          updated_at
        )
        VALUES(
          $1,$2,$3,NOW()
        )

        ON CONFLICT(
          organization_id,
          key
        )

        DO UPDATE SET
          value=
            EXCLUDED.value,
          updated_at=
            NOW()
        `,
        [
          oid,
          key,
          v
        ]
      );
    }

    res.json({
      ok:true
    });
  }
);


/* ============================================
   SUPER ADMIN / PLATFORM
   ============================================ */

app.get(
  '/api/platform/plans',
  requireAuth,
  requireSuperAdmin,
  (req,res)=>{
    res.json({
      plans:[
        {
          id:'start',
          name:'Start',
          price:14900,
          userLimit:5
        },

        {
          id:'business',
          name:'Business',
          price:29900,
          userLimit:20
        },

        {
          id:'pro',
          name:'Pro',
          price:49900,
          userLimit:50
        }
      ]
    });
  }
);


app.get(
  '/api/platform/organizations',
  requireAuth,
  requireSuperAdmin,
  async(req,res)=>{
    const r=
      await query(
        `
        SELECT
          o.*,

          COUNT(
            DISTINCT u.id
          )::int users,

          COUNT(
            DISTINCT t.id
          )::int tickets,

          COUNT(
            DISTINCT t.id
          ) FILTER(
            WHERE
              t.status NOT IN(
                'resolved',
                'closed'
              )
          )::int backlog,

          MAX(
            u.last_login_at
          ) last_activity_at

        FROM organizations o

        LEFT JOIN users u
          ON u.organization_id=o.id

        LEFT JOIN tickets t
          ON t.organization_id=o.id

        GROUP BY o.id

        ORDER BY
          o.created_at DESC
        `
      );

    res.json({
      organizations:r.rows
    });
  }
);


app.get(
  '/api/platform/summary',
  requireAuth,
  requireSuperAdmin,
  async(req,res)=>{
    const r=(
      await query(
        `
        SELECT

          (
            SELECT COUNT(*)::int
            FROM organizations
          ) organizations,

          (
            SELECT COUNT(*)::int
            FROM organizations
            WHERE status='active'
          ) active,

          (
            SELECT COUNT(*)::int
            FROM organizations
            WHERE status='trial'
          ) trials,

          (
            SELECT COUNT(*)::int
            FROM organizations
            WHERE status='suspended'
          ) suspended,

          (
            SELECT COUNT(*)::int
            FROM users
            WHERE status='active'
          ) users,

          (
            SELECT COUNT(*)::int
            FROM tickets
          ) tickets,

          (
            SELECT COUNT(*)::int
            FROM tickets
            WHERE status NOT IN(
              'resolved',
              'closed'
            )
          ) backlog
        `
      )
    ).rows[0];

    const prices={
      start:14900,
      business:29900,
      pro:49900
    };

    const plans=(
      await query(
        `
        SELECT
          plan,
          COUNT(*)::int n
        FROM organizations
        WHERE status='active'
        GROUP BY plan
        `
      )
    ).rows;

    r.mrr_cents=
      plans.reduce(
        (
          sum,
          x
        )=>
          sum+
          (
            prices[x.plan]||0
          )*
          Number(x.n),
        0
      );

    res.json(r);
  }
);


app.post(
  '/api/platform/organizations',
  requireAuth,
  requireSuperAdmin,
  async(req,res)=>{
    const name=
      clean(
        req.body.name,
        160
      );

    const slug=
      clean(
        req.body.slug,
        80
      )
      .toLowerCase()
      .replace(
        /[^a-z0-9-]/g,
        '-'
      )
      .replace(
        /-+/g,
        '-'
      )
      .replace(
        /^-|-$/g,
        ''
      );

    const plan=[
      'start',
      'business',
      'pro'
    ].includes(
      req.body.plan
    )
      ?req.body.plan
      :'start';

    const defaults={
      start:5,
      business:20,
      pro:50
    };

    const limit=
      Math.max(
        1,
        Math.min(
          1000,
          Number(
            req.body.userLimit
          )||
          defaults[plan]
        )
      );

    const trialDays=
      Math.max(
        0,
        Math.min(
          90,
          Number(
            req.body.trialDays
          )||0
        )
      );

    const adminName=
      clean(
        req.body.adminName,
        120
      );

    const username=
      clean(
        req.body.adminUsername,
        60
      ).toLowerCase();

    const password=
      String(
        req.body.adminPassword||
        ''
      );

    const billingEmail=
      clean(
        req.body.billingEmail,
        160
      )||null;

    const contactName=
      clean(
        req.body.contactName,
        120
      )||null;

    const contactPhone=
      clean(
        req.body.contactPhone,
        40
      )||null;

    const notes=
      clean(
        req.body.commercialNotes,
        3000
      )||null;

    if(
      name.length<2 ||
      slug.length<2 ||
      adminName.length<3 ||
      username.length<3 ||
      password.length<8
    ){
      return res
        .status(400)
        .json({
          error:
            'Preencha empresa e administrador corretamente.'
        });
    }

    if(
      !/^[a-z0-9._-]+$/.test(
        username
      )
    ){
      return res
        .status(400)
        .json({
          error:
            'Usuário do administrador inválido.'
        });
    }

    try{
      const orgStatus=
        trialDays>0
          ?'trial'
          :'active';

      const trialEnds=
        trialDays>0
          ?new Date(
              Date.now()+
              trialDays*
              86400000
            ).toISOString()
          :null;

      const o=(
        await query(
          `
          INSERT INTO organizations(
            name,
            slug,
            status,
            plan,
            user_limit,
            trial_days,
            trial_ends_at,
            billing_email,
            contact_name,
            contact_phone,
            commercial_notes
          )
          VALUES(
            $1,$2,$3,$4,$5,
            $6,$7,$8,$9,$10,$11
          )
          RETURNING *
          `,
          [
            name,
            slug,
            orgStatus,
            plan,
            limit,
            trialDays,
            trialEnds,
            billingEmail,
            contactName,
            contactPhone,
            notes
          ]
        )
      ).rows[0];

      const defaultSettings={
        brand_name:
          'Central de Serviços',

        company_name:
          name,

        brand_tagline:
          'Service Management & Support',

        support_email:
          billingEmail||'',

        primary_color:
          '#56d4c4',

        sla_low:'72',
        sla_medium:'48',
        sla_high:'24',
        sla_urgent:'4'
      };

      for(
        const[
          k,
          v
        ]
        of Object.entries(
          defaultSettings
        )
      ){
        await query(
          `
          INSERT INTO organization_settings(
            organization_id,
            key,
            value
          )
          VALUES(
            $1,$2,$3
          )
          `,
          [
            o.id,
            k,
            v
          ]
        );
      }

      for(
        const c
        of[
          'Hardware',
          'Software',
          'Rede',
          'Acesso',
          'Segurança',
          'Outro'
        ]
      ){
        await query(
          `
          INSERT INTO categories(
            organization_id,
            name
          )
          VALUES(
            $1,$2
          )
          `,
          [
            o.id,
            c
          ]
        );
      }

      for(
        const d
        of[
          'Administração',
          'TI',
          'Financeiro',
          'RH',
          'Operação',
          'Comercial'
        ]
      ){
        await query(
          `
          INSERT INTO departments(
            organization_id,
            name
          )
          VALUES(
            $1,$2
          )
          `,
          [
            o.id,
            d
          ]
        );
      }

      const u=(
        await query(
          `
          INSERT INTO users(
            organization_id,
            name,
            username,
            email,
            department,
            role,
            status,
            password_hash
          )
          VALUES(
            $1,$2,$3,$4,
            'Administração',
            'admin',
            'active',
            $5
          )
          RETURNING id
          `,
          [
            o.id,
            adminName,
            username,

            clean(
              req.body.adminEmail,
              160
            )||
              billingEmail,

            await bcrypt.hash(
              password,
              12
            )
          ]
        )
      ).rows[0];

      await query(
        `
        INSERT INTO audit_logs(
          organization_id,
          actor_id,
          action,
          target_type,
          target_id,
          details
        )
        VALUES(
          $1,$2,$3,$4,$5,$6
        )
        `,
        [
          o.id,
          req.user.id,
          'organization_created',
          'organization',
          o.id,
          JSON.stringify({
            plan,
            status:orgStatus,
            trialDays
          })
        ]
      );

      res
        .status(201)
        .json({
          organizationId:
            Number(o.id),

          adminId:
            Number(u.id),

          status:
            orgStatus,

          trialEnds
        });

    }catch(e){
      if(e.code==='23505'){
        return res
          .status(409)
          .json({
            error:
              'Slug ou usuário já está em uso.'
          });
      }

      throw e;
    }
  }
);


app.patch(
  '/api/platform/organizations/:id',
  requireAuth,
  requireSuperAdmin,
  async(req,res)=>{
    const id=
      Number(
        req.params.id
      );

    const o=(
      await query(
        `
        SELECT *
        FROM organizations
        WHERE id=$1
        `,
        [id]
      )
    ).rows[0];

    if(!o){
      return res
        .status(404)
        .json({
          error:
            'Empresa não encontrada.'
        });
    }

    const st=[
      'active',
      'trial',
      'suspended'
    ].includes(
      req.body.status
    )
      ?req.body.status
      :o.status;

    const plan=[
      'start',
      'business',
      'pro'
    ].includes(
      req.body.plan
    )
      ?req.body.plan
      :o.plan;

    const limit=
      Math.max(
        1,
        Math.min(
          1000,
          Number(
            req.body.userLimit
          )||
          o.user_limit
        )
      );

    const trialDays=
      Math.max(
        0,
        Math.min(
          90,
          Number(
            req.body.trialDays??
            o.trial_days
          )||0
        )
      );

    const trialEnds=
      req.body.trialEndsAt
        ?new Date(
            req.body.trialEndsAt
          ).toISOString()
        :o.trial_ends_at;

    const subEnds=
      req.body.subscriptionEndsAt
        ?new Date(
            req.body.subscriptionEndsAt
          ).toISOString()
        :null;

    await query(
      `
      UPDATE organizations
      SET
        name=$1,
        status=$2,
        plan=$3,
        user_limit=$4,
        trial_days=$5,
        trial_ends_at=$6,
        subscription_ends_at=$7,
        billing_email=$8,
        contact_name=$9,
        contact_phone=$10,
        commercial_notes=$11,
        updated_at=NOW()
      WHERE id=$12
      `,
      [
        clean(
          req.body.name??
          o.name,
          160
        ),

        st,
        plan,
        limit,
        trialDays,
        trialEnds,
        subEnds,

        clean(
          req.body.billingEmail??
          o.billing_email,
          160
        )||null,

        clean(
          req.body.contactName??
          o.contact_name,
          120
        )||null,

        clean(
          req.body.contactPhone??
          o.contact_phone,
          40
        )||null,

        clean(
          req.body.commercialNotes??
          o.commercial_notes,
          3000
        )||null,

        id
      ]
    );

    res.json({
      ok:true
    });
  }
);


/* ============================================
   BILLING / MERCADO PAGO
   ============================================ */

const BILLING_PLANS={
  start:{
    id:'start',
    name:'Start',
    price:149,
    priceCents:14900,
    userLimit:5,
    description:
      'Central de Serviços Start'
  },

  business:{
    id:'business',
    name:'Business',
    price:299,
    priceCents:29900,
    userLimit:20,
    description:
      'Central de Serviços Business'
  },

  pro:{
    id:'pro',
    name:'Pro',
    price:499,
    priceCents:49900,
    userLimit:50,
    description:
      'Central de Serviços Pro'
  }
};


async function mercadoPagoRequest(
  apiPath,
  options={}
){
  if(
    !process.env.MP_ACCESS_TOKEN
  ){
    const e=
      new Error(
        'Mercado Pago não configurado.'
      );

    e.status=503;

    throw e;
  }

  const response=
    await fetch(
      `https://api.mercadopago.com${apiPath}`,
      {
        ...options,

        headers:{
          Authorization:
            `Bearer ${process.env.MP_ACCESS_TOKEN}`,

          'Content-Type':
            'application/json',

          ...(
            options.headers||
            {}
          )
        }
      }
    );

  const data=
    await response
      .json()
      .catch(
        ()=>({})
      );

  if(!response.ok){
    console.error(
      'Mercado Pago:',
      response.status,
      data
    );

    const e=
      new Error(
        data.message ||
        data.error ||
        'Falha na comunicação com o Mercado Pago.'
      );

    e.status=502;

    throw e;
  }

  return data;
}


/* PLANOS PÚBLICOS */

app.get(
  '/api/billing/plans',
  (req,res)=>{
    res.json({
      currency:'BRL',
      frequency:1,
      frequencyType:'months',
      plans:
        Object.values(
          BILLING_PLANS
        )
    });
  }
);


/* CRIAR ASSINATURA */

app.post(
  '/api/billing/subscribe',
  requireAuth,
  async(req,res)=>{
    const organizationId=
      tenant(req);

    const planId=
      clean(
        req.body.plan,
        30
      ).toLowerCase();

    const plan=
      BILLING_PLANS[
        planId
      ];

    if(!plan){
      return res
        .status(400)
        .json({
          error:
            'Plano inválido.'
        });
    }

    const organization=(
      await query(
        `
        SELECT *
        FROM organizations
        WHERE id=$1
        `,
        [
          organizationId
        ]
      )
    ).rows[0];

    if(!organization){
      return res
        .status(404)
        .json({
          error:
            'Empresa não encontrada.'
        });
    }

    /*
     * Evita criar várias assinaturas
     * para a mesma empresa.
     */

    if(
      organization
        .mp_subscription_id &&
      [
        'authorized',
        'pending',
        'paused'
      ].includes(
        String(
          organization
            .billing_status||
          ''
        ).toLowerCase()
      )
    ){
      return res
        .status(409)
        .json({
          error:
            'Esta empresa já possui uma assinatura vinculada.'
        });
    }

    const payerEmail=
      clean(
        req.body.email ||
        organization.billing_email ||
        req.user.email,
        160
      );

    if(!payerEmail){
      return res
        .status(400)
        .json({
          error:
            'Informe um e-mail de cobrança.'
        });
    }

    const baseUrl=
      (
        process.env.APP_URL ||
        `${req.protocol}://${req.get('host')}`
      )
      .replace(
        /\/+$/,
        ''
      );

    const externalReference=
      `org:${organizationId}:plan:${planId}`;

    const subscription=
      await mercadoPagoRequest(
        '/preapproval',
        {
          method:'POST',

          body:
            JSON.stringify({
              reason:
                plan.description,

              external_reference:
                externalReference,

              payer_email:
                payerEmail,

              auto_recurring:{
                frequency:1,

                frequency_type:
                  'months',

                transaction_amount:
                  plan.price,

                currency_id:
                  'BRL'
              },

              back_url:
                `${baseUrl}/plataforma?billing=return`
            })
        }
      );

    /*
     * IMPORTANTE:
     *
     * Ainda NÃO alteramos
     * o plano da empresa.
     *
     * O plano só será ativado
     * quando o webhook confirmar
     * status authorized.
     */

    await query(
      `
      UPDATE organizations
      SET
        billing_email=$1,
        mp_subscription_id=$2,
        billing_status=$3,
        updated_at=NOW()
      WHERE id=$4
      `,
      [
        payerEmail,

        subscription.id||
        null,

        subscription.status||
        'pending',

        organizationId
      ]
    );

    res
      .status(201)
      .json({
        ok:true,

        subscriptionId:
          subscription.id,

        status:
          subscription.status,

        checkoutUrl:
          subscription.init_point,

        plan:
          planId
      });
  }
);


/* STATUS DA ASSINATURA */

app.get(
  '/api/billing/subscription',
  requireAuth,
  async(req,res)=>{
    const organizationId=
      tenant(req);

    const organization=(
      await query(
        `
        SELECT
          id,
          name,
          plan,
          billing_email,
          billing_status,
          mp_subscription_id
        FROM organizations
        WHERE id=$1
        `,
        [
          organizationId
        ]
      )
    ).rows[0];

    if(!organization){
      return res
        .status(404)
        .json({
          error:
            'Empresa não encontrada.'
        });
    }

    if(
      !organization
        .mp_subscription_id
    ){
      return res.json({
        organization,
        subscription:null
      });
    }

    const subscription=
      await mercadoPagoRequest(
        `/preapproval/${
          encodeURIComponent(
            String(
              organization
                .mp_subscription_id
            )
          )
        }`
      );

    res.json({
      organization,

      subscription:{
        id:
          subscription.id,

        status:
          subscription.status,

        payerEmail:
          subscription
            .payer_email,

        nextPaymentDate:
          subscription
            .next_payment_date,

        amount:
          subscription
            .auto_recurring
            ?.transaction_amount,

        currency:
          subscription
            .auto_recurring
            ?.currency_id
      }
    });
  }
);


/* ============================================
   MERCADO PAGO WEBHOOK
   ============================================ */

function validateMercadoPagoWebhook(
  req
){
  const secret=
    String(
      process.env
        .MP_WEBHOOK_SECRET||
      ''
    ).trim();

  const xSignature=
    String(
      req.headers[
        'x-signature'
      ]||
      ''
    );

  const xRequestId=
    String(
      req.headers[
        'x-request-id'
      ]||
      ''
    );

  const dataId=
    req.query['data.id'] ||
    req.query.data_id ||
    req.body?.data?.id;

  if(
    !secret ||
    !xSignature ||
    !xRequestId ||
    !dataId
  ){
    return false;
  }

  const signatureParts={};

  for(
    const part
    of xSignature.split(',')
  ){
    const index=
      part.indexOf('=');

    if(index===-1){
      continue;
    }

    const key=
      part
        .slice(
          0,
          index
        )
        .trim();

    const value=
      part
        .slice(
          index+1
        )
        .trim();

    if(
      key &&
      value
    ){
      signatureParts[
        key
      ]=value;
    }
  }

  const ts=
    signatureParts.ts;

  const receivedHash=
    signatureParts.v1;

  if(
    !ts ||
    !receivedHash
  ){
    return false;
  }

  const manifest=
    `id:${String(dataId).toLowerCase()};`+
    `request-id:${xRequestId};`+
    `ts:${ts};`;

  const expectedHash=
    crypto
      .createHmac(
        'sha256',
        secret
      )
      .update(
        manifest
      )
      .digest(
        'hex'
      );

  const expectedBuffer=
    Buffer.from(
      expectedHash,
      'utf8'
    );

  const receivedBuffer=
    Buffer.from(
      receivedHash,
      'utf8'
    );

  if(
    expectedBuffer.length!==
    receivedBuffer.length
  ){
    return false;
  }

  return crypto
    .timingSafeEqual(
      expectedBuffer,
      receivedBuffer
    );
}


/* RECEBER WEBHOOK */

app.post(
  '/api/billing/webhook',
  async(req,res)=>{
    try{

      if(
        !validateMercadoPagoWebhook(
          req
        )
      ){
        console.warn(
          'Webhook Mercado Pago rejeitado: assinatura inválida.'
        );

        return res
          .sendStatus(401);
      }

      const type=
        String(
          req.body?.type ||
          req.query.type ||
          req.body?.topic ||
          ''
        );

      const dataId=
        req.query['data.id'] ||
        req.query.data_id ||
        req.body?.data?.id;

      console.log(
        'Webhook Mercado Pago recebido:',
        type,
        dataId
      );


      /* ========================================
         ASSINATURA
         ======================================== */

      if(
        type===
        'subscription_preapproval'
      ){
        /*
         * Não confiamos diretamente
         * no status enviado no webhook.
         *
         * Consultamos a assinatura
         * diretamente no Mercado Pago.
         */

        const subscription=
          await mercadoPagoRequest(
            `/preapproval/${
              encodeURIComponent(
                String(
                  dataId
                )
              )
            }`
          );

        const externalReference=
          String(
            subscription
              .external_reference||
            ''
          );

        /*
         * Formato criado
         * anteriormente:
         *
         * org:1:plan:start
         * org:1:plan:business
         * org:1:plan:pro
         */

        const match=
          externalReference
            .match(
              /^org:(\d+):plan:(start|business|pro)$/
            );

        if(!match){
          console.warn(
            'Webhook sem external_reference reconhecida:',
            externalReference
          );

          return res
            .sendStatus(200);
        }

        const organizationId=
          Number(
            match[1]
          );

        const planId=
          match[2];

        const plan=
          BILLING_PLANS[
            planId
          ];

        if(!plan){
          console.warn(
            'Plano não encontrado:',
            planId
          );

          return res
            .sendStatus(200);
        }

        const subscriptionStatus=
          String(
            subscription.status||
            'pending'
          ).toLowerCase();


        /*
         * Só libera o plano
         * quando o Mercado Pago
         * confirmar AUTHORIZED.
         */

        if(
          subscriptionStatus===
          'authorized'
        ){
          await query(
            `
            UPDATE organizations
            SET
              plan=$1,
              user_limit=$2,
              mp_subscription_id=$3,
              billing_status=$4,

              billing_email=
                COALESCE(
                  $5,
                  billing_email
                ),

              status=
                CASE
                  WHEN status='suspended'
                    THEN 'active'
                  ELSE status
                END,

              updated_at=
                NOW()

            WHERE id=$6
            `,
            [
              planId,

              plan.userLimit,

              String(
                subscription.id
              ),

              subscriptionStatus,

              subscription
                .payer_email||
              null,

              organizationId
            ]
          );

          console.log(
            `Assinatura autorizada: empresa ${organizationId} | plano ${planId}`
          );

        }else{
          /*
           * Pending / paused /
           * cancelled etc.
           *
           * Atualizamos somente
           * o estado da cobrança.
           */

          await query(
            `
            UPDATE organizations
            SET
              mp_subscription_id=$1,

              billing_status=$2,

              billing_email=
                COALESCE(
                  $3,
                  billing_email
                ),

              updated_at=
                NOW()

            WHERE id=$4
            `,
            [
              String(
                subscription.id
              ),

              subscriptionStatus,

              subscription
                .payer_email||
              null,

              organizationId
            ]
          );

          console.log(
            `Assinatura sincronizada: empresa ${organizationId} | status ${subscriptionStatus}`
          );
        }

        return res
          .sendStatus(200);
      }


      /* ========================================
         PAGAMENTOS
         ======================================== */

      if(
        type==='payment' ||
        type==='payments' ||
        type===
          'subscription_authorized_payment'
      ){
        /*
         * Nesta primeira versão,
         * confirmamos o evento.
         *
         * Depois podemos criar
         * tabela billing_payments
         * com histórico financeiro.
         */

        console.log(
          'Evento financeiro Mercado Pago recebido:',
          type,
          dataId
        );

        return res
          .sendStatus(200);
      }


      /*
       * Evento não utilizado.
       * Retornamos 200 para evitar
       * novas tentativas desnecessárias.
       */

      console.log(
        'Webhook Mercado Pago ignorado:',
        type
      );

      return res
        .sendStatus(200);

    }catch(error){
      console.error(
        'Erro webhook Mercado Pago:',
        error
      );

      return res
        .sendStatus(500);
    }
  }
);


/* ============================================
   HEALTH
   ============================================ */

app.get(
  '/health',
  (req,res)=>{
    res.json({
      ok:true,
      version:
        '8.0.0-clean',
      mode:
        'multi-tenant-saas',
      billing:
        'mercado-pago',
      time:
        new Date()
          .toISOString()
    });
  }
);


/* ============================================
   404 API
   ============================================ */

app.use(
  '/api',
  (req,res)=>{
    res
      .status(404)
      .json({
        error:
          'Rota não encontrada.'
      });
  }
);


/* ============================================
   ERROR HANDLER
   ============================================ */

app.use(
  (
    err,
    req,
    res,
    next
  )=>{
    console.error(
      err
    );

    res
      .status(
        err.status||
        500
      )
      .json({
        error:
          err.status
            ?err.message
            :'Erro interno do servidor.'
      });
  }
);


/* ============================================
   START SERVER
   ============================================ */

initDatabase()
  .then(
    ()=>{
      app.listen(
        PORT,
        '0.0.0.0',
        ()=>{
          console.log(
            `Central de Serviços V8 Clean em http://localhost:${PORT}`
          );
        }
      );
    }
  )
  .catch(
    e=>{
      console.error(
        'Falha ao iniciar:',
        e
      );

      process.exit(1);
    }
  );