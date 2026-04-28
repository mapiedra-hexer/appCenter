const { app, BrowserWindow, ipcMain, Notification, shell, webContents } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const Store = require('./store');

let mainWindow;

function isExternalProtocol(url) {
  try {
    const parsedUrl = new URL(url);
    return !['http:', 'https:', 'about:'].includes(parsedUrl.protocol);
  } catch (error) {
    return true;
  }
}

function setupWebContentsHandlers(contents) {
  if (!contents || contents.isDestroyed()) {
    return;
  }

  contents.setWindowOpenHandler(({ url }) => {
    if (isExternalProtocol(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }

    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 1000,
        height: 760,
        parent: mainWindow,
        modal: false,
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          webviewTag: false
        }
      }
    };
  });
}

const store = new Store({
  configName: 'user-preferences',
  defaults: {
    apps: [],
    focusMode: {
      active: false,
      endTime: null
    }
  }
});

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'src', 'assets', 'icons', 'appcenter.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  
  // F12 para abrir/cerrar consola en debug
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
}

function setupAutoUpdater() {
  // Evita ruido de logs y permite que el update se aplique cuando el usuario confirme.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    if (mainWindow) {
      mainWindow.webContents.send('updater:checking');
    }
  });

  autoUpdater.on('update-available', (info) => {
    if (mainWindow) {
      mainWindow.webContents.send('updater:available', info);
    }
  });

  autoUpdater.on('update-not-available', (info) => {
    if (mainWindow) {
      mainWindow.webContents.send('updater:not-available', info);
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    if (mainWindow) {
      mainWindow.webContents.send('updater:progress', progress);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    if (mainWindow) {
      mainWindow.webContents.send('updater:downloaded', info);
    }
  });

  autoUpdater.on('error', (error) => {
    if (mainWindow) {
      mainWindow.webContents.send('updater:error', error ? error.message : 'Error desconocido en auto-update');
    }
  });
}

app.whenReady().then(() => {
  // Solución para evitar que WhatsApp bloquee la versión vieja de Chrome en Electron
  app.userAgentFallback = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  // Interceptar intentos de abrir nueva ventana (popups, OAuth, target=_blank, window.open...)
  // desde cualquier webContents de la app, incluyendo webviews internos
  app.on('web-contents-created', (event, contents) => {
    setupWebContentsHandlers(contents);
  });

  createWindow();
  setupAutoUpdater();

  // Solo comprobar updates en app empaquetada para evitar ruido en desarrollo.
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify();
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// Fallback IPC por si algún evento antiguo lo requiere
ipcMain.on('open-popup', (event, { url }) => {
    shell.openExternal(url);
});

ipcMain.on('setup-webview-handlers', (event, { wvContentsId }) => {
  const contents = webContents.fromId(wvContentsId);
  setupWebContentsHandlers(contents);
});

ipcMain.handle('updater:check', async () => {
  if (!app.isPackaged) {
    return { ok: false, reason: 'Auto-update solo disponible en app empaquetada.' };
  }

  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error ? error.message : 'No se pudo comprobar actualizaciones.' };
  }
});

ipcMain.handle('updater:install', async () => {
  autoUpdater.quitAndInstall();
  return { ok: true };
});

// IPC: Configuración
ipcMain.handle('get-config', () => store.get('apps'));
ipcMain.handle('save-config', (event, apps) => {
    store.set('apps', apps);
    return true;
});

// Focus Queue
let focusQueue = [];

// Focus state handle
ipcMain.handle('get-focus-mode', () => store.get('focusMode') || { active: false });
ipcMain.handle('set-focus-mode', (event, focusMode) => {
    const prevMode = store.get('focusMode') || { active: false };
    const prevState = prevMode.active;
    store.set('focusMode', focusMode);
    
    // Si se acaba de apagar el modo concentración y tenemos cosas en cola:
    if (prevState && !focusMode.active && focusQueue.length > 0) {
        // Agrupar por App
        const summary = focusQueue.reduce((acc, note) => {
            acc[note.appId] = (acc[note.appId] || 0) + 1;
            return acc;
        }, {});
        
        let bodyText = "Resumen de actividad:\n";
        for (const [id, count] of Object.entries(summary)) {
            const appDef = store.get('apps').find(a => a.id === id);
            const name = appDef ? appDef.name : id;
            bodyText += `• ${name}: ${count} mensajes\n`;
        }

        new Notification({
            title: 'Modo Concentración Finalizado 🛎️',
            body: bodyText,
            icon: path.join(__dirname, 'src', 'assets', 'icons', 'appcenter.png')
        }).show();
        
        // Limpiamos la cola
        focusQueue = [];
    }
    
    return true;
});

// Captura de Notificaciones desde el Preload (interno de las webapps)
ipcMain.on('webview-notification', (event, payload) => {
    const { title, options, appId } = payload;
    
    // 1. Avisar siempre a la UI (renderer) para que pinte el "Badge Rojo"
    if (mainWindow) {
        mainWindow.webContents.send('update-badge', { appId });
    }
    
    // 2. Comprobar Modo Concentración
    const focusState = store.get('focusMode');
    if (!focusState.active) {
        // Modo Normal: mostramos la notificación en el Sistema Operativo
        // Buscamos también el nombre de la app
        const appDef = store.get('apps').find(a => a.id === appId);
        const name = appDef ? appDef.name : 'Web';
        
        new Notification({
            title: `${title} (${name})`,
            body: options.body || '',
            icon: path.join(__dirname, 'src', 'assets', 'icons', 'appcenter.png') // TODO: Descargar options.icon como nativeImage si quisieramos
        }).show();
    } else {
        // Modo Concentración Activo: encolamos para el resumen
        focusQueue.push(payload);
    }
});
