const { app, Tray, Menu, nativeImage, BrowserWindow, WebContentsView, shell, Notification, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const userAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/76.0.3809.131 Safari/537.36';
const icon = nativeImage.createFromPath('assets/images/appCenter-icon.png');

let mainWindow;
let webContentsViews = {};
let currentWebContentsView;
let tray;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1024,
        height: 720,
        icon: path.join(__dirname, 'assets/images', 'appCenter-icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'renderer.js'),
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    mainWindow.webContents.openDevTools();
    mainWindow.setMinimumSize(1024, 720);
    // mainWindow.removeMenu();
    // mainWindow.maximize();
    mainWindow.setHasShadow(true);
    mainWindow.loadFile('index.html');
    mainWindow.on('resize', () => {
        const { width, height } = mainWindow.getContentBounds();
        for (const id in webContentsViews) {
            webContentsViews[id].setBounds({ x: 60, y: 0, width: (width - 60), height: height });
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

}

function loadButtons() {
    const filePath = path.join(__dirname, 'apps.json');
    try {
        const data = fs.readFileSync(filePath);
        return JSON.parse(data);
    } catch (err) {
        console.error('Error al cargar el archivo apps.json:', err);
        return [];
    }
}

function createContentsView(apps) {
    const { width, height } = mainWindow.getContentBounds();

    apps.forEach((app, index) => {
        const newView = new WebContentsView()
        webContentsViews[index] = newView;
        newView.webContents.loadURL(app.url, {userAgent});
        newView.setVisible(false);
        newView.setBounds({ x: 60, y: 0, width: (width - 60) , height: height });
        mainWindow.contentView.addChildView(newView)
    
        //Envía enlaces a ventana nueva al navegador
        newView.webContents.setWindowOpenHandler(({ url }) => {
            shell.openExternal(url);
            return { action: 'deny' };
        });

        newView.webContents.on('page-favicon-updated', (event, favicon) => {
            console.log('favicon update', favicon[0]);
            mainWindow.webContents.send('changeFavicon', [index, favicon[0]]);
        })
    });
}

ipcMain.on('create-contents-view', (event, { apps }) => {
    createContentsView(apps);
});

function showContentsView(viewId) {
    
    for (const id in webContentsViews) {
        if (id == viewId) {
            webContentsViews[id].setVisible(true);
            currentWebContentsView = webContentsViews[id];
        } else {
            webContentsViews[id].setVisible(false);
        }
    }
}

ipcMain.on('current-content-view', (event, { viewId }) => {
    showContentsView(viewId);
});

ipcMain.on('content-view-refresh', (event) => {
    currentWebContentsView.webContents.mainFrame.frame.reload();
});

app.whenReady().then(() => {
    createWindow();

    ipcMain.handle('load-buttons', () => {
        return loadButtons();
    });
   
    tray = new Tray(icon);
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Item1', type: 'radio' },
        { label: 'Item2', type: 'radio' },
        { label: 'Item3', type: 'radio', checked: true },
        { label: 'Item4', type: 'radio' }
    ]);

    tray.setToolTip('appCenter');
    tray.setContextMenu(contextMenu);
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});


// // Interceptar la creación de notificaciones en las páginas web
// app.on('web-contents-created', (event, webContents) => {
//     webContents.on('did-create-window', (event, childWindow) => {
//         childWindow.webContents.on('ipc-message', (event, channel, message) => {
//             if (channel === 'web-notification') {
//                 // Mostrar la notificación de escritorio en Electron
//                 new Notification({
//                     title: message.title,
//                     body: message.body,
//                 }).show();
//             }
//         });
//     });
// });