// Pool de conexiones a PostgreSQL/PostGIS.
// Producción (Render): DATABASE_URL con SSL.
// Local: DATABASE_URL o variables PGHOST/PGUSER/... (ver .env.example). En Docker, host = "db".
'use strict';
const { Pool } = require('pg');

function buildConfig() {
  // Opciones comunes del pool. Objetivo: mantener las conexiones VIVAS y
  // reutilizarlas en vez de abrir/cerrar una por consulta (connection churn).
  const poolOpts = {
    max: +(process.env.PG_POOL_MAX || 10),
    // Nunca cerramos clientes inactivos por timeout (0 = desactivado). Antes,
    // el default de 10 s dejaba sockets ociosos que un firewall/NAT de la red
    // (10.26.40.22) cortaba en segundos -> sesiones de ~3 s en los logs.
    idleTimeoutMillis: +(process.env.PG_IDLE_TIMEOUT_MS || 0),
    // Espera para conseguir un cliente antes de fallar (0 = ilimitado).
    connectionTimeoutMillis: +(process.env.PG_CONN_TIMEOUT_MS || 10000),
    // TCP keepalive: evita que intermediarios (NAT/LB/firewall) tiren el socket
    // ocioso. Ésta es la causa real del churn cada 3 s.
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    // Recicla un cliente tras N usos (protege de fugas de estado en sesiones muy
    // longevas). 0 = sin límite.
    maxUses: +(process.env.PG_MAX_USES || 7500),
  };
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      // Render exige SSL (certificado interno). En local con URL sin SSL: PGSSL=disable
      ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
      ...poolOpts,
    };
  }
  return {
    host: process.env.PGHOST || 'localhost',
    port: +(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'basta',
    password: process.env.PGPASSWORD || 'basta',
    database: process.env.PGDATABASE || 'basta_puebla',
    ...poolOpts,
  };
}

const pool = new Pool(buildConfig());

// Mantiene un piso de conexiones "calientes": tras arrancar, deja PG_POOL_MIN
// clientes abiertos y listos. node-pg no tiene opción `min`, así que los
// pre-creamos y liberamos al pool (quedan ociosos y, con idleTimeout=0, vivos).
async function warmPool(min = +(process.env.PG_POOL_MIN || 2)) {
  const clients = [];
  try {
    for (let i = 0; i < min; i++) clients.push(await pool.connect());
  } catch (err) {
    console.error('[db] no se pudo precalentar el pool:', err.message);
  } finally {
    clients.forEach((c) => c.release());
  }
}

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
  warmPool,
};
