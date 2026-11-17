const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('spike', {
  config: () => ipcRenderer.invoke('spike-config'),
  done: report => ipcRenderer.invoke('spike-done', report),
  fail: message => ipcRenderer.invoke('spike-fail', String(message)),
});
