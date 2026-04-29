const { ipcRenderer } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

let currentApps = [];
let dragStartIndex = null;
const notificationCounts = {};

$(document).ready(async function() {
    // 1. Cargar las apps guardadas al iniciar y modo focus
    currentApps = await ipcRenderer.invoke('get-config') || [];
    const focusState = await ipcRenderer.invoke('get-focus-mode');
    await renderAppInfo();
    
    if (focusState && focusState.active) {
        $('#btn-focus').addClass('active').text('Modo Concentración 🔕 (ON)');
    }

    renderDashboard();
    activateInitialView();

    // 2. Eventos de la UI Principal (Gestión)
    
    // Toggle Focus Mode
    $('#btn-focus').on('click', async function() {
        const isCurrentlyActive = $(this).hasClass('active');
        const newState = !isCurrentlyActive;
        
        // Lo mandamos al Main Process (Donde si newState = false, va a emitir el resumen)
        await ipcRenderer.invoke('set-focus-mode', { active: newState, endTime: null });
        
        if (newState) {
            $(this).addClass('active').text('Modo Concentración 🔕 (ON)');
        } else {
            $(this).removeClass('active').text('Modo Concentración 🔕');
        }
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
        const fileInput = document.getElementById('custom-icon');

        if (fileInput.files && fileInput.files.length > 0) {
            const file = fileInput.files[0];
            const reader = new FileReader();
            reader.onload = function(evt) {
                const iconHtml = `<img src="${evt.target.result}" alt="${name}">`;
                addApp({ id, name, url, icon: iconHtml, enabled: true });
                $('#form-custom-app')[0].reset();
            };
            reader.readAsDataURL(file);
        } else {
            // Icono de AppCenter por defecto si no suben nada
            const iconHtml = `<img src="assets/icons/appcenter.png" alt="${name}">`;
            addApp({ id, name, url, icon: iconHtml, enabled: true });
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
                 // Volver a ajustes si este era el activo
                 $('#view-settings').addClass('active-view');
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
            saveAndRender();
        }
    });

    // 3. Eventos de Navegación de WebViews (Sidebar)
    $('#sidebar').on('click', '.app-icon', function() {
        const appId = $(this).data('id');
        activateApp(appId);
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

    // 5. Escuchar Eventos IPC de Notificaciones del Main
    ipcRenderer.on('update-badge', (event, { appId, count }) => {
        if (Number.isFinite(count)) {
            setNotificationBadge(appId, count);
        } else {
            incrementNotificationBadge(appId);
        }
    });

    ipcRenderer.on('activate-app', (event, { appId, notificationId }) => {
        activateApp(appId, { notificationId });
    });

    ipcRenderer.on('activate-app-index', (event, { appIndex }) => {
        activateAppByIndex(appIndex);
    });

    ipcRenderer.on('show-settings', () => {
        showSettings();
    });

    // 6. Ciclo de auto-update
    registerAutoUpdateHandlers();

});

// --- Funciones Lógicas ---

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
    currentApps.push(appData);
    await saveAndRender();
}

async function saveAndRender() {
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
    $('#view-settings').addClass('active-view');
    $('.app-icon.active').removeClass('active');
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

function incrementNotificationBadge(appId) {
    if (!appId) {
        return;
    }

    notificationCounts[appId] = (notificationCounts[appId] || 0) + 1;
    renderNotificationBadge(appId);
}

function setNotificationBadge(appId, count) {
    if (!appId) {
        return;
    }

    notificationCounts[appId] = Math.max(0, count);
    renderNotificationBadge(appId);
}

function renderNotificationBadge(appId) {
    const count = notificationCounts[appId] || 0;
    const badge = $(`#badge-${appId}`);
    if (!badge.length) {
        return;
    }

    if (count > 0) {
        badge.text(count > 99 ? '99+' : count).css('display', 'flex');
    } else {
        badge.text(0).hide();
    }
}

function clearNotificationBadge(appId) {
    notificationCounts[appId] = 0;
    renderNotificationBadge(appId);
}

function activateApp(appId, options = {}) {
    const app = currentApps.find(a => a.id === appId && a.enabled);
    if (!app) {
        showSettings();
        return;
    }

    document.title = `AppCenter | ${app.name}`;

    if (!document.querySelector(`webview[data-id="${appId}"]`)) {
        renderDashboard();
    }

    $('.app-icon.active').removeClass('active');
    $('webview.active').removeClass('active');
    $('#view-settings').removeClass('active-view');

    $(`.app-icon[data-id="${appId}"]`).addClass('active');
    const webview = document.querySelector(`webview[data-id="${appId}"]`);
    if (webview) {
        webview.classList.add('active');

        if (options.notificationId) {
            webview.send('appcenter-notification-clicked', { notificationId: options.notificationId });
        }
    }
    clearNotificationBadge(appId);
}

function renderDashboard() {
    const $sidebarList = $('#app-list');
    const $managedList = $('#active-apps-list');
    const $webviewsContainer = $('#webviews-container');

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
                <div class="app-icon ${isActive ? 'active' : ''}" data-id="${app.id}" title="${app.name} (${shortcutLabel})">
                    ${app.icon}
                    <div class="badge" id="badge-${app.id}">0</div>
                </div>
            `);
            $sidebarList.append($icon);
            renderNotificationBadge(app.id);
            enabledAppIndex += 1;

            // Gestionar WebView (solo lo creamos si no existe)
            let $wv = $(`webview[data-id="${app.id}"]`);
            if ($wv.length === 0) {
                // preload inyectado absoluto para que Electron lo reconozca
                const preloadPath = pathToFileURL(path.join(__dirname, 'preload.js')).toString();
                const wvHtml = `<webview data-id="${app.id}" src="${app.url}" class="${isActive ? 'active' : ''}" preload="${preloadPath}" allowpopups></webview>`;
                $webviewsContainer.append(wvHtml);
                
                // Una vez montado en DOM y cuando empiece a cargar, le pasamos su ID al preload
                const wvNode = document.querySelector(`webview[data-id="${app.id}"]`);
                wvNode.addEventListener('dom-ready', () => {
                   wvNode.send('set-app-id', app.id);

                   // Enviamos el webContentsId al main process para que registre
                   // setWindowOpenHandler en el webview (API moderna reemplaza new-window deprecado)
                   const wvContentsId = wvNode.getWebContentsId();
                   ipcRenderer.send('setup-webview-handlers', { wvContentsId, appId: app.id });
                });

                // Fallback para Electron antiguo (por si acaso)
                wvNode.addEventListener('new-window', (e) => {
                    e.preventDefault();
                    ipcRenderer.send('open-popup', { url: e.url, frameName: e.frameName });
                });
            }
        }

        // --- Renderizar Settings (Drag & Drop UI) ---
        const statusIcon = app.enabled ? '👁️' : '🙈';
        const toggleClass = app.enabled ? 'btn-toggle-app' : 'btn-toggle-app inactive';
        
        $managedList.append(`
            <li class="managed-app-item" draggable="true" data-index="${index}">
                <div class="managed-app-info">
                    <span style="cursor: grab;">↕️</span>
                    <span>${app.icon}</span>
                    <span>${app.name}</span>
                </div>
                <div class="app-actions">
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
