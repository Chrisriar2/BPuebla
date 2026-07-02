// Rutas de cobertura — BACKEND_PLAN.md §3
//   GET   /routes         (lista; ?geom=1 incluye geometría GeoJSON)
//   GET   /routes/:id     (una ruta, con geometría GeoJSON)
//   PATCH /routes/:id     (aprobar / editar)
'use strict';
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

// campos base (sin geometría pesada)
const BASE_COLS = `id, zona, estado, colonias, paradas, km, prev_km, ahorro, creado, actualizado`;
// geometría como GeoJSON (para Leaflet). Puede ser grande (cientos de puntos).
const GEOM_COLS = `
  ST_AsGeoJSON(geom_optima)::json AS geom_optima,
  ST_AsGeoJSON(geom_previa)::json AS geom_previa`;

// GET /routes?estado=&geom=1
router.get('/', async (req, res, next) => {
  try {
    const cols = req.query.geom ? `${BASE_COLS}, ${GEOM_COLS}` : BASE_COLS;
    const params = [];
    let where = '';
    if (req.query.estado) { params.push(req.query.estado); where = `WHERE estado = $1`; }
    const r = await db.query(`SELECT ${cols} FROM routes ${where} ORDER BY id`, params);
    res.json({ total: r.rows.length, data: r.rows });
  } catch (err) { next(err); }
});

// GET /routes/:id  (siempre con geometría)
router.get('/:id', async (req, res, next) => {
  try {
    const r = await db.query(
      `SELECT ${BASE_COLS}, ${GEOM_COLS} FROM routes WHERE id = $1`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Ruta no encontrada' });
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

// construye un WKT LINESTRING a partir de:
//   body.path        -> [[lat,lng], ...]           (formato del tablero)
//   body.geom_optima -> GeoJSON LineString {coordinates:[[lng,lat],...]}
function lineWKTFromBody(b) {
  if (!b) return null;
  if (Array.isArray(b.path) && b.path.length >= 2) {
    const coords = b.path.map((p) => `${+p[1]} ${+p[0]}`).join(', '); // lng lat
    return `LINESTRING(${coords})`;
  }
  const g = b.geom_optima;
  if (g && g.type === 'LineString' && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
    const coords = g.coordinates.map((c) => `${+c[0]} ${+c[1]}`).join(', '); // ya viene lng lat
    return `LINESTRING(${coords})`;
  }
  return null;
}

// PATCH /routes/:id  (aprobar/editar campos y/o GEOMETRÍA de la ruta óptima) — solo staff
router.patch('/:id', requireAuth('staff'), async (req, res, next) => {
  try {
    const allowed = ['estado', 'zona', 'colonias', 'paradas', 'km', 'prev_km', 'ahorro'];
    const sets = [];
    const params = [];
    for (const k of allowed) {
      if (req.body && k in req.body) { params.push(req.body[k]); sets.push(`${k} = $${params.length}`); }
    }

    // geometría opcional: guarda geom_optima y recalcula km desde PostGIS (m -> km)
    let geomChanged = false;
    const wkt = lineWKTFromBody(req.body);
    if (wkt) {
      params.push(wkt);
      const gi = params.length;
      const geomExpr = `ST_SetSRID(ST_GeomFromText($${gi}), 4326)`;
      sets.push(`geom_optima = ${geomExpr}`);
      // km recalculado sobre la nueva geometría (a menos que el body ya mande km)
      if (!(req.body && 'km' in req.body)) {
        sets.push(`km = ROUND((ST_Length(${geomExpr}::geography) / 1000.0)::numeric, 2)`);
      }
      geomChanged = true;
    }

    if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });

    params.push(req.params.id);
    const r = await db.query(
      `UPDATE routes SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${BASE_COLS}`,
      params
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Ruta no encontrada' });

    // si cambió la geometría, /live debe recargar (los camiones de esa ruta la usan)
    if (geomChanged) { try { require('./live').invalidate(); } catch (e) {} }
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
