const { ipcRenderer } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

let currentApps = [];
let dragStartIndex = null;
const defaultLinkOpenMode = 'external';
const internalTabsByApp = {};
const activeTabByApp = {};
const notifiedApps = new Set();
const pageNotificationBridgeScript = `
(() => {
    if (window.__appcenterNotificationBridgeInstalled) {
        return;
    }

    Object.defineProperty(window, '__appcenterNotificationBridgeInstalled', {
        configurable: true,
        value: true
    });

    const postNotification = (notification = {}) => {
        window.postMessage({
            source: 'appcenter-page-bridge',
            type: 'notification',
            notification
        }, '*');
    };

    const getNotificationPayload = (title, options = {}, nativeShown = false) => ({
        title: String(title || ''),
        body: options && options.body ? String(options.body) : '',
        tag: options && options.tag ? String(options.tag) : '',
        nativeShown
    });

    const OriginalNotification = window.Notification;
    if (typeof OriginalNotification === 'function') {
        const WrappedNotification = function(title, options) {
            postNotification(getNotificationPayload(title, options, true));
            return new OriginalNotification(title, options);
        };

        try {
            Object.setPrototypeOf(WrappedNotification, OriginalNotification);
        } catch (error) {}

        WrappedNotification.prototype = OriginalNotification.prototype;
        Object.defineProperty(WrappedNotification, 'permission', {
            configurable: true,
            get: () => OriginalNotification.permission
        });
        WrappedNotification.requestPermission = (...args) => OriginalNotification.requestPermission.apply(OriginalNotification, args);
        WrappedNotification.maxActions = OriginalNotification.maxActions || 0;

        Object.defineProperty(window, 'Notification', {
            configurable: true,
            writable: true,
            value: WrappedNotification
        });
    }

    if (window.ServiceWorkerRegistration && window.ServiceWorkerRegistration.prototype) {
        const swPrototype = window.ServiceWorkerRegistration.prototype;
        const originalShowNotification = swPrototype.showNotification;
        if (typeof originalShowNotification === 'function' && !originalShowNotification.__appcenterWrapped) {
            const wrappedShowNotification = function(title, options) {
                postNotification(getNotificationPayload(title, options, true));
                return originalShowNotification.apply(this, arguments);
            };
            wrappedShowNotification.__appcenterWrapped = true;
            swPrototype.showNotification = wrappedShowNotification;
        }
    }

    const patchBadgeTarget = (target) => {
        if (!target || target.__appcenterBadgeBridgeInstalled) {
            return;
        }

        Object.defineProperty(target, '__appcenterBadgeBridgeInstalled', {
            configurable: true,
            value: true
        });

        const originalSetAppBadge = target.setAppBadge;
        Object.defineProperty(target, 'setAppBadge', {
            configurable: true,
            writable: true,
            value: function(contents) {
                const badgeValue = Number(contents);
                if (contents === undefined || !Number.isFinite(badgeValue) || badgeValue > 0) {
                    postNotification({ nativeShown: false });
                }

                if (typeof originalSetAppBadge === 'function') {
                    return originalSetAppBadge.apply(this, arguments);
                }

                return Promise.resolve();
            }
        });
    };

    patchBadgeTarget(window.navigator);
    patchBadgeTarget(Object.getPrototypeOf(window.navigator));
})();
`;
let focusModeState = { active: false, endTime: null };
let focusCountdownTimer = null;
let nextInternalTabId = 1;
let sidebarWheelLocked = false;

