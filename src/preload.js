const { ipcRenderer } = require('electron');

ipcRenderer.on('set-app-id', () => {});

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
