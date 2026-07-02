// Auth mínima — JWT HS256 con el módulo `crypto` nativo (sin dependencias extra).
// Suficiente para Fase 3a (demo). En producción usar una lib madura + secreto fuerte.
'use strict';
const crypto = require('crypto');

// En producción JWT_SECRET es obligatorio (Render lo genera vía render.yaml).
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET es obligatorio en producción');
}
const SECRET = process.env.JWT_SECRET || 'basta-puebla-dev-secret';

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function hmac(data) {
  return crypto.createHmac('sha256', SECRET).update(data).digest('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// firma un JWT HS256 con expiración (por defecto 12 h)
function sign(payload, expiresInSec) {
  const now = Math.floor(Date.now() / 1000);
  const body = Object.assign({ iat: now, exp: now + (expiresInSec || 60 * 60 * 12) }, payload);
  const data = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' + b64url(JSON.stringify(body));
  return data + '.' + hmac(data);
}

// verifica firma + expiración; devuelve el payload o null
function verify(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    if (hmac(parts[0] + '.' + parts[1]) !== parts[2]) return null;
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch (e) { return null; }
}

function sha256hex(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }

// middleware opcional para proteger rutas (Fase 3+): exige Bearer válido
function requireAuth(rol) {
  return (req, res, next) => {
    const m = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
    const payload = m ? verify(m[1]) : null;
    if (!payload) return res.status(401).json({ error: 'Token inválido o ausente' });
    if (rol && payload.rol !== rol) return res.status(403).json({ error: 'Rol no autorizado' });
    req.auth = payload;
    next();
  };
}

module.exports = { sign, verify, sha256hex, requireAuth };
