-- ============================================================
-- 03_seed_users.sql  ·  Choferes demo (login por ruta + PIN)
-- Corre DESPUÉS de 02_seed.sql porque users.route_id referencia routes(id).
-- PIN demo = '1234' para todos; pin_hash = sha256(pin) hex (== src/auth.js).
-- ============================================================
INSERT INTO users (rol, nombre, usuario, pin_hash, route_id) VALUES
  ('chofer', 'Chofer R-07 (OP-04471)', NULL, encode(digest('1234','sha256'),'hex'), 'R-07'),
  ('chofer', 'Chofer R-01 (OP-04007)', NULL, encode(digest('1234','sha256'),'hex'), 'R-01'),
  ('chofer', 'Chofer R-03 (OP-01180)', NULL, encode(digest('1234','sha256'),'hex'), 'R-03'),
  ('chofer', 'Chofer R-09 (OP-03771)', NULL, encode(digest('1234','sha256'),'hex'), 'R-09')
ON CONFLICT DO NOTHING;
