// BASTA PUEBLA — API backend (Fase 1)
// Express + PostgreSQL/PostGIS. Endpoints núcleo: reportes y rutas.
'use strict';
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const db = require('./db');

const app = express();
const PORT = +(process.env.PORT || 3000);

// CORS: en producción limita a los dominios del frontend con CORS_ORIGIN
// (lista separada por comas, p. ej. "https://basta-puebla.vercel.app").
// Sin CORS_ORIGIN (o "*") permite cualquier origen (modo local/demo).
// El APK del chofer (Capacitor) manda origin http(s)://localhost o
// capacitor://localhost — se permiten siempre para que la app funcione
// desde cualquier red sin abrir el CORS al resto del mundo.
const APP_ORIGINS = ['http://localhost', 'https://localhost', 'capacitor://localhost'];
const corsOrigin = (process.env.CORS_ORIGIN || '*').trim();
app.use(cors(
  corsOrigin === '*'
    ? {}
    : { origin: corsOrigin.split(',').map((s) => s.trim()).filter(Boolean).concat(APP_ORIGINS) }
));
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));

// --- healthcheck (comprueba también la BD) ---
app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ ok: true, db: 'up' });
  } catch (err) {
    res.status(503).json({ ok: false, db: 'down', error: err.message });
  }
});

// --- raíz: mini índice de la API ---
app.get('/', (req, res) => {
  res.json({
    name: 'BASTA PUEBLA API',
    fase: 1,
    endpoints: {
      reportes: ['GET /reports', 'POST /reports', 'GET /reports/:folio', 'PATCH /reports/:folio'],
      rutas: ['GET /routes', 'GET /routes/:id', 'PATCH /routes/:id'],
      flota: ['GET /trucks', 'GET /trucks/:id', 'PATCH /trucks/:id'],
      tiempo_real: ['GET /live (SSE)'],
      chofer: ['POST /trucks/:id/telemetry', 'POST /trucks/:id/events', 'GET /trucks/:id/events'],
      auth: ['POST /auth/chofer', 'POST /auth/staff'],
      salud: ['GET /health'],
    },
  });
});

// --- endpoints núcleo (Fase 1) ---
app.use('/reports', require('./routes/reports'));
app.use('/routes', require('./routes/routes'));

// --- flota + tiempo real (Fase 2) + telemetría/eventos del chofer (Fase 3) ---
app.use('/trucks', require('./routes/trucks'));
app.use('/live', require('./routes/live'));

// --- eventos recientes de toda la flota (incidencias) para el Mapa en Vivo ---
app.get('/events', async (req, res) => {
  try {
    const r = await db.query(
      "SELECT id, truck_id, tipo, (payload - 'foto') AS payload, ts FROM events ORDER BY ts DESC LIMIT 200"
    );
    res.json({ total: r.rows.length, data: r.rows });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', detalle: err.message });
  }
});

// --- auth (Fase 3): /auth/chofer, /auth/staff ---
app.use('/auth', require('./routes/auth'));

// --- 404 ---
app.use((req, res) => res.status(404).json({ error: 'No encontrado', path: req.path }));

// --- manejador de errores central ---
app.use((err, req, res, next) => {
  console.error('[api] error:', err.message);
  res.status(500).json({ error: 'Error interno', detalle: err.message });
});

// --- arranque: espera a la BD antes de escuchar ---
(async () => {
  try {
    await db.waitForDb();
    console.log('[db] conectado');
    app.listen(PORT, () => console.log(`[api] escuchando en http://localhost:${PORT}`));
  } catch (err) {
    console.error('[api] no se pudo conectar a Postgres:', err.message);
    process.exit(1);
  }
})();
