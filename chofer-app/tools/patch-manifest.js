// patch-manifest.js — asegura que AndroidManifest.xml declare los permisos que la
// app necesita (ubicación, cámara, red). Idempotente: solo agrega los que falten.
// Lo llama rebuild-apk.bat después de `cap sync` y antes de compilar.
const fs = require('fs');
const path = require('path');

const mf = path.resolve(__dirname, '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
if (!fs.existsSync(mf)) {
  console.error('  ERROR: no existe ' + mf);
  console.error('  Corre antes:  npx cap add android');
  process.exit(1);
}

let xml = fs.readFileSync(mf, 'utf8');
const perms = [
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.CAMERA',
];

const missing = perms.filter((p) => xml.indexOf('android:name="' + p + '"') < 0);
if (!missing.length) {
  console.log('  Permisos ya presentes en el manifest; sin cambios.');
  process.exit(0);
}

const inject = missing.map((p) => '    <uses-permission android:name="' + p + '" />').join('\n') + '\n';
// inserta justo después de la etiqueta <manifest ...>
xml = xml.replace(/(<manifest\b[^>]*>)/, '$1\n' + inject);
fs.writeFileSync(mf, xml, 'utf8');
console.log('  Permisos agregados al manifest: ' + missing.join(', '));
