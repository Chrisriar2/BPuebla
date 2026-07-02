// Reportes ciudadanos — BACKEND_PLAN.md §3
//   GET    /reports          (filtros: estado, colonia, tipo, q · paginado)
//   POST   /reports          (alta desde la PWA ciudadana → devuelve folio)
//   GET    /reports/:folio   (seguimiento del QR)
//   PATCH  /reports/:folio   (estado / prioridad)
'use strict';
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

// POST /reports es PÚBLICO para el ciudadano (PWA, anónimo). Pero si la petición
// TRAE un token (viene del tablero), se exige que sea un staff válido.
function optionalStaff(req, res, next) {
  if (/^Bearer\s+/i.test(req.headers.authorization || '')) return requireAuth('staff')(req, res, next);
  next(); // sin token -> ciudadano anónimo
}

// columnas comunes: expone la geometría como lat/lng planos
const SELECT_COLS = `
  folio, tipo, colonia, estado, abierto, cam, dist, hora, prioridad, foto_url,
  ST_Y(pos) AS lat, ST_X(pos) AS lng,
  creado`;

// GET /reports?estado=&colonia=&tipo=&q=&page=1&limit=20
router.get('/', async (req, res, next) => {
  try {
    const { estado, colonia, tipo, q } = req.query;
    const page = Math.max(1, +(req.query.page || 1));
    const limit = Math.min(200, Math.max(1, +(req.query.limit || 20)));
    const offset = (page - 1) * limit;

    const where = [];
    const params = [];
    if (estado) { params.push(estado); where.push(`estado = $${params.length}`); }
    if (colonia) { params.push(colonia); where.push(`colonia = $${params.length}`); }
    if (tipo) { params.push(tipo); where.push(`tipo = $${params.length}`); }
    if (q) {
      params.push(`%${q}%`);
      const i = params.length;
      where.push(`(colonia ILIKE $${i} OR folio ILIKE $${i} OR tipo ILIKE $${i})`);
    }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const totalRes = await db.query(`SELECT count(*)::int AS n FROM reports ${whereClause}`, params);
    const total = totalRes.rows[0].n;

    const rows = await db.query(
      `SELECT ${SELECT_COLS} FROM reports ${whereClause}
       ORDER BY prioridad DESC, creado DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    res.json({ page, limit, total, pages: Math.ceil(total / limit), data: rows.rows });
  } catch (err) { next(err); }
});

// GET /reports/:folio  (seguimiento del QR)
router.get('/:folio', async (req, res, next) => {
  try {
    const r = await db.query(`SELECT ${SELECT_COLS} FROM reports WHERE folio = $1`, [req.params.folio]);
    if (!r.rows.length) return res.status(404).json({ error: 'Reporte no encontrado' });
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

// POST /reports  (alta desde la PWA ciudadana [público] o el tablero [staff])
router.post('/', optionalStaff, async (req, res, next) => {
  try {
    const { tipo, colonia, foto_url } = req.body || {};
    const lat = req.body?.lat ?? req.body?.pos?.lat;
    const lng = req.body?.lng ?? req.body?.pos?.lng;

    if (!tipo) return res.status(400).json({ error: 'Falta "tipo"' });
    if (lat == null || lng == null) return res.status(400).json({ error: 'Falta la ubicación (lat/lng)' });
    const hora = (req.body && req.body.hora) || null;

    const pos = `ST_SetSRID(ST_MakePoint($1, $2), 4326)`; // (lng, lat)
    const r = await db.query(
      `INSERT INTO reports (tipo, colonia, foto_url, estado, abierto, hora, pos)
       VALUES ($3, $4, $5, 'Pendientes', '0h 00m',
               COALESCE($6, to_char(now() AT TIME ZONE 'America/Mexico_City', 'HH24:MI')), ${pos})
       RETURNING ${SELECT_COLS}`,
      [lng, lat, tipo, colonia || null, foto_url || null, hora]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { next(err); }
});

// PATCH /reports/:folio  (estado / prioridad / cam) — solo staff
router.patch('/:folio', requireAuth('staff'), async (req, res, next) => {
  try {
    const allowed = ['estado', 'prioridad', 'cam', 'abierto', 'dist'];
    const sets = [];
    const params = [];
    for (const k of allowed) {
      if (req.body && k in req.body) { params.push(req.body[k]); sets.push(`${k} = $${params.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });

    params.push(req.params.folio);
    const r = await db.query(
      `UPDATE reports SET ${sets.join(', ')} WHERE folio = $${params.length} RETURNING ${SELECT_COLS}`,
      params
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Reporte no encontrado' });
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
