// Flota — BACKEND_PLAN.md §3 (Fase 2)
//   GET   /trucks          (lista; filtros sector, estado, turno, q · paginado opcional)
//   GET   /trucks/:id      (un camión)
//   PATCH /trucks/:id      (reasignar ruta / cambiar estado, etc.)
'use strict';
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

// tras requireAuth('chofer'): exige que el token corresponda a ESTE camión
function requireChoferTruck(req, res, next) {
  if (req.auth.truck_id !== req.params.id) {
    return res.status(403).json({ error: 'El token del chofer no corresponde al camión ' + req.params.id });
  }
  next();
}

// expone la geometría pos como lat/lng planos (como en reports.js)
const SELECT_COLS = `
  id, placa, modelo, anio, chofer, estado, route_id, sector, turno,
  combustible, km_turno, pct, tele_min,
  ST_Y(pos) AS lat, ST_X(pos) AS lng,
  actualizado`;

// GET /trucks?sector=&estado=&turno=&q=&page=&limit=
router.get('/', async (req, res, next) => {
  try {
    const { sector, estado, turno, q } = req.query;
    const where = [];
    const params = [];
    if (sector) { params.push(sector); where.push(`sector = $${params.length}`); }
    if (estado) { params.push(estado); where.push(`estado = $${params.length}`); }
    if (turno) { params.push(turno); where.push(`turno = $${params.length}`); }
    if (q) {
      params.push(`%${q}%`);
      const i = params.length;
      where.push(`(id ILIKE $${i} OR placa ILIKE $${i} OR chofer ILIKE $${i} OR modelo ILIKE $${i} OR route_id ILIKE $${i})`);
    }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    // paginación OPCIONAL: si no mandan limit, devuelve toda la flota (60)
    const totalRes = await db.query(`SELECT count(*)::int AS n FROM trucks ${whereClause}`, params);
    const total = totalRes.rows[0].n;

    let pageSql = '';
    let page = 1, limit = total;
    if (req.query.limit) {
      limit = Math.min(500, Math.max(1, +req.query.limit));
      page = Math.max(1, +(req.query.page || 1));
      params.push(limit); params.push((page - 1) * limit);
      pageSql = `LIMIT $${params.length - 1} OFFSET $${params.length}`;
    }

    const rows = await db.query(
      `SELECT ${SELECT_COLS} FROM trucks ${whereClause} ORDER BY id ${pageSql}`,
      params
    );
    res.json({ page, limit, total, pages: limit ? Math.ceil(total / limit) : 1, data: rows.rows });
  } catch (err) { next(err); }
});

