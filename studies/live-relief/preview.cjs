// A private profile for the rehearsal build, with motion visible on first use.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const profile = app.commandLine.getSwitchValue('user-data-dir') || path.join(app.getPath('appData'), 'Form and Field Relief Preview');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
try {
  const rehearsal = {
    look: 'relief', source: { kind: 'test' }, reliefPresence: false, reliefPalette: 'neon',
    relief: { surface: 'scales', size: 'nano', motion: 'ricochet', finish: 'silver',
      depth: .92, reach: .8, settle: 1.65, lightAngle: -38, edgeLight: .48 },
  };
  fs.writeFileSync(path.join(profile, 'live-settings.json'), JSON.stringify(rehearsal), { flag: 'wx' });
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
}
require('../../electron/main.cjs');
