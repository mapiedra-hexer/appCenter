const { app, BrowserWindow, ipcMain, Notification, nativeImage, session, shell, webContents } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const Store = require('./store');

let mainWindow;
const APP_USER_MODEL_ID = 'es.dobuss.appcenter';
const APP_NAME = 'AppCenter';
const trackedTitleFallbacks = new Set();
const lastUnreadByApp = new Map();
const recentNotificationAtByApp = new Map();
const activeNativeNotifications = new Set();

app.setName(APP_NAME);

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

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

function parseUnreadCountFromTitle(title) {
  if (!title) {
    return 0;
  }

  const match = title.match(/^\((\d+)\)\s+/);
  return match ? Number(match[1]) : 0;
}

function setupWebviewNotificationFallback(contents, appId) {
  if (!contents || contents.isDestroyed() || !appId || trackedTitleFallbacks.has(contents.id)) {
    return;
  }

  trackedTitleFallbacks.add(contents.id);

  contents.on('page-title-updated', (event, title) => {
    const unreadCount = parseUnreadCountFromTitle(title);
    const previousCount = lastUnreadByApp.get(appId) || 0;
    lastUnreadByApp.set(appId, unreadCount);

    if (unreadCount <= previousCount) {
      return;
    }

    if (Date.now() - (recentNotificationAtByApp.get(appId) || 0) < 4000) {
      return;
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-badge', { appId, count: unreadCount });
    }

    showAppNotification({
      title: 'Nueva actividad',
      body: unreadCount === 1 ? 'Tienes 1 elemento sin leer.' : `Tienes ${unreadCount} elementos sin leer.`,
      appId
    });
  });

  contents.once('destroyed', () => {
    trackedTitleFallbacks.delete(contents.id);
  });
}

function setupNotificationPermissions() {
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'notifications') {
      return true;
    }

    return undefined;
  });

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'notifications') {
      callback(true);
      return;
    }

    callback(false);
  });
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
  return true;
}

function showAppNotification({ title, body, appId, notificationId }) {
  if (appId) {
    recentNotificationAtByApp.set(appId, Date.now());
  }

  const apps = store.get('apps') || [];
  const appDef = apps.find(a => a.id === appId);
  const name = appDef ? appDef.name : 'Web';

  const notification = new Notification({
    title: `${title} (${name})`,
    body: body || '',
    icon: path.join(__dirname, 'src', 'assets', 'icons', 'appcenter.png')
  });

  activeNativeNotifications.add(notification);

  notification.on('click', () => {
    activeNativeNotifications.delete(notification);
    if (focusMainWindow() && appId) {
      mainWindow.webContents.send('activate-app', { appId, notificationId });
    }
  });

  notification.on('close', () => {
    activeNativeNotifications.delete(notification);
  });

  notification.show();
}

function showFocusSummaryNotification(queue) {
  const summary = queue.reduce((acc, note) => {
    acc[note.appId] = (acc[note.appId] || 0) + 1;
    return acc;
  }, {});

  const apps = store.get('apps') || [];
  let bodyText = "Resumen de actividad:\n";
  for (const [id, count] of Object.entries(summary)) {
    const appDef = apps.find(a => a.id === id);
    const name = appDef ? appDef.name : id;
    bodyText += `• ${name}: ${count} mensajes\n`;
  }

  const appIds = Object.keys(summary);
  const notification = new Notification({
    title: 'Modo Concentración Finalizado',
    body: bodyText,
    icon: path.join(__dirname, 'src', 'assets', 'icons', 'appcenter.png')
  });

  activeNativeNotifications.add(notification);

  notification.on('click', () => {
    activeNativeNotifications.delete(notification);
    if (!focusMainWindow()) {
      return;
    }

    if (appIds.length === 1) {
      mainWindow.webContents.send('activate-app', { appId: appIds[0] });
    } else {
      mainWindow.webContents.send('show-settings');
    }
  });

  notification.on('close', () => {
    activeNativeNotifications.delete(notification);
  });

  notification.show();
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
  const iconFile = process.platform === 'win32' ? 'appcenter.ico' : 'appcenter.png';
  const appIcon = nativeImage.createFromPath(path.join(__dirname, 'src', 'assets', 'icons', iconFile));
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: appIcon,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true
    }
  });

  if (process.platform === 'win32') {
    mainWindow.setIcon(appIcon);
  }

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
  setupNotificationPermissions();
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

ipcMain.on('setup-webview-handlers', (event, { wvContentsId, appId }) => {
  const contents = webContents.fromId(wvContentsId);
  setupWebContentsHandlers(contents);
  setupWebviewNotificationFallback(contents, appId);
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
        showFocusSummaryNotification(focusQueue);
        focusQueue = [];
    }
    
    return true;
});

// Captura de Notificaciones desde el Preload (interno de las webapps)
ipcMain.on('webview-notification', (event, payload) => {
    const { notificationId, title, options, appId } = payload;
    
    // 1. Avisar siempre a la UI (renderer) para que pinte el "Badge Rojo"
    if (mainWindow) {
        mainWindow.webContents.send('update-badge', { appId });
    }
    
    // 2. Comprobar Modo Concentración
    const focusState = store.get('focusMode');
    if (!focusState.active) {
        // Modo Normal: mostramos la notificación bajo AppCenter en el Sistema Operativo.
        showAppNotification({
            title,
            body: options.body || '',
            appId,
            notificationId
        });
    } else {
        // Modo Concentración Activo: encolamos para el resumen
        focusQueue.push(payload);
    }
});