// GET /trucks/:id
router.get('/:id', async (req, res, next) => {
  try {
    const r = await db.query(`SELECT ${SELECT_COLS} FROM trucks WHERE id = $1`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Camión no encontrado' });
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

// PATCH /trucks/:id  (reasignar ruta / cambiar estado / etc.) — solo staff
router.patch('/:id', requireAuth('staff'), async (req, res, next) => {
  try {
    const allowed = ['route_id', 'estado', 'sector', 'turno', 'combustible', 'km_turno', 'pct', 'chofer'];
    const sets = [];
    const params = [];
    for (const k of allowed) {
      if (req.body && k in req.body) { params.push(req.body[k]); sets.push(`${k} = $${params.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });

    params.push(req.params.id);
    const r = await db.query(
      `UPDATE trucks SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${SELECT_COLS}`,
      params
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Camión no encontrado' });

    // avisa al canal en vivo que la flota cambió (reasignación de ruta, etc.)
    try { require('./live').invalidate(); } catch (e) {}
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// FASE 3 — ingesta desde la app del chofer
// ---------------------------------------------------------------------------

// POST /trucks/:id/telemetry  { lat, lng, velocidad?, pct? }
//   guarda un punto GPS en `telemetry`, refleja la posición actual en `trucks`
//   y empuja la posición al canal /live para que el tablero la vea al instante.
//   Requiere token de chofer cuyo truck_id coincida con :id.
router.post('/:id/telemetry', requireAuth('chofer'), requireChoferTruck, async (req, res, next) => {
  try {
    const id = req.params.id;
    const b = req.body || {};
    const lat = b.lat, lng = b.lng;
    if (lat == null || lng == null) return res.status(400).json({ error: 'Faltan lat/lng' });
    const velocidad = b.velocidad != null ? b.velocidad : null;
    const pct = b.pct != null ? b.pct : null;

    const exists = await db.query('SELECT 1 FROM trucks WHERE id = $1', [id]);
    if (!exists.rows.length) return res.status(404).json({ error: 'Camión no encontrado' });

    const pos = 'ST_SetSRID(ST_MakePoint($1, $2), 4326)'; // (lng, lat)
    await db.query(
      `INSERT INTO telemetry (truck_id, velocidad, pct, pos) VALUES ($3, $4, $5, ${pos})`,
      [lng, lat, id, velocidad, pct]
    );
    // refleja la última posición/avance en la fila del camión (telemetría fresca)
    await db.query(
      `UPDATE trucks SET pos = ${pos}, pct = COALESCE($4, pct), tele_min = 0,
         estado = CASE WHEN estado IN ('En cochera','Sin reportar') THEN 'En ruta' ELSE estado END
       WHERE id = $3`,
      [lng, lat, id, pct]
    );
    // reflejo inmediato en /live (sin esperar a la recarga periódica)
    try { require('./live').pushTelemetry(id, { lat: +lat, lng: +lng, pct: pct != null ? +pct : null }); } catch (e) {}

    res.status(201).json({ ok: true, truck_id: id, lat: +lat, lng: +lng, pct: pct != null ? +pct : null });
  } catch (err) { next(err); }
});

// POST /trucks/:id/events   { events: [{ id, tipo, payload?, ts? }, ...] }
//   cola offline del chofer: inserta en lote con idempotencia por id de evento
//   (ON CONFLICT DO NOTHING) y los marca synced=true.
//   Requiere token de chofer cuyo truck_id coincida con :id.
router.post('/:id/events', requireAuth('chofer'), requireChoferTruck, async (req, res, next) => {
  try {
    const id = req.params.id;
    const list = (req.body && (req.body.events || req.body.eventos)) || [];
    if (!Array.isArray(list) || !list.length) return res.status(400).json({ error: 'Se espera events: [ ... ]' });

    const exists = await db.query('SELECT 1 FROM trucks WHERE id = $1', [id]);
    if (!exists.rows.length) return res.status(404).json({ error: 'Camión no encontrado' });

    let insertados = 0;
    const ids = [];
    for (const e of list) {
      if (!e || !e.id || !e.tipo) continue;
      const r = await db.query(
        `INSERT INTO events (id, truck_id, tipo, payload, ts, synced)
         VALUES ($1, $2, $3, $4::jsonb, COALESCE($5::timestamptz, now()), true)
         ON CONFLICT (id) DO NOTHING RETURNING id`,
        [String(e.id), id, e.tipo, e.payload != null ? JSON.stringify(e.payload) : null, e.ts || null]
      );
      ids.push(String(e.id));
      if (r.rows.length) insertados++;
    }
    res.status(201).json({ ok: true, recibidos: list.length, insertados, duplicados: ids.length - insertados, ids });
  } catch (err) { next(err); }
});

// GET /trucks/:id/events  (comprobación / historial de la cola)
router.get('/:id/events', async (req, res, next) => {
  try {
    const r = await db.query(
      'SELECT id, truck_id, tipo, payload, ts, synced FROM events WHERE truck_id = $1 ORDER BY ts DESC LIMIT 100',
      [req.params.id]
    );
    res.json({ total: r.rows.length, data: r.rows });
  } catch (err) { next(err); }
});

// POST /trucks/:id/end  — el chofer termina su turno: el camión queda "En cochera".
//   Requiere token de chofer cuyo truck_id == :id.
router.post('/:id/end', requireAuth('chofer'), requireChoferTruck, async (req, res, next) => {
  try {
    const r = await db.query(
      "UPDATE trucks SET estado = 'En cochera', pct = 0 WHERE id = $1 RETURNING id, estado",
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Camión no encontrado' });
    try { require('./live').invalidate(); } catch (e) {}
    res.json({ ok: true, truck_id: r.rows[0].id, estado: r.rows[0].estado });
  } catch (err) { next(err); }
});

module.exports = router;
