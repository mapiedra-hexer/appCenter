const { app, BrowserWindow, ipcMain, Notification, nativeImage, screen, session, shell, webContents } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const { PNG } = require('pngjs');
const Store = require('./store');

let mainWindow;
let defaultWindowIcon;
const APP_USER_MODEL_ID = 'es.dobuss.appcenter';
const APP_NAME = 'AppCenter';
const trackedTitleFallbacks = new Set();
const lastUnreadByApp = new Map();
const recentNotificationAtByApp = new Map();
const activeNativeNotifications = new Set();
let updateDownloadedNotificationShown = false;
const shortcutRegisteredContents = new Set();
const appIdByWebContentsId = new Map();
let currentSystemBadgeCount = 0;

app.setName(APP_NAME);

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

function getAppIconPath(extension = process.platform === 'win32' ? 'ico' : 'png') {
  const iconFile = `appcenter.${extension}`;
  const iconDir = app.isPackaged
    ? path.join(process.resourcesPath, 'assets', 'icons')
    : path.join(__dirname, 'src', 'assets', 'icons');

  return path.join(iconDir, iconFile);
}

function createBadgedWindowIcon() {
  const sourceIcon = nativeImage
    .createFromPath(getAppIconPath('png'))
    .resize({ width: 256, height: 256 });
  const png = PNG.sync.read(sourceIcon.toPNG());
  const centerX = 202;
  const centerY = 54;
  const outerRadius = 40;
  const innerRadius = 32;

  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const distance = Math.hypot(x - centerX, y - centerY);
      if (distance > outerRadius) {
        continue;
      }

      const idx = (png.width * y + x) << 2;
      if (distance <= innerRadius) {
        png.data[idx] = 239;
        png.data[idx + 1] = 68;
        png.data[idx + 2] = 68;
        png.data[idx + 3] = 255;
      } else {
        png.data[idx] = 255;
        png.data[idx + 1] = 255;
        png.data[idx + 2] = 255;
        png.data[idx + 3] = 255;
      }
    }
  }

  return nativeImage.createFromBuffer(PNG.sync.write(png));
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

  setupKeyboardShortcuts(contents);

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

function getFunctionKeyIndex(input) {
  const match = input && input.key ? input.key.match(/^F(\d+)$/) : null;
  if (!match) {
    return null;
  }

  const keyNumber = Number(match[1]);
  if (!Number.isInteger(keyNumber) || keyNumber < 1 || keyNumber > 24) {
    return null;
  }

  return keyNumber - 1;
}

function setupKeyboardShortcuts(contents) {
  if (!contents || contents.isDestroyed() || shortcutRegisteredContents.has(contents.id)) {
    return;
  }

  shortcutRegisteredContents.add(contents.id);

  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') {
      return;
    }

    if (input.key === 'F12' && (input.control || input.meta)) {
      if (mainWindow && !mainWindow.isDestroyed() && contents === mainWindow.webContents) {
        mainWindow.webContents.toggleDevTools();
      }
      event.preventDefault();
      return;
    }

    const appIndex = getFunctionKeyIndex(input);
    if (appIndex === null) {
      return;
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('activate-app-index', { appIndex });
      event.preventDefault();
    }
  });

  contents.once('destroyed', () => {
    shortcutRegisteredContents.delete(contents.id);
  });
}

function parseUnreadCountFromTitle(title) {
  if (!title) {
    return 0;
  }

  const match = title.match(/^\((\d+)\)\s+/);
  return match ? Number(match[1]) : 0;
}

function createTaskbarBadgeIcon(count) {
  const label = count > 99 ? '99+' : String(count);
  const fontSize = label.length > 2 ? 6 : label.length > 1 ? 7 : 9;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="7.5" fill="#ef4444"/>
      <circle cx="8" cy="8" r="7" fill="none" stroke="#ffffff" stroke-width="1"/>
      <text x="8" y="11" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="#ffffff">${label}</text>
    </svg>
  `;

  const encodedSvg = Buffer.from(svg).toString('base64');
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${encodedSvg}`);
}

