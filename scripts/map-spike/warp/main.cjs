// Map stage 4 spike (throwaway): what perspective drawing costs. Run: npx electron scripts/map-spike/warp/main.cjs
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
app.whenReady().then(() => {
  const w = new BrowserWindow({ width: 1920, height: 1080, show: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), backgroundThrottling: false } });
  ipcMain.on('done', (_e, text) => { console.log(text); app.quit(); });
  w.loadFile(path.join(__dirname, 'index.html'));
});
