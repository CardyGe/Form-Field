'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const invoke = (method, ...args) => ipcRenderer.invoke(`studio:${method}`, ...args);
const closeHandlers = new Set();

ipcRenderer.on('studio:before-close', async (_event, token) => {
  if (typeof token !== 'string') return;
  try {
    if (!closeHandlers.size) throw new Error('The editor is not ready to save its latest changes.');
    for (const handler of [...closeHandlers]) await handler();
    ipcRenderer.send('studio:close-ready', token, { ok: true });
  } catch (error) {
    ipcRenderer.send('studio:close-ready', token, { ok: false, error: String(error?.message || error).slice(0, 2000) });
  }
});

contextBridge.exposeInMainWorld('studio', Object.freeze({
  getStatus: () => invoke('getStatus'),
  loadAutosave: () => invoke('loadAutosave'),
  saveAutosave: project => invoke('saveAutosave', project),
  saveProject: project => invoke('saveProject', project),
  openProject: () => invoke('openProject'),
  chooseExportDirectory: () => invoke('chooseExportDirectory'),
  saveStill: (bytes, suggestedName) => invoke('saveStill', bytes, suggestedName),
  beginExport: request => invoke('beginExport', request),
  writeFrame: (jobId, frameIndex, bytes) => invoke('writeFrame', jobId, frameIndex, bytes),
  finishExport: jobId => invoke('finishExport', jobId),
  cancelExport: jobId => invoke('cancelExport', jobId),
  listJobs: () => invoke('listJobs'),
  resumeExport: jobId => invoke('resumeExport', jobId),
  revealPath: filename => invoke('revealPath', filename),
  onBeforeClose: callback => {
    if (typeof callback !== 'function') throw new TypeError('Expected a close callback.');
    closeHandlers.add(callback);
    return () => closeHandlers.delete(callback);
  },
  onExportProgress: callback => {
    if (typeof callback !== 'function') throw new TypeError('Expected a progress callback.');
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('studio:export', listener);
    return () => ipcRenderer.removeListener('studio:export', listener);
  },
}));
