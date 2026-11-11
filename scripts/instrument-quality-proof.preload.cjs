const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('instrumentProof',Object.fromEntries(['config','start','frame','phase','still','finish','fail'].map(name=>[name,(...args)=>ipcRenderer.invoke('instrument-proof-'+name,...args)])));
