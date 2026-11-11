const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('fractalProof',Object.fromEntries(['config','start','frame','phase','still','finish','fail'].map(name=>[name,(...args)=>ipcRenderer.invoke('fractal-proof-'+name,...args)])));
