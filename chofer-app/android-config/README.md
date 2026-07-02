# Configuración Android (aplicar tras `npx cap add android`)

El proyecto nativo `android/` se genera con `npx cap add android`. Estos ajustes
no se pueden versionar dentro de `android/` (se crea en el equipo con SDK), así que
aquí quedan listos para copiar. Todo esto habilita el **HTTP en claro (cleartext)**
que la app necesita para hablar con `http://192.168.x.x:3000` (el backend NO usa TLS).

## 1) network_security_config.xml
Copia [network_security_config.xml](network_security_config.xml) a:
```
android/app/src/main/res/xml/network_security_config.xml
```
(crea la carpeta `xml/` si no existe).

## 2) AndroidManifest.xml
Edita `android/app/src/main/AndroidManifest.xml` y en la etiqueta `<application ...>`
añade estos dos atributos:
```xml
<application
    android:usesCleartextTraffic="true"
    android:networkSecurityConfig="@xml/network_security_config"
    ... (resto de atributos que ya trae) >
```
Y confirma que estén los permisos (Capacitor + plugins los añaden solos al sync, pero
verifícalos) DENTRO de `<manifest>` y fuera de `<application>`:
```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.CAMERA" />
```

## 3b) ícono y splash (ya generados)
Los PNG ya están rasterizados. Opción rápida: copia [`res/mipmap-*`](res) sobre
`android/app/src/main/res/`. O usa `@capacitor/assets` (ver [../resources/README.md](../resources/README.md)).

## 3c) (recomendado) confirmar el scheme http
`capacitor.config.json` ya trae `server.androidScheme: "http"`. Esto hace que la
app cargue en `http://localhost`, así las llamadas a `http://192.168.x.x:3000` NO
son "mixed content" (si el scheme fuera https, el WebView las bloquearía).

Tras copiar/editar: `npx cap sync android` y compila (ver BUILD_APK.md).
