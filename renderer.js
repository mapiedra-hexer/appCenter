const { ipcRenderer } = require('electron');

let appsData = [];

async function loadAppsData() {
    appsData = await ipcRenderer.invoke('load-buttons');
    generateButtons();
}

function openBrowserView(url, viewId) {
    ipcRenderer.send('open-content-view', { url, viewId });
}

function generateButtons() {
    const buttonContainer = document.getElementById('button-container');

    buttonContainer.innerHTML = '';

    appsData.forEach((button) => {
        const newButton = document.createElement('button');

        const icon = document.createElement('img');
        icon.src = 'icons/'+button.icon;
        icon.alt = `${button.name} icon`;

        const buttonText = document.createElement('span');
        buttonText.textContent = button.name;

        newButton.appendChild(icon);
        newButton.appendChild(buttonText);
        newButton.onclick = () => openBrowserView(button.url, button.name);

        buttonContainer.appendChild(newButton);
    });
}

function showAddButtonDialog() {
    document.getElementById('dialog').style.display = 'block';
}

function hideAddButtonDialog() {
    document.getElementById('dialog').style.display = 'none';
}

function showNotification(title, body) {
    const notification = new Notification(title, {
        body: body,
        icon: 'path/to/icon.png' // Ruta al icono si quieres incluirlo
    });

    notification.onclick = () => {
        console.log("Notificación clickeada");
    };
}

// Verificar permiso de notificaciones
if (Notification.permission === "granted") {
    showNotification("Hola!", "Esto es una notificación.");
} else if (Notification.permission !== "denied") {
    Notification.requestPermission().then(permission => {
        if (permission === "granted") {
            showNotification("Hola!", "Esto es una notificación.");
        }
    });
}

// window.Notification = (title, options) => {
//     // Aquí puedes usar la API de Electron para enviar una notificación
//     const electronNotification = new window.electronNotification(title, options);
//     electronNotification.show();
// };


window.onload = loadAppsData;