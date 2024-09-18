const { ipcRenderer } = require('electron');

let appsData = [];

async function loadAppsData() {
    appsData = await ipcRenderer.invoke('load-buttons');
    generateButtons();
    createBrowsersView(appsData);
}

function createBrowsersView(apps) {
    ipcRenderer.send('create-contents-view', { apps });
}

function setCurrentBrowserView(viewId, url, name) {
    ipcRenderer.send('current-content-view', { viewId, url, name });
}

function generateButtons() {
    const buttonContainer = document.getElementById('button-container');

    buttonContainer.innerHTML = '';

    appsData.forEach((button, index) => {
        const newButton = document.createElement('button');
        newButton.id = 'button-'+ index;

        const icon = document.createElement('img');
        icon.src = 'icons/'+button.icon;
        icon.alt = `${button.name} icon`;

        const buttonText = document.createElement('span');
        buttonText.textContent = button.name;

        newButton.appendChild(icon);
        newButton.appendChild(buttonText);
        newButton.onclick = () => setCurrentBrowserView(index, button.url, button.name);

        buttonContainer.appendChild(newButton);
    });
}

function refresh () {
    alert('refresh');
    ipcRenderer.send('content-view-refresh');
}
function showConfigDialog() {
    document.getElementById('dialog-config').style.display = 'block';
}

function hideConfigDialog() {
    document.getElementById('dialog-config').style.display = 'none';
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

ipcRenderer.on('changeFavicon', (event, data) => {
    console.log('Favicon Actualizado:', data);
    document.getElementById('button-' + data[0]).querySelector('img').src = data[1];
});

// Verificar permiso de notificaciones
// if (Notification.permission === "granted") {
//     showNotification("Hola!", "Esto es una notificación.");
// } else if (Notification.permission !== "denied") {
//     Notification.requestPermission().then(permission => {
//         if (permission === "granted") {
//             showNotification("Hola!", "Esto es una notificación.");
//         }
//     });
// }

// window.Notification = (title, options) => {
//     // Aquí puedes usar la API de Electron para enviar una notificación
//     const electronNotification = new window.electronNotification(title, options);
//     electronNotification.show();
// };


window.onload = loadAppsData;