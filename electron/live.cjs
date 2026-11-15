'use strict';

// Live mode in the main process: camera permission, the artwork window, and
// the relay between it and the studio window. Camera video never passes
// through here; only settings and a small preview picture do.

/** A permission request: only camera video, only from this app's own windows. */
function allowPermission(permission, details, isOurWindow) {
  const types = details?.mediaTypes;
  return isOurWindow === true && permission === 'media' && Array.isArray(types) && types.length === 1 && types[0] === 'video';
}

/** A permission check (made before and while the camera is used): the same rule. */
function allowPermissionCheck(permission, details, isOurWindow) {
  return isOurWindow === true && permission === 'media' && details?.mediaType === 'video';
}

/** Asks macOS for the camera the first time only. A refusal can only be changed in System Settings. */
async function ensureCameraAccess(systemPreferences) {
  const status = typeof systemPreferences.getMediaAccessStatus === 'function' ? systemPreferences.getMediaAccessStatus('camera') : 'granted';
  if (status === 'granted') return 'granted';
  if (status !== 'not-determined' || typeof systemPreferences.askForMediaAccess !== 'function') return 'refused';
  return await systemPreferences.askForMediaAccess('camera') ? 'granted' : 'refused';
}

module.exports = { allowPermission, allowPermissionCheck, ensureCameraAccess };
