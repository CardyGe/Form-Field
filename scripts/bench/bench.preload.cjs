const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('bench', {
  config: () => ipcRenderer.invoke('bench-config'),
  log: message => ipcRenderer.invoke('bench-log', message),
  done: results => ipcRenderer.invoke('bench-done', results),
  fail: error => ipcRenderer.invoke('bench-fail', error),
});
