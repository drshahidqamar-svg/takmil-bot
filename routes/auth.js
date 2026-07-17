// helpers/auth.js — Password hashing, JWT session cookies, and role middleware
// ──────────────────────────────────────────────────────────────────────────
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');

const JWT_SECRET  = process.env.JWT_SECRET || 'CHANGE_ME_INSECURE_DEFAULT';
const COOKIE_NAME = 'takmil_session';
const TOKEN_TTL   = '12h';

if (!process.env.JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET is not set in environment variables — using an insecure default. Set a real secret in Railway before relying on this in production.');
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function issueToken(user) {
  // Keep the payload minimal — id, role, and linked_name are all that's
  // needed to scope access. Never put the password hash in the token.
  return jwt.sign(
    { id: user.id, name: user.name, role: user.role, linked_name: user.linked_name },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 12 * 60 * 60 * 1000, // 12h, matches TOKEN_TTL
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

function decodeToken(token) {
  try { return jwt.verify(token, JWT_SECRET); }
  catch(e) { return null; }
}

// ── Middleware: require any valid logged-in user ──────────────────────────
// Attaches req.user = { id, name, role, linked_name }.
// API requests (path starts with /api) get a 401 JSON response if unauthenticated;
// page requests get redirected to /login so a browser visit behaves naturally.
function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  const user  = token ? decodeToken(token) : null;
  if (!user) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not logged in' });
    return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  }
  req.user = user;
  next();
}

// ── Middleware: require one of the given roles ─────────────────────────────
// Usage: requireRole(['admin']) or requireRole(['admin','regional_coordinator','coordinator'])
function requireRole(roles) {
  return function(req, res, next) {
    requireAuth(req, res, function() {
      if (!roles.includes(req.user.role)) {
        if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Not authorized for this role' });
        return res.status(403).send('<h2 style="font-family:sans-serif;text-align:center;margin-top:80px">403 — You don\'t have access to this page.</h2><p style="text-align:center"><a href="/login">Back to login</a></p>');
      }
      next();
    });
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  issueToken,
  setSessionCookie,
  clearSessionCookie,
  decodeToken,
  requireAuth,
  requireRole,
  COOKIE_NAME,
};
