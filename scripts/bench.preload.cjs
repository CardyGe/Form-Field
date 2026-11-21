const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('bench', {
  config: () => ipcRenderer.invoke('bench-config'),
  done: report => ipcRenderer.invoke('bench-done', report),
  fail: error => ipcRenderer.invoke('bench-fail', String(error)),
  note: text => ipcRenderer.invoke('bench-note', String(text)),
});
