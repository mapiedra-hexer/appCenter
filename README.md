# AppCenter

Hub centralizado de aplicaciones web embebidas con Electron. Permite integrar en una sola ventana Gmail, WhatsApp, ClickUp, Holded, HubSpot, Dobuss ERP y cualquier app web personalizada, con gestión centralizada de notificaciones y modo concentración.

---

## Requisitos previos

- [Node.js](https://nodejs.org/) v18 o superior
- npm v8 o superior
- En Windows: no se requieren dependencias adicionales
- En Linux/Mac para builds: herramientas de compilación nativas (`build-essential` en Ubuntu, Xcode CLI en Mac)

---

## Instalación y desarrollo

```bash
# 1. Clonar o descomprimir el proyecto
cd appcenter

# 2. Instalar dependencias
npm install

# 3. Arrancar en modo desarrollo
npm start
```

La ventana de Electron se abrirá con **F12** disponible para abrir DevTools.

> En desarrollo usa `npm run build:win` para generar los binarios de Windows. El comando `npm run build:all` compila para Windows/Linux/macOS y está pensado para CI en runners nativos.

---

## Inicializar repositorio Git

Si vas a versionar el proyecto desde cero:

```bash
# 1. Inicializar repositorio
git init

# 2. Añadir archivos (respetando .gitignore)
git add .

# 3. Crear primer commit
git commit -m "chore: inicializar proyecto"

# 4. (Opcional) conectar remoto
git remote add origin <URL_DEL_REPOSITORIO>
git branch -M main
git push -u origin main
```

El proyecto incluye un archivo `.gitignore` para excluir dependencias, artefactos de build y logs.

---

## Versionado automático por commit

Este repositorio incrementa automáticamente la versión antes de cada commit mediante el hook `.githooks/pre-commit`.

Al ejecutar `npm install`, el script `prepare` configura Git para usar `.githooks/` como carpeta de hooks:

```bash
npm install
```

Comportamiento por defecto:

- Cada commit sube `patch` (`x.y.Z`).
- El hook actualiza y añade al commit `package.json` y `package-lock.json`.
- El build usa automáticamente esa versión porque `electron-builder` lee `version` desde `package.json`.

Para saltar el incremento en un commit puntual:

```bash
SKIP_VERSION_BUMP=1 git commit -m "docs: actualizar notas internas"
```

Para forzar otro tipo de incremento:

```bash
VERSION_INCREMENT=minor git commit -m "feat: nueva funcionalidad"
VERSION_INCREMENT=major git commit -m "feat: cambio incompatible"
```

En PowerShell:

```powershell
$env:VERSION_INCREMENT="minor"; git commit -m "feat: nueva funcionalidad"; Remove-Item Env:\VERSION_INCREMENT
```

---

## Estructura del proyecto

```
appcenter/
├── main.js              # Proceso principal de Electron (IPC, notificaciones, ventanas)
├── store.js             # Persistencia JSON local (configuración de apps y focus mode)
├── package.json         # Configuración del proyecto y de electron-builder
├── src/
│   ├── index.html       # UI principal (sidebar + settings + webviews)
│   ├── style.css        # Estilos de la interfaz
│   ├── renderer.js      # Lógica de UI con jQuery (gestión de apps, drag & drop, badges)
│   ├── preload.js       # Script inyectado en cada webview (intercepta Notifications)
│   └── assets/
│       ├── icons/       # Iconos PNG de las apps del catálogo
│       └── js/
│           └── jquery.min.js   # jQuery 3.7.1 (incluido estáticamente)
```

---

## Características principales

- **Sidebar de apps**: añade, ordena (drag & drop), activa/desactiva y elimina aplicaciones web
- **Catálogo predefinido**: Gmail, Google Chat, Google Meet, WhatsApp, Telegram, Holded, HubSpot, ClickUp, Dobuss ERP
- **Apps personalizadas**: añade cualquier URL con nombre e icono opcional (PNG propio)
- **Notificaciones centralizadas**: las notificaciones de cada webview se interceptan y se muestran como notificaciones nativas del sistema, con badge en el icono de la sidebar
- **Modo Concentración**: al activarlo, las notificaciones se suprimen; al desactivarlo, se muestra un resumen de actividad por app
- **Popups y logins externos**: los `window.open()` y target=_blank se abren en el navegador del sistema

---

## Añadir una nueva app al catálogo predefinido

Edita `src/index.html` dentro del bloque `.catalog-grid`:

```html
<button class="btn btn-catalog"
    data-id="miapp"
    data-name="Mi App"
    data-url="https://miapp.com"
    data-icon="assets/icons/miapp.png">
    <img src="assets/icons/miapp.png" alt="Mi App"> Mi App
</button>
```

Coloca el icono PNG (idealmente 256×256px) en `src/assets/icons/miapp.png`.

---

## Compilación y distribución

Se usa **[electron-builder](https://www.electron.build/)** para generar los instaladores.

```bash
# Windows local (instalador NSIS + portable)
npm run build

# Solo Windows (instalador NSIS + portable)
npm run build:win

# Solo Windows (instalador NSIS)
npm run build:win:installer

# Solo Windows portable
npm run build:win:portable

# Solo Linux (.deb)
npm run build:linux

# Solo macOS (.dmg)
npm run build:mac

# Publicar release en GitHub con metadatos de auto-update
npm run release
```

Los artefactos generados aparecerán en la carpeta `dist/`, separados por sistema:

- `dist/windows/`: instalador NSIS, portable y `.blockmap`
- `dist/linux/`: paquete `.deb`
- `dist/mac/`: paquete `.dmg`
- `dist/latest.yml`: metadata de actualización para Windows

> **Nota**: Para compilar para **macOS** es necesario ejecutar el comando desde un Mac con Xcode instalado. Para **Linux** y **Windows** se puede compilar desde cualquier plataforma con las dependencias de sistema instaladas. El target cruzado (cross-compile) no está oficialmente soportado por todas las distribuciones de electron-builder.

### Configuración del build

La sección `"build"` en `package.json` controla:

| Campo | Valor |
|---|---|
| `appId` | `es.dobuss.appcenter` |
| `productName` | `AppCenter` |
| `icon` | `build/icon.*` generado desde `src/assets/icons/appcenter.png` |
| Publicación | GitHub Releases (`mapiedra-hexer/appCenter`) |
| Windows target | NSIS installer (x64) + portable (x64) |
| Linux target | .deb (x64) |
| macOS target | DMG (x64 + arm64) |

---

## CI/CD y releases automáticas

Workflows incluidos:

- `.github/workflows/ci-build.yml`: valida compilación en `windows-latest`, `ubuntu-latest`, `macos-latest` para `push` y `pull_request`.
- `.github/workflows/release.yml`: en cada push a `master`, lee la versión de `package.json`, crea la release `vX.Y.Z`, compila en Windows/Linux/macOS y adjunta los instaladores como assets.

Assets esperados por release:

- Windows: `.exe` (NSIS) y portable
- Linux: `.deb`
- macOS: `.dmg`
- Metadatos updater: `.yml` y `.blockmap`

Permisos necesarios en GitHub Actions:

- `contents: write` (ya declarado en workflow)
- `GITHUB_TOKEN` automático del repositorio

---

## Auto-update en la aplicación

Se integra con `electron-updater` y GitHub Releases.

Comportamiento:

- Al iniciar la app empaquetada, se comprueban actualizaciones.
- Si hay una versión nueva, se descarga en segundo plano.
- Al terminar la descarga, se pide confirmación para reiniciar e instalar.
- Desde el panel de ajustes se muestra la versión actual y se puede lanzar una comprobación manual.

Notas importantes:

- En `npm start` (desarrollo) el autoupdate no se ejecuta.
- Para que funcione en producción, la release de GitHub debe incluir los instaladores y los metadatos generados por electron-builder (`latest.yml`/equivalentes y `.blockmap`).
- Los ficheros `.blockmap` permiten descargas diferenciales: el actualizador descarga solo partes cambiadas del instalador. No son necesarios para abrir el instalador manualmente, pero sí conviene conservarlos en releases si se quiere auto-update eficiente.
- Al no firmar código en Windows de momento, SmartScreen puede mostrar advertencias hasta incorporar certificado.

Para cambiar la versión de la aplicación, modifica `"version"` en `package.json`.
Normalmente no hace falta cambiarla a mano: el hook de commit la incrementa automáticamente.

---

## Persistencia de datos

La configuración (lista de apps y estado del modo concentración) se guarda automáticamente en un fichero JSON local en el directorio de datos de usuario del sistema operativo:

- **Windows**: `%APPDATA%\appcenter\user-preferences.json`
- **Linux**: `~/.config/appcenter/user-preferences.json`
- **macOS**: `~/Library/Application Support/appcenter/user-preferences.json`

---

## Variables de entorno y debug

```bash
# Activar modo debug mostrando las DevTools al inicio (editar main.js)
# Buscar la línea y descomentar:
mainWindow.webContents.openDevTools();

# O simplemente presionar F12 con la app abierta
```

---

## Licencia

Proyecto interno de Dobuss. Todos los derechos reservados.
