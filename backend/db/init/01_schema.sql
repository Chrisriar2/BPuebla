-- ============================================================
-- 01_schema.sql  ·  BASTA PUEBLA — esquema FASE 1 (PostgreSQL + PostGIS)
-- BACKEND_PLAN.md §2 (modelo de datos).
-- Se ejecuta automáticamente por el contenedor postgis en el PRIMER arranque
-- (docker-entrypoint-initdb.d). Para re-ejecutar: borra el volumen `db_data`.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- ------------------------------------------------------------
-- routes — rutas de cobertura (geometría real de calles, OSRM)
--   geom_optima  = ruta optimizada (path)
--   geom_previa  = ruta previa registrada (prev)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS routes (
  id            TEXT PRIMARY KEY,                 -- 'R-07'
  zona          TEXT NOT NULL,
  estado        TEXT NOT NULL DEFAULT 'Pendiente',-- Pendiente | Aprobada | En ejecución
  colonias      TEXT,
  paradas       INTEGER,                          -- nº de paradas (stops)
  km            NUMERIC(7,2),                     -- km ruta óptima
  prev_km       NUMERIC(7,2),                     -- km ruta previa
  ahorro        INTEGER,                          -- % ahorro
  geom_optima   geometry(LineString, 4326),
  geom_previa   geometry(LineString, 4326),
  creado        TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS routes_estado_idx        ON routes (estado);
CREATE INDEX IF NOT EXISTS routes_geom_optima_gix   ON routes USING GIST (geom_optima);

-- ------------------------------------------------------------
-- trucks — flota. pos = posición actual (Point).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trucks (
  id            TEXT PRIMARY KEY,                 -- 'C-07'
  placa         TEXT,
  modelo        TEXT,
  anio          INTEGER,
  chofer        TEXT,                             -- id de operador 'OP-04471'
  estado        TEXT NOT NULL DEFAULT 'En cochera', -- En ruta | En cochera | Falla | Sin reportar
  route_id      TEXT REFERENCES routes(id) ON DELETE SET NULL,
  sector        TEXT,
  turno         TEXT,                             -- Matutino | Vespertino | Nocturno
  combustible   INTEGER,                          -- % combustible
  km_turno      NUMERIC(7,2),                     -- km recorridos en el turno
  pct           INTEGER DEFAULT 0,                -- % de avance sobre la ruta
  tele_min      INTEGER,                          -- minutos desde última telemetría
  pos           geometry(Point, 4326),
  actualizado   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trucks_estado_idx   ON trucks (estado);
CREATE INDEX IF NOT EXISTS trucks_route_idx     ON trucks (route_id);
CREATE INDEX IF NOT EXISTS trucks_pos_gix       ON trucks USING GIST (pos);

-- ------------------------------------------------------------
-- reports — reportes ciudadanos. folio autoincremental (para el QR).
--   cam: id de camión asignado; texto libre (NO FK: algunos reportes
--   sembrados referencian camiones fuera de la flota semilla).
-- ------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS reports_folio_seq START 48300;
CREATE TABLE IF NOT EXISTS reports (
  folio         TEXT PRIMARY KEY DEFAULT nextval('reports_folio_seq')::text,
  tipo          TEXT NOT NULL,                    -- Desbordado | Lleno | Tirado fuera
  colonia       TEXT,
  estado        TEXT NOT NULL DEFAULT 'Pendientes', -- Pendientes | En atención | Resueltos
  abierto       TEXT,                             -- tiempo abierto legible ('6h 12m' / 'resuelto')
  cam           TEXT,                             -- camión asignado ('C-04') — sin FK a propósito
  dist          TEXT,                             -- distancia al camión más cercano ('0.8 km')
  hora          TEXT,                             -- hora del reporte ('14:21')
  prioridad     BOOLEAN NOT NULL DEFAULT FALSE,   -- marcado como prioritario
  foto_url      TEXT,                             -- foto adjunta (storage) — fase 2
  pos           geometry(Point, 4326),
  creado        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reports_estado_idx  ON reports (estado);
CREATE INDEX IF NOT EXISTS reports_tipo_idx     ON reports (tipo);
CREATE INDEX IF NOT EXISTS reports_pos_gix      ON reports USING GIST (pos);

-- ------------------------------------------------------------
-- telemetry — serie temporal de GPS de los camiones (tiempo real + historial).
-- Sin seed. Se llena en fase 2 vía POST /trucks/:id/telemetry.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS telemetry (
  id            BIGSERIAL PRIMARY KEY,
  truck_id      TEXT NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
  ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
  velocidad     NUMERIC(6,2),                     -- km/h
  pct           INTEGER,                          -- % de avance sobre la ruta
  pos           geometry(Point, 4326)
);
CREATE INDEX IF NOT EXISTS telemetry_truck_ts_idx ON telemetry (truck_id, ts DESC);
CREATE INDEX IF NOT EXISTS telemetry_pos_gix       ON telemetry USING GIST (pos);

-- ------------------------------------------------------------
-- events — cola de eventos del chofer (sube por lotes, idempotente).
--   id lo genera el cliente (idempotencia offline) -> PK de texto.
-- Sin seed. Fase 2/3 vía POST /trucks/:id/events.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id            TEXT PRIMARY KEY,                 -- uuid generado por la app del chofer
  truck_id      TEXT NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL,                    -- parada | incidencia
  payload       JSONB,
  ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced        BOOLEAN NOT NULL DEFAULT TRUE     -- recibido/confirmado por el servidor
);
CREATE INDEX IF NOT EXISTS events_truck_idx ON events (truck_id, ts DESC);

-- ------------------------------------------------------------
-- users — staff municipal (login) y choferes (ruta + PIN), por rol.
-- Fase 3 (auth). Se siembran 2 usuarios demo (hash placeholder).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  rol           TEXT NOT NULL,                    -- staff | chofer
  nombre        TEXT NOT NULL,
  usuario       TEXT UNIQUE,                      -- login del staff
  pin_hash      TEXT,                             -- hash del PIN del chofer / password del staff
  route_id      TEXT REFERENCES routes(id) ON DELETE SET NULL, -- ruta asignada (chofer)
  activo        BOOLEAN NOT NULL DEFAULT TRUE,
  creado        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- pgcrypto: para sembrar los PIN hasheados (sha256 hex, igual que src/auth.js)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- semilla de staff (sin route_id). Los CHOFERES se siembran en
-- 03_seed_users.sql, DESPUÉS de 02_seed.sql (su route_id referencia routes).
--   admin / basta2026  -> login real (pin_hash = sha256('basta2026') hex, == src/auth.js)
--   supervisor         -> 'demo-no-hash' acepta cualquier password (comodín demo)
INSERT INTO users (rol, nombre, usuario, pin_hash) VALUES
  ('staff', 'Administrador OOSL', 'admin', encode(digest('basta2026','sha256'),'hex')),
  ('staff', 'Supervisor OOSL', 'supervisor', 'demo-no-hash')
ON CONFLICT (usuario) DO NOTHING;

-- ------------------------------------------------------------
-- trigger util: mantener `actualizado` al día en routes/trucks
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_actualizado() RETURNS trigger AS $$
BEGIN NEW.actualizado = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS routes_touch ON routes;
CREATE TRIGGER routes_touch BEFORE UPDATE ON routes
  FOR EACH ROW EXECUTE FUNCTION touch_actualizado();

DROP TRIGGER IF EXISTS trucks_touch ON trucks;
CREATE TRIGGER trucks_touch BEFORE UPDATE ON trucks
  FOR EACH ROW EXECUTE FUNCTION touch_actualizado();
