// Pool de conexiones a PostgreSQL/PostGIS.
// Producción (Render): DATABASE_URL con SSL.
// Local: DATABASE_URL o variables PGHOST/PGUSER/... (ver .env.example). En Docker, host = "db".
'use strict';
const { Pool } = require('pg');

function buildConfig() {
  const max = +(process.env.PG_POOL_MAX || 10);
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      // Render exige SSL (certificado interno). En local con URL sin SSL: PGSSL=disable
      ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
      max,
    };
  }
  return {
    host: process.env.PGHOST || 'localhost',
    port: +(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'basta',
    password: process.env.PGPASSWORD || 'basta',
    database: process.env.PGDATABASE || 'basta_puebla',
    max,
  };
}

const pool = new Pool(buildConfig());

pool.on('error', (err) => {
  console.error('[db] error inesperado en cliente inactivo:', err.message);
});

// Espera a que la BD acepte conexiones (el contenedor de Postgres tarda en arrancar).
async function waitForDb({ retries = 30, delayMs = 1000 } = {}) {
  for (let i = 1; i <= retries; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (i === retries) throw err;
      console.log(`[db] esperando a Postgres... (${i}/${retries})`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
  waitForDb,
};
