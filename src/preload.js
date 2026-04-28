const { ipcRenderer } = require('electron');

// Para identificar la aplicación que levanta esta notificación,
// el renderer (index.html) habrá pasado por IPC asíncrono el ID de la app asociado a este webview,
// o lo extraemos de alguna variable inyectada. En un webview, cada script carga independiente.
// Para no complicarlo, podemos obligar al WebView a inyectarse su propio id mediante queryString dummy.

// Detectamos ?appId=xxx en el href del padre (o se la inyectamos en IPC a posteriori)
let currentAppId = "unknown";

// El main.js / renderer pueden mandarnos el nombre
ipcRenderer.on('set-app-id', (e, id) => {
    currentAppId = id;
});

const OriginalNotification = window.Notification;

class AppCenterNotification {
    constructor(title, options) {
        options = options || {};
        // Intentar parsear el icono o coger el favicon por defecto
        if (!options.icon) {
            const favicon = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
            if(favicon && favicon.href) {
                options.icon = favicon.href;
            }
        }
        
        // En lugar de emitir la notificación al SO, la mandamos al main
        ipcRenderer.send('webview-notification', {
            title: title,
            options: options,
            appId: currentAppId
        });
        
        this.title = title;
        this.options = options;
        
        setTimeout(() => {
            if (typeof this.onshow === 'function') this.onshow();
        }, 100);
    }
    
    static get permission() { return 'granted'; }
    static async requestPermission() { return 'granted'; }
    close() { if (typeof this.onclose === 'function') this.onclose(); }
}

window.Notification = AppCenterNotification;
