// db_init.js — inicializa la base de datos (esquema + semilla) de forma idempotente.
// Pensado para Render (donde no existe docker-entrypoint-initdb.d) y utilizable en local.
//
//   node scripts/db_init.js            (usa DATABASE_URL o PGHOST/PGUSER/...)
//
// - 01_schema.sql se aplica SIEMPRE (todo es CREATE ... IF NOT EXISTS / ON CONFLICT).
// - 02_seed.sql + 03_seed_users.sql solo se aplican si la tabla `routes` está vacía,
//   para no duplicar la semilla en cada deploy.
'use strict';
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

const INIT_DIR = path.join(__dirname, '..', 'db', 'init');

async function runSql(file) {
  const sql = fs.readFileSync(path.join(INIT_DIR, file), 'utf8');
  console.log(`[db:init] aplicando ${file} ...`);
  await db.query(sql);
}

(async () => {
  try {
    await db.waitForDb();
    await runSql('01_schema.sql');

    const r = await db.query('SELECT count(*)::int AS n FROM routes');
    if (r.rows[0].n === 0) {
      await runSql('02_seed.sql');
      await runSql('03_seed_users.sql');
      console.log('[db:init] semilla aplicada (18 rutas · 60 camiones · 34 reportes).');
    } else {
      console.log(`[db:init] la BD ya tiene datos (${r.rows[0].n} rutas) — semilla omitida.`);
    }

    console.log('[db:init] listo.');
    await db.pool.end();
    process.exit(0);
  } catch (err) {
    console.error('[db:init] error:', err.message);
    process.exit(1);
  }
})();
