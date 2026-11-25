import './player.css';
import { Stage } from './Stage';
import { defaultLiveSettings, SIGNAL_STARTS } from './settings';
import type { SourceState } from './source';

const canvas = document.querySelector<HTMLCanvasElement>('#art')!;
const frame = document.querySelector<HTMLElement>('#stage')!;
const camera = document.querySelector<HTMLButtonElement>('#camera')!;
const demo = document.querySelector<HTMLButtonElement>('#demo')!;
const clear = document.querySelector<HTMLButtonElement>('#clear')!;
const fullscreen = document.querySelector<HTMLButtonElement>('#fullscreen')!;
const exit = document.querySelector<HTMLButtonElement>('#exit-fullscreen')!;
const look = document.querySelector<HTMLSelectElement>('#look')!;
const instructions = document.querySelector<HTMLElement>('#instructions')!;
const status = document.querySelector<HTMLElement>('#status')!;

const demoInstructions = instructions.textContent!;
const cameraInstructions = 'Step back to fit your arms in view. Hold a pose, then sweep an arm to release the light.';

function message(text: string, error = false): void {
  if (status.textContent !== text) status.textContent = text;
  status.toggleAttribute('data-error', error);
}

function mount(stage: Stage): void {
  const settings = defaultLiveSettings();
  settings.look = 'signal';
  settings.quality = 720;
  let aim = { x: .5, y: .5 };
  let pointer: number | null = null;
  let sourceState: SourceState = { status: 'idle' };
  const usingCamera = () => settings.source.kind === 'camera';

  function applyLook(index: number): void {
    settings.signal = { ...settings.signal, ...SIGNAL_STARTS[index].values };
    stage.apply(settings);
    stage.renderer.clear();
  }

  function applySource(kind: 'camera' | 'test'): void {
    settings.source = { kind, deviceId: null };
    settings.mirror = kind === 'camera';
    frame.dataset.source = kind;
    camera.textContent = usingCamera() ? 'Turn off camera' : 'Use camera';
    camera.toggleAttribute('data-active', usingCamera());
    demo.textContent = usingCamera() ? 'Play demo' : 'Restart demo';
    instructions.textContent = usingCamera() ? cameraInstructions : demoInstructions;
    message('');
    aim = { x: .5, y: .5 };
    pointer = null;
    stage.retry(settings);
    stage.renderer.clear();
  }

  stage.onState = state => {
    sourceState = state;
    if (!usingCamera()) return;
    switch (state.status) {
      case 'starting': message('Waiting for camera access…'); break;
      case 'running': message('Finding your silhouette…'); break;
      case 'refused': useDemoAfterError('Camera access was blocked. Allow it in your browser to try again.'); break;
      case 'none': useDemoAfterError('No camera was found.'); break;
      case 'lost': useDemoAfterError('The camera disconnected.'); break;
      case 'error': useDemoAfterError('The camera could not start. Check that it is available, then try again.'); break;
    }
  };

  function useDemoAfterError(text: string): void {
    applySource('test');
    message(text, true);
  }

  SIGNAL_STARTS.forEach(({ label }, index) => look.add(new Option(label, String(index))));
  look.value = '1';
  applySource('test');
  applyLook(1);

  demo.addEventListener('click', () => applySource('test'));
  camera.addEventListener('click', () => {
    if (usingCamera()) { applySource('test'); return; }
    if (!window.isSecureContext || location.protocol === 'file:') {
      message('Open the hosted page over HTTPS or localhost to use the camera.', true);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !('requestVideoFrameCallback' in HTMLVideoElement.prototype)) {
      message('Camera play needs a newer browser. You can still play the demo.', true);
      return;
    }
    applySource('camera');
  });
  look.addEventListener('change', () => applyLook(look.selectedIndex));
  clear.addEventListener('click', () => stage.renderer.clear());

  function setAim(x: number, y: number): void {
    aim = { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
    stage.aimDemo(aim.x, aim.y);
  }

  function aimAtPointer(event: PointerEvent): void {
    const bounds = canvas.getBoundingClientRect();
    setAim((event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height);
  }

  canvas.addEventListener('pointerdown', event => {
    if (usingCamera() || pointer !== null || event.button !== 0) return;
    pointer = event.pointerId;
    canvas.setPointerCapture(pointer);
    aimAtPointer(event);
  });
  canvas.addEventListener('pointermove', event => {
    if (event.pointerId === pointer) aimAtPointer(event);
  });
  canvas.addEventListener('lostpointercapture', event => {
    if (event.pointerId === pointer) pointer = null;
  });
  canvas.addEventListener('keydown', event => {
    if (usingCamera()) return;
    const x = (Number(event.key === 'ArrowRight') - Number(event.key === 'ArrowLeft')) * .07;
    const y = (Number(event.key === 'ArrowDown') - Number(event.key === 'ArrowUp')) * .07;
    if (x || y) { event.preventDefault(); setAim(aim.x + x, aim.y + y); }
  });

  const reports = window.setInterval(() => {
    if (!usingCamera() || sourceState.status !== 'running') return;
    const { people } = stage.peopleReport();
    const ready = stage.renderer.peopleDiagnostics().ready;
    if (people?.state === 'failed') useDemoAfterError('Background removal could not start. Try the camera again.');
    else if (people?.state === 'behind') message('Reconnecting background removal…');
    else message(ready ? '' : 'Finding your silhouette…');
  }, 250);

  window.addEventListener('pagehide', event => {
    if (event.persisted) { if (usingCamera()) applySource('test'); }
    else { window.clearInterval(reports); stage.dispose(); }
  });
}

fullscreen.addEventListener('click', async () => {
  if (frame.requestFullscreen) {
    try { await frame.requestFullscreen(); canvas.focus(); return; }
    catch { /* Fall back to filling the viewport. */ }
  }
  frame.classList.add('is-expanded');
  document.body.classList.add('expanded');
  canvas.focus();
});

function closeExpanded(): void {
  frame.classList.remove('is-expanded');
  document.body.classList.remove('expanded');
  fullscreen.focus();
}

exit.addEventListener('click', () => {
  if (document.fullscreenElement === frame) void document.exitFullscreen();
  else closeExpanded();
});
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) fullscreen.focus();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && frame.classList.contains('is-expanded')) closeExpanded();
});

try { mount(new Stage(canvas)); }
catch {
  for (const control of [camera, demo, look, clear, fullscreen]) control.disabled = true;
  instructions.textContent = '';
  message('Signal Melt needs WebGL 2 and floating-point render textures. Try a browser with hardware acceleration enabled.', true);
}