$(document).ready(async function() {
    // 1. Cargar las apps guardadas al iniciar y modo focus
    currentApps = await ipcRenderer.invoke('get-config') || [];
    currentApps = currentApps.map(normalizeAppConfig);
    const focusState = await ipcRenderer.invoke('get-focus-mode');
    setFocusModeState(focusState);
    await renderAppInfo();

    renderDashboard();
    activateInitialView();

    // 2. Eventos de la UI Principal (Gestión)
    
    // Toggle Focus Mode
    $('#btn-focus').on('click', async function() {
        if (focusModeState.active) {
            const nextState = await ipcRenderer.invoke('set-focus-mode', { active: false, endTime: null });
            setFocusModeState(nextState);
            return;
        }

        toggleFocusPanel();
    });

    $('.focus-option').on('click', async function() {
        const isIndefinite = $(this).data('indefinite') === true;
        const minutes = Number($(this).data('minutes'));
        const endTime = isIndefinite ? null : Date.now() + minutes * 60 * 1000;
        const nextState = await ipcRenderer.invoke('set-focus-mode', { active: true, endTime });
        setFocusModeState(nextState);
        hideFocusPanel();
    });

    $('#focus-custom-form').on('submit', async function(event) {
        event.preventDefault();
        const minutes = Number($('#focus-custom-minutes').val());
        if (!Number.isFinite(minutes) || minutes < 1) {
            return;
        }

        const nextState = await ipcRenderer.invoke('set-focus-mode', {
            active: true,
            endTime: Date.now() + minutes * 60 * 1000
        });
        setFocusModeState(nextState);
        hideFocusPanel();
        this.reset();
    });

    $('#focus-time-form').on('submit', async function(event) {
        event.preventDefault();
        const endTime = getTimestampForTimeInput($('#focus-end-time').val());
        if (!endTime) {
            return;
        }

        const nextState = await ipcRenderer.invoke('set-focus-mode', { active: true, endTime });
        setFocusModeState(nextState);
        hideFocusPanel();
        this.reset();
    });

    $(document).on('click', function(event) {
        if (!$(event.target).closest('.focus-control').length) {
            hideFocusPanel();
        }
    });

    ipcRenderer.on('focus-mode-changed', (event, focusMode) => {
        setFocusModeState(focusMode);
    });

    // Ir a Settings
    $('#btn-settings').on('click', () => {
        showSettings();
    });

    $('#btn-check-updates').on('click', async function() {
        setUpdateStatus('Comprobando actualizaciones...');
        const result = await ipcRenderer.invoke('updater:check');

        if (!result.ok) {
            setUpdateStatus(result.reason || 'No se pudo comprobar si hay actualizaciones.', 'error');
        }
    });

    // Añadir desde el catálogo
    $('.btn-catalog').on('click', async function() {
        const id = $(this).data('id');
        const name = $(this).data('name');
        const url = $(this).data('url');
        const iconUrl = $(this).data('icon');
        const iconHtml = `<img src="${iconUrl}" alt="${name}">`;

        addApp({ id, name, url, icon: iconHtml, enabled: true });
    });

    // Añadir Custom App
    $('#form-custom-app').on('submit', function(e) {
        e.preventDefault();
        const id = 'custom-' + Date.now();
        const name = $('#custom-name').val();
        const url = $('#custom-url').val();
        const linkOpenMode = $('#custom-link-open-mode').val() === 'external' ? 'external' : 'internal';
        const fileInput = document.getElementById('custom-icon');

        if (fileInput.files && fileInput.files.length > 0) {
            const file = fileInput.files[0];
            const reader = new FileReader();
            reader.onload = function(evt) {
                const iconHtml = `<img src="${evt.target.result}" alt="${name}">`;
                addApp({ id, name, url, icon: iconHtml, enabled: true, linkOpenMode });
                $('#form-custom-app')[0].reset();
            };
            reader.readAsDataURL(file);
        } else {
            // Icono de AppCenter por defecto si no suben nada
            const iconHtml = `<img src="assets/icons/appcenter.png" alt="${name}">`;
            addApp({ id, name, url, icon: iconHtml, enabled: true, linkOpenMode });
            this.reset();
        }
    });

    // Activar/Desactivar App
    $('#active-apps-list').on('click', '.btn-toggle-app', function() {
        const idToToggle = $(this).data('id');
        const app = currentApps.find(a => a.id === idToToggle);
        if(app) {
            app.enabled = !app.enabled;
            // Si deshabilitamos, tenemos que asegurar limpiar su webview o clase activa
            if(!app.enabled) {
                 $(`webview[data-id="${app.id}"]`).remove();
                 $(`.app-icon[data-id="${app.id}"]`).remove();
                 notifiedApps.delete(app.id);
                 delete internalTabsByApp[app.id];
                 delete activeTabByApp[app.id];
                 // Volver a ajustes si este era el activo
                 $('#view-settings').addClass('active-view');
            }
            saveAndRender();
        }
    });

    // Elegir si los enlaces abiertos por una app se quedan dentro de AppCenter o salen al navegador del sistema.
    $('#active-apps-list').on('click', '.btn-toggle-link-mode', function() {
        const idToToggle = $(this).data('id');
        const app = currentApps.find(a => a.id === idToToggle);
        if (app) {
            app.linkOpenMode = getAppLinkOpenMode(app) === 'external' ? 'internal' : 'external';
            if (app.linkOpenMode === 'external') {
                closeAllInternalTabsForApp(app.id);
            }
            saveAndRender();
        }
    });

    // Eliminar App
    $('#active-apps-list').on('click', '.btn-delete-app', function() {
        if(confirm("¿Seguro que deseas eliminar esta aplicación?")) {
            const idToRemove = $(this).data('id');
            currentApps = currentApps.filter(a => a.id !== idToRemove);
            $(`webview[data-id="${idToRemove}"]`).remove();
            notifiedApps.delete(idToRemove);
            delete internalTabsByApp[idToRemove];
            delete activeTabByApp[idToRemove];
            saveAndRender();
        }
    });

    // 3. Eventos de Navegación de WebViews (Sidebar)
    $('#sidebar').on('click', '.app-icon', function() {
        const appId = $(this).data('id');
        activateApp(appId);
    });

    $('#sidebar').on('wheel', function(event) {
        handleSidebarWheel(event.originalEvent);
    });

    $(document).on('wheel', function(event) {
        const nativeEvent = event.originalEvent;
        if (nativeEvent && nativeEvent.altKey && !$(nativeEvent.target).closest('#sidebar').length) {
            handleSidebarWheel(nativeEvent);
        }
    });

    $(document).on('keydown', function(event) {
        handleAltArrowNavigation(event.originalEvent);
    });

    $('#internal-tabs-bar').on('click', '.internal-tab', function() {
        const appId = $(this).data('app-id');
        const tabId = $(this).data('tab-id');
        activateInternalTab(appId, tabId);
    });

    $('#internal-tabs-bar').on('click', '.internal-tab-close', function(e) {
        e.stopPropagation();
        const appId = $(this).closest('.internal-tab').data('app-id');
        const tabId = $(this).closest('.internal-tab').data('tab-id');
        closeInternalTab(appId, tabId);
    });

    // 4. Drag & Drop nativo para reordenar en la lista (Settings)
    const $list = $('#active-apps-list');
    
    $list.on('dragstart', '.managed-app-item', function(e) {
        dragStartIndex = +$(this).attr('data-index');
        $(this).css('opacity', '0.4');
    });

    $list.on('dragenter dragover', '.managed-app-item', function(e) {
        e.preventDefault(); // Necesario para permitir 'drop'
        $(this).addClass('drag-over');
    });

    $list.on('dragleave', '.managed-app-item', function() {
        $(this).removeClass('drag-over');
    });

    $list.on('drop', '.managed-app-item', function(e) {
        e.preventDefault();
        $(this).removeClass('drag-over');
        const dragEndIndex = +$(this).attr('data-index');
        swapItems(dragStartIndex, dragEndIndex);
    });

    $list.on('dragend', '.managed-app-item', function() {
        $(this).css('opacity', '1');
        $('.managed-app-item').removeClass('drag-over');
    });

    ipcRenderer.on('activate-app-index', (event, { appIndex }) => {
        activateAppByIndex(appIndex);
    });

    ipcRenderer.on('activate-app', (event, { appId }) => {
        activateApp(appId);
    });

    ipcRenderer.on('mark-app-notification', (event, { appId }) => {
        markAppNotified(appId);
    });

    ipcRenderer.on('show-settings', () => {
        showSettings();
    });

    ipcRenderer.on('open-internal-tab', (event, { appId, url, openerContentsId }) => {
        openInternalTab(appId, url, { openerContentsId });
    });

    ipcRenderer.on('close-internal-tab-by-contents-id', (event, { contentsId }) => {
        closeInternalTabByContentsId(contentsId);
    });

    ipcRenderer.on('menu-command', (event, { command }) => {
        handleMenuCommand(command);
    });

    // 6. Ciclo de auto-update
    registerAutoUpdateHandlers();

});

