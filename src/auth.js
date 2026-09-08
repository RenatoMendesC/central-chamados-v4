const jwt=require('jsonwebtoken');
const {query}=require('./db');

const COOKIE_NAME='central_session';

function signUser(user){
  return jwt.sign(
    {sub:String(user.id)},
    process.env.JWT_SECRET,
    {expiresIn:'12h',issuer:'central-chamados'}
  );
}

function setAuthCookie(res,user){
  res.cookie(
    COOKIE_NAME,
    signUser(user),
    {
      httpOnly:true,
      secure:process.env.NODE_ENV==='production',
      sameSite:'lax',
      maxAge:12*60*60*1000,
      path:'/'
    }
  );
}

function clearAuthCookie(res){
  res.clearCookie(COOKIE_NAME,{path:'/'});
}

async function loadUser(req){
  const token=req.cookies?.[COOKIE_NAME];
  if(!token)return null;

  try{
    const p=jwt.verify(
      token,
      process.env.JWT_SECRET,
      {issuer:'central-chamados'}
    );

    const r=await query(
      `
      SELECT
        u.id,
        u.organization_id,
        u.is_super_admin,
        u.name,
        u.username,
        u.email,
        u.department,
        u.role,
        u.status,
        u.photo_data,
        u.created_at,
        u.last_login_at,

        o.name organization_name,
        o.slug organization_slug,
        o.status organization_status,
        o.plan organization_plan,
        o.trial_days organization_trial_days,
        o.trial_ends_at organization_trial_ends_at,
        o.billing_status organization_billing_status,
        o.subscription_ends_at organization_subscription_ends_at

      FROM users u
      LEFT JOIN organizations o
        ON o.id=u.organization_id
      WHERE u.id=$1
      `,
      [p.sub]
    );

    const u=r.rows[0];

    if(!u || u.status!=='active'){
      return null;
    }

    /*
      O Super Admin pertence ao Control Plane e não deve
      ser bloqueado pelo estado comercial de uma empresa.
    */
    if(u.is_super_admin){
      u.trial_expired=false;
      u.billing_required=false;
      return u;
    }

    if(!u.organization_id){
      return null;
    }

    /*
      Empresa suspensa continua sem acesso.
      Suspensão é diferente de trial expirado.
    */
    if(u.organization_status==='suspended'){
      return null;
    }

    const now=Date.now();

    const trialEndsAt=
      u.organization_trial_ends_at
        ? new Date(u.organization_trial_ends_at).getTime()
        : null;

    const subscriptionEndsAt=
      u.organization_subscription_ends_at
        ? new Date(u.organization_subscription_ends_at).getTime()
        : null;

    /*
      Trial expirado:
      NÃO invalidamos a sessão.

      Isso permite que o administrador continue autenticado
      e seja direcionado para Configurações / Cobrança.
    */
    u.trial_expired=
      u.organization_status==='trial' &&
      Boolean(trialEndsAt) &&
      trialEndsAt<=now;

    /*
      Uma assinatura com data final vencida também pode
      exigir regularização. Se subscription_ends_at for NULL,
      não consideramos vencida aqui.
    */
    u.subscription_expired=
      Boolean(subscriptionEndsAt) &&
      subscriptionEndsAt<=now;

    /*
      Flag única para o restante da aplicação.
      Depois podemos usá-la no server.js e no front-end para
      restringir operação e liberar apenas cobrança/logout.
    */
    u.billing_required=
      u.trial_expired ||
      u.subscription_expired ||
      (["inactive","pending","cancelled","paused"].includes(u.organization_billing_status) && u.organization_status!=="trial");

    return u;

  }catch{
    return null;
  }
}

async function requireAuth(req,res,next){
  const u=await loadUser(req);

  if(!u){
    clearAuthCookie(res);

    if(req.path.startsWith('/api/')){
      return res.status(401).json({
        error:'Não autenticado.'
      });
    }

    return res.redirect('/');
  }

  req.user=u;

  // Bloqueio central por assinatura
  if(u.billing_required && !u.is_super_admin){
    const allowed=req.path==="/assinatura" || req.path==="/api/me" || req.path==="/api/auth/logout" || req.path.startsWith("/api/billing/");

    if(!allowed){
      if(req.path.startsWith("/api/")){
        return res.status(402).json({error:"Assinatura necessaria para continuar utilizando a plataforma.",code:"BILLING_REQUIRED",billingRequired:true,redirect:"/assinatura"});
      }
      return res.redirect("/assinatura");
    }
  }

  next();
}

function requireRole(...roles){
  return(req,res,next)=>{
    if(
      !req.user ||
      (
        !req.user.is_super_admin &&
        !roles.includes(req.user.role)
      )
    ){
      if(req.path.startsWith('/api/')){
        return res.status(403).json({
          error:'Sem permissão.'
        });
      }

      return res.redirect('/dashboard');
    }

    next();
  };
}

function requireSuperAdmin(req,res,next){
  if(!req.user?.is_super_admin){
    if(req.path.startsWith('/api/')){
      return res.status(403).json({
        error:'Acesso exclusivo do Super Admin.'
      });
    }

    return res.redirect('/dashboard');
  }

  next();
}

module.exports={
  setAuthCookie,
  clearAuthCookie,
  loadUser,
  requireAuth,
  requireRole,
  requireSuperAdmin
};
