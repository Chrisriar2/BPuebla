@echo off
REM ============================================================
REM  BASTA PUEBLA - Chofer : recompilar el APK (un clic)
REM  Uso:   rebuild-apk.bat https://basta-puebla-api.onrender.com
REM  (o define BP_API_URL; sin URL el APK queda en modo LAN/demo)
REM  Corre en cmd.exe (no PowerShell) -> npx/gradlew funcionan.
REM ============================================================
setlocal
cd /d "%~dp0"
if not "%~1"=="" set "BP_API_URL=%~1"
echo.
echo === [1/5] Apuntar la app al backend publico (set-api) ===
if defined BP_API_URL (
  node "%~dp0tools\set-api.js" "%BP_API_URL%"
  if errorlevel 1 ( echo   ERROR inyectando la URL del API. & goto :fin )
) else (
  echo   (sin BP_API_URL: el APK usara solo la busqueda LAN/demo)
)

echo.
echo === [2/5] npm install (dependencias/plugins, idempotente) ===
call npm install
if errorlevel 1 ( echo   ERROR en npm install. Revisa Node/red. & goto :fin )

echo.
echo === [3/5] Copiar web + plugins nativos al proyecto Android (cap sync) ===
call npx --yes cap sync android
if errorlevel 1 ( echo   ERROR en cap sync. Ver mensaje de arriba. & goto :fin )

echo.
echo === [4/5] Asegurar permisos en AndroidManifest (ubicacion/camara/red) ===
node "%~dp0tools\patch-manifest.js"
if errorlevel 1 ( echo   ERROR parcheando el manifest. & goto :fin )

echo.
echo === [5/5] Compilar APK debug (Gradle) ===
if not exist "android\gradlew.bat" ( echo   No existe android\. Corre antes:  npx cap add android & goto :fin )
cd android
call gradlew.bat assembleDebug
if errorlevel 1 ( echo   ERROR en Gradle. Revisa JAVA_HOME (JDK 17) y ANDROID_HOME. & goto :fin )
cd ..

echo.
echo ================================================================
echo  APK LISTO:
echo    %~dp0android\app\build\outputs\apk\debug\app-debug.apk
echo.
echo  Reinstalalo en el telefono (reemplaza el anterior).
echo  Con el telefono conectado por USB (depuracion activada) puedes:
echo    adb install -r "%~dp0android\app\build\outputs\apk\debug\app-debug.apk"
echo ================================================================

:fin
echo.
pause