// --- Funciones Lógicas ---

function setFocusModeState(focusMode) {
    focusModeState = focusMode || { active: false, endTime: null };
    renderFocusModeState();
    applyFocusAudioState();
}

function renderFocusModeState() {
    const $button = $('#btn-focus');

    if (!$button.length) {
        return;
    }

    if (!focusModeState.active) {
        clearFocusCountdown();
        $button.removeClass('active').text('Modo Concentración');
        return;
    }

    $button.addClass('active');
    updateFocusButtonText();

    if (focusModeState.endTime) {
        clearFocusCountdown();
        focusCountdownTimer = setInterval(updateFocusButtonText, 30000);
    } else {
        clearFocusCountdown();
    }
}

function updateFocusButtonText() {
    if (!focusModeState.active) {
        $('#btn-focus').removeClass('active').text('Modo Concentración');
        return;
    }

    if (!focusModeState.endTime) {
        $('#btn-focus').text('Concentración: indefinido');
        return;
    }

    const remainingMs = focusModeState.endTime - Date.now();
    if (remainingMs <= 0) {
        $('#btn-focus').text('Concentración: finalizando');
        return;
    }

    $('#btn-focus').text(`Concentración: ${formatRemainingTime(remainingMs)}`);
}

function clearFocusCountdown() {
    if (focusCountdownTimer) {
        clearInterval(focusCountdownTimer);
        focusCountdownTimer = null;
    }
}

