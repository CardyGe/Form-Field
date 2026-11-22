const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('spike', { done: text => ipcRenderer.send('done', text) });
