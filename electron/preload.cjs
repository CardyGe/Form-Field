'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const invoke = (method, ...args) => ipcRenderer.invoke(`studio:${method}`, ...args);
const closeHandlers = new Set();
const subscribe = (channel, callback) => {
  if (typeof callback !== 'function') throw new TypeError('Expected a callback.');
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

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
  saveProject: (project, saveAs) => invoke('saveProject', project, saveAs === true),
  forgetProjectPath: () => invoke('forgetProjectPath'),
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
  installation: Object.freeze({
    get: () => invoke('installation:get'),
    set: settings => invoke('installation:set', settings),
    log: text => invoke('installation:log', text),
  }),
  map: Object.freeze({
    // True only in the small window the scripted checks open, so their probes never ship to a real wall.
    checks: process.argv.includes('--form-field-checks'),
    loadAutosave: () => invoke('map:loadAutosave'),
    saveAutosave: text => invoke('map:saveAutosave', text),
    openShow: () => invoke('map:openShow'),
    chooseVideo: () => invoke('map:chooseVideo'),
    findVideo: (name) => invoke('map:findVideo', name),
    saveShow: (text, saveAs) => invoke('map:saveShow', text, saveAs),
    displays: () => invoke('map:displays'),
    openOutput: displayId => invoke('map:openOutput', displayId),
    closeOutput: () => invoke('map:closeOutput'),
    send: message => ipcRenderer.send('studio:map:send', message),
    onMessage: callback => subscribe('studio:map:message', callback),
    onOutputChanged: callback => subscribe('studio:map:output', callback),
    onDisplaysChanged: callback => subscribe('studio:map:displays', callback),
    ready: () => ipcRenderer.send('studio:map:ready'),
    requestClose: () => ipcRenderer.send('studio:map:close'),
    sendPreview: jpeg => ipcRenderer.send('studio:map:preview', jpeg),
    sendState: state => ipcRenderer.send('studio:map:state', state),
    onState: callback => subscribe('studio:map:state', callback),
    onPreview: callback => subscribe('studio:map:preview', callback),
  }),
  live: Object.freeze({
    loadSettings: () => invoke('live:loadSettings'),
    saveSettings: settings => invoke('live:saveSettings', settings),
    cameraAccess: () => invoke('live:cameraAccess'),
    microphoneAccess: () => invoke('live:microphoneAccess'),
    displays: () => invoke('live:displays'),
    openOutput: displayId => invoke('live:openOutput', displayId),
    closeOutput: () => invoke('live:closeOutput'),
    send: message => ipcRenderer.send('studio:live:send', message),
    onMessage: callback => subscribe('studio:live:message', callback),
    onOutputChanged: callback => subscribe('studio:live:output', callback),
    ready: () => ipcRenderer.send('studio:live:ready'),
    requestClose: () => ipcRenderer.send('studio:live:close'),
    sendState: state => ipcRenderer.send('studio:live:state', state),
    onState: callback => subscribe('studio:live:state', callback),
    onDisplaysChanged: callback => subscribe('studio:live:displays', callback),
    sendPreview: (jpeg, fps) => ipcRenderer.send('studio:live:preview', jpeg, fps),
    onPreview: callback => {
      if (typeof callback !== 'function') throw new TypeError('Expected a callback.');
      const listener = (_event, jpeg, fps) => callback(jpeg, fps);
      ipcRenderer.on('studio:live:preview', listener);
      return () => ipcRenderer.removeListener('studio:live:preview', listener);
    },
  }),
  onExportProgress: callback => {
    if (typeof callback !== 'function') throw new TypeError('Expected a progress callback.');
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('studio:export', listener);
    return () => ipcRenderer.removeListener('studio:export', listener);
  },
}));
