# BASTA PUEBLA

Plataforma de gestión de recolección de residuos para Puebla: **tablero municipal**
(mapa en vivo de la flota, rutas optimizadas, reportes ciudadanos), **PWA ciudadana**
(reportar contenedores con foto + seguimiento por QR) y **app del chofer**
(login por ruta + PIN, GPS en tiempo real, cola offline de incidencias).

## Stack

| Capa | Tecnología | Deploy |
|---|---|---|
| Backend | Node.js ≥18 · Express 4 · `pg` (sin ORM) | **Render** (web service) |
| Base de datos | PostgreSQL 16 + **PostGIS** (geometrías de rutas/posiciones) | **Render** (Postgres) |
| Frontend | HTML autocontenidos (tablero, PWA, chofer) + build de inyección de config | **Vercel** (sitio estático) |
| App Android | Capacitor 6 (geolocalización, cámara, SQLite offline) | APK local (opcional) |

Tiempo real vía **SSE** (`GET /live`). Auth con **JWT HS256** (roles `staff` y `chofer`).

## Estructura

```
basta-puebla/
├─ render.yaml              # Blueprint de Render: BD + servicio web
├─ .gitignore
├─ backend/                 # API Express
│  ├─ src/                  #   index.js (app), db.js (pool), auth.js (JWT), routes/
│  ├─ db/init/              #   01_schema.sql · 02_seed.sql · 03_seed_users.sql
│  ├─ scripts/db_init.js    #   migración+seed idempotente (Render y local)
│  ├─ Dockerfile            #   imagen de la API (solo para local)
│  ├─ docker-compose.yml    #   stack local: Postgres/PostGIS + API
│  └─ .env.example
├─ frontend/                # sitio estático para Vercel
│  ├─ public/               #   index.html (tablero) · ciudadano.html (PWA) · chofer.html
│  ├─ build.js              #   copia public/ → dist/ inyectando BP_API_URL
│  ├─ vercel.json
│  └─ .env.example
└─ chofer-app/              # proyecto Capacitor para generar el APK Android (opcional)
```

> **Nota:** los HTML de `frontend/public/` son artefactos generados por los scripts
> del prototipo original (carpeta `PIMDI/build/`, que depende de bundles locales).
> Igual que `backend/db/init/02_seed.sql`. Si cambias el prototipo, regénéralos allí
> y vuelve a copiarlos aquí.

## Base de datos

- **Esquema** ([backend/db/init/01_schema.sql](backend/db/init/01_schema.sql)): tablas
  `routes`, `trucks`, `reports`, `telemetry`, `events`, `users`, con geometrías PostGIS
  SRID 4326 (`LineString` para rutas, `Point` para posiciones). Activa las extensiones
  `postgis` y `pgcrypto` (ambas disponibles en Render).
- **Semilla** (`02_seed.sql` + `03_seed_users.sql`): 18 rutas · 60 camiones ·
  34 reportes + usuarios demo (staff `admin`/`basta2026`; choferes PIN `1234`).
- **Inicialización**: `npm run db:init` (en `backend/`) ejecuta
  [scripts/db_init.js](backend/scripts/db_init.js): aplica el esquema (idempotente) y
  la semilla **solo si la BD está vacía**. En Render corre automáticamente en cada
  arranque (parte del `startCommand`), así que no duplica datos.
- **Conexión**: por `DATABASE_URL` (con SSL automático, requerido por Render) o, en
  local, por variables `PGHOST`/`PGUSER`/... — ver la tabla de variables más abajo.

## Requisitos previos