function applyTaskbarOverlay() {
  if (!mainWindow || mainWindow.isDestroyed() || process.platform !== 'win32') {
    return;
  }

  if (isFocusModeActive()) {
    mainWindow.setOverlayIcon(null, 'Modo concentración activo');
    if (defaultWindowIcon) {
      mainWindow.setIcon(defaultWindowIcon);
    }
    mainWindow.flashFrame(false);
    return;
  }

  if (currentSystemBadgeCount > 0) {
    mainWindow.setOverlayIcon(
      createTaskbarBadgeIcon(currentSystemBadgeCount),
      `${currentSystemBadgeCount} notificaciones pendientes`
    );
    mainWindow.setIcon(createBadgedWindowIcon());
    mainWindow.flashFrame(true);
  } else {
    mainWindow.setOverlayIcon(null, 'Sin notificaciones pendientes');
    if (defaultWindowIcon) {
      mainWindow.setIcon(defaultWindowIcon);
    }
    mainWindow.flashFrame(false);
  }
}

function updateSystemBadge(count) {
  currentSystemBadgeCount = Math.max(0, Number.isFinite(count) ? count : 0);
  app.setBadgeCount(isFocusModeActive() ? 0 : currentSystemBadgeCount);
  applyTaskbarOverlay();
}

function setTrackedWebContentsAudioMuted(muted) {
  for (const contentsId of appIdByWebContentsId.keys()) {
    const contents = webContents.fromId(contentsId);
    if (contents && !contents.isDestroyed() && typeof contents.setAudioMuted === 'function') {
      contents.setAudioMuted(muted);
    }
  }
}

function setupWebviewNotificationFallback(contents, appId) {
  if (!contents || contents.isDestroyed() || !appId || trackedTitleFallbacks.has(contents.id)) {
    return;
  }

  trackedTitleFallbacks.add(contents.id);
  appIdByWebContentsId.set(contents.id, appId);

  contents.on('page-title-updated', (event, title) => {
    const unreadCount = parseUnreadCountFromTitle(title);
    const previousCount = lastUnreadByApp.get(appId) || 0;
    lastUnreadByApp.set(appId, unreadCount);

    if (unreadCount !== previousCount && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-badge', { appId, count: unreadCount });
    }

    if (unreadCount <= previousCount) {
      return;
    }

    if (Date.now() - (recentNotificationAtByApp.get(appId) || 0) < 4000) {
      return;
    }

    showAppNotification({
      title: 'Nueva actividad',
      body: unreadCount === 1 ? 'Tienes 1 elemento sin leer.' : `Tienes ${unreadCount} elementos sin leer.`,
      appId
    });
  });

  contents.once('destroyed', () => {
    trackedTitleFallbacks.delete(contents.id);
    appIdByWebContentsId.delete(contents.id);
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

  if (isFocusModeActive()) {
    queueFocusNotification({ title, body, appId, notificationId });
    return;
  }

  const apps = store.get('apps') || [];
  const appDef = apps.find(a => a.id === appId);
  const name = appDef ? appDef.name : 'Web';

  const notification = new Notification({
    title: `${title} (${name})`,
    body: body || '',
    icon: getAppIconPath('png')
  });

  activeNativeNotifications.add(notification);

  notification.on('click', () => {
    activeNativeNotifications.delete(notification);
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
  const summaryEntries = Object.entries(summary);
  let bodyText = 'Sin actividad pendiente durante el modo concentración.';

  if (summaryEntries.length > 0) {
    bodyText = 'Resumen de actividad:\n';
  }

  for (const [id, count] of summaryEntries) {
    const appDef = apps.find(a => a.id === id);
    const name = appDef ? appDef.name : id;
    bodyText += `${name}: ${count} notificación${count === 1 ? '' : 'es'}\n`;
  }

  const appIds = Object.keys(summary);
  const notification = new Notification({
    title: 'Modo Concentración Finalizado',
    body: bodyText,
    icon: getAppIconPath('png')
  });

  activeNativeNotifications.add(notification);

  notification.on('click', () => {
    activeNativeNotifications.delete(notification);
  });

  notification.on('close', () => {
    activeNativeNotifications.delete(notification);
  });

  notification.show();
}

function showUpdateDownloadedNotification(info) {
  if (updateDownloadedNotificationShown) {
    return;
  }

  updateDownloadedNotificationShown = true;
  const version = info && info.version ? ` ${info.version}` : '';
  const notification = new Notification({
    title: `Actualización de ${APP_NAME} lista`,
    body: `La versión${version} se ha descargado. Abre AppCenter para reiniciar e instalarla.`,
    icon: getAppIconPath('png')
  });

  activeNativeNotifications.add(notification);

  notification.on('click', () => {
    activeNativeNotifications.delete(notification);
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
    windowState: null,
    focusMode: {
      active: false,
      endTime: null
    }
  }
});

const DEFAULT_WINDOW_STATE = {
  width: 1200,
  height: 800
};

function getInitialWindowState() {
  const savedState = store.get('windowState');

  if (!isValidWindowState(savedState)) {
    return DEFAULT_WINDOW_STATE;
  }

  const savedBounds = {
    x: savedState.x,
    y: savedState.y,
    width: savedState.width,
    height: savedState.height
  };

  if (!isWindowVisibleOnAnyDisplay(savedBounds)) {
    return DEFAULT_WINDOW_STATE;
  }

  return {
    ...savedBounds,
    isMaximized: savedState.isMaximized === true
  };
}

function isValidWindowState(state) {
  return state
    && Number.isInteger(state.width)
    && Number.isInteger(state.height)
    && Number.isInteger(state.x)
    && Number.isInteger(state.y)
    && state.width >= 800
    && state.height >= 600;
}

function isWindowVisibleOnAnyDisplay(bounds) {
  return screen.getAllDisplays().some((display) => rectanglesOverlap(bounds, display.workArea));
}

function rectanglesOverlap(first, second) {
  return first.x < second.x + second.width
    && first.x + first.width > second.x
    && first.y < second.y + second.height
    && first.y + first.height > second.y;
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const bounds = mainWindow.isMaximized()
    ? mainWindow.getNormalBounds()
    : mainWindow.getBounds();

  store.set('windowState', {
    ...bounds,
    isMaximized: mainWindow.isMaximized()
  });
}

function createWindow () {
  const appIcon = nativeImage.createFromPath(getAppIconPath());
  const initialWindowState = getInitialWindowState();
  defaultWindowIcon = appIcon;
  mainWindow = new BrowserWindow({
    width: initialWindowState.width,
    height: initialWindowState.height,
    x: initialWindowState.x,
    y: initialWindowState.y,
    icon: appIcon,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true
    }
  });

  if (initialWindowState.isMaximized) {
    mainWindow.maximize();
  }

  if (process.platform === 'win32') {
    mainWindow.setIcon(appIcon);
  }

  mainWindow.setMenu(null);
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  setupKeyboardShortcuts(mainWindow.webContents);

  mainWindow.on('show', applyTaskbarOverlay);
  mainWindow.on('restore', applyTaskbarOverlay);
  mainWindow.on('focus', applyTaskbarOverlay);
  mainWindow.on('close', saveWindowState);
  mainWindow.webContents.once('did-finish-load', applyTaskbarOverlay);
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
    showUpdateDownloadedNotification(info);

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
    autoUpdater.checkForUpdates();
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
  if (contents && appId) {
    appIdByWebContentsId.set(contents.id, appId);
    if (isFocusModeActive() && typeof contents.setAudioMuted === 'function') {
      contents.setAudioMuted(true);
    }
  }
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

ipcMain.handle('app:get-info', () => ({
  name: app.getName(),
  version: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
  packaged: app.isPackaged
}));

// IPC: Configuración
ipcMain.handle('get-config', () => store.get('apps'));
ipcMain.handle('save-config', (event, apps) => {
    store.set('apps', apps);
    return true;
});

// Focus Queue
let focusQueue = [];
let focusModeTimer = null;

function normalizeFocusMode(focusMode) {
    if (!focusMode || !focusMode.active) {
        return { active: false, endTime: null };
    }

    const endTime = Number.isFinite(focusMode.endTime) ? focusMode.endTime : null;
    const active = endTime === null || endTime > Date.now();

    return {
        active,
        endTime: active ? endTime : null
    };
}

function queueFocusNotification({ title, body, appId, notificationId }) {
    focusQueue.push({
        title: title || 'Nueva actividad',
        body: body || '',
        appId,
        notificationId,
        createdAt: Date.now()
    });
}

function isFocusModeActive() {
    const focusState = normalizeFocusMode(store.get('focusMode'));

    if (!focusState.active) {
        endFocusMode({ showSummary: true });
        return false;
    }

    scheduleFocusModeTimer(focusState);
    return true;
}

function scheduleFocusModeTimer(focusMode = store.get('focusMode')) {
    if (focusModeTimer) {
        clearTimeout(focusModeTimer);
        focusModeTimer = null;
    }

    const normalized = normalizeFocusMode(focusMode);

    if (!normalized.active || normalized.endTime === null) {
        return;
    }

    const delay = Math.max(0, normalized.endTime - Date.now());
    focusModeTimer = setTimeout(() => {
        endFocusMode({ showSummary: true });
    }, delay);
}

function syncFocusSuppressionState() {
    const active = isFocusModeActive();
    setTrackedWebContentsAudioMuted(active);
    updateSystemBadge(currentSystemBadgeCount);
}

function endFocusMode({ showSummary }) {
    const prevMode = store.get('focusMode') || { active: false };

    if (!prevMode.active) {
        return;
    }

    if (focusModeTimer) {
        clearTimeout(focusModeTimer);
        focusModeTimer = null;
    }

    store.set('focusMode', { active: false, endTime: null });
    setTrackedWebContentsAudioMuted(false);
    updateSystemBadge(currentSystemBadgeCount);

    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('focus-mode-changed', { active: false, endTime: null });
    }

    if (showSummary) {
        showFocusSummaryNotification(focusQueue);
    }

    focusQueue = [];
}

// Focus state handle
ipcMain.handle('get-focus-mode', () => {
    const savedFocusMode = store.get('focusMode');
    const focusMode = normalizeFocusMode(savedFocusMode);

    if (savedFocusMode && savedFocusMode.active && !focusMode.active) {
        endFocusMode({ showSummary: true });
        return { active: false, endTime: null };
    }

    store.set('focusMode', focusMode);
    scheduleFocusModeTimer(focusMode);
    return focusMode;
});

ipcMain.handle('set-focus-mode', (event, focusMode) => {
    const prevMode = store.get('focusMode') || { active: false };
    const prevState = prevMode.active;
    const nextMode = normalizeFocusMode(focusMode);
    store.set('focusMode', nextMode);
    scheduleFocusModeTimer(nextMode);
    syncFocusSuppressionState();
    
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('focus-mode-changed', nextMode);
    }

    // Si se acaba de apagar el modo concentración, mostramos el resumen acumulado.
    if (prevState && !nextMode.active) {
        showFocusSummaryNotification(focusQueue);
        focusQueue = [];
    }
    
    return nextMode;
});

// Captura de Notificaciones desde el Preload (interno de las webapps)
ipcMain.on('webview-notification', (event, payload) => {
    const { notificationId, title, options } = payload;
    const notificationOptions = options || {};
    const payloadAppId = payload.appId;
    const appId = payloadAppId && payloadAppId !== 'unknown'
        ? payloadAppId
        : appIdByWebContentsId.get(event.sender.id);

    if (!appId) {
        return;
    }
    
    // 1. Avisar siempre a la UI (renderer) para que pinte el "Badge Rojo"
    if (mainWindow) {
        mainWindow.webContents.send('update-badge', { appId });
    }
    
    // 2. Comprobar Modo Concentración
    if (!isFocusModeActive()) {
        // Modo Normal: mostramos la notificación bajo AppCenter en el Sistema Operativo.
        showAppNotification({
            title,
            body: notificationOptions.body || '',
            appId,
            notificationId
        });
    } else {
        // Modo Concentración Activo: encolamos para el resumen
        queueFocusNotification({
            title,
            body: notificationOptions.body || '',
            appId,
            notificationId
        });
    }
});

ipcMain.on('set-badge-count', (event, { count }) => {
    updateSystemBadge(count);
});
