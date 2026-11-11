const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('surfaceProof', {
  start: request => ipcRenderer.invoke('surface-proof-start', request),
  frame: (id, index, bytes) => ipcRenderer.invoke('surface-proof-frame', id, index, bytes),
  phase: (label, bytes) => ipcRenderer.invoke('surface-proof-phase', label, bytes),
  still: (name, bytes) => ipcRenderer.invoke('surface-proof-still', name, bytes),
  finish: (id, report) => ipcRenderer.invoke('surface-proof-finish', id, report),
  fail: error => ipcRenderer.invoke('surface-proof-fail', error),
});
