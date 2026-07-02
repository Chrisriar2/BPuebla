# Ícono y splash

Fuente vectorial: [icon.svg](icon.svg). **Ya están rasterizados los PNG** listos para
Capacitor/Android (no hace falta rasterizar de nuevo salvo que cambies el diseño):

- `icon.png` — 1024×1024 (fuente para `@capacitor/assets`)
- `splash.png` — 2732×2732 (fondo `#0F2A1F` + logo centrado)

Y los **mipmaps de launcher** por densidad, ya generados, en
[`../android-config/res/mipmap-*`](../android-config/res) (`ic_launcher.png` +
`ic_launcher_round.png`).

## Enganchar en el APK (dos opciones)
**A (recomendada) — @capacitor/assets** (regenera todo desde `icon.png`/`splash.png`):
```
npx @capacitor/assets generate --android
```
Rellena `android/app/src/main/res/mipmap-*` y el splash automáticamente.

**B — copiar los mipmaps ya generados** (si no quieres usar la herramienta):
copia `android-config/res/mipmap-*` sobre `android/app/src/main/res/` tras `npx cap add android`.

## Regenerar los PNG (solo si editas icon.svg)
Los PNG se rasterizaron desde `icon.svg` con Chromium (canvas). También sirve ImageMagick:
```
magick -background none -density 300 resources/icon.svg -resize 1024x1024 resources/icon.png
```
Si omites todo esto, el APK compila con el ícono por defecto de Capacitor.
