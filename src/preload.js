const { ipcRenderer } = require('electron');

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

function createSilentNotification(title, options = {}) {
    const target = new EventTarget();

    Object.defineProperties(target, {
        title: { value: String(title || ''), enumerable: true },
        body: { value: options.body || '', enumerable: true },
        icon: { value: options.icon || '', enumerable: true },
        tag: { value: options.tag || '', enumerable: true }
    });

    target.close = () => {};
    setTimeout(() => target.dispatchEvent(new Event('show')), 0);
    return target;
}

function installNotificationBridge() {
    const originalNotification = window.Notification;

    const setAppBadge = (contents) => {
        const badgeValue = Number(contents);
        if (contents === undefined || !Number.isFinite(badgeValue) || badgeValue > 0) {
            sendAppNotification();
        }

        return Promise.resolve();
    };

    const clearAppBadge = () => Promise.resolve();

    if (typeof originalNotification === 'function') {
        const SilentNotification = function(title, options) {
            sendAppNotification({
                title,
                body: options && options.body,
                tag: options && options.tag
            });
            return createSilentNotification(title, options);
        };

        Object.defineProperty(SilentNotification, 'permission', {
            get: () => 'granted'
        });
        SilentNotification.requestPermission = (callback) => {
            const permission = SilentNotification.permission;
            if (typeof callback === 'function') {
                callback(permission);
            }
            return Promise.resolve(permission);
        };
        SilentNotification.maxActions = originalNotification.maxActions || 0;
        SilentNotification.prototype = originalNotification.prototype;

        Object.defineProperty(window, 'Notification', {
            configurable: true,
            writable: true,
            value: SilentNotification
        });
    }

    if (window.ServiceWorkerRegistration && window.ServiceWorkerRegistration.prototype) {
        window.ServiceWorkerRegistration.prototype.showNotification = function(title, options) {
            sendAppNotification({
                title,
                body: options && options.body,
                tag: options && options.tag
            });
            return Promise.resolve();
        };
    }

    if (window.navigator) {
        const defineBadgeApi = (target) => {
            if (!target) {
                return;
            }

            Object.defineProperty(target, 'setAppBadge', {
                configurable: true,
                writable: true,
                value: setAppBadge
            });
            Object.defineProperty(target, 'clearAppBadge', {
                configurable: true,
                writable: true,
                value: clearAppBadge
            });
        };

        defineBadgeApi(window.navigator);
        defineBadgeApi(Object.getPrototypeOf(window.navigator));

        if (window.navigator.permissions && typeof window.navigator.permissions.query === 'function') {
            const originalPermissionsQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
            window.navigator.permissions.query = (descriptor) => {
                if (descriptor && descriptor.name === 'notifications') {
                    return Promise.resolve({ state: 'granted', onchange: null });
                }

                return originalPermissionsQuery(descriptor);
            };
        }
    }
}

ipcRenderer.on('set-app-id', (event, appId) => {
    currentAppId = appId || null;
    flushPendingNotifications();
});

installNotificationBridge();

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
