// set-api.js — apunta la app del chofer (www/index.html) a un backend público.
// Con esto el APK funciona en cualquier lugar (datos móviles, otra WiFi), sin
// depender de la red local. La búsqueda LAN queda como respaldo.
//
//   node tools/set-api.js https://basta-puebla-api.onrender.com
//   BP_API_URL=https://... node tools/set-api.js
//
// Hace 3 cosas (idempotente — se puede correr las veces que sea):
//   1. Inyecta <script data-bp-api> con window.BP_API_BASE tras <head>.
//   2. Parchea ensureServer() para que pruebe esa URL PRIMERO (antes de
//      localhost y del escaneo de subredes).
//   3. Sube los timeouts de sondeo 900ms → 5000ms (Render free tarda en
//      despertar; con 900ms el probe fallaba siempre en frío).
// Después: npx cap sync android + recompilar (rebuild-apk.bat ya lo llama).
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'www', 'index.html');
const url = (process.argv[2] || process.env.BP_API_URL || '').trim().replace(/\/+$/, '');

if (!url || !/^https?:\/\//.test(url)) {
  console.error('Uso: node tools/set-api.js https://tu-api.onrender.com  (o variable BP_API_URL)');
  process.exit(1);
}

let html = fs.readFileSync(FILE, 'utf8');

// 1) window.BP_API_BASE (reemplaza la inyección previa si ya existe)
const tag = `<script data-bp-api>window.BP_API_BASE=${JSON.stringify(url)};</script>`;
if (/<script data-bp-api>[\s\S]*?<\/script>/.test(html)) {
  html = html.replace(/<script data-bp-api>[\s\S]*?<\/script>/, tag);
} else {
  const m = html.match(/<head[^>]*>/i);
  if (!m) { console.error('No se encontró <head> en www/index.html'); process.exit(1); }
  html = html.slice(0, m.index + m[0].length) + tag + html.slice(m.index + m[0].length);
}

// 2) ensureServer(): probar la URL pública antes que localhost/subredes
const anchor = "first.push('http://localhost:3000');";
const patched = "if(window.BP_API_BASE)first.push(stripSlash(window.BP_API_BASE));" + anchor;
if (html.includes(patched)) {
  // ya parcheado
} else if (html.includes(anchor)) {
  html = html.replace(anchor, patched);
} else {
  console.warn('[set-api] aviso: no se encontró ensureServer() para parchear (¿HTML regenerado con otra versión?)');
}

// 3) timeouts de sondeo aptos para internet (no solo LAN)
html = html.replace('probeFirst(first,900)', 'probeFirst(first,5000)');
html = html.replace('probe(API_BASE,900)', 'probe(API_BASE,5000)');

fs.writeFileSync(FILE, html);
console.log(`[set-api] www/index.html apunta a ${url} (respaldo LAN intacto).`);
console.log('[set-api] ahora corre: npx cap sync android  y recompila el APK.');