function formatRemainingTime(remainingMs) {
    const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours === 0) {
        return `${minutes} min`;
    }

    if (minutes === 0) {
        return `${hours} h`;
    }

    return `${hours} h ${minutes} min`;
}

function toggleFocusPanel() {
    const panel = document.getElementById('focus-panel');
    if (!panel) {
        return;
    }

    panel.hidden = !panel.hidden;
}

function hideFocusPanel() {
    const panel = document.getElementById('focus-panel');
    if (panel) {
        panel.hidden = true;
    }
}

function getTimestampForTimeInput(value) {
    if (!value || !/^\d{2}:\d{2}$/.test(value)) {
        return null;
    }

    const [hours, minutes] = value.split(':').map(Number);
    const target = new Date();
    target.setHours(hours, minutes, 0, 0);

    if (target.getTime() <= Date.now()) {
        target.setDate(target.getDate() + 1);
    }

    return target.getTime();
}

function applyFocusAudioState() {
    const muted = focusModeState.active === true;
    document.querySelectorAll('webview').forEach((webview) => {
        applyAudioMuteToWebview(webview, muted);
    });
}

function applyAudioMuteToWebview(webview, muted = focusModeState.active === true) {
    if (!webview || typeof webview.setAudioMuted !== 'function') {
        return;
    }

    try {
        webview.setAudioMuted(muted);
    } catch (error) {
        console.warn('[AppCenter] No se pudo cambiar el silencio del webview:', error);
    }
}

async function renderAppInfo() {
    const info = await ipcRenderer.invoke('app:get-info');
    const platformLabel = {
        win32: 'Windows',
        darwin: 'macOS',
        linux: 'Linux'
    }[info.platform] || info.platform;

    $('#app-version').text(`${info.name} v${info.version} · ${platformLabel} ${info.arch}`);
}

function setUpdateStatus(message, type = 'info') {
    $('#update-status')
        .removeClass('error success')
        .addClass(type)
        .text(message)
        .prop('hidden', false);
}

async function addApp(appData) {
    if (currentApps.find(a => a.id === appData.id)) {
        alert('Esta aplicación ya está en tu lista.');
        return;
    }
    currentApps.push(normalizeAppConfig(appData));
    await saveAndRender();
}

async function saveAndRender() {
    currentApps = currentApps.map(normalizeAppConfig);
    await ipcRenderer.invoke('save-config', currentApps);
    renderDashboard();
}

function swapItems(fromIndex, toIndex) {
    const itemOne = currentApps[fromIndex];
    currentApps.splice(fromIndex, 1);
    currentApps.splice(toIndex, 0, itemOne);
    saveAndRender();
}

function showSettings() {
    document.title = 'AppCenter';
    $('.active-view').removeClass('active-view');
    $('webview.active').removeClass('active');
    $('#internal-tabs-bar').prop('hidden', true).empty();
    $('#view-settings').addClass('active-view');
    $('.app-icon.active').removeClass('active');
}

function markAppNotified(appId) {
    if (!appId) {
        return;
    }

    notifiedApps.add(appId);
    updateAppNotificationBadge(appId);
}

function clearAppNotification(appId) {
    if (!appId) {
        return;
    }

    ipcRenderer.send('clear-app-notification', { appId });

    if (!notifiedApps.has(appId)) {
        return;
    }

    notifiedApps.delete(appId);
    updateAppNotificationBadge(appId);
}

function updateAppNotificationBadge(appId) {
    $(`.app-icon[data-id="${appId}"]`).toggleClass('has-notification', notifiedApps.has(appId));
}

function installPageNotificationBridge(webview, appId) {
    if (!webview || typeof webview.executeJavaScript !== 'function') {
        return;
    }

    webview.executeJavaScript(pageNotificationBridgeScript, true).catch((error) => {
        console.warn(`[AppCenter] No se pudo instalar el bridge de notificaciones para ${appId}:`, error);
    });
}