- **Node.js ≥ 18** y npm.
- Para la BD local: **Docker** (recomendado) o un PostgreSQL 16 con PostGIS instalado.
- Cuentas gratuitas en [GitHub](https://github.com), [Render](https://render.com) y
  [Vercel](https://vercel.com).
- (Solo APK) Android Studio + JDK 17 — ver [chofer-app/BUILD_APK.md](chofer-app/BUILD_APK.md).

## Correr en local

### 1. Base de datos + API con Docker (recomendado)

```bash
cd backend
docker compose up --build
```

Levanta Postgres/PostGIS (aplica esquema + semilla en el primer arranque) y la API en
`http://localhost:3000`. Prueba: `curl http://localhost:3000/health` → `{"ok":true,"db":"up"}`.

### 2. API sin Docker (Postgres propio)

```bash
cd backend
npm install
cp .env.example .env        # ajusta la conexión a tu Postgres
npm run db:init:local       # crea esquema + semilla (idempotente)
npm run dev                 # API con recarga en http://localhost:3000
```

### 3. Frontend

```bash
cd frontend
npm run build               # genera dist/ (sin BP_API_URL usa localhost:3000)
npx serve dist              # sirve el sitio, p. ej. http://localhost:3000 ó :5000
```

- `/` → tablero municipal (staff demo: `admin` / `basta2026`)
- `/ciudadano` → PWA ciudadana (reportar + seguimiento QR)
- `/chofer` → app del chofer web (rutas demo `RT-204`/`RT-118`/`RT-104`, PIN `1234`)

Flujo de prueba: crea un reporte en la PWA → aparece en el tablero; inicia ruta en la
app del chofer → el camión se mueve en el Mapa en Vivo.

## Despliegue

### Paso 0 — Subir el repo a GitHub

Desde la raíz de esta carpeta:

```bash
git init
git add .
git commit -m "BASTA PUEBLA: backend + frontend + BD listos para Render/Vercel"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/basta-puebla.git
git push -u origin main
```

(Crea antes el repositorio vacío `basta-puebla` en GitHub, sin README ni .gitignore.)

### Paso 1 — Base de datos + backend en Render (Blueprint)

El [render.yaml](render.yaml) crea **la BD y la API juntas**:

1. En Render: **New → Blueprint** → conecta tu cuenta de GitHub y elige el repo `basta-puebla`.
2. Render detecta `render.yaml` y propone: BD `basta-puebla-db` (Postgres) y servicio
   web `basta-puebla-api`. Confirma con **Apply**.
3. Variables: `DATABASE_URL` y `JWT_SECRET` se configuran solas. `CORS_ORIGIN` te la
   pedirá (o quedará vacía): déjala en `*` de momento; la afinarás en el paso 3.
4. En el primer arranque, `npm run db:init` crea el esquema PostGIS y carga la semilla.
   Verifica: `https://basta-puebla-api.onrender.com/health` → `{"ok":true,"db":"up"}`.
5. **Copia la URL pública del servicio** (p. ej. `https://basta-puebla-api.onrender.com`);
   la necesitas para Vercel.

<details>
<summary>Alternativa manual (sin Blueprint)</summary>

1. **New → PostgreSQL**: nombre `basta-puebla-db`, base `basta_puebla`, versión 16. Créala
   y copia la **Internal Database URL**.
2. **New → Web Service**: conecta el repo, **Root Directory** = `backend`,
   Build = `npm install --omit=dev`, Start = `npm run db:init && npm start`,
   Health check path = `/health`.
3. Variables de entorno del servicio: `DATABASE_URL` (la Internal URL del paso 1),
   `JWT_SECRET` (valor aleatorio largo), `NODE_ENV=production`, `CORS_ORIGIN`,
   `CHOFER_DEMO_PIN=1234`.
</details>

> ⚠️ Plan free de Render: la API se "duerme" tras 15 min sin tráfico (el primer request
> tarda ~1 min) y la BD gratuita expira a los 30 días si no pasas a plan de pago.

### Paso 2 — Frontend en Vercel

1. En Vercel: **Add New → Project** → importa el repo `basta-puebla`.
2. **Root Directory** = `frontend` (Framework preset: *Other*; `vercel.json` ya define
   build `npm run build` y salida `dist`).
3. En **Environment Variables** añade `BP_API_URL` = la URL de Render del paso 1
   (sin `/` final).
4. **Deploy**. Tu sitio queda en `https://<proyecto>.vercel.app`:
   `/` tablero · `/ciudadano` PWA · `/chofer` app del chofer.

### Paso 3 — Cerrar el círculo (CORS)

En Render → `basta-puebla-api` → **Environment** → pon
`CORS_ORIGIN=https://<proyecto>.vercel.app` (varios dominios separados por comas) y
guarda (redeploy automático). Así solo tu frontend puede llamar a la API desde el navegador.

### APK del chofer (funciona en cualquier red)

El proyecto Capacitor está en [chofer-app/](chofer-app) (ver
[BUILD_APK.md](chofer-app/BUILD_APK.md)). Para compilar un APK que funcione **donde
sea** (datos móviles, cualquier WiFi — sin depender de la red local):

```bash
cd chofer-app
rebuild-apk.bat https://basta-puebla-api.onrender.com
```

El paso 1 del script ([tools/set-api.js](chofer-app/tools/set-api.js)) inyecta la URL
de Render en la app y hace que la pruebe **primero** (la búsqueda LAN queda solo como
respaldo); luego sincroniza y compila. El backend ya permite los orígenes del APK
(`http(s)://localhost`, `capacitor://localhost`) aunque `CORS_ORIGIN` esté restringido
a Vercel, así que no hay nada más que configurar.

> Con el plan free de Render, si la API estaba dormida el primer intento de conexión
> del APK puede tardar ~1 min; la app reintenta sola y mientras tanto encola los
> eventos offline.

## Variables de entorno

### Backend (Render / `backend/.env`)

| Variable | Para qué sirve | Ejemplo |
|---|---|---|
| `PORT` | Puerto HTTP de la API. **Render la inyecta solo** — no la definas allí. | `3000` |
| `DATABASE_URL` | Cadena de conexión Postgres. En Render: *Internal Database URL* (se vincula sola con el Blueprint). Tiene prioridad sobre las `PG*`. | `postgresql://basta:pass@host:5432/basta_puebla` |
| `PGSSL` | Pon `disable` **solo en local** si usas `DATABASE_URL` contra un Postgres sin SSL. | `disable` |
| `PGHOST` / `PGPORT` / `PGUSER` / `PGPASSWORD` / `PGDATABASE` | Conexión local sin `DATABASE_URL` (Docker las define en compose). | `localhost` / `5432` / `basta` / `basta` / `basta_puebla` |
| `PG_POOL_MAX` | Conexiones máximas del pool. | `10` |
| `JWT_SECRET` | Firma de los tokens JWT. **Obligatoria en producción** (el Blueprint la genera aleatoria). | `una-cadena-larga-aleatoria` |
| `CORS_ORIGIN` | Orígenes permitidos (coma-separados). `*` = todos (solo demo/local). | `https://basta-puebla.vercel.app` |
| `CHOFER_DEMO_PIN` | PIN comodín del login demo de choferes. | `1234` |
| `NODE_ENV` | `production` en Render (activa validaciones estrictas). | `production` |

### Frontend (Vercel / `frontend/.env`)

| Variable | Para qué sirve | Ejemplo |
|---|---|---|
| `BP_API_URL` | URL pública del backend; se inyecta en los HTML **al hacer build**. Sin ella, las apps usan `http://localhost:3000`. | `https://basta-puebla-api.onrender.com` |

> En runtime también puedes redirigir el API sin rebuild: `?api=https://...` en la URL,
> o `BP_API.setBase('https://...')` en la consola del tablero (queda en `localStorage`).

## Endpoints principales

Base local `http://localhost:3000`. Público: `GET /health`, `GET /reports`,
`POST /reports` (PWA anónima), `GET /routes`, `GET /trucks`, `GET /live` (SSE),
`GET /events`. Con token de **staff**: `PATCH /routes/:id`, `PATCH /trucks/:id`,
`PATCH /reports/:folio`. Con token de **chofer**: `POST /trucks/:id/telemetry`,
`POST /trucks/:id/events`. Login: `POST /auth/staff`, `POST /auth/chofer`.
