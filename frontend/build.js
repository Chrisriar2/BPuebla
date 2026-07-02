// build.js — "build" del frontend estático.
// Copia public/ -> dist/ inyectando la URL del backend en cada HTML:
//
//   BP_API_URL=https://mi-api.onrender.com node build.js
//
// Las apps leen la URL del API en este orden: ?api= en la URL >
// localStorage.bp_api_base > window.BP_API_BASE > http://localhost:3000.
// Aquí se inyecta window.BP_API_BASE al inicio del <head>, antes de que
// corra cualquier script de la app.
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'public');
const OUT = path.join(__dirname, 'dist');
const API_URL = (process.env.BP_API_URL || '').trim().replace(/\/+$/, '');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const name of fs.readdirSync(SRC)) {
  const srcFile = path.join(SRC, name);
  if (!name.endsWith('.html')) {
    fs.copyFileSync(srcFile, path.join(OUT, name));
    continue;
  }
  let html = fs.readFileSync(srcFile, 'utf8');
  if (API_URL) {
    const tag = `<script>window.BP_API_BASE=${JSON.stringify(API_URL)};</script>`;
    const m = html.match(/<head[^>]*>/i);
    if (!m) throw new Error(`${name}: no se encontró <head> para inyectar BP_API_URL`);
    html = html.slice(0, m.index + m[0].length) + tag + html.slice(m.index + m[0].length);
    // La app del chofer trae auto-descubrimiento LAN (ensureServer): haz que
    // pruebe la URL pública PRIMERO y con timeout apto para internet (Render
    // free tarda en despertar). En los HTML sin esa lógica no cambia nada.
    const anchor = "first.push('http://localhost:3000');";
    html = html
      .replace(anchor, "if(window.BP_API_BASE)first.push(stripSlash(window.BP_API_BASE));" + anchor)
      .replace('probeFirst(first,900)', 'probeFirst(first,5000)')
      .replace('probe(API_BASE,900)', 'probe(API_BASE,5000)');
  }
  fs.writeFileSync(path.join(OUT, name), html);
  console.log(`[build] ${name}${API_URL ? ' (API → ' + API_URL + ')' : ' (sin BP_API_URL: usará localhost:3000)'}`);
}
console.log('[build] listo en dist/');