function titleHasUnreadIndicator(title) {
    return /^\s*[\[(]\d+[\])]/.test(String(title || ''));
}

function maybeMarkAppUnreadFromTitle(appId, title) {
    if (!appId || !titleHasUnreadIndicator(title)) {
        return;
    }

    if ($('.app-icon.active').data('id') === appId) {
        return;
    }

    markAppNotified(appId);
}

function normalizeAppConfig(app) {
    return {
        ...app,
        linkOpenMode: getAppLinkOpenMode(app)
    };
}

function getAppLinkOpenMode(app) {
    if (app && app.linkOpenMode === 'internal') {
        return 'internal';
    }

    if (app && app.linkOpenMode === 'external') {
        return 'external';
    }

    return defaultLinkOpenMode;
}

function getEnabledApps() {
    return currentApps.filter(app => app.enabled);
}

function activateInitialView() {
    const enabledApps = getEnabledApps();
    if (enabledApps.length === 0) {
        showSettings();
        return;
    }

    activateApp(enabledApps[0].id);
}

function activateAppByIndex(appIndex) {
    if (!Number.isInteger(appIndex) || appIndex < 0) {
        return;
    }

    const app = getEnabledApps()[appIndex];
    if (!app) {
        return;
    }

    activateApp(app.id);
}

function handleSidebarWheel(event) {
    if (!event || sidebarWheelLocked) {
        return;
    }

    handleSidebarWheelDelta({
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        preventDefault: () => event.preventDefault()
    });
}

function handleSidebarWheelDelta({ deltaX = 0, deltaY = 0, preventDefault = null } = {}) {
    if (sidebarWheelLocked) {
        return;
    }

    const delta = Math.abs(deltaY) >= Math.abs(deltaX) ? deltaY : deltaX;
    if (delta === 0) {
        return;
    }

    navigateAppsByDirection(delta > 0 ? 1 : -1, preventDefault);
}

function handleAltArrowNavigation(event) {
    if (!event || !event.altKey) {
        return;
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
        return;
    }

    navigateAppsByDirection(event.key === 'ArrowDown' ? 1 : -1, () => event.preventDefault());
}

function navigateAppsByDirection(direction, preventDefault = null) {
    if (sidebarWheelLocked || (direction !== 1 && direction !== -1)) {
        return;
    }

    const enabledApps = getEnabledApps();
    if (enabledApps.length === 0) {
        return;
    }

    if (typeof preventDefault === 'function') {
        preventDefault();
    }

    const activeAppId = $('.app-icon.active').data('id');
    const activeIndex = enabledApps.findIndex(app => app.id === activeAppId);
    const nextIndex = activeIndex === -1
        ? (direction > 0 ? 0 : enabledApps.length - 1)
        : (activeIndex + direction + enabledApps.length) % enabledApps.length;

    sidebarWheelLocked = true;
    activateApp(enabledApps[nextIndex].id);

    setTimeout(() => {
        sidebarWheelLocked = false;
    }, 220);
}

function getActiveWebview() {
    return document.querySelector('webview.active');
}

function handleMenuCommand(command) {
    const webview = getActiveWebview();

    if (command === 'show-settings') {
        showSettings();
        return;
    }

    if (command === 'previous-app') {
        navigateAppsByDirection(-1);
        return;
    }

    if (command === 'next-app') {
        navigateAppsByDirection(1);
        return;
    }

    if (!webview) {
        return;
    }

    if (command === 'reload-active-app' && typeof webview.reload === 'function') {
        webview.reload();
        return;
    }

    if (command === 'go-back' && typeof webview.canGoBack === 'function' && webview.canGoBack()) {
        webview.goBack();
        return;
    }

    if (command === 'go-forward' && typeof webview.canGoForward === 'function' && webview.canGoForward()) {
        webview.goForward();
    }
}

