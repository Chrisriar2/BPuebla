// Auth — BACKEND_PLAN.md §3 (Fase 3)
//   POST /auth/chofer  (ruta + PIN)  -> token + ruta asignada + camión
//   POST /auth/staff   (usuario + password) -> token
'use strict';
const express = require('express');
const db = require('../db');
const { sign, sha256hex } = require('../auth');

const router = express.Router();
const DEMO_PIN = process.env.CHOFER_DEMO_PIN || '1234';

// POST /auth/chofer  { ruta_id, pin, truck_id? }
router.post('/chofer', async (req, res, next) => {
  try {
    const ruta_id = req.body && (req.body.ruta_id || req.body.route_id);
    const pin = req.body && req.body.pin;
    if (!ruta_id || !pin) return res.status(400).json({ error: 'Faltan ruta_id y/o pin' });

    const rt = await db.query('SELECT id, zona, estado, colonias, paradas, km FROM routes WHERE id = $1', [ruta_id]);
    if (!rt.rows.length) return res.status(404).json({ error: 'Ruta no encontrada' });

    // 1) valida contra un chofer sembrado de esa ruta; 2) si no hay, regla demo (PIN fijo)
    const u = await db.query(
      "SELECT id, nombre, pin_hash FROM users WHERE rol = 'chofer' AND route_id = $1 AND activo = true LIMIT 1",
      [ruta_id]
    );
    let chofer;
    if (u.rows.length) {
      if (u.rows[0].pin_hash !== sha256hex(pin)) return res.status(401).json({ error: 'PIN incorrecto' });
      chofer = { id: u.rows[0].id, nombre: u.rows[0].nombre };
    } else {
      if (String(pin) !== DEMO_PIN) return res.status(401).json({ error: 'PIN incorrecto' });
      chofer = { id: null, nombre: 'Chofer demo' };
    }

    // camión asignado a la ruta (para telemetría/eventos). Prioriza uno "En ruta".
    // camión canónico de la ruta = el de menor id (el sembrado), estable aunque
    // haya terminado su turno (En cochera). Para R-03 esto es siempre C-04.
    const tk = await db.query(
      'SELECT id FROM trucks WHERE route_id = $1 ORDER BY id LIMIT 1',
      [ruta_id]
    );
    const truck_id = (req.body && req.body.truck_id) || (tk.rows[0] && tk.rows[0].id) || null;

    const token = sign({ sub: chofer.id, rol: 'chofer', ruta_id, truck_id });
    res.json({ token, rol: 'chofer', chofer, route: rt.rows[0], truck_id });
  } catch (err) { next(err); }
});

// POST /auth/staff  { usuario, password }
router.post('/staff', async (req, res, next) => {
  try {
    const usuario = req.body && req.body.usuario;
    const password = req.body && req.body.password;
    if (!usuario) return res.status(400).json({ error: 'Falta usuario' });

    const u = await db.query(
      "SELECT id, nombre, pin_hash FROM users WHERE rol = 'staff' AND usuario = $1 AND activo = true",
      [usuario]
    );
    if (!u.rows.length) return res.status(401).json({ error: 'Usuario no encontrado' });
    // demo: 'demo-no-hash' acepta cualquier password; si hay hash real, compara sha256
    const ph = u.rows[0].pin_hash;
    if (ph && ph !== 'demo-no-hash' && ph !== sha256hex(password || '')) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    const token = sign({ sub: u.rows[0].id, rol: 'staff' });
    res.json({ token, rol: 'staff', usuario, nombre: u.rows[0].nombre });
  } catch (err) { next(err); }
});

module.exports = router;
