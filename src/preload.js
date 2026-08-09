const { ipcRenderer } = require('electron');

// Este preload corre en un mundo aislado (contextIsolation): no puede tocar
// window.Notification de la página. La captura de notificaciones la hace el
// bridge inyectado en el mundo principal desde renderer.js, que comunica con
// este script vía window.postMessage. Aquí solo se releva al host y se
// reenvían los atajos Alt+scroll / Alt+flechas.

let currentAppId = null;
const pendingNotifications = [];

function sendAppNotification(notification = {}) {
    if (!currentAppId) {
        pendingNotifications.push(notification);
        return;
    }

    ipcRenderer.sendToHost('appcenter-notification', {
        appId: currentAppId,
        title: notification.title || '',
        body: notification.body || '',
        tag: notification.tag || '',
        nativeShown: notification.nativeShown === true
    });
}

function flushPendingNotifications() {
    if (!currentAppId || pendingNotifications.length === 0) {
        return;
    }

    const notificationsToSend = pendingNotifications.splice(0);
    notificationsToSend.forEach(sendAppNotification);
}

ipcRenderer.on('set-app-id', (event, appId) => {
    currentAppId = appId || null;
    flushPendingNotifications();
});

window.addEventListener('message', (event) => {
    if (event.source !== window) {
        return;
    }

    const data = event.data;
    if (!data || data.source !== 'appcenter-page-bridge' || data.type !== 'notification') {
        return;
    }

    sendAppNotification(data.notification || {});
}, true);

window.addEventListener('wheel', (event) => {
    if (!event.altKey) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();

    ipcRenderer.sendToHost('appcenter-alt-wheel', {
        deltaX: event.deltaX,
        deltaY: event.deltaY
    });
}, { capture: true, passive: false });

window.addEventListener('keydown', (event) => {
    if (!event.altKey || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();

    ipcRenderer.sendToHost('appcenter-alt-arrow', {
        direction: event.key === 'ArrowDown' ? 1 : -1
    });
}, { capture: true });