function activateApp(appId, options = {}) {
    const app = currentApps.find(a => a.id === appId && a.enabled);
    if (!app) {
        showSettings();
        return;
    }

    document.title = `AppCenter | ${app.name}`;
    clearAppNotification(appId);

    ensureAppTabs(app);

    if (!document.querySelector(getTabSelector(appId, 'main'))) {
        renderDashboard();
    }

    $('.app-icon.active').removeClass('active');
    $('webview.active').removeClass('active');
    $('#view-settings').removeClass('active-view');

    $(`.app-icon[data-id="${appId}"]`).addClass('active');
    const appIcon = document.querySelector(`.app-icon[data-id="${appId}"]`);
    if (appIcon) {
        appIcon.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    activateInternalTab(appId, activeTabByApp[appId] || 'main');
}

function ensureAppTabs(app) {
    if (!app || !app.id) {
        return [];
    }

    if (!internalTabsByApp[app.id]) {
        internalTabsByApp[app.id] = [{
            id: 'main',
            appId: app.id,
            title: app.name,
            url: app.url,
            closable: false,
            isPopupTab: false,
            openerContentsId: null
        }];
    } else {
        const mainTab = internalTabsByApp[app.id].find(tab => tab.id === 'main');
        if (mainTab) {
            mainTab.title = app.name;
            mainTab.url = app.url;
        }
    }

    if (!activeTabByApp[app.id]) {
        activeTabByApp[app.id] = 'main';
    }

    return internalTabsByApp[app.id];
}

function getTabSelector(appId, tabId) {
    return `webview[data-id="${appId}"][data-tab-id="${tabId}"]`;
}

function createManagedWebview(app, tab, isActive = false) {
    const $existing = $(getTabSelector(app.id, tab.id));
    if ($existing.length > 0) {
        return $existing[0];
    }

    const preloadPath = pathToFileURL(path.join(__dirname, 'preload.js')).toString();
    const $webview = $('<webview>')
        .attr('data-id', app.id)
        .attr('data-tab-id', tab.id)
        .attr('src', tab.url)
        .attr('preload', preloadPath)
        .attr('allowpopups', '');

    if (isActive) {
        $webview.addClass('active');
    }

    $('#webviews-container').append($webview);

    const wvNode = $webview[0];
    applyAudioMuteToWebview(wvNode);

    wvNode.addEventListener('dom-ready', () => {
       applyAudioMuteToWebview(wvNode);
       installPageNotificationBridge(wvNode, app.id);
       wvNode.send('set-app-id', app.id);

       const wvContentsId = wvNode.getWebContentsId();
       ipcRenderer.send('setup-webview-handlers', {
           wvContentsId,
           appId: app.id,
           isPopupTab: tab.isPopupTab === true,
           openerContentsId: tab.openerContentsId || null
       });
    });

    wvNode.addEventListener('ipc-message', (event) => {
        if (!event) {
            return;
        }

        if (event.channel === 'appcenter-alt-wheel') {
            const payload = event.args && event.args[0] ? event.args[0] : {};
            handleSidebarWheelDelta(payload);
            return;
        }

        if (event.channel === 'appcenter-alt-arrow') {
            const payload = event.args && event.args[0] ? event.args[0] : {};
            navigateAppsByDirection(payload.direction);
            return;
        }

        if (event.channel === 'appcenter-notification') {
            const payload = event.args && event.args[0] ? event.args[0] : {};
            markAppNotified(payload.appId || app.id);
            ipcRenderer.send('app-notification', {
                ...payload,
                appId: payload.appId || app.id
            });
        }
    });

    wvNode.addEventListener('did-finish-load', () => {
        applyAudioMuteToWebview(wvNode);
        installPageNotificationBridge(wvNode, app.id);
    });

    wvNode.addEventListener('page-title-updated', (event) => {
        if (event && event.title) {
            tab.title = event.title;
            maybeMarkAppUnreadFromTitle(app.id, event.title);
            renderInternalTabs(app.id);
        }
    });

    wvNode.addEventListener('new-window', (e) => {
        e.preventDefault();

        if (getAppLinkOpenMode(app) === 'external') {
            ipcRenderer.send('open-popup', { url: e.url, frameName: e.frameName, appId: app.id });
            return;
        }

        const openerContentsId = typeof wvNode.getWebContentsId === 'function' ? wvNode.getWebContentsId() : null;
        openInternalTab(app.id, e.url, { openerContentsId });
    });

    return wvNode;
}

function renderInternalTabs(appId) {
    const app = currentApps.find(item => item.id === appId && item.enabled);
    const tabs = app ? ensureAppTabs(app) : [];
    const $tabsBar = $('#internal-tabs-bar');

    if (!app || getAppLinkOpenMode(app) !== 'internal') {
        $tabsBar.prop('hidden', true).empty();
        return;
    }

    if (!app || $('.app-icon.active').data('id') !== appId) {
        return;
    }

    $tabsBar.empty();

    tabs.forEach((tab) => {
        const isActive = activeTabByApp[appId] === tab.id;
        const safeTitle = escapeHtml(tab.title);
        const closeButton = tab.closable
            ? '<button type="button" class="internal-tab-close" title="Cerrar pestaña">×</button>'
            : '';
        $tabsBar.append(`
            <div class="internal-tab ${isActive ? 'active' : ''}" data-app-id="${appId}" data-tab-id="${tab.id}" title="${safeTitle}">
                <span class="internal-tab-title"><span class="internal-tab-title-text">${safeTitle}</span></span>
                ${closeButton}
            </div>
        `);
    });

    $tabsBar.prop('hidden', tabs.length === 0);
    updateScrollableTabTitles();
}

function activateInternalTab(appId, tabId) {
    const app = currentApps.find(item => item.id === appId && item.enabled);
    if (!app) {
        return;
    }

    const tabs = ensureAppTabs(app);
    const tab = tabs.find(item => item.id === tabId) || tabs[0];
    if (!tab) {
        return;
    }

    activeTabByApp[appId] = tab.id;
    $('webview.active').removeClass('active');

    let webview = document.querySelector(getTabSelector(appId, tab.id));
    if (!webview) {
        webview = createManagedWebview(app, tab, true);
    }

    if (webview) {
        webview.classList.add('active');
        if (typeof webview.focus === 'function') {
            webview.focus();
        }
    }

    renderInternalTabs(appId);
}

function openInternalTab(appId, url, { openerContentsId = null } = {}) {
    const app = currentApps.find(item => item.id === appId && item.enabled);
    if (!app || !url || getAppLinkOpenMode(app) !== 'internal') {
        return;
    }

    const tabs = ensureAppTabs(app);
    const tab = {
        id: `tab-${Date.now()}-${nextInternalTabId++}`,
        appId,
        title: getReadableTabTitle(url),
        url,
        closable: true,
        isPopupTab: true,
        openerContentsId
    };

    tabs.push(tab);
    activeTabByApp[appId] = tab.id;
    activateApp(appId);
}

function closeInternalTab(appId, tabId) {
    const tabs = internalTabsByApp[appId];
    if (!tabs) {
        return;
    }

    const tabIndex = tabs.findIndex(tab => tab.id === tabId);
    if (tabIndex < 0 || tabs[tabIndex].closable === false) {
        return;
    }

    $(getTabSelector(appId, tabId)).remove();
    tabs.splice(tabIndex, 1);

    if (activeTabByApp[appId] === tabId) {
        const nextTab = tabs[Math.max(0, tabIndex - 1)] || tabs[0];
        activeTabByApp[appId] = nextTab ? nextTab.id : 'main';
        activateInternalTab(appId, activeTabByApp[appId]);
    } else {
        renderInternalTabs(appId);
    }
}

function closeInternalTabByContentsId(contentsId) {
    if (!contentsId) {
        return;
    }

    const webview = Array.from(document.querySelectorAll('webview[data-tab-id]'))
        .find(candidate => typeof candidate.getWebContentsId === 'function' && candidate.getWebContentsId() === contentsId);

    if (!webview) {
        return;
    }

    closeInternalTab(webview.dataset.id, webview.dataset.tabId);
}

function closeAllInternalTabsForApp(appId) {
    const tabs = internalTabsByApp[appId];
    if (!tabs) {
        return;
    }

    tabs
        .filter(tab => tab.id !== 'main')
        .forEach(tab => {
            $(getTabSelector(appId, tab.id)).remove();
        });

    internalTabsByApp[appId] = tabs.filter(tab => tab.id === 'main');
    activeTabByApp[appId] = 'main';

    if ($('.app-icon.active').data('id') === appId) {
        activateInternalTab(appId, 'main');
        $('#internal-tabs-bar').prop('hidden', true).empty();
    }
}

function getReadableTabTitle(url) {
    try {
        const parsedUrl = new URL(url);
        return parsedUrl.hostname.replace(/^www\./, '');
    } catch (error) {
        return 'Nueva pestaña';
    }
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function updateScrollableTabTitles() {
    requestAnimationFrame(() => {
        document.querySelectorAll('.internal-tab-title').forEach((title) => {
            const text = title.querySelector('.internal-tab-title-text');
            if (!text) {
                return;
            }

            const overflow = text.scrollWidth > title.clientWidth + 2;
            title.classList.toggle('scrolling', overflow);
            if (overflow) {
                title.style.setProperty('--tab-title-distance', `${text.scrollWidth - title.clientWidth + 24}px`);
            } else {
                title.style.removeProperty('--tab-title-distance');
            }
        });
    });
}

function renderDashboard() {
    const $sidebarList = $('#app-list');
    const $managedList = $('#active-apps-list');

    const activeAppId = $('.app-icon.active').length > 0 ? $('.app-icon.active').data('id') : null;
    let enabledAppIndex = 0;

    $sidebarList.empty();
    $managedList.empty();

    currentApps.forEach((app, index) => {
        // --- Renderizar Sidebar ---
        if (app.enabled) {
            const isActive = (activeAppId === app.id);
            const shortcutLabel = `F${enabledAppIndex + 1}`;
            const $icon = $(`
                <div class="app-icon ${isActive ? 'active' : ''} ${notifiedApps.has(app.id) ? 'has-notification' : ''}" data-id="${app.id}" title="${app.name} (${shortcutLabel})">
                    ${app.icon}
                </div>
            `);
            $sidebarList.append($icon);
            enabledAppIndex += 1;

            const tabs = ensureAppTabs(app);
            const mainTab = tabs.find(tab => tab.id === 'main');
            const activeTabId = activeTabByApp[app.id] || 'main';
            createManagedWebview(app, mainTab, isActive && activeTabId === 'main');

            if (isActive && activeTabId !== 'main') {
                const activeTab = tabs.find(tab => tab.id === activeTabId);
                if (activeTab) {
                    createManagedWebview(app, activeTab, true);
                }
            }
        }

        // --- Renderizar Settings (Drag & Drop UI) ---
        const statusIcon = app.enabled ? '👁️' : '🙈';
        const toggleClass = app.enabled ? 'btn-toggle-app' : 'btn-toggle-app inactive';
        const linkOpenMode = getAppLinkOpenMode(app);
        const linkModeIcon = linkOpenMode === 'external' ? '↗' : '▣';
        const linkModeLabel = linkOpenMode === 'external' ? 'Externo' : 'Interno';
        const linkModeTitle = linkOpenMode === 'external'
            ? 'Los enlaces se abren en el navegador del sistema'
            : 'Los enlaces se abren dentro de AppCenter';
        
        $managedList.append(`
            <li class="managed-app-item" draggable="true" data-index="${index}">
                <div class="managed-app-info">
                    <span style="cursor: grab;">↕️</span>
                    <span>${app.icon}</span>
                    <span>${app.name}</span>
                </div>
                <div class="app-actions">
                    <button type="button" class="btn-toggle-link-mode ${linkOpenMode}" data-id="${app.id}" title="${linkModeTitle}">
                        <span class="link-mode-icon">${linkModeIcon}</span>
                        <span class="link-mode-text">${linkModeLabel}</span>
                    </button>
                    <button type="button" class="${toggleClass}" data-id="${app.id}" title="Activar/Desactivar">${statusIcon}</button>
                    <button type="button" class="btn-delete-app" data-id="${app.id}" title="Eliminar">🗑️</button>
                </div>
            </li>
        `);
    });
}

function registerAutoUpdateHandlers() {
    ipcRenderer.on('updater:checking', () => {
        setUpdateStatus('Comprobando actualizaciones...');
    });

    ipcRenderer.on('updater:available', (event, info) => {
        const version = info && info.version ? info.version : 'nueva versión';
        setUpdateStatus(`Actualización disponible: ${version}. Descargando...`);
        console.log(`[Updater] Actualización disponible: ${version}`);
    });

    ipcRenderer.on('updater:not-available', () => {
        setUpdateStatus('La aplicación ya está actualizada.', 'success');
    });

    ipcRenderer.on('updater:progress', (event, progress) => {
        const percent = progress && typeof progress.percent === 'number'
            ? progress.percent.toFixed(1)
            : '0.0';
        setUpdateStatus(`Descargando actualización: ${percent}%`);
        console.log(`[Updater] Descargando actualización: ${percent}%`);
    });

    ipcRenderer.on('updater:downloaded', async () => {
        setUpdateStatus('Actualización descargada. Reinicia para instalarla.', 'success');
        const shouldInstall = confirm('La actualización está lista. ¿Quieres reiniciar ahora para instalarla?');
        if (shouldInstall) {
            await ipcRenderer.invoke('updater:install');
        }
    });

    ipcRenderer.on('updater:error', (event, message) => {
        setUpdateStatus(message || 'Error al comprobar actualizaciones.', 'error');
        console.error('[Updater] Error:', message);
    });
}
