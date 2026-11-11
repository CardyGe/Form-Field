const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('proof', {
  start: request => ipcRenderer.invoke('proof-start', request),
  frame: (id, index, bytes) => ipcRenderer.invoke('proof-frame', id, index, bytes),
  note: note => ipcRenderer.invoke('proof-note', note),
  still: (name, bytes) => ipcRenderer.invoke('proof-still', name, bytes),
  finish: id => ipcRenderer.invoke('proof-finish', id),
  fail: error => ipcRenderer.invoke('proof-fail', error),
});
