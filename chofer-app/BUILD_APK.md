# Compilar el APK del chofer (Capacitor + Android)

Este equipo **no tiene** Android SDK/JDK/Gradle, así que el proyecto queda **listo**
y aquí están los pasos EXACTOS para compilarlo en una PC con las herramientas.

La app web ya está generada en [`www/`](www/) (Leaflet **local**, sin CDN). Es un
artefacto del prototipo original (PIMDI/build/build_apps.js): si cambias el prototipo,
regenérala allí y recopia `www/index.html` (**nunca** edites el HTML a mano — la única
excepción automatizada es `tools/set-api.js`, ver abajo).

## Apuntar el APK a producción (Render) ← para que funcione en cualquier red

```bash
node tools/set-api.js https://basta-puebla-api.onrender.com
```

(o `rebuild-apk.bat https://...`, que ya lo incluye como paso 1). Inyecta
`window.BP_API_BASE` en `www/index.html`, hace que el auto-descubrimiento pruebe esa
URL **antes** que localhost/subredes LAN, y sube los timeouts de sondeo a 5 s (Render
free despierta lento). La vinculación LAN (QR / IP manual / escaneo) sigue disponible
como respaldo. Es idempotente: córrelo de nuevo para cambiar la URL. Recuerda que
cualquier cambio en `www/` requiere `npx cap sync android` + recompilar.

---

## 0. Instalar el toolchain (una vez)
1. **JDK 17** (Temurin/Adoptium) — Capacitor 6 requiere Java 17.
2. **Android Studio** (incluye Android SDK + Platform-Tools + Gradle).
   - Al abrirlo: *SDK Manager* → instala **Android SDK Platform 34** y **Build-Tools 34**.
   - Acepta licencias: en una terminal, `sdkmanager --licenses` (o desde el SDK Manager).
3. **Node 18+** (ya lo tienes).
4. Variables de entorno (normalmente las pone Android Studio):
   - `JAVA_HOME` → carpeta del JDK 17
   - `ANDROID_HOME` → `%LOCALAPPDATA%\Android\Sdk`

## 1. Instalar dependencias del proyecto
```bash
cd PIMDI/chofer-app
npm install
```

## 2. Añadir la plataforma Android
```bash
npx cap add android
```
Esto crea la carpeta `android/` (proyecto Gradle nativo).

## 3. Configurar el HTTP en claro (cleartext)  ← CRÍTICO
Sin esto, Android bloquea las llamadas a `http://192.168.x.x:3000`.
Sigue [`android-config/README.md`](android-config/README.md):
- copia `network_security_config.xml` a `android/app/src/main/res/xml/`
- añade `android:usesCleartextTraffic="true"` y `android:networkSecurityConfig="@xml/network_security_config"` al `<application>` del `AndroidManifest.xml`.
(`capacitor.config.json` ya trae `server.androidScheme: "http"`.)

## 4. (Opcional) ícono y splash
Ver [`resources/README.md`](resources/README.md) → `npx @capacitor/assets generate --android`.

## 5. Sincronizar web + plugins nativos
```bash
npx cap sync android
```
Copia `www/` al proyecto Android e instala los plugins nativos
(geolocation, camera, sqlite, mlkit barcode).

## 6. Compilar el APK debug
```bash
cd android
# Windows:
.\gradlew.bat assembleDebug
# (macOS/Linux: ./gradlew assembleDebug)
```
**El APK queda en:**
```
android/app/build/outputs/apk/debug/app-debug.apk
```
Instálalo en el teléfono (arrastrándolo, `adb install app-debug.apk`, o compartiéndolo).
En el teléfono habrá que permitir "instalar apps de origen desconocido".

> Para un APK firmado de release: `gradlew assembleRelease` con un keystore configurado
> (fuera del alcance de la demo).

---

## Cómo se comporta en el teléfono
- **Permisos**: al primer uso pide **Ubicación** (GPS) y, al reportar, **Cámara**.
- **Auto-vinculación**: al abrir busca el servidor en la WiFi (IP del propio dispositivo
  vía WebRTC → escanea su /24; si no, prueba subredes comunes). Muestra "Buscando… /
  Conectado a <IP> / Sin servidor". Respaldo: **Vincular por QR** (escanea el `qr.html`
  de la PC) o escribir la IP a mano.
- **GPS real**: mueve el camión de verdad → `POST /trucks/:id/telemetry` → el tablero
  (Mapa en Vivo `/live`) lo ve moverse.
- **Offline**: los eventos (incidencias/paradas) se guardan en cola persistente y se
  suben por lotes (`POST /trucks/:id/events`, idempotente por id) al reconectar.

## Notas de robustez (mejoras post-demo, ya con hooks en el código)
- **Cola en SQLite**: hoy la cola persiste en `localStorage` (sobrevive reinicios; funciona
  en web y APK). Para usar `@capacitor-community/sqlite`, reemplaza `saveQueue`/`loadQueue`
  en `build_apps.js` (CHOFER_BODY) por la API del plugin (crear conexión + tabla `events`).
  La idempotencia ya la garantiza el `id` de evento en el servidor.
- **Mapas offline (MBTiles)**: hoy los tiles vienen del CDN de CARTO. Para offline real,
  descarga los tiles de la zona (p. ej. con `tilemaker`/`mbutil` a `www/tiles/{z}/{x}/{y}.png`)
  y cambia la URL del `L.tileLayer` en `build_apps.js` a `./tiles/{z}/{x}/{y}.png`
  (con el CDN como *fallback*). Es el único paso que requiere bajar el paquete de tiles.
