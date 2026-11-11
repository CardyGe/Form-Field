const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('sculptureProof', {
  start: request => ipcRenderer.invoke('sculpture-proof-start', request),
  frame: (id, index, bytes) => ipcRenderer.invoke('sculpture-proof-frame', id, index, bytes),
  phase: (label, bytes) => ipcRenderer.invoke('sculpture-proof-phase', label, bytes),
  still: (name, bytes) => ipcRenderer.invoke('sculpture-proof-still', name, bytes),
  finish: (id, report) => ipcRenderer.invoke('sculpture-proof-finish', id, report),
  fail: error => ipcRenderer.invoke('sculpture-proof-fail', error),
});
