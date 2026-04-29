const { ipcRenderer, webFrame } = require('electron');

// Para identificar la aplicación que levanta esta notificación,
// el renderer (index.html) habrá pasado por IPC asíncrono el ID de la app asociado a este webview,
// o lo extraemos de alguna variable inyectada. En un webview, cada script carga independiente.
// Para no complicarlo, podemos obligar al WebView a inyectarse su propio id mediante queryString dummy.

// Detectamos ?appId=xxx en el href del padre (o se la inyectamos en IPC a posteriori)
let currentAppId = "unknown";
let nextNotificationId = 1;
const notifications = new Map();

function getNotificationBridgeScript(appId) {
    return `
        (() => {
            const appId = ${JSON.stringify(appId)};
            if (window.__appcenterNotificationBridgeInstalled) {
                window.__appcenterNotificationBridgeAppId = appId;
                return;
            }

            window.__appcenterNotificationBridgeInstalled = true;
            window.__appcenterNotificationBridgeAppId = appId;
            let nextNotificationId = 1;

            const sendNotification = (title, options) => {
                window.postMessage({
                    source: 'appcenter-notification',
                    notificationId: Date.now() + '-' + nextNotificationId++,
                    title: String(title || 'Nueva actividad'),
                    options: options || {},
                    appId: window.__appcenterNotificationBridgeAppId
                }, '*');
            };

            const OriginalNotification = window.Notification;
            if (typeof OriginalNotification === 'function') {
                function AppCenterNotification(title, options) {
                    sendNotification(title, options);
                    const instance = Object.create(AppCenterNotification.prototype);
                    instance.title = title;
                    instance.options = options || {};
                    instance.close = () => {};
                    setTimeout(() => {
                        if (typeof instance.onshow === 'function') {
                            instance.onshow(new Event('show'));
                        }
                    }, 0);
                    return instance;
                }

                AppCenterNotification.permission = 'granted';
                AppCenterNotification.requestPermission = () => Promise.resolve('granted');
                AppCenterNotification.prototype = OriginalNotification.prototype;
                Object.defineProperty(window, 'Notification', {
                    configurable: true,
                    writable: true,
                    value: AppCenterNotification
                });
            }

            const serviceWorker = navigator.serviceWorker;
            if (serviceWorker && serviceWorker.ready && !serviceWorker.__appcenterReadyWrapped) {
                serviceWorker.__appcenterReadyWrapped = true;
                const wrapRegistration = (registration) => {
                    if (!registration || registration.__appcenterShowNotificationWrapped) {
                        return registration;
                    }

                    const originalShowNotification = registration.showNotification;
                    if (typeof originalShowNotification === 'function') {
                        registration.__appcenterShowNotificationWrapped = true;
                        registration.showNotification = function(title, options) {
                            sendNotification(title, options);
                            return Promise.resolve();
                        };
                    }

                    return registration;
                };

                const originalReady = serviceWorker.ready;
                Object.defineProperty(serviceWorker, 'ready', {
                    configurable: true,
                    get() {
                        return originalReady.then(wrapRegistration);
                    }
                });

                originalReady.then(wrapRegistration).catch(() => {});
            }
        })();
    `;
}

function installNotificationBridge(appId = currentAppId) {
    webFrame.executeJavaScript(getNotificationBridgeScript(appId)).catch(() => {});
}

// El main.js / renderer pueden mandarnos el nombre
ipcRenderer.on('set-app-id', (e, id) => {
    currentAppId = id;
    installNotificationBridge(id);
});

installNotificationBridge();

window.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.source !== 'appcenter-notification') {
        return;
    }

    ipcRenderer.send('webview-notification', {
        notificationId: data.notificationId,
        title: data.title,
        options: data.options || {},
        appId: data.appId || currentAppId
    });
});

const OriginalNotification = window.Notification;

class AppCenterNotification {
    constructor(title, options) {
        options = options || {};
        const notificationId = `${Date.now()}-${nextNotificationId++}`;
        // Intentar parsear el icono o coger el favicon por defecto
        if (!options.icon) {
            const favicon = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
            if(favicon && favicon.href) {
                options.icon = favicon.href;
            }
        }
        
        // En lugar de emitir la notificación al SO, la mandamos al main
        ipcRenderer.send('webview-notification', {
            notificationId: notificationId,
            title: title,
            options: options,
            appId: currentAppId
        });
        
        this.id = notificationId;
        this.title = title;
        this.options = options;
        this.listeners = {};
        notifications.set(notificationId, this);
        
        setTimeout(() => {
            this.dispatchEvent(new Event('show'));
        }, 100);
    }
    
    static get permission() { return 'granted'; }
    static async requestPermission() { return 'granted'; }
    addEventListener(type, listener) {
        if (typeof listener !== 'function') {
            return;
        }

        this.listeners[type] = this.listeners[type] || new Set();
        this.listeners[type].add(listener);
    }

    removeEventListener(type, listener) {
        if (this.listeners[type]) {
            this.listeners[type].delete(listener);
        }
    }

    dispatchEvent(event) {
        const handler = this[`on${event.type}`];
        if (typeof handler === 'function') {
            handler.call(this, event);
        }

        for (const listener of this.listeners[event.type] || []) {
            listener.call(this, event);
        }

        return true;
    }

    close() {
        notifications.delete(this.id);
        this.dispatchEvent(new Event('close'));
    }
}

window.Notification = AppCenterNotification;

ipcRenderer.on('appcenter-notification-clicked', (event, { notificationId }) => {
    const notification = notifications.get(notificationId);
    if (!notification) {
        return;
    }

    notification.dispatchEvent(new Event('click'));
});
