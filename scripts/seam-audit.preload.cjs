const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('audit', {
  begin: () => ipcRenderer.invoke('audit-begin'),
  indices: total => ipcRenderer.invoke('audit-indices', total),
  frame: (id, index, bytes) => ipcRenderer.invoke('audit-frame', id, index, bytes),
  measure: (id, name, kind, frames) => ipcRenderer.invoke('audit-measure', id, name, kind, frames),
  done: error => ipcRenderer.invoke('audit-done', error),
});
