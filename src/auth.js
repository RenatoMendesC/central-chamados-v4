const jwt=require('jsonwebtoken');
const {query}=require('./db');
const COOKIE_NAME='central_session';
function signUser(user){return jwt.sign({sub:String(user.id)},process.env.JWT_SECRET,{expiresIn:'12h',issuer:'central-chamados'});}
function setAuthCookie(res,user){res.cookie(COOKIE_NAME,signUser(user),{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:12*60*60*1000,path:'/'});}
function clearAuthCookie(res){res.clearCookie(COOKIE_NAME,{path:'/'});}
async function loadUser(req){const token=req.cookies?.[COOKIE_NAME];if(!token)return null;try{const p=jwt.verify(token,process.env.JWT_SECRET,{issuer:'central-chamados'});const r=await query(`SELECT u.id,u.organization_id,u.is_super_admin,u.name,u.username,u.email,u.department,u.role,u.status,u.photo_data,u.created_at,u.last_login_at,o.name organization_name,o.slug organization_slug,o.status organization_status,o.plan organization_plan FROM users u LEFT JOIN organizations o ON o.id=u.organization_id WHERE u.id=$1`,[p.sub]);const u=r.rows[0];if(!u||u.status!=='active'||(!u.is_super_admin&&u.organization_status==='suspended'))return null;return u;}catch{return null;}}
async function requireAuth(req,res,next){const u=await loadUser(req);if(!u){clearAuthCookie(res);if(req.path.startsWith('/api/'))return res.status(401).json({error:'Não autenticado.'});return res.redirect('/');}req.user=u;next();}
function requireRole(...roles){return(req,res,next)=>{if(!req.user||(!req.user.is_super_admin&&!roles.includes(req.user.role))){if(req.path.startsWith('/api/'))return res.status(403).json({error:'Sem permissão.'});return res.redirect('/dashboard');}next();};}
function requireSuperAdmin(req,res,next){if(!req.user?.is_super_admin){if(req.path.startsWith('/api/'))return res.status(403).json({error:'Acesso exclusivo do Super Admin.'});return res.redirect('/dashboard');}next();}
module.exports={setAuthCookie,clearAuthCookie,loadUser,requireAuth,requireRole,requireSuperAdmin};
