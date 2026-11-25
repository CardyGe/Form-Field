'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createOutputWindow } = require('./output-window.cjs');

function fakes() {
  const blocker = { started: [], stopped: [], running: new Set(),
    start(kind) { this.started.push(kind); this.running.add(7); return 7; },
    isStarted(id) { return this.running.has(id); },
    stop(id) { this.stopped.push(id); this.running.delete(id); } };
  const created = [];
  class BrowserWindow {
    constructor(options) { this.options = options; this.handlers = {}; this.destroyed = false;
      this.webContents = { setWindowOpenHandler: fn => { this.openHandler = fn; }, on: (name, fn) => { this.handlers[name] = fn; } };
      created.push(this); }
    isDestroyed() { return this.destroyed; }
    once(name, fn) { this.handlers[`once:${name}`] = fn; }
    on(name, fn) { this.handlers[name] = fn; }
    close() { this.closed = true; }
  }
  return { blocker, created, BrowserWindow };
}
const display = { id: 3, bounds: { x: 10, y: 20, width: 1920, height: 1080 } };

test('the artwork window is sandboxed, refuses new windows, and keeps the display awake', () => {
  const { blocker, created, BrowserWindow } = fakes();
  const { window, release } = createOutputWindow({ BrowserWindow, powerSaveBlocker: blocker, display, preload: '/p.js', title: 'Form & Field Map', windowed: false });
  assert.equal(window, created[0]);
  assert.equal(window.options.webPreferences.sandbox, true);
  assert.equal(window.options.webPreferences.preload, '/p.js');
  assert.equal(window.options.x, 10);
  assert.equal(window.options.title, 'Form & Field Map');
  assert.equal(window.displayId, 3);
  assert.deepEqual(window.openHandler(), { action: 'deny' });
  assert.deepEqual(blocker.started, ['prevent-display-sleep']);
  release();
  assert.deepEqual(blocker.stopped, [7]);
  release();
  assert.deepEqual(blocker.stopped, [7]);
});

test('only the scripted checks window is given the check hooks flag', () => {
  const make = windowed => { const { blocker, BrowserWindow } = fakes(); return createOutputWindow({ BrowserWindow, powerSaveBlocker: blocker, display, preload: '/p.js', title: 'T', windowed }).window.options.webPreferences.additionalArguments; };
  assert.deepEqual(make(false), []);
  assert.deepEqual(make(true), ['--form-field-checks']);
});

test('windowed mode uses a small ordinary size', () => {
  const { blocker, BrowserWindow } = fakes();
  const { window } = createOutputWindow({ BrowserWindow, powerSaveBlocker: blocker, display, preload: '/p.js', windowed: true });
  assert.equal(window.options.width, 960);
  assert.equal(window.options.height, 540);
});

test('on the studio\'s own screen the output is a movable, resizable window, never full screen', () => {
  const { blocker, BrowserWindow } = fakes();
  const own = { id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 25, width: 1512, height: 957 } };
  const { window } = createOutputWindow({ BrowserWindow, powerSaveBlocker: blocker, display: own, preload: '/p.js', title: 'Form & Field Map', windowed: false, framed: true });
  assert.equal(window.options.frame, true);
  assert.equal(window.options.resizable, true);
  assert.equal(window.options.movable, true);
  assert.equal(window.options.fullscreenable, false);
  assert.equal(window.options.skipTaskbar, false);
  // 16:9, centred in the screen's work area.
  assert.equal(window.options.width, 960);
  assert.equal(window.options.height, 540);
  assert.equal(window.options.x, 276);
  assert.equal(window.options.y, 25 + Math.round((957 - 540) / 2));
  let fullScreen = false;
  Object.assign(window, { show() {}, setSimpleFullScreen() { fullScreen = true; }, setFullScreen() { fullScreen = true; } });
  window.handlers['once:ready-to-show']();
  assert.equal(fullScreen, false);
});

test('on a separate display the output still goes full screen', () => {
  const { blocker, BrowserWindow } = fakes();
  const { window } = createOutputWindow({ BrowserWindow, powerSaveBlocker: blocker, display, preload: '/p.js', windowed: false });
  let fullScreen = false;
  Object.assign(window, { show() {}, setSimpleFullScreen() { fullScreen = true; }, setFullScreen() { fullScreen = true; } });
  window.handlers['once:ready-to-show']();
  assert.equal(fullScreen, true);
  assert.equal(window.options.frame, false);
});
