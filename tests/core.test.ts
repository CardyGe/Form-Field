import {FINISH_KEYS} from '../src/core/finishing';
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPreset, createLayer, createProject, MAX_ASSET_BYTES, parameterDefinitions, PRESETS, validateProject, varyLayer, visibleParameterDefinitions } from '../src/core/project';
import { evaluateLayer, frameCount, phaseAtFrame, sampleModulation } from '../src/core/timeline';
import type { LayerKind, Modulation, Project } from '../src/shared/types';

const TAU = Math.PI * 2;
const FRACTAL_V5_FIELDS = ['variant', 'quality', 'density', 'juliaReal', 'juliaImag', 'trap', 'boxScale', 'boxRadius', 'radial', 'roughness', 'lightAngle', 'exposure', 'lineWidth'];
const V6_FIELDS: Partial<Record<LayerKind, string[]>> = {
  surface: ['variant', 'density', 'stretch', 'turbulence', 'centerX', 'centerY', 'lightAngle', 'roughness', 'saturation', 'hue', 'exposure'],
  sculpture: ['form', 'lobes', 'thickness', 'stretch', 'curl', 'foldFrequency', 'asymmetry', 'ridgeScale', 'metallic', 'clearcoat', 'sheen', 'filmScale', 'lightPower', 'shadowStrength', 'shadowSoftness', 'saturation', 'hue', 'exposure'],
  fractal: ['colorMode', 'colorSteps', 'colorMix', 'saturation', 'hue'],
  oil: [],
  graphic: [],
  super8: [],
  image: ['mirror', 'repeat', 'saturation', 'hue', 'exposure'],
};
const close = (actual: number, expected: number, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not close to ${expected}`);
const modulation = (kind: Modulation['kind'], extra: Partial<Modulation> = {}): Modulation => ({ kind, cycles: 1, phase: 0, amount: 1, points: [], ...extra });
const clone = <T>(value: T): T => structuredClone(value);
const invalid = (edit: (project: Project) => void, pattern: RegExp) => {
  const project = createProject(); edit(project); assert.throws(() => validateProject(project), pattern);
};

test('defaults and curated presets are complete valid saved projects, with no shared mutable state', () => {
  const first = createProject(); const second = createProject();
  assert.equal(first.width, 3840); assert.equal(first.height, 2160); assert.equal(frameCount(first), 300);
  assert.notEqual(first.id, second.id); assert.notEqual(first.layers[0].id, second.layers[0].id);
  assert.deepEqual(validateProject(first), first);
  assert.deepEqual(createLayer('sculpture').palette, PRESETS.find((preset) => preset.id === 'pearl-organism')!.palette);
  assert.notDeepEqual(createLayer('sculpture').palette, createLayer('surface').palette);
  for (const preset of PRESETS) {
    const project = createProject(); project.layers = [applyPreset(createLayer(preset.kind), preset.id)];
    assert.deepEqual(validateProject(project), project);
    const registry = parameterDefinitions(preset.kind);
    for (const definition of registry) assert.equal(typeof preset.params[definition.key], 'number');
    const originalColor = preset.palette[0];
    project.layers[0].palette[0] = originalColor === '#ffffff' ? '#000000' : '#ffffff';
    assert.equal(preset.palette[0], originalColor);
  }
  const definitions = parameterDefinitions('surface'); definitions[0].min = -100;
  assert.equal(parameterDefinitions('surface')[0].min, 0);
  assert.throws(() => applyPreset(first.layers[0], 'pearl-organism'), /requires a sculpture layer/);
  assert.throws(() => applyPreset(first.layers[0], 'missing'), /Unknown preset/);
});

test('rational frame counts and wrapped frame phases never add a duplicate endpoint', () => {
  const project = createProject(); project.fps = { num: 60000, den: 1001 };
  assert.equal(frameCount(project), 599);
  project.duration = 1001 / 60;
  assert.equal(frameCount(project), 1000);
  close(phaseAtFrame(0, 1000), 0); close(phaseAtFrame(1000, 1000), 0);
  close(phaseAtFrame(-1, 1000), phaseAtFrame(999, 1000));
  close(phaseAtFrame(1001, 1000), phaseAtFrame(1, 1000));
  assert.ok(phaseAtFrame(999, 1000) < TAU);
  assert.throws(() => phaseAtFrame(0, 0), /positive integer/);
  assert.throws(() => frameCount({ duration: 10, fps: { num: 30, den: 0 } }), /positive/);
});

test('all modulators close smoothly at wrap and evaluate identically in any seek order', () => {
  const kinds: Modulation[] = [
    modulation('sine', { cycles: 3, phase: 0.13 }),
    modulation('pulse', { cycles: 2, phase: 0.21 }),
    modulation('noise', { cycles: 4, phase: 0.07 }),
    modulation('keyframes', { points: [{ time: 0.12, value: -0.3 }, { time: 0.38, value: 0.8 }, { time: 0.71, value: -0.6 }] }),
  ];
  const epsilon = 1e-5;
  for (const mod of kinds) {
    const samples = [0, 0.1, 2.5, 5.8, 1.2, TAU, -0.1].map((phase) => [phase, sampleModulation(mod, phase, 1729)] as const);
    for (const [phase, value] of [...samples].reverse()) {
      close(sampleModulation(mod, phase, 1729), value);
      close(sampleModulation(mod, phase + TAU, 1729), value);
      assert.ok(value >= -1 && value <= 1);
    }
    const center = sampleModulation(mod, 0, 1729);
    const leftSlope = (center - sampleModulation(mod, -epsilon, 1729)) / epsilon;
    const rightSlope = (sampleModulation(mod, epsilon, 1729) - center) / epsilon;
    close(leftSlope, rightSlope, 0.005);
  }
  close(sampleModulation(modulation('sine', { phase: 0.25 }), 0, 1), 1);
  assert.notEqual(sampleModulation(modulation('noise'), 1, 1), sampleModulation(modulation('noise'), 1, 2));
  assert.throws(() => sampleModulation(modulation('sine', { cycles: 1.5 }), 0, 1), /integer cycles/);
});

test('cyclic Hermite keys hit control points and preserve slope through each key', () => {
  const points = [{ time: 0, value: -0.2 }, { time: 0.17, value: 0.8 }, { time: 0.61, value: -0.5 }, { time: 0.9, value: 0.1 }];
  const mod = modulation('keyframes', { points });
  const epsilon = 1e-6;
  for (const point of points) {
    const phase = point.time * TAU;
    close(sampleModulation(mod, phase, 0), point.value);
    const left = (point.value - sampleModulation(mod, phase - epsilon, 0)) / epsilon;
    const right = (sampleModulation(mod, phase + epsilon, 0) - point.value) / epsilon;
    close(left, right, 0.0001);
  }
  const atMaximum = modulation('keyframes', { points: [{ time: 0, value: 1 }, { time: 0.2, value: -0.2 }, { time: 0.7, value: -0.8 }] });
  const left = (1 - sampleModulation(atMaximum, -epsilon, 0)) / epsilon;
  const right = (sampleModulation(atMaximum, epsilon, 0) - 1) / epsilon;
  close(left, right, 0.0001);
  for (let i = 0; i < 1000; i++) {
    const value = sampleModulation(atMaximum, phaseAtFrame(i, 1000), 0);
    assert.ok(value >= -0.8 && value <= 1, 'Hermite interpolation must not add an overshoot');
  }
});

test('parameter, opacity and transform modulation is bounded and does not mutate input', () => {
  const layer = createLayer('surface');
  layer.params.warp = 0.9;
  layer.modulations = {
    warp: modulation('sine'), opacity: modulation('sine'),
    'transform.x': modulation('sine'), 'transform.y': modulation('sine'),
    'transform.scale': modulation('sine'), 'transform.rotation': modulation('sine'),
  };
  const before = clone(layer);
  const peak = evaluateLayer(layer, Math.PI / 2); const trough = evaluateLayer(layer, Math.PI * 1.5);
  assert.equal(peak.params.warp, 1); assert.equal(peak.opacity, 1); assert.equal(trough.opacity, 0.5);
  assert.equal(peak.transform.x, 2); assert.equal(trough.transform.y, -2);
  assert.equal(trough.transform.scale, 0.05); close(peak.transform.rotation, TAU);
  assert.deepEqual(layer, before);
  assert.deepEqual(evaluateLayer(layer, 0.72), evaluateLayer(layer, 0.72 + TAU));
  peak.palette[0] = '#ffffff'; assert.notEqual(layer.palette[0], '#ffffff');
});

test('authored variations are reproducible, bounded, and honor independent locks', () => {
  const layer = applyPreset(createLayer('sculpture'), 'pearl-organism');
  const before = clone(layer);
  const unlocked = { palette: false, structure: false, motion: false, material: false };
  const varied = varyLayer(layer, 0.7, unlocked);
  assert.deepEqual(varied, varyLayer(layer, 0.7, unlocked)); assert.deepEqual(layer, before);
  assert.notEqual(varied.params.seed, layer.params.seed);
  assert.notDeepEqual(varyLayer(varied, 0.7, unlocked), varied);
  const project = createProject(); project.layers = [varied]; assert.doesNotThrow(() => validateProject(project));
  const locked = varyLayer(layer, 1, { palette: true, structure: true, motion: true, material: false });
  assert.deepEqual(locked.palette, layer.palette); assert.equal(locked.params.seed, layer.params.seed);
  for (const definition of parameterDefinitions('sculpture')) {
    if (definition.section !== 'Material') assert.equal(locked.params[definition.key], layer.params[definition.key]);
  }
  assert.notEqual(locked.params.roughness, layer.params.roughness);
  assert.deepEqual(varyLayer(layer, 1, { palette: true, structure: true, motion: true, material: true }), layer);
  assert.deepEqual(varyLayer(layer, 0, unlocked), layer);
  assert.throws(() => varyLayer(layer, Infinity, unlocked), /between 0 and 1/);
});

test('motion lock preserves the complete noise-route motion while other controls vary', () => {
  const layer = createLayer('surface');
  layer.modulations['transform.x'] = modulation('noise', { cycles: 3, amount: 0.3, phase: 0.2 });
  const varied = varyLayer(layer, 0.7, { palette: false, structure: false, motion: true, material: false });
  assert.equal(varied.params.seed, layer.params.seed);
  assert.notEqual(varied.params.warp, layer.params.warp, 'Unlocked structure should still vary');
  assert.deepEqual(varied.modulations, layer.modulations);
  for (const phase of [0, 0.1, 0.7, 2.3, 5.4, TAU]) {
    assert.equal(evaluateLayer(varied, phase).transform.x, evaluateLayer(layer, phase).transform.x);
  }
  const unlocked = varyLayer(layer, 0.7, { palette: false, structure: false, motion: false, material: false });
  assert.notEqual(evaluateLayer(unlocked, 0.7).transform.x, evaluateLayer(layer, 0.7).transform.x);
});

test('project validation rejects corruption rather than repairing it', () => {
  invalid((p) => { (p as unknown as Record<string, unknown>).schemaVersion = 3; }, /schemaVersion/);
  invalid((p) => { p.layers.push(clone(p.layers[0])); }, /duplicate layer IDs/);
  invalid((p) => { p.layers = Array.from({ length: 5 }, () => createLayer('surface')); }, /one and four/);
  invalid((p) => { p.layers = []; }, /one and four/);
  invalid((p) => { p.layers[0].params.warp = NaN; }, /params.warp/);
  invalid((p) => { p.layers[0].params.style = 0.2; }, /params.style/);
  invalid((p) => { p.layers[0].params.cycles = 1.5; }, /params.cycles/);
  invalid((p) => { p.width = 1e9; }, /width/);
  invalid((p) => { p.layers[0].transform.scale = 0; }, /transform.scale/);
  invalid((p) => { p.layers[0].opacity = Infinity; }, /opacity/);
  invalid((p) => { p.fps.den = 0; }, /fps.den/);
  invalid((p) => { p.fps.num = 1000; }, /frame rate/);
  invalid((p) => { p.layers[0].palette = ['#fff']; }, /six hex/);
  invalid((p) => { p.layers[0].params.unrecognized = 2; }, /not supported/);
  invalid((p) => { p.layers[0].modulations.seed = modulation('sine'); }, /not supported/);
  invalid((p) => { p.layers[0].modulations.warp = modulation('noise', { cycles: 2.2 }); }, /integer/);
  invalid((p) => { p.layers[0].modulations.warp = modulation('sine', { phase: 2 }); }, /phase/);
  invalid((p) => { p.layers[0].modulations.warp = modulation('keyframes', { points: [{ time: 0, value: 0 }, { time: 1, value: 0 }] }); }, /endpoint is implicit/);
  invalid((p) => { p.layers[0].modulations.warp = modulation('keyframes', { points: [{ time: 0.3, value: 0 }, { time: 0.2, value: 0 }] }); }, /increase strictly/);
  invalid((p) => { p.layers[0].modulations.warp = modulation('keyframes', { points: [{ time: 0, value: 0 }] }); }, /at least two/);
  assert.throws(() => validateProject(null), /root must be an object/);
  const project = createProject(); const validated = validateProject(project); validated.layers[0].params.warp = 0;
  assert.notEqual(project.layers[0].params.warp, 0);
});

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9xkAAAAASUVORK5CYII=';
// Real 16 × 8 baseline JPEG encoded with FFmpeg; the test inserts bounded APP1 metadata.
const JPEG = '/9j/4AAQSkZJRgABAgAAAQABAAD//gAPTGF2YzYwLjMuMTAwAP/bAEMACAQEBAQEBQUFBQUFBgYGBgYGBgYGBgYGBgcHBwgICAcHBwYGBwcICAgICQkJCAgICAkJCgoKDAwLCw4ODhERFP/EAEwAAQEAAAAAAAAAAAAAAAAAAAAHAQEBAAAAAAAAAAAAAAAAAAAFBxABAAAAAAAAAAAAAAAAAAAAABEBAAAAAAAAAAAAAAAAAAAAAP/AABEIAAgAEAMBIgACEQADEQD/2gAMAwEAAhEDEQA/AI4Av4t//9k=';

function orientedJPEG(orientation: number, little: boolean, corrupt?: (tiff: Buffer) => void): string {
  const tiff = Buffer.alloc(26);
  tiff.write(little ? 'II' : 'MM');
  const write16 = (value: number, offset: number) => little ? tiff.writeUInt16LE(value, offset) : tiff.writeUInt16BE(value, offset);
  const write32 = (value: number, offset: number) => little ? tiff.writeUInt32LE(value, offset) : tiff.writeUInt32BE(value, offset);
  write16(42, 2); write32(8, 4); write16(1, 8);
  write16(0x0112, 10); write16(3, 12); write32(1, 14); write16(orientation, 18);
  corrupt?.(tiff);
  const payload = Buffer.concat([Buffer.from('Exif\0\0'), tiff]);
  const segment = Buffer.alloc(4); segment.writeUInt16BE(0xffe1, 0); segment.writeUInt16BE(payload.length + 2, 2);
  const bytes = Buffer.from(JPEG, 'base64');
  return 'data:image/jpeg;base64,' + Buffer.concat([bytes.subarray(0, 2), segment, payload, bytes.subarray(2)]).toString('base64');
}

test('still assets validate size, actual dimensions, MIME and nonanimated containers', () => {
  const project = createProject(); const image = createLayer('image');
  image.image = { name: 'Pixel.png', dataUrl: PNG, width: 1, height: 1, fit: 'contain' };
  project.layers.push(image);
  assert.doesNotThrow(() => validateProject(project));
  const wrongDimensions = clone(project); wrongDimensions.layers[1].image!.width = 2;
  assert.throws(() => validateProject(wrongDimensions), /dimensions do not match/);
  const remote = clone(project); remote.layers[1].image!.dataUrl = 'https://example.com/a.png';
  assert.throws(() => validateProject(remote), /data URL/);
  const svg = clone(project); svg.layers[1].image!.dataUrl = 'data:image/svg+xml;base64,PHN2Zy8+';
  assert.throws(() => validateProject(svg), /data URL/);
  const spoofed = clone(project); spoofed.layers[1].image!.dataUrl = PNG.replace('image/png', 'image/jpeg');
  assert.throws(() => validateProject(spoofed), /JPEG/);
  const huge = clone(project); huge.layers[1].image!.dataUrl = 'data:image/png;base64,' + 'A'.repeat(Math.ceil(MAX_ASSET_BYTES / 3) * 4 + 100);
  assert.throws(() => validateProject(huge), /20 MiB/);
  const animated = clone(project);
  const binary = Buffer.from(PNG.split(',')[1], 'base64');
  const control = Buffer.alloc(20); control.writeUInt32BE(8, 0); control.write('acTL', 4);
  animated.layers[1].image!.dataUrl = 'data:image/png;base64,' + Buffer.concat([binary.subarray(0, 33), control, binary.subarray(33)]).toString('base64');
  assert.throws(() => validateProject(animated), /animated PNG/);
  const mask = createProject(); mask.layers[0].mask = { kind: 'image', softness: 0.2, invert: false, size: 1, dataUrl: PNG };
  assert.doesNotThrow(() => validateProject(mask));
  delete mask.layers[0].mask.dataUrl;
  assert.throws(() => validateProject(mask), /mask.dataUrl/);
});

test('every preset survives all lock combinations, repeated variation and JSON roundtrips', () => {
  for (const preset of PRESETS) {
    const source = applyPreset(createLayer(preset.kind), preset.id);
    source.modulations.opacity = modulation('sine', { cycles: 3, phase: 0.25 });
    source.modulations['transform.rotation'] = modulation('keyframes', { points: [{ time: 0, value: -0.3 }, { time: 0.3, value: 0.7 }, { time: 0.8, value: -0.8 }] });
    for (let bits = 0; bits < 16; bits++) {
      const locks = { palette: Boolean(bits & 1), structure: Boolean(bits & 2), motion: Boolean(bits & 4), material: Boolean(bits & 8) };
      let layer = clone(source);
      for (let iteration = 0; iteration < 4; iteration++) layer = varyLayer(layer, iteration / 3, locks);
      const project = createProject(); project.layers = [layer];
      project.fps = { num: 30000, den: 1001 };
      const restored = validateProject(JSON.parse(JSON.stringify(project)));
      assert.deepEqual(restored, project, `${preset.id} must roundtrip with lock combination ${bits}`);
      assert.deepEqual(layer.modulations, source.modulations, 'Variation must retain authored routes');
      if (locks.palette) assert.deepEqual(layer.palette, source.palette);
      if (locks.structure) assert.equal(layer.params.seed, source.params.seed);
      for (const definition of parameterDefinitions(source.kind)) {
        const locked = definition.section === 'Motion' ? locks.motion : definition.section === 'Material' ? locks.material : locks.structure;
        if (locked) assert.equal(layer.params[definition.key], source.params[definition.key]);
      }
      for (const phase of [0, 0.125 * TAU, 0.8 * TAU]) {
        assert.deepEqual(evaluateLayer(restored.layers[0], phase), evaluateLayer(project.layers[0], phase));
      }
    }
  }
});

test('JPEG validation matches browser-oriented dimensions for both EXIF byte orders', () => {
  for (const little of [true, false]) {
    for (let orientation = 1; orientation <= 8; orientation++) {
      const project = createProject(); const layer = createLayer('image');
      const swapped = orientation >= 5;
      layer.image = { name: 'Oriented.jpg', dataUrl: orientedJPEG(orientation, little), width: swapped ? 8 : 16, height: swapped ? 16 : 8, fit: 'contain' };
      project.layers = [layer];
      assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))), project);
      if (swapped) {
        const incorrect = clone(project); incorrect.layers[0].image!.width = 16; incorrect.layers[0].image!.height = 8;
        assert.throws(() => validateProject(incorrect), /dimensions do not match/);
      }
    }
  }
});

test('malformed EXIF offsets, types and entry counts are rejected with bounded reads', () => {
  const corruptions = [
    (tiff: Buffer) => tiff.writeUInt32LE(0xffffffff, 4),
    (tiff: Buffer) => tiff.writeUInt16LE(65535, 8),
    (tiff: Buffer) => tiff.writeUInt16LE(4, 12),
    (tiff: Buffer) => tiff.writeUInt32LE(2, 14),
    (tiff: Buffer) => tiff.writeUInt16LE(9, 18),
    (tiff: Buffer) => tiff.write('ZZ', 0),
  ];
  for (const corrupt of corruptions) {
    const project = createProject(); const layer = createLayer('image');
    layer.image = { name: 'Corrupt.jpg', dataUrl: orientedJPEG(6, true, corrupt), width: 8, height: 16, fit: 'contain' };
    project.layers = [layer];
    assert.throws(() => validateProject(project), /invalid or truncated JPEG EXIF/);
  }
});

test('legacy sculpture projects receive only absent opening/twist defaults without input mutation', () => {
  const legacy = createProject(); legacy.layers = [createLayer('sculpture')];
  delete legacy.layers[0].params.opening; delete legacy.layers[0].params.twist;
  const before = clone(legacy);
  const normalized = validateProject(legacy);
  assert.deepEqual(legacy, before, 'Loading must never mutate the parsed source document');
  assert.equal(normalized.layers[0].params.opening, 0.55);
  assert.equal(normalized.layers[0].params.twist, 0.3);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(normalized))), normalized);
  const partial = clone(legacy); partial.layers[0].params.opening = 0;
  assert.equal(validateProject(partial).layers[0].params.opening, 0, 'Authored zero must not be replaced');
  delete partial.layers[0].params.fold;
  assert.throws(() => validateProject(partial), /params.fold/, 'Legacy support must not repair unrelated missing controls');
  const unknown = clone(legacy); unknown.layers[0].params.unrecognized = 0.2;
  assert.throws(() => validateProject(unknown), /not supported/);
});

test('opening and signed twist reject corruption, modulate within bounds, and follow structure locks', () => {
  for (const [key, value] of [['opening', -0.01], ['opening', 1.01], ['twist', -1.01], ['twist', 1.01], ['opening', NaN], ['twist', Infinity]] as const) {
    const project = createProject(); project.layers = [createLayer('sculpture')]; project.layers[0].params[key] = value;
    assert.throws(() => validateProject(project), new RegExp(`params.${key}`));
  }
  const explicitUndefined = createProject(); explicitUndefined.layers = [createLayer('sculpture')];
  (explicitUndefined.layers[0].params as Record<string, unknown>).opening = undefined;
  assert.throws(() => validateProject(explicitUndefined), /params.opening/, 'An explicitly corrupt value is not a missing legacy field');
  const layer = createLayer('sculpture'); layer.params.opening = 0.9; layer.params.twist = 0.8;
  layer.modulations = { opening: modulation('sine'), twist: modulation('sine') };
  const project = createProject(); project.layers = [layer]; assert.doesNotThrow(() => validateProject(project));
  const peak = evaluateLayer(layer, Math.PI / 2); const trough = evaluateLayer(layer, Math.PI * 1.5);
  assert.equal(peak.params.opening, 1); assert.equal(peak.params.twist, 1);
  close(trough.params.opening, 0.4); close(trough.params.twist, -0.2);
  const locked = varyLayer(layer, 1, { palette: false, structure: true, motion: false, material: false });
  assert.equal(locked.params.opening, layer.params.opening); assert.equal(locked.params.twist, layer.params.twist);
  const varied = varyLayer(createLayer('sculpture'), 0.8, { palette: true, structure: false, motion: true, material: true });
  assert.notEqual(varied.params.opening, 0.55); assert.notEqual(varied.params.twist, 0.3);
  const presetValues = PRESETS.filter((preset) => preset.kind === 'sculpture').map((preset) => [preset.params.opening, preset.params.twist]);
  assert.ok(new Set(presetValues.map((values) => JSON.stringify(values))).size >= 3, 'Sculpture presets should explore distinct configurations');
  assert.ok(presetValues.some(([, twist]) => twist < 0) && presetValues.some(([, twist]) => twist > 0));
});

test('legacy surfaces receive only absent roundness/relief defaults and retain strict validation', () => {
  const legacy = createProject();
  delete legacy.layers[0].params.roundness; delete legacy.layers[0].params.relief;
  const before = clone(legacy);
  const normalized = validateProject(legacy);
  assert.deepEqual(legacy, before);
  assert.equal(normalized.layers[0].params.roundness, 0.6);
  assert.equal(normalized.layers[0].params.relief, 0.55);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(normalized))), normalized);
  const authored = clone(legacy); authored.layers[0].params.roundness = 0; authored.layers[0].params.relief = 1;
  const restored = validateProject(authored);
  assert.equal(restored.layers[0].params.roundness, 0); assert.equal(restored.layers[0].params.relief, 1);
  delete authored.layers[0].params.warp;
  assert.throws(() => validateProject(authored), /params.warp/, 'Legacy normalization must not repair old missing parameters');
  const unknown = clone(legacy); unknown.layers[0].params.cornerAlgorithm = 1;
  assert.throws(() => validateProject(unknown), /not supported/);
});

test('surface shape and relief controls clamp modulation, reject corruption and honor separate locks', () => {
  for (const [key, value] of [['roundness', -0.01], ['roundness', 1.01], ['relief', -0.01], ['relief', 1.01], ['roundness', NaN], ['relief', Infinity]] as const) {
    const project = createProject(); project.layers[0].params[key] = value;
    assert.throws(() => validateProject(project), new RegExp(`params.${key}`));
  }
  const corrupt = createProject(); (corrupt.layers[0].params as Record<string, unknown>).roundness = undefined;
  assert.throws(() => validateProject(corrupt), /params.roundness/);
  const layer = createLayer('surface'); layer.params.roundness = 0.9; layer.params.relief = 0.85;
  layer.modulations = { roundness: modulation('sine'), relief: modulation('sine') };
  const project = createProject(); project.layers = [layer]; assert.doesNotThrow(() => validateProject(project));
  const peak = evaluateLayer(layer, Math.PI / 2); const trough = evaluateLayer(layer, Math.PI * 1.5);
  assert.equal(peak.params.roundness, 1); assert.equal(peak.params.relief, 1);
  close(trough.params.roundness, 0.4); close(trough.params.relief, 0.35);
  const shapeLocked = varyLayer(layer, 0.8, { palette: true, structure: true, motion: true, material: false });
  assert.equal(shapeLocked.params.roundness, layer.params.roundness); assert.equal(shapeLocked.params.relief, layer.params.relief, 'Animated baselines stay with their routes');
  const materialLocked = varyLayer(layer, 0.8, { palette: true, structure: false, motion: true, material: true });
  assert.equal(materialLocked.params.roundness, layer.params.roundness); assert.equal(materialLocked.params.relief, layer.params.relief);
  const unanimated = { ...layer, modulations: {} };
  assert.notEqual(varyLayer(unanimated, .8, {palette:true,structure:true,motion:true,material:false}).params.relief, layer.params.relief);
  assert.notEqual(varyLayer(unanimated, .8, {palette:true,structure:false,motion:true,material:true}).params.roundness, layer.params.roundness);
  const surfacePresets = PRESETS.filter((preset) => preset.kind === 'surface');
  assert.ok(new Set(surfacePresets.map((preset) => preset.params.roundness)).size > 2);
  assert.ok(new Set(surfacePresets.map((preset) => preset.params.relief)).size > 2);
});

test('fractal defaults and all family variants roundtrip alongside existing layer kinds', () => {
  const layer = createLayer('fractal');
  assert.equal(layer.name, 'Prismatic Fractal');
  assert.equal(layer.params.seed, 1729);
  assert.deepEqual(layer.palette, PRESETS.find((preset) => preset.id === 'prismatic-fold')!.palette);
  assert.deepEqual(parameterDefinitions('fractal').map((definition) => definition.key).sort(), [
    'style', 'scale', 'detail', 'fold', 'symmetry', 'twist', 'morph', 'travel', 'cycles',
    'offset', 'relief', 'glow', 'contrast', 'cameraYaw', 'cameraPitch', 'zoom',
    'variant', 'quality', 'density', 'juliaReal', 'juliaImag', 'trap', 'boxScale', 'boxRadius', 'radial', 'roughness', 'lightAngle', 'exposure', 'lineWidth',
    'colorMode', 'colorSteps', 'colorMix', 'saturation', 'hue', 'zoomFlight', 'approach', 'outside',...FINISH_KEYS,
  ].sort());
  assert.equal(layer.params.quality, 2);
  assert.equal(layer.params.morph, 0.1);
  assert.deepEqual(parameterDefinitions('fractal').filter((definition) => definition.step === 1).map((definition) => definition.key).sort(), ['colorMode', 'colorSteps', 'cycles', 'echoBlend', 'quality', 'radial', 'slitBlocks', 'slitScroll', 'slitShape', 'slitSlices', 'slitSpan', 'style', 'symmetry', 'toonBands', 'toonCycles', 'toonOutlineColor', 'variant']);
  const presets = PRESETS.filter((preset) => preset.kind === 'fractal');
  assert.equal(presets.length, 11);
  assert.equal(new Set(presets.map((preset) => preset.id)).size, 11);
  for (const family of [0, 1, 2]) assert.deepEqual([...new Set(presets.filter((preset) => preset.params.style === family).map((preset) => preset.params.variant))].sort(), [0, 1, 2]);
  const project = createProject();
  const before = clone(project.layers[0]);
  project.layers.push(createLayer('sculpture'), layer, createLayer('image'));
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))), project);
  assert.deepEqual(project.layers[0], before, 'Adding a Fractal must not alter an existing Surface');
  assert.equal(createProject().layers[0].kind, 'surface', 'The default project remains the established Surface');
  for (const seed of [0, 0xffffffff]) {
    layer.params.seed = seed;
    for (const preset of presets) {
      const applied = applyPreset(layer, preset.id);
      assert.equal(applied.params.seed, seed, 'A preset preserves the saved Fractal identity');
      const saved = createProject(); saved.layers = [applied];
      assert.deepEqual(validateProject(JSON.parse(JSON.stringify(saved))), saved);
    }
  }
  assert.throws(() => applyPreset(layer, 'acid-tide'), /requires a surface layer/);
  assert.throws(() => applyPreset(createLayer('surface'), 'prismatic-fold'), /requires a fractal layer/);
});

test('fractal saves reject missing original controls, invalid ranges, fractional algorithms and seed corruption', () => {
  const project = createProject(); project.layers = [createLayer('fractal')];
  const saved = clone(project);
  for (const [key, value] of [
    ['style', -1], ['style', 3], ['style', 0.5], ['symmetry', 2], ['symmetry', 13], ['symmetry', 6.5],
    ['cycles', 0], ['cycles', 9], ['cycles', 1.5], ['scale', 0.49], ['scale', 5.01],
    ['twist', -1.01], ['twist', 1.01], ['cameraPitch', -1.11], ['cameraPitch', 1.11],
    ['cameraYaw', -Math.PI - 0.01], ['cameraYaw', Math.PI + 0.01], ['zoom', 0.49], ['zoom', 2.01],
    ['detail', NaN], ['morph', Infinity], ['travel', -0.01], ['relief', 1.01], ['glow', 1.01],
    ['offset', -0.01], ['contrast', 1.01], ['fold', -0.01],
    ['variant', 3], ['variant', 0.5], ['quality', -1], ['quality', 1.5], ['quality', 3],
    ['density', 0.24], ['density', 3.01], ['juliaReal', -1.21], ['juliaReal', 0.41], ['juliaImag', -0.81], ['juliaImag', 0.81],
    ['boxScale', 1.44], ['boxScale', 2.81], ['boxRadius', 0.19], ['boxRadius', 0.81], ['radial', -0.01], ['radial', 0.5], ['radial', 1.01],
    ['roughness', 0.04], ['roughness', 1.01], ['exposure', 0.24], ['exposure', 2.01], ['lineWidth', 0.24], ['lineWidth', 2.01],
    ['trap', NaN], ['density', Infinity], ['lightAngle', -Math.PI - 0.01], ['lightAngle', Math.PI + 0.01],
    ['seed', -1], ['seed', 0x100000000], ['seed', 0.5],
  ] as const) {
    const invalid = clone(project); invalid.layers[0].params[key] = value;
    assert.throws(() => validateProject(invalid), new RegExp(`params.${key}`));
  }
  for (const definition of parameterDefinitions('fractal')) {
    const missing = clone(project); delete missing.layers[0].params[definition.key];
    if ([...FRACTAL_V5_FIELDS, ...(V6_FIELDS.fractal ?? []),...FINISH_KEYS,'zoomFlight','approach','outside'].includes(definition.key)) assert.equal(validateProject(missing).layers[0].params[definition.key], definition.default);
    else assert.throws(() => validateProject(missing), new RegExp(`params.${definition.key}`), 'Only additive fields may receive legacy defaults');
    for (const boundary of [definition.min, definition.max]) {
      const valid = clone(project); valid.layers[0].params[definition.key] = boundary;
      assert.equal(validateProject(valid).layers[0].params[definition.key], boundary);
    }
  }
  for (const key of ['style', 'variant', 'quality', 'radial', 'symmetry', 'cycles', 'colorMode', 'colorSteps', 'seed']) {
    const invalid = clone(project); invalid.layers[0].modulations[key] = modulation('sine');
    assert.throws(() => validateProject(invalid), /modulations.*not supported/, 'Discrete Fractal controls cannot acquire discontinuous modulation');
  }
  const unknown = clone(project); unknown.layers[0].params.iterations = 60;
  assert.throws(() => validateProject(unknown), /params.iterations.*not supported/);
  assert.deepEqual(project, saved);
});

test('fractal continuous controls modulate cyclically, clamp at bounds and preserve locked motion', () => {
  const layer = createLayer('fractal');
  const continuous = parameterDefinitions('fractal').filter((definition) => definition.step !== 1);
  for (const definition of continuous) {
    layer.params[definition.key] = (definition.min + definition.max) / 2;
    layer.modulations[definition.key] = modulation('sine');
  }
  const before = clone(layer);
  const project = createProject(); project.layers = [layer];
  assert.doesNotThrow(() => validateProject(project));
  const peak = evaluateLayer(layer, Math.PI / 2); const trough = evaluateLayer(layer, Math.PI * 1.5);
  for (const definition of continuous) {
    close(peak.params[definition.key], definition.max);
    close(trough.params[definition.key], definition.min);
  }
  assert.deepEqual(evaluateLayer(layer, 0.71), evaluateLayer(layer, 0.71 + TAU));
  assert.deepEqual(layer, before);

  const authored = applyPreset(createLayer('fractal'), 'velvet-julia');
  authored.modulations['transform.x'] = modulation('noise', { cycles: 3, amount: 0.2, phase: 0.17 });
  const motionLocked = varyLayer(authored, 0.9, { palette: false, structure: false, motion: true, material: false });
  assert.equal(motionLocked.params.seed, authored.params.seed);
  assert.notEqual(motionLocked.params.fold, authored.params.fold);
  assert.notEqual(motionLocked.params.relief, authored.params.relief);
  for (const definition of parameterDefinitions('fractal').filter((definition) => definition.section === 'Motion')) {
    assert.equal(motionLocked.params[definition.key], authored.params[definition.key]);
  }
  for (const phase of [0, 0.19, 1.7, 4.2, TAU]) {
    assert.equal(evaluateLayer(motionLocked, phase).transform.x, evaluateLayer(authored, phase).transform.x);
  }
  const unlocked = varyLayer(authored, 1, { palette: false, structure: false, motion: false, material: false });
  assert.deepEqual(unlocked, varyLayer(authored, 1, { palette: false, structure: false, motion: false, material: false }));
  assert.notEqual(unlocked.params.seed, authored.params.seed);
  const restored = createProject(); restored.layers = [unlocked];
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(restored))), restored);
});

test('v0.4 Fractal compositions gain only absent controls without changing authored artwork or routes', () => {
  const legacy = createProject(); legacy.layers = [applyPreset(createLayer('fractal'), 'velvet-julia')];
  for (const key of FRACTAL_V5_FIELDS) delete legacy.layers[0].params[key];
  legacy.layers[0].params.morph = 0.35;
  legacy.layers[0].params.seed = 0;
  legacy.layers[0].modulations.fold = modulation('noise', { cycles: 3, phase: 0.2, amount: 0.1 });
  const source = clone(legacy), restored = validateProject(legacy);
  assert.deepEqual(legacy, source, 'Legacy migration cannot mutate a parsed document');
  const expected = clone(source);
  for (const definition of parameterDefinitions('fractal').filter(definition => FRACTAL_V5_FIELDS.includes(definition.key))) expected.layers[0].params[definition.key] = definition.default;
  assert.deepEqual(restored, expected);
  assert.equal(restored.layers[0].params.morph, 0.35, 'A new default cannot overwrite an authored old control');
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(restored))), restored);
  for (const key of FRACTAL_V5_FIELDS) {
    for (const value of [undefined, NaN, Infinity]) {
      const corrupt = clone(source); (corrupt.layers[0].params as Record<string, unknown>)[key] = value;
      assert.throws(() => validateProject(corrupt), new RegExp(`params.${key}`), 'Explicit corruption cannot acquire a legacy default');
    }
  }
  const authored = clone(source); authored.layers[0].params.variant = 2; authored.layers[0].params.quality = 0; authored.layers[0].params.juliaImag = 0;
  const loaded = validateProject(authored);
  assert.equal(loaded.layers[0].params.variant, 2); assert.equal(loaded.layers[0].params.quality, 0); assert.equal(loaded.layers[0].params.juliaImag, 0);
  const incomplete = clone(source); delete incomplete.layers[0].params.fold;
  assert.throws(() => validateProject(incomplete), /params.fold/);
});

test('family inspectors reveal relevant controls while saved hidden values remain intact', () => {
  const layer = createLayer('fractal');
  const keys = () => visibleParameterDefinitions(layer).map(definition => definition.key);
  assert.ok(keys().includes('lineWidth')); assert.ok(keys().includes('symmetry'));
  assert.ok(!keys().includes('juliaReal')); assert.ok(!keys().includes('boxScale'));
  layer.params.style = 1;
  assert.ok(keys().includes('juliaReal')); assert.ok(keys().includes('juliaImag')); assert.ok(keys().includes('trap'));
  assert.ok(!keys().includes('boxScale')); assert.ok(!keys().includes('roughness')); assert.ok(!keys().includes('symmetry'));
  layer.params.variant = 1;
  assert.ok(keys().includes('symmetry'), 'Julia radial mode exposes its symmetry count');
  layer.params.style = 2;
  assert.ok(keys().includes('boxScale')); assert.ok(keys().includes('boxRadius')); assert.ok(keys().includes('roughness')); assert.ok(keys().includes('lightAngle'));
  assert.ok(!keys().includes('lineWidth')); assert.ok(!keys().includes('trap')); assert.ok(!keys().includes('juliaReal')); assert.ok(!keys().includes('symmetry'));
  layer.params.radial = 1;
  assert.ok(keys().includes('symmetry'), 'Mandelbox symmetry appears only when radial fold is enabled');
  const project = createProject(); project.layers = [layer];
  assert.deepEqual(validateProject(project).layers[0].params, layer.params, 'Visibility never deletes saved controls');
});

test('variations retain render quality and make small Julia constant changes around the selected variant', () => {
  const layer = applyPreset(createLayer('fractal'), 'velvet-julia');
  layer.params.quality = 0;
  let varied = layer;
  for (let count = 0; count < 12; count++) {
    const next = varyLayer(varied, 0.35, { palette: false, structure: false, material: false, motion: false });
    assert.equal(next.params.quality, 0, 'New variation cannot silently change render quality');
    assert.equal(next.params.style, 1); assert.equal(next.params.variant, 0);
    assert.ok(Math.abs(next.params.juliaReal - varied.params.juliaReal) < 0.002);
    assert.ok(Math.abs(next.params.juliaImag - varied.params.juliaImag) < 0.002);
    varied = next;
  }
});

test('mixed schema-1 compositions migrate older instruments without repairing or mutating Fractals', () => {
  const project = createProject();
  const surface = project.layers[0];
  delete surface.params.roundness; delete surface.params.relief;
  const sculpture = createLayer('sculpture');
  delete sculpture.params.opening; delete sculpture.params.twist;
  const fractal = applyPreset(createLayer('fractal'), 'velvet-julia');
  fractal.params.seed = 0; fractal.params.morph = 0; fractal.params.glow = 0;
  fractal.modulations.fold = modulation('keyframes', {
    cycles: 2, phase: 0.19, amount: 0.35,
    points: [{ time: 0, value: -0.4 }, { time: 0.27, value: 0.8 }, { time: 0.73, value: -0.2 }],
  });
  project.layers.push(sculpture, fractal, createLayer('image'));
  const source = clone(project);
  const loaded = validateProject(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(project, source);
  assert.equal(loaded.schemaVersion, 1);
  assert.equal(loaded.layers[0].params.roundness, 0.6);
  assert.equal(loaded.layers[0].params.relief, 0.55);
  assert.equal(loaded.layers[1].params.opening, 0.55);
  assert.equal(loaded.layers[1].params.twist, 0.3);
  assert.deepEqual(loaded.layers[2], fractal, 'A current Fractal retains authored zeroes and keyframes exactly');
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(loaded))), loaded);
  for (const phase of [0, 0.23, 1.8, 5.6, TAU]) {
    assert.deepEqual(evaluateLayer(loaded.layers[2], phase), evaluateLayer(fractal, phase));
  }
  const incomplete = clone(project); delete incomplete.layers[2].params.fold;
  assert.throws(() => validateProject(incomplete), /layers\[2\].params.fold/);
  const corrupt = clone(project); (corrupt.layers[2].params as Record<string, unknown>).glow = undefined;
  assert.throws(() => validateProject(corrupt), /layers\[2\].params.glow/);
  loaded.layers[2].params.fold = 0;
  loaded.layers[2].palette[0] = '#ffffff';
  loaded.layers[2].modulations.fold.points[0].value = 1;
  assert.deepEqual(project, source, 'Editing the loaded composition cannot mutate the parsed document');
});

test('v0.5 compositions gain only absent v0.6 controls across all four instruments', () => {
  const expected = createProject();
  expected.layers.push(createLayer('sculpture'), applyPreset(createLayer('fractal'), 'velvet-julia'), createLayer('image'));
  expected.layers[0].params.warp = 0.123456789;
  expected.layers[0].modulations.warp = modulation('noise', { cycles: 3, phase: 0.21, amount: 0.27 });
  expected.layers[1].params.opening = 0;
  expected.layers[1].modulations.twist = modulation('keyframes', { amount: 0.31, points: [{ time: 0, value: -0.5 }, { time: 0.41, value: 0.7 }] });
  expected.layers[2].params.exposure = 0.73;
  expected.layers[2].params.juliaReal = -0.74499123;
  expected.layers[2].modulations.exposure = modulation('sine', { amount: 0.13, cycles: 2 });
  expected.layers[3].image = { name: 'Embedded.png', dataUrl: PNG, width: 1, height: 1, fit: 'cover' };
  expected.layers[3].mask = { kind: 'image', dataUrl: PNG, size: 0.7, softness: 0.13, invert: true };
  expected.layers[3].modulations['transform.rotation'] = modulation('noise', { amount: 0.2, phase: 0.33 });
  const legacy = clone(expected);
  for (const layer of legacy.layers) for (const key of (V6_FIELDS[layer.kind] ?? [])) delete layer.params[key];
  const source = clone(legacy), loaded = validateProject(legacy);
  assert.deepEqual(legacy, source, 'Normalizing cannot mutate the original parsed document');
  assert.deepEqual(loaded, expected, 'All original values, routes, assets and masks must remain exact');
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(loaded))), expected);
  for (const phase of [0, 0.71, 2.1, 5.9]) {
    for (let index = 0; index < loaded.layers.length; index++) assert.deepEqual(evaluateLayer(loaded.layers[index], phase), evaluateLayer(expected.layers[index], phase));
  }
  loaded.layers[3].image!.name = 'Changed.png';
  loaded.layers[0].modulations.warp.phase = 0;
  assert.deepEqual(legacy, source, 'Loaded nested assets and routes cannot alias the parsed source');
  for (const [index, original] of ['warp', 'fold', 'detail', 'seed'].entries()) {
    const missing = clone(legacy); delete missing.layers[index].params[original];
    assert.throws(() => validateProject(missing), new RegExp(`params.${original}`), 'New migration cannot repair missing original fields');
  }
});

test('new instrument controls preserve authored boundaries and reject explicit corruption', () => {
  for (const kind of ['surface', 'sculpture', 'fractal', 'image'] as const) {
    const base = createProject(); base.layers = [createLayer(kind)];
    for (const key of (V6_FIELDS[kind] ?? [])) {
      const definition = parameterDefinitions(kind).find(item => item.key === key)!;
      for (const value of [definition.min, definition.max]) {
        const authored = clone(base);
        for (const absent of (V6_FIELDS[kind] ?? [])) delete authored.layers[0].params[absent];
        authored.layers[0].params[key] = value;
        assert.equal(validateProject(authored).layers[0].params[key], value, `${kind}.${key} authored boundary cannot be overwritten`);
      }
      const corruptValues: unknown[] = [undefined, null, NaN, Infinity, String(definition.default), definition.min - 0.01, definition.max + 0.01];
      if (definition.step === 1) corruptValues.push(definition.min + 0.5);
      for (const value of corruptValues) {
        const corrupt = clone(base); (corrupt.layers[0].params as Record<string, unknown>)[key] = value;
        assert.throws(() => validateProject(corrupt), new RegExp(`params.${key}`), `${kind}.${key} must reject explicit corruption`);
      }
      if (definition.step === 1) {
        const discrete = clone(base); discrete.layers[0].modulations[key] = modulation('sine');
        assert.throws(() => validateProject(discrete), /modulations.*not supported/, `${kind}.${key} cannot receive a discontinuous route`);
      }
    }
  }
});

test('new continuous controls animate cyclically within bounds and obey independent variation locks', () => {
  for (const kind of ['surface', 'sculpture', 'fractal', 'image'] as const) {
    const layer = createLayer(kind);
    const definitions = parameterDefinitions(kind).filter(definition => (V6_FIELDS[kind] ?? []).includes(definition.key) && definition.step !== 1);
    for (const definition of definitions) {
      layer.params[definition.key] = (definition.min + definition.max) / 2;
      layer.modulations[definition.key] = modulation('sine');
    }
    const project = createProject(); project.layers = [layer];
    assert.deepEqual(validateProject(project), project);
    const peak = evaluateLayer(layer, Math.PI / 2), trough = evaluateLayer(layer, Math.PI * 1.5);
    for (const definition of definitions) {
      close(peak.params[definition.key], definition.max);
      close(trough.params[definition.key], definition.min);
    }
    assert.deepEqual(evaluateLayer(layer, 0.73), evaluateLayer(layer, 0.73 + TAU));
    const original = clone(layer);
    for (const locks of [
      { palette: true, structure: true, material: false, motion: true },
      { palette: true, structure: false, material: true, motion: true },
    ]) {
      const varied = varyLayer(layer, 0.35, locks);
      for (const definition of definitions) {
        const locked = definition.section === 'Material' ? locks.material : locks.structure;
        if (locked) assert.equal(varied.params[definition.key], original.params[definition.key]);
      }
      assert.deepEqual(varied.modulations, original.modulations);
      if (kind === 'fractal') assert.equal(varied.params.quality, original.params.quality);
    }
    assert.deepEqual(layer, original);
  }
});

test('Fractal contour controls appear only for contour coloring without deleting hidden values', () => {
  const layer = createLayer('fractal'); layer.params.colorSteps = 9;
  assert.ok(!visibleParameterDefinitions(layer).some(definition => definition.key === 'colorSteps'));
  assert.ok(!visibleParameterDefinitions(layer).some(definition => definition.key === 'colorMix'));
  layer.params.colorMode = 2;
  assert.ok(visibleParameterDefinitions(layer).some(definition => definition.key === 'colorSteps'));
  assert.ok(visibleParameterDefinitions(layer).some(definition => definition.key === 'colorMix'));
  layer.params.colorMode = 1;
  assert.ok(!visibleParameterDefinitions(layer).some(definition => definition.key === 'colorSteps'));
  assert.ok(visibleParameterDefinitions(layer).some(definition => definition.key === 'colorMix'));
  assert.equal(layer.params.colorSteps, 9);
  const varied = varyLayer(layer, 0.35, { palette: false, structure: false, material: false, motion: false });
  assert.equal(varied.params.colorMode, 1, 'Gentle variations retain the chosen coloring algorithm');
});

test('the curated library covers every Surface pattern, four Sculpture forms and three Fractal colorings', () => {
  assert.equal(PRESETS.filter(p => p.kind !== 'graphic').length, 59);
  assert.equal(new Set(PRESETS.map(preset => preset.id)).size, PRESETS.length);
  const surfaces = PRESETS.filter(preset => preset.kind === 'surface');
  assert.equal(surfaces.length, 15);
  assert.deepEqual([...new Set(surfaces.map(preset => preset.params.style))].sort(), [0, 1, 2, 3]);
  const sculptures = PRESETS.filter(preset => preset.kind === 'sculpture');
  assert.equal(sculptures.length, 5);
  assert.deepEqual(sculptures.reduce((counts, preset) => { counts[preset.params.form]++; return counts; }, [0, 0, 0, 0]), [1, 2, 1, 1]);
  assert.deepEqual([...new Set(PRESETS.filter(preset => preset.kind === 'fractal').map(preset => preset.params.colorMode))].sort(), [0, 1, 2]);
  for (const kind of ['surface', 'sculpture', 'fractal'] as const) {
    const layer = applyPreset(createLayer(kind), PRESETS.find(preset => preset.kind === kind && (preset.params.variant > 0 || preset.params.form > 0 || preset.params.colorMode > 0))!.id);
    const varied = varyLayer(layer, 0.35, { palette: false, structure: false, material: false, motion: false });
    for (const key of ['style', 'variant', 'form', 'colorMode']) if (key in layer.params) assert.equal(varied.params[key], layer.params[key], 'A gentle variation retains the chosen discrete form and coloring');
  }
});

test('palette locks retain both swatches and color grading while exposure follows the material lock', () => {
  for (const kind of ['surface', 'sculpture', 'fractal', 'image'] as const) {
    const layer = createLayer(kind);
    layer.params.hue = 0.47; layer.params.saturation = 1.3; layer.params.exposure = 1;
    const paletteLocked = varyLayer(layer, 0.8, { palette: true, structure: true, material: false, motion: true });
    assert.deepEqual(paletteLocked.palette, layer.palette);
    assert.equal(paletteLocked.params.hue, layer.params.hue);
    assert.equal(paletteLocked.params.saturation, layer.params.saturation);
    assert.notEqual(paletteLocked.params.exposure, layer.params.exposure, 'Unlocked material still changes exposure');
    const unlocked = varyLayer(layer, 0.8, { palette: false, structure: true, material: false, motion: true });
    assert.notEqual(unlocked.params.hue, layer.params.hue);
    assert.notEqual(unlocked.params.saturation, layer.params.saturation);
    const materialLocked = varyLayer(layer, 0.8, { palette: false, structure: true, material: true, motion: true });
    assert.equal(materialLocked.params.hue, layer.params.hue);
    assert.equal(materialLocked.params.saturation, layer.params.saturation);
    assert.equal(materialLocked.params.exposure, layer.params.exposure);
  }
});
