const jwt = require('jsonwebtoken');
const { query } = require('./db');

const COOKIE_NAME = 'central_session';

function signUser(user) {
  return jwt.sign(
    { sub: String(user.id), role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '12h', issuer: 'central-chamados' }
  );
}

function setAuthCookie(res, user) {
  res.cookie(COOKIE_NAME, signUser(user), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 12 * 60 * 60 * 1000,
    path: '/',
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

async function loadUser(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { issuer: 'central-chamados' });
    const result = await query(`
      SELECT id, name, username, email, department, role, status, photo_data, created_at, last_login_at
      FROM users WHERE id=$1
    `, [payload.sub]);
    const user = result.rows[0];
    if (!user || user.status !== 'active') return null;
    return user;
  } catch {
    return null;
  }
}

async function requireAuth(req, res, next) {
  const user = await loadUser(req);
  if (!user) {
    clearAuthCookie(res);
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Não autenticado.' });
    return res.redirect('/');
  }
  req.user = user;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Sem permissão.' });
      return res.redirect('/chamados');
    }
    next();
  };
}

module.exports = { setAuthCookie, clearAuthCookie, loadUser, requireAuth, requireRole };
