const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('study', {
  config: () => ipcRenderer.invoke('study-config'),
  write: (name, bytes) => ipcRenderer.invoke('study-write', name, bytes),
  note: value => ipcRenderer.invoke('study-note', value),
  done: report => ipcRenderer.invoke('study-done', report),
  fail: error => ipcRenderer.invoke('study-fail', error),
});
