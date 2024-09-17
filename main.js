const { app, BrowserWindow, WebContentsView, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let webContentsViews = {};

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

    mainWindow.maximize();
    mainWindow.loadFile('index.html');

    mainWindow.on('resize', () => {
        const { width, height } = mainWindow.getBounds();
        for (const id in webContentsViews) {
            webContentsViews[id].setBounds({ x: 100, y: 0, width: width - 100, height: height - 70 });
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

function createOrShowContentsView(url, viewId) {
    const { width, height } = mainWindow.getBounds();

    if (webContentsViews[viewId]) {
        mainWindow.contentView.addChildView(webContentsViews[viewId]);
    } else {
        const newView = new WebContentsView()
        webContentsViews[viewId] = newView;
        newView.webContents.loadURL(url);
        newView.setBounds({ x: 100, y: 0, width: width - 100, height: height - 70 });
        
        mainWindow.contentView.addChildView(newView)
    }

    for (const id in webContentsViews) {
        if (id == viewId) {
            webContentsViews[id].setVisible(true);
        } else {
            webContentsViews[id].setVisible(false);
        }
    }
}

ipcMain.on('open-content-view', (event, { url, viewId }) => {
    createOrShowContentsView(url, viewId);
});

app.whenReady().then(() => {
    createWindow();

    ipcMain.handle('load-buttons', () => {
        return loadButtons();
    });
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