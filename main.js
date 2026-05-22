const { app, BrowserWindow, Notification, dialog, ipcMain, Menu, nativeImage, screen, session, shell, webContents } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const Store = require('./store');

let mainWindow;
const APP_USER_MODEL_ID = 'es.dobuss.appcenter';
const APP_NAME = 'AppCenter';
const shortcutRegisteredContents = new Set();
const popupReturnRegisteredContents = new Set();
const appIdByWebContentsId = new Map();
const popupTabMetaByWebContentsId = new Map();
let systemBadgeClearTimer = null;
app.setName(APP_NAME);

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

function getChromeCompatibleUserAgent() {
  const chromeVersion = process.versions.chrome || '120.0.0.0';
  const platformToken = process.platform === 'darwin'
    ? 'Macintosh; Intel Mac OS X 10_15_7'
    : process.platform === 'linux'
      ? 'X11; Linux x86_64'
      : 'Windows NT 10.0; Win64; x64';

  return `Mozilla/5.0 (${platformToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
}

function applyChromeCompatibleUserAgent(contents) {
  if (!contents || contents.isDestroyed() || typeof contents.setUserAgent !== 'function') {
    return;
  }

  contents.setUserAgent(getChromeCompatibleUserAgent());
}

function getAppIconPath(extension = process.platform === 'win32' ? 'ico' : 'png') {
  const iconFile = `appcenter.${extension}`;
  const iconDir = app.isPackaged
    ? path.join(process.resourcesPath, 'assets', 'icons')
    : path.join(__dirname, 'src', 'assets', 'icons');

  return path.join(iconDir, iconFile);
}

function isExternalProtocol(url) {
  try {
    const parsedUrl = new URL(url);
    return !['http:', 'https:', 'about:'].includes(parsedUrl.protocol);
  } catch (error) {
    return true;
  }
}

function isHttpOrHttpsUrl(url) {
  try {
    const parsedUrl = new URL(url);
    return ['http:', 'https:'].includes(parsedUrl.protocol);
  } catch (error) {
    return false;
  }
}

function getAppDefinitionForContents(contents) {
  if (!contents || contents.isDestroyed()) {
    return null;
  }

  const appId = appIdByWebContentsId.get(contents.id);
  if (!appId) {
    return null;
  }

  const apps = store.get('apps') || [];
  return apps.find(appDef => appDef.id === appId) || null;
}

function getPopupReturnHosts(appDef) {
  const hosts = new Set();

  try {
    hosts.add(new URL(appDef.url).hostname);
  } catch (error) {
    return hosts;
  }

  if (appDef.id === 'gchat') {
    hosts.add('chat.google.com');
    hosts.add('mail.google.com');
  }

  return hosts;
}

function getUrlHost(url) {
  try {
    return new URL(url).hostname;
  } catch (error) {
    return '';
  }
}

function isAuthOrLoginUrl(url) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (error) {
    return false;
  }

  const host = parsedUrl.hostname.toLowerCase();
  const pathname = parsedUrl.pathname.toLowerCase();
  const authHosts = [
    'accounts.google.com',
    'login.microsoftonline.com',
    'login.live.com',
    'appleid.apple.com',
    'github.com',
    'gitlab.com',
    'auth0.com',
    'okta.com'
  ];
  const authPathTokens = ['/login', '/signin', '/sign-in', '/oauth', '/authorize', '/sso', '/auth'];

  return authHosts.some(authHost => host === authHost || host.endsWith(`.${authHost}`))
    || authPathTokens.some(token => pathname.includes(token));
}

function isPopupReturnUrlForApp(appDef, targetUrl) {
  const host = getUrlHost(targetUrl);
  return Boolean(host && appDef && getPopupReturnHosts(appDef).has(host));
}

function shouldReturnPopupUrlToOpener(openerContents, targetUrl) {
  const appDef = getAppDefinitionForContents(openerContents);
  if (!appDef) {
    return false;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch (error) {
    return false;
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return false;
  }

  return getPopupReturnHosts(appDef).has(parsedUrl.hostname);
}

function shouldOpenAppLinksExternally(contents) {
  const appDef = getAppDefinitionForContents(contents);
  return !appDef || appDef.linkOpenMode !== 'internal';
}

function shouldOpenWindowExternally(contents, details) {
  if (!shouldOpenAppLinksExternally(contents) || !details || !isHttpOrHttpsUrl(details.url)) {
    return false;
  }

  const appDef = getAppDefinitionForContents(contents);
  if (isAuthOrLoginUrl(details.url) || isPopupReturnUrlForApp(appDef, details.url)) {
    return false;
  }

  return true;
}

function shouldOpenWindowAsInternalTab(contents, details) {
  const appDef = getAppDefinitionForContents(contents);
  return Boolean(appDef && appDef.linkOpenMode === 'internal' && details && isHttpOrHttpsUrl(details.url));
}

function requestInternalTab(contents, details) {
  const appDef = getAppDefinitionForContents(contents);
  if (!appDef || !mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  mainWindow.webContents.send('open-internal-tab', {
    appId: appDef.id,
    url: details.url,
    openerContentsId: contents.id,
    disposition: details.disposition
  });

  if (!mainWindow.isFocused()) {
    mainWindow.show();
    mainWindow.focus();
  }

  return true;
}

function returnPopupUrlToOpener(openerContents, popupWindow, targetUrl) {
  if (!shouldReturnPopupUrlToOpener(openerContents, targetUrl)) {
    return false;
  }

  if (!openerContents || openerContents.isDestroyed()) {
    return false;
  }

  openerContents.loadURL(targetUrl);

  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.close();
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }

  return true;
}

function closeInternalTabByContentsId(contentsId) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send('close-internal-tab-by-contents-id', { contentsId });
}

function setupInternalTabReturnToOpener(contents) {
  if (!contents || contents.isDestroyed()) {
    return;
  }

  const meta = popupTabMetaByWebContentsId.get(contents.id);
  if (!meta || meta.returnRegistered) {
    return;
  }

  meta.returnRegistered = true;
  popupTabMetaByWebContentsId.set(contents.id, meta);

  const handleNavigation = (event, targetUrl) => {
    const openerContents = webContents.fromId(meta.openerContentsId);
    if (!openerContents || openerContents.isDestroyed()) {
      return;
    }

    if (returnPopupUrlToOpener(openerContents, null, targetUrl)) {
      if (event) {
        event.preventDefault();
      }
      closeInternalTabByContentsId(contents.id);
    }
  };

  contents.on('will-navigate', handleNavigation);
  contents.on('will-redirect', handleNavigation);
  contents.on('did-navigate', handleNavigation);
}

function setupPopupReturnToOpener(contents) {
  if (!contents || contents.isDestroyed() || popupReturnRegisteredContents.has(contents.id)) {
    return;
  }

  popupReturnRegisteredContents.add(contents.id);

  contents.on('did-create-window', (popupWindow, details) => {
    if (!popupWindow || popupWindow.isDestroyed()) {
      return;
    }

    const popupContents = popupWindow.webContents;
    setupWebContentsHandlers(popupContents);

    if (details && details.url) {
      returnPopupUrlToOpener(contents, popupWindow, details.url);
    }

    const handlePopupNavigation = (event, targetUrl) => {
      if (returnPopupUrlToOpener(contents, popupWindow, targetUrl) && event) {
        event.preventDefault();
      }
    };

    popupContents.on('will-navigate', handlePopupNavigation);
    popupContents.on('will-redirect', handlePopupNavigation);
    popupContents.on('did-navigate', (event, targetUrl) => {
      returnPopupUrlToOpener(contents, popupWindow, targetUrl);
    });
  });

  contents.once('destroyed', () => {
    popupReturnRegisteredContents.delete(contents.id);
    popupTabMetaByWebContentsId.delete(contents.id);
  });
}

function setupWebContentsHandlers(contents) {
  if (!contents || contents.isDestroyed()) {
    return;
  }

  applyChromeCompatibleUserAgent(contents);
  setupKeyboardShortcuts(contents);
  setupPopupReturnToOpener(contents);

  contents.setWindowOpenHandler((details) => {
    const { url } = details;
    if (isExternalProtocol(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }

    if (shouldOpenWindowExternally(contents, details)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }

    if (shouldOpenWindowAsInternalTab(contents, details) && requestInternalTab(contents, details)) {
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

    if (input.key.toLowerCase() === 'r' && (input.control || input.meta) && !input.alt && !input.shift) {
      sendMenuCommand('reload-active-app');
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

function sendMenuCommand(command) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send('menu-command', { command });
}

function showNavigationHelp() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Navegación y atajos',
    message: 'Navegación y atajos de teclado',
    detail: [
      'Ctrl + R: refrescar la app activa.',
      'Alt + Izquierda / Alt + Derecha: ir atrás o adelante en la app activa.',
      'Scroll sobre la barra lateral: cambiar de app.',
      'Alt + Scroll: cambiar de app desde cualquier app web.',
      'Alt + Arriba / Alt + Abajo: cambiar a la app anterior o siguiente.',
      'F1-F24: abrir apps por posición en la barra lateral.',
      'Ctrl + ,: abrir configuración.',
      'Ctrl + Q o Alt + F4: salir de AppCenter.'
    ].join('\n'),
    buttons: ['Aceptar']
  });
}

function openBasicDocumentation() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Documentación básica',
    message: 'Documentación básica de AppCenter',
    detail: [
      'AppCenter centraliza aplicaciones web en una ventana única.',
      '',
      'Usa la barra lateral para cambiar entre apps. El scroll sobre esa barra cambia rápidamente de app, y Alt + scroll permite hacerlo incluso cuando el foco está dentro de una web.',
      '',
      'Puedes refrescar la app activa con Ctrl + R, volver con Alt + Izquierda y avanzar con Alt + Derecha.',
      '',
      'La configuración permite gestionar las apps visibles y el modo de apertura de enlaces.'
    ].join('\n'),
    buttons: ['Aceptar', 'Abrir README'],
    defaultId: 0,
    cancelId: 0
  }).then(({ response }) => {
    if (response !== 1) {
      return;
    }

    const readmePath = path.join(__dirname, 'README.md');
    shell.openPath(readmePath).then((errorMessage) => {
      if (!errorMessage) {
        return;
      }

      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'README no disponible',
        message: 'No se pudo abrir README.md',
        detail: errorMessage,
        buttons: ['Aceptar']
      });
    });
  }).catch((error) => {
    dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'Documentación básica',
      message: 'No se pudo mostrar la documentación básica',
      detail: error ? error.message : 'Error desconocido',
      buttons: ['Aceptar']
    });
  });
}

function createApplicationMenu() {
  const template = [
    {
      label: 'Archivo',
      submenu: [
        {
          label: 'Configuración',
          accelerator: 'CommandOrControl+,',
          click: () => sendMenuCommand('show-settings')
        },
        { type: 'separator' },
        {
          label: 'Salir de la aplicación',
          accelerator: 'CommandOrControl+Q',
          click: () => app.quit()
        },
        {
          label: 'Salir de la aplicación',
          accelerator: 'Alt+F4',
          visible: false,
          click: () => app.quit()
        }
      ]
    },
    {
      label: 'Navegación',
      submenu: [
        {
          label: 'Refrescar app activa',
          accelerator: 'CommandOrControl+R',
          click: () => sendMenuCommand('reload-active-app')
        },
        { type: 'separator' },
        {
          label: 'Atrás',
          accelerator: 'Alt+Left',
          click: () => sendMenuCommand('go-back')
        },
        {
          label: 'Adelante',
          accelerator: 'Alt+Right',
          click: () => sendMenuCommand('go-forward')
        },
        { type: 'separator' },
        {
          label: 'App anterior',
          accelerator: 'Alt+Up',
          click: () => sendMenuCommand('previous-app')
        },
        {
          label: 'App siguiente',
          accelerator: 'Alt+Down',
          click: () => sendMenuCommand('next-app')
        }
      ]
    },
    {
      label: 'Ayuda',
      submenu: [
        {
          label: 'Instrucciones de navegación y atajos',
          accelerator: 'CommandOrControl+F1',
          click: showNavigationHelp
        },
        {
          label: 'Documentación básica',
          accelerator: 'CommandOrControl+F2',
          click: openBasicDocumentation
        }
      ]
    }
  ];

  return Menu.buildFromTemplate(template);
}

function setTrackedWebContentsAudioMuted(muted) {
  for (const contentsId of appIdByWebContentsId.keys()) {
    const contents = webContents.fromId(contentsId);
    if (contents && !contents.isDestroyed() && typeof contents.setAudioMuted === 'function') {
      contents.setAudioMuted(muted);
    }
  }
}

function clearSystemNotificationBadge() {
  if (typeof app.setBadgeCount === 'function') {
    app.setBadgeCount(0);
  }

  if (mainWindow && !mainWindow.isDestroyed() && typeof mainWindow.setOverlayIcon === 'function') {
    mainWindow.setOverlayIcon(null, '');
  }
}

function startSystemBadgeGuard() {
  clearSystemNotificationBadge();

  if (systemBadgeClearTimer) {
    return;
  }

  systemBadgeClearTimer = setInterval(clearSystemNotificationBadge, 1000);
  if (typeof systemBadgeClearTimer.unref === 'function') {
    systemBadgeClearTimer.unref();
  }
}

function getAppDefinitionById(appId) {
  const apps = store.get('apps') || [];
  return apps.find(appDef => appDef.id === appId) || null;
}

function showAppCenterNotification({ appId, title, body, tag }) {
  if (!Notification.isSupported()) {
    return;
  }

  const appDef = getAppDefinitionById(appId);
  const appName = appDef && appDef.name ? appDef.name : 'Aplicación';
  const notificationTitle = title && title !== appName
    ? `${appName}: ${title}`
    : appName;
  const notificationBody = body || 'Nueva notificación';

  const notification = new Notification({
    title: notificationTitle,
    body: notificationBody,
    icon: getAppIconPath('png'),
    silent: false
  });

  notification.on('show', clearSystemNotificationBadge);
  notification.on('close', clearSystemNotificationBadge);
  notification.on('click', () => {
    clearSystemNotificationBadge();

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();

      if (appId) {
        mainWindow.webContents.send('activate-app', { appId });
      }
    }
  });

  notification.show();
  clearSystemNotificationBadge();
}

function markRendererAppNotification(appId) {
  if (!appId || !mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send('mark-app-notification', { appId });
}

function handleAppNotification(notification = {}) {
  markRendererAppNotification(notification.appId);
  if (notification.nativeShown !== true) {
    showAppCenterNotification(notification);
  }
}

function configureNotificationPermissions(electronSession) {
  if (!electronSession) {
    return;
  }

  electronSession.setPermissionRequestHandler((contents, permission, callback) => {
    if (permission === 'notifications') {
      clearSystemNotificationBadge();
      callback(true);
      return;
    }

    callback(true);
  });

  if (typeof electronSession.setPermissionCheckHandler === 'function') {
    electronSession.setPermissionCheckHandler((contents, permission) => {
      if (permission === 'notifications') {
        clearSystemNotificationBadge();
        return true;
      }

      return true;
    });
  }
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
  mainWindow = new BrowserWindow({
    width: initialWindowState.width,
    height: initialWindowState.height,
    x: initialWindowState.x,
    y: initialWindowState.y,
    icon: appIcon,
    autoHideMenuBar: false,
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

  clearSystemNotificationBadge();

  const applicationMenu = createApplicationMenu();
  Menu.setApplicationMenu(applicationMenu);
  mainWindow.setMenu(applicationMenu);
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  setupKeyboardShortcuts(mainWindow.webContents);

  mainWindow.on('close', saveWindowState);
  mainWindow.on('focus', clearSystemNotificationBadge);
  mainWindow.on('show', clearSystemNotificationBadge);
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
  startSystemBadgeGuard();
  const chromeCompatibleUserAgent = getChromeCompatibleUserAgent();
  app.userAgentFallback = chromeCompatibleUserAgent;
  session.defaultSession.setUserAgent(chromeCompatibleUserAgent);
  configureNotificationPermissions(session.defaultSession);

  // Interceptar intentos de abrir nueva ventana (popups, OAuth, target=_blank, window.open...)
  // desde cualquier webContents de la app, incluyendo webviews internos
  app.on('web-contents-created', (event, contents) => {
    setupWebContentsHandlers(contents);
  });

  createWindow();
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
ipcMain.on('open-popup', (event, { url, appId }) => {
    if (!url) {
      return;
    }

    const apps = store.get('apps') || [];
    const appDef = apps.find(item => item.id === appId);
    if (appDef && appDef.linkOpenMode === 'internal') {
      return;
    }

    if (isAuthOrLoginUrl(url) || isPopupReturnUrlForApp(appDef, url)) {
      return;
    }

    shell.openExternal(url);
});

ipcMain.on('setup-webview-handlers', (event, { wvContentsId, appId, isPopupTab = false, openerContentsId = null }) => {
  const contents = webContents.fromId(wvContentsId);
  if (contents && appId) {
    appIdByWebContentsId.set(contents.id, appId);
    if (isPopupTab && openerContentsId) {
      const existingMeta = popupTabMetaByWebContentsId.get(contents.id);
      popupTabMetaByWebContentsId.set(contents.id, {
        appId,
        openerContentsId,
        returnRegistered: existingMeta ? existingMeta.returnRegistered === true : false
      });
    }
    if (isFocusModeActive() && typeof contents.setAudioMuted === 'function') {
      contents.setAudioMuted(true);
    }
  }
  setupWebContentsHandlers(contents);
  setupInternalTabReturnToOpener(contents);
});

ipcMain.on('app-notification', (event, notification) => {
  handleAppNotification(notification || {});
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

    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('focus-mode-changed', { active: false, endTime: null });
    }
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

    return nextMode;
});
