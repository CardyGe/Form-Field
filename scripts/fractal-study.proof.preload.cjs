const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('fractalProof', {
  start: request => ipcRenderer.invoke('fractal-proof-start', request),
  frame: (id, index, bytes) => ipcRenderer.invoke('fractal-proof-frame', id, index, bytes),
  phase: (label, bytes) => ipcRenderer.invoke('fractal-proof-phase', label, bytes),
  still: (name, bytes) => ipcRenderer.invoke('fractal-proof-still', name, bytes),
  motionFrame: (index, bytes) => ipcRenderer.invoke('fractal-proof-motion-frame', index, bytes),
  finish: (id, report) => ipcRenderer.invoke('fractal-proof-finish', id, report),
  fail: error => ipcRenderer.invoke('fractal-proof-fail', error),
});
