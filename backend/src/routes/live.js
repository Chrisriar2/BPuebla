// Tiempo real — BACKEND_PLAN.md §3 (Fase 2)
//   GET /live   → Server-Sent Events (SSE) con posiciones de la flota.
//
// Elegí SSE sobre WebSocket: sin dependencias extra, va sobre HTTP normal,
// funciona con EventSource del navegador y es CORS-friendly. El tablero se
// suscribe con:  new EventSource(baseURL + '/live')
//
// Un ÚNICO temporizador compartido anima a los camiones "En ruta" a lo largo
// de la geometría real de su ruta (cacheada como polilínea) y difunde a todos
// los clientes conectados. La flota se recarga de la BD cada 20 s o cuando un
// PATCH /trucks la invalida.
'use strict';
const express = require('express');
const db = require('../db');

const router = express.Router();

const clients = new Set();      // respuestas SSE abiertas
let state = null;               // [{id, estado, route_id, path:[[lat,lng]], pct, lat, lng}]
let timer = null;
let lastLoad = 0;
const TICK_MS = 2500;
const RELOAD_MS = 20000;

// posiciones REALES recibidas por telemetría (truckId -> {lat,lng,pct}).
const real = new Map();
// camiones controlados por GPS del chofer: NUNCA se animan (se quedan en su última
// posición real y solo se mueven con telemetría). Se siembra con C-04 (el de la demo)
// y cualquier camión que reciba telemetría se agrega automáticamente.
const manual = new Set((process.env.LIVE_MANUAL_TRUCKS || 'C-04').split(',').map((s) => s.trim()).filter(Boolean));

// punto a lo largo de una polilínea según fracción 0..1 (igual que el prototipo)
function ptOnPath(path, frac) {
  if (!path || !path.length) return null;
  const i = Math.round(Math.max(0, Math.min(1, frac)) * (path.length - 1));
  return path[i];
}

// carga flota + geometría de rutas y arma el estado en memoria
async function loadState() {
  const r = await db.query(`
    SELECT t.id, t.estado, t.route_id, COALESCE(t.pct,0) AS pct,
           ST_Y(t.pos) AS lat, ST_X(t.pos) AS lng,
           ST_AsGeoJSON(rt.geom_optima)::json AS geom
    FROM trucks t
    LEFT JOIN routes rt ON rt.id = t.route_id`);
  state = r.rows.map((row) => {
    // GeoJSON LineString coords vienen como [lng,lat] -> a [lat,lng]
    const path = (row.geom && row.geom.coordinates) ? row.geom.coordinates.map((c) => [c[1], c[0]]) : null;
    return { id: row.id, estado: row.estado, route_id: row.route_id, pct: +row.pct, path, lat: +row.lat, lng: +row.lng };
  });
  lastLoad = Date.now();
}

// invalidación externa (la llama PATCH /trucks al reasignar ruta)
function invalidate() { lastLoad = 0; }

// telemetría real del chofer (POST /trucks/:id/telemetry). Fija la posición y marca
// al camión como GPS/manual -> deja de simularse (solo se mueve con GPS real).
function pushTelemetry(id, o) {
  manual.add(id);
  real.set(id, { lat: o.lat, lng: o.lng, pct: (o.pct != null ? o.pct : null) });
  if (state && !state.some((t) => t.id === id)) lastLoad = 0; // camión nuevo -> fuerza recarga
  ensureTimer();
}

function snapshot() {
  return state.map((t) => {
    let lat = t.lat, lng = t.lng, pct = t.pct, isReal = false;
    const ov = real.get(t.id);
    if (manual.has(t.id)) {
      // GPS/manual: usa su última posición real; si aún no hay, se queda en la de BD. NUNCA se anima.
      if (ov) { lat = ov.lat; lng = ov.lng; if (ov.pct != null) pct = ov.pct; isReal = true; }
    } else if (t.estado === 'En ruta' && t.path) {
      const p = ptOnPath(t.path, (t.pct || 0) / 100);
      if (p) { lat = p[0]; lng = p[1]; }
    }
    return { id: t.id, estado: t.estado, route_id: t.route_id, pct: Math.round(pct || 0), lat, lng, real: isReal };
  });
}

function broadcast(event, dataObj) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(dataObj)}\n\n`;
  for (const res of clients) { try { res.write(payload); } catch (e) {} }
}

async function tick() {
  try {
    if (!state || Date.now() - lastLoad > RELOAD_MS) await loadState();
    // anima (backdrop de flota) solo a los camiones NO manuales que están en ruta.
    // Los GPS/manual (C-04 y los que envían telemetría) nunca se mueven solos.
    for (const t of state) {
      if (!manual.has(t.id) && t.estado === 'En ruta' && t.path) {
        t.pct = (t.pct + 0.8) % 100;   // ~0.8%/tick; envuelve al terminar la ruta
      }
    }
    broadcast('positions', { ts: Date.now(), trucks: snapshot() });
  } catch (err) {
    console.error('[live] tick error:', err.message);
  }
}

function ensureTimer() {
  if (!timer) timer = setInterval(tick, TICK_MS);
}
function maybeStopTimer() {
  if (timer && clients.size === 0) { clearInterval(timer); timer = null; }
}

// GET /live  (SSE)
router.get('/', async (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write('retry: 3000\n\n');

  clients.add(res);
  ensureTimer();

  // manda un snapshot inmediato al conectarse
  try {
    if (!state) await loadState();
    res.write(`event: positions\ndata: ${JSON.stringify({ ts: Date.now(), trucks: snapshot() })}\n\n`);
  } catch (e) {}

  req.on('close', () => {
    clients.delete(res);
    maybeStopTimer();
  });
});

module.exports = router;
module.exports.invalidate = invalidate;
module.exports.pushTelemetry = pushTelemetry;
