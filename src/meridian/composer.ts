import { createRandom } from './random';
import { euclid } from './rhythm';
import { MERIDIAN_SCHEMES } from './schemes';
import { AXIS, COLLAPSE_STYLES, type ElementGroup, type FormKind, type Score, type ScoreElement, type ScoreForm } from './types';

export type ComposeParams = Readonly<Record<string, number>>;

type Random = () => number;
type ZoneRole = 'scale' | 'orbit' | 'lattice' | 'void';

const TAU = Math.PI * 2;
const DEGREE = Math.PI / 180;
const CANDIDATES = 8;
const DEFAULT_OUTER = 0.46;
const HUB_RADIUS = 0.022;
const INNER_LIMIT = 0.06;
const RING_GAP_LIMIT = 0.015;
const RING_GAP_TARGET = 0.02;
const SPOKE_GAP_LIMIT = 1.5 * DEGREE;
const TWIN_GAP = 1.1 * DEGREE;
const RHYTHM_STEPS = 16;
const MAX_NODES = 1500;
const MAX_SYSTEM_RINGS = 28;
const MAX_TICKS_PER_SCALE = 180;

const RATIO_SET = [1.25, 4 / 3, Math.SQRT2, 1.5, (1 + Math.sqrt(5)) / 2];
const AUTO_SYMMETRY = [3, 4, 5, 6, 6, 8, 8, 12];
const LINE = { hair: 1, fine: 1.6 } as const;
// A long Peak and a short Rest: the phrase spends its time lit.
const STATE_SHARES = [0.035, 0.15, 0.2, 0.1, 0.27, 0.165, 0.08];
/** Parameter that stretches each state's share. Seed has none: it is always the brief opening point. */
const STATE_KEYS = [null, 'scoreDraw', 'scoreBuild', 'scoreCharge', 'scorePeak', 'scoreCollapse', 'scoreRest'] as const;
const INTERIOR_STEPS = [0.382, 0.618, 0.236, 0.764];
const BAND_DUTIES = [0.38, 0.55, 0.72, 0.9];
const BAND_THICKNESS = [0.16, 0.26, 0.42, 0.6];
const RAYS = 72;
const RAY_REACH = 0.62;
const FIELD_HALF_WIDTH = 1.0;
const FIELD_HALF_HEIGHT = 0.6;
const SPIRAL_START = 0.05;
const COLLAPSE_ANGLES = [0, 0, Math.PI / 2, Math.PI / 4, -Math.PI / 4, Math.PI / 6];
/** The schemes a seed may choose. Silver stays a deliberate choice, and no single hue dominates. */
const SEED_SCHEMES = MERIDIAN_SCHEMES.flatMap((scheme, i) => (scheme.name === 'Silver' ? [] : [i + 1]));
/** Consecutive seeds walk through every silhouette. */
const FORM_ORDER: readonly FormKind[] = ['field', 'bleed', 'edge', 'core', 'twin', 'spiral', 'horizon', 'cathedral'];
interface FormPlan { outer: readonly [number, number]; place: readonly [number, number]; zones: number; rings: number; bands: number; hero: number; square: number; turns: boolean }
const FORM_PLANS: Readonly<Record<FormKind, FormPlan>> = {
  bleed: { outer: [1.12, 1.34], place: [0.14, 0.07], zones: 2, rings: 2.6, bands: 3, hero: 2.4, square: 0, turns: false },
  edge: { outer: [1.5, 1.8], place: [0.95, 0.42], zones: 2, rings: 2.6, bands: 3, hero: 3, square: 0, turns: true },
  core: { outer: [0.3, 0.38], place: [0.06, 0.03], zones: 1, rings: 1.6, bands: 2, hero: 1.2, square: 0, turns: false },
  field: { outer: [0.42, 0.56], place: [0.42, 0.12], zones: 0, rings: 1, bands: 2, hero: 1.5, square: 0, turns: false },
  twin: { outer: [0.5, 0.62], place: [0.5, 0.06], zones: 0, rings: 1.1, bands: 2, hero: 1.5, square: 0, turns: false },
  horizon: { outer: [1.15, 1.4], place: [0.22, 0.76], zones: 2, rings: 2.4, bands: 3, hero: 2.6, square: 0, turns: false },
  spiral: { outer: [0.95, 1.2], place: [0.16, 0.05], zones: 1, rings: 1.2, bands: 1, hero: 1.6, square: 0, turns: true },
  cathedral: { outer: [0.72, 0.98], place: [0, 0], zones: 2, rings: 2, bands: 3, hero: 1.6, square: 0.9, turns: false },
};
const ROLE_PLANS: readonly (readonly ZoneRole[])[] = [
  ['scale', 'void', 'lattice', 'orbit'],
  ['orbit', 'scale', 'void', 'lattice'],
  ['lattice', 'void', 'scale', 'orbit'],
  ['scale', 'orbit', 'void', 'lattice'],
  ['void', 'lattice', 'scale', 'orbit'],
  ['orbit', 'lattice', 'void', 'scale'],
];

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const finite = (value: number | undefined, fallback: number) => (Number.isFinite(value) ? (value as number) : fallback);
const count = (value: number | undefined, fallback: number, low: number, high: number) => clamp(Math.round(finite(value, fallback)), low, high);
const pick = <T>(random: Random, items: readonly T[]): T => items[Math.floor(random() * items.length)];
const wrap = (angle: number) => ((angle % TAU) + TAU) % TAU;
const between = (inner: number, outer: number, share: number) => inner * (outer / inner) ** share;

/** A repeatable hash of the seed, so a composition's form, collapse and colour do not depend on which candidate wins. */
function seedHash(seed: number, salt: number): number {
  let hash = Math.imul((seed >>> 0) ^ salt, 0x9e3779b1);
  hash = Math.imul(hash ^ (hash >>> 15), 0x85ebca6b);
  return (hash ^ (hash >>> 13)) >>> 0;
}

function chooseForm(seed: number, random: Random): ScoreForm {
  const kind = FORM_ORDER[(seed >>> 0) % FORM_ORDER.length];
  const plan = FORM_PLANS[kind];
  const sideX = random() < 0.5 ? -1 : 1;
  const sideY = random() < 0.5 ? -1 : 1;
  const [placeX, placeY] = plan.place;
  const scheme = SEED_SCHEMES[seedHash(seed, 0x51ed27) % SEED_SCHEMES.length];
  const options = SEED_SCHEMES.filter((other) => other !== scheme);
  return {
    kind, outer: plan.outer[0] + random() * (plan.outer[1] - plan.outer[0]),
    turn: plan.turns ? random() * TAU : 0,
    centreX: sideX * placeX * (0.85 + random() * 0.3), centreY: (kind === 'horizon' ? -1 : sideY) * placeY * (0.9 + random() * 0.2),
    twinX: -sideX * 0.54, twinY: -sideY * 0.1, square: plan.square,
    collapse: COLLAPSE_STYLES[seedHash(seed, 0x2f6e2b) % COLLAPSE_STYLES.length],
    collapseAngle: COLLAPSE_ANGLES[seedHash(seed, 0x1b873593) % COLLAPSE_ANGLES.length],
    scheme, peakScheme: options[seedHash(seed, 0x7a3d11) % options.length],
  };
}

/**
 * Element fields by group. `radius` is a fraction of frame height, angles are radians.
 * ring, hero, hub: `length` is the full turn. arc, band: `angle` starts a sweep of `length` radians.
 * band: `weight` is its thickness in frame heights. tick, spoke: `radius` is the inner end and `length` the radial extent.
 * node: `length` is the mark size.
 * `colour`: 0 base, 1 primary accent, 2 secondary accent. Symmetric copies share a `slot`, so they land together.
 */
function composeCandidate(seed: number, random: Random, params: ComposeParams): Score {
  // Symmetry order. Zero or missing lets the seed choose.
  const requested = Math.round(finite(params.symmetry, 0));
  const symmetry = requested >= 1 ? Math.min(requested, 24) : pick(random, AUTO_SYMMETRY);
  const sector = TAU / symmetry;
  const form = chooseForm(seed, random);
  const plan = FORM_PLANS[form.kind];
  const axis = wrap(AXIS + form.turn);

  // Phrase timing and rhythm.
  const shares = STATE_SHARES.map((share, i) => {
    const key = STATE_KEYS[i];
    return share * (0.85 + random() * 0.3) * (key ? clamp(finite(params[key], 1), 0.1, 4) : 1);
  });
  const total = shares.reduce((sum, share) => sum + share, 0);
  let running = 0;
  const stateEnds = shares.map((share, i) => (i === shares.length - 1 ? 1 : (running += share / total)));
  const rhythm = {
    ring: euclid(pick(random, [3, 5, 7]), RHYTHM_STEPS, Math.floor(random() * RHYTHM_STEPS)),
    spoke: euclid(pick(random, [4, 5, 6]), RHYTHM_STEPS, Math.floor(random() * RHYTHM_STEPS)),
    node: euclid(pick(random, [7, 9, 11, 13]), RHYTHM_STEPS, Math.floor(random() * RHYTHM_STEPS)),
  };
  const [seedEnd, drawEnd, buildEnd, chargeEnd, , collapseEnd] = stateEnds;
  const collapseStart = stateEnds[4];
  const onHit = (pattern: readonly boolean[], slot: number, start: number, end: number) => {
    const hits = pattern.flatMap((hit, step) => (hit ? [step] : []));
    const step = hits.length ? hits[slot % hits.length] : 0;
    return start + ((end - start) * step) / pattern.length;
  };
  const enterFor: Record<ElementGroup, (slot: number) => number> = {
    hub: () => 0,
    ring: (slot) => onHit(rhythm.ring, slot, seedEnd, drawEnd),
    spoke: (slot) => onHit(rhythm.spoke, slot, seedEnd, drawEnd),
    arc: (slot) => onHit(rhythm.ring, slot, drawEnd, buildEnd),
    band: (slot) => onHit(rhythm.spoke, slot, seedEnd + (drawEnd - seedEnd) * 0.5, buildEnd),
    tick: (slot) => onHit(rhythm.node, slot, drawEnd, buildEnd),
    node: (slot) => onHit(rhythm.node, slot, (drawEnd + buildEnd) / 2, buildEnd),
    hero: () => chargeEnd,
  };

  const elements: ScoreElement[] = [];
  let origin: 0 | 1 = 0;
  const add = (group: ElementGroup, zone: number, radius: number, angle: number, length: number, weight: number, colour: number, slot: number, shape: ScoreElement['shape'] = 'dot', extra: Pick<ScoreElement, 'reserve' | 'fixed'> = {}) => {
    // Collapse runs outside-in, a spoke going with its outer end. The hub survives Rest as the point that becomes the next Seed.
    const exit = group === 'hub' ? 1 : collapseStart + (collapseEnd - collapseStart) * 0.42 * (1 - clamp((group === 'spoke' ? radius + length : radius) / form.outer, 0, 1));
    elements.push({ group, zone, radius, angle: wrap(angle), length, weight, colour, enter: enterFor[group](slot), exit, slot, shape, ...(origin ? { origin } : {}), ...extra });
  };

  let arcSlot = 0;
  let tickSlot = 1;
  let nodeSlot = 0;
  let nodes = 0;
  const density = clamp(finite(params.nodeDensity, 0.5), 0, 1);
  const squareShare = clamp(finite(params.latticeType, 0.35), 0, 1);

  /** One concentric system: zones on a ratio, then rings, bands, scales, orbits, lattices and spokes. */
  const buildSystem = (outerRadius: number, primary: boolean) => {
    const zones = count(count(params.zones, 4, 1, 8) + plan.zones, 4, 1, 8);
    // Always drawn, so setting Radial ratio does not change the rest of the seed's choices.
    const seededRatio = pick(random, RATIO_SET), requestedRatio = finite(params.structureRadialRatio, 0);
    const ratio = Math.min(requestedRatio > 1 ? requestedRatio : seededRatio, (outerRadius / INNER_LIMIT) ** (1 / zones));
    const edges = Array.from({ length: zones + 1 }, (_, i) => outerRadius / ratio ** i);
    const rolePlan = pick(random, ROLE_PLANS);
    const turn = Math.floor(random() * rolePlan.length);
    const roles = Array.from({ length: zones }, (_, i) => rolePlan[(i + turn) % rolePlan.length]);
    const voidZone = roles.indexOf('void');
    const heroZone = voidZone >= 0 ? voidZone : 0;
    const heroRadius = between(edges[heroZone + 1], edges[heroZone], 0.5);
    const accentZone = heroZone + 1 < zones ? heroZone + 1 : Math.max(0, heroZone - 1);

    if (primary) {
      add('hero', heroZone, heroRadius, axis, TAU, (6 + random() * 4) * plan.hero, 1, 0);
      add('hub', zones - 1, HUB_RADIUS, axis, TAU, LINE.fine, 0, 0);
      for (let i = 0; i < 4; i++) add('tick', zones - 1, HUB_RADIUS * 1.5, axis + (i * TAU) / 4, HUB_RADIUS * 1.2, LINE.hair, 0, 0); // crosshair
    }

    // Rings: zone edges first, then interior divisions of the scale zones.
    const ringBudget = Math.min(MAX_SYSTEM_RINGS, Math.round(count(params.ringCount, 7, 0, 32) * plan.rings));
    const taken = primary ? [heroRadius] : [];
    let ringSlot = 0;
    const placeRing = (radius: number, zone: number, weight: number) => {
      if (ringSlot >= ringBudget || taken.some((other) => Math.abs(other - radius) < RING_GAP_TARGET)) return;
      taken.push(radius);
      add('ring', zone, radius, axis, TAU, weight, ringSlot % 3 === 2 ? 1 : ringSlot % 5 === 3 ? 2 : 0, ringSlot++);
    };
    edges.forEach((edge, i) => placeRing(edge, Math.min(i, zones - 1), i === 0 ? LINE.fine : LINE.hair));
    roles.forEach((role, zone) => {
      if (role !== 'scale') return;
      for (const step of INTERIOR_STEPS.slice(0, 2)) placeRing(between(edges[zone + 1], edges[zone], step), zone, LINE.hair);
    });
    // A higher Ring count keeps going: the remaining divisions, then the bands that are not held empty.
    roles.forEach((role, zone) => {
      if (role === 'void') return;
      for (const step of INTERIOR_STEPS) placeRing(between(edges[zone + 1], edges[zone], step), zone, LINE.hair);
    });

    // Bands: the heavy colour that the fine instrument lines are drawn against.
    const bandZones = roles.flatMap((role, zone) => (role !== 'void' ? [zone] : []));
    for (let b = 0; b < Math.min(plan.bands, bandZones.length); b++) {
      const zone = bandZones[(b * 2 + Math.floor(random() * bandZones.length)) % bandZones.length];
      const width = edges[zone] - edges[zone + 1];
      const pieces = Math.max(1, symmetry * pick(random, [1, 1, 2]) >> (symmetry > 8 ? 1 : 0));
      const duty = pick(random, BAND_DUTIES);
      const thickness = width * pick(random, BAND_THICKNESS);
      const start = axis + random() * sector;
      for (let i = 0; i < pieces; i++) add('band', zone, between(edges[zone + 1], edges[zone], 0.5), start + (i * TAU) / pieces, (TAU / pieces) * duty, thickness, 1 + (b % 2), b);
    }

    // Zone contents.
    const addNode = (zone: number, radius: number, angle: number, slot: number, shape: ScoreElement['shape']) => {
      if (nodes >= MAX_NODES) return;
      nodes++;
      add('node', zone, radius, angle, 0.005, LINE.hair, zone === accentZone && slot % 3 === 0 ? 1 : 0, slot, shape);
    };

    roles.forEach((role, zone) => {
      const inner = edges[zone + 1];
      const outer = edges[zone];
      const width = outer - inner;
      if (role === 'void') {
        // Marks held in reserve: lowering Negative space lets them fill the quiet band.
        const perRow = symmetry * Math.max(1, Math.round(24 / symmetry));
        for (let i = 0; i < perRow; i++) add('node', zone, between(inner, outer, 0.24), axis + ((i + 0.5) * TAU) / perRow, 0.004, LINE.hair, 0, nodeSlot, 'dot', { reserve: true });
      } else if (role === 'scale') {
        const perSector = Math.max(1, Math.round(pick(random, [60, 72, 96, 120]) / symmetry));
        const ticks = Math.min(MAX_TICKS_PER_SCALE, symmetry * perSector);
        const majorEvery = Math.max(1, Math.round(ticks / (symmetry * pick(random, [1, 2, 3]))));
        const base = between(inner, outer, 0.1);
        for (let i = 0; i < ticks; i++) {
          const major = i % majorEvery === 0;
          add('tick', zone, base, axis + (i * TAU) / ticks, width * (major ? 0.34 : 0.14), major ? LINE.fine : LINE.hair, major && zone === accentZone ? 1 : 0, tickSlot + (major ? 0 : 1));
        }
        tickSlot += 2;
      } else if (role === 'orbit') {
        for (const [track, share] of [0.36, 0.68].entries()) {
          const dashes = symmetry * pick(random, track ? [1, 2] : [2, 3, 4]);
          const duty = pick(random, track ? [0.62, 0.78] : [0.3, 0.45]);
          for (let i = 0; i < dashes; i++) add('arc', zone, between(inner, outer, share), axis + (i * TAU) / dashes, (TAU / dashes) * duty, track ? LINE.fine : LINE.hair, zone === accentZone ? 1 : 0, arcSlot);
          arcSlot++;
        }
      } else if (role === 'lattice') {
        if (random() < squareShare) {
          const pitch = Math.max(width / 6, 0.05 - 0.028 * density);
          const reach = Math.ceil(outer / pitch);
          for (let x = -reach; x <= reach; x++) for (let y = -reach; y <= reach; y++) {
            const radius = Math.hypot(x, y) * pitch;
            const angle = wrap(Math.atan2(y, x));
            if (radius < inner + width * 0.12 || radius > outer - width * 0.12 || angle >= sector) continue;
            for (let copy = 0; copy < symmetry; copy++) addNode(zone, radius, axis + angle + copy * sector, nodeSlot + (Math.abs(x) + Math.abs(y)) % 4, 'square');
          }
          nodeSlot += 4;
        } else {
          const rows = 2 + Math.round(density * 3);
          const perRow = symmetry * Math.max(1, Math.round((12 + density * 36) / symmetry));
          for (let row = 0; row < rows; row++) {
            const radius = between(inner, outer, (row + 1) / (rows + 1));
            for (let i = 0; i < perRow; i++) addNode(zone, radius, axis + ((i + (row % 2) * 0.5) * TAU) / perRow, nodeSlot, 'dot');
            nodeSlot++;
          }
        }
      }
    });

    // Spokes share one set of angles per sector, so no two can nearly coincide.
    const spokeBudget = count(params.spokeCount, 12, 0, 96);
    if (spokeBudget > 0) {
      const perSector = clamp(Math.round(spokeBudget / symmetry), 1, Math.max(1, Math.floor(sector / (3.2 * DEGREE))));
      const reach = pick(random, [1, 1, 2, zones]);
      const [mainInner, mainOuter] = heroZone < zones - 1 ? [edges[Math.min(zones, heroZone + 1 + reach)], edges[heroZone + 1]]
        : heroZone > 0 ? [edges[heroZone], outerRadius] : [edges[1], heroRadius * 0.82];
      const fillZones = roles.flatMap((role, zone) => (role !== 'void' ? [zone] : []));
      const twinned = random() < 0.55;
      for (let k = 0; k < perSector; k++) {
        const offset = (k * sector) / perSector;
        for (let copy = 0; copy < symmetry; copy++) {
          const angle = axis + offset + copy * sector;
          if (k === 0) {
            const zone = Math.max(heroZone, accentZone);
            if (twinned) {
              add('spoke', zone, mainInner, angle - TWIN_GAP / 2, mainOuter - mainInner, LINE.hair, 2, 0);
              add('spoke', zone, mainInner, angle + TWIN_GAP / 2, mainOuter - mainInner, LINE.hair, 2, 0);
            } else add('spoke', zone, mainInner, angle, mainOuter - mainInner, LINE.fine, 0, 0);
          } else if (fillZones.length) {
            const zone = fillZones[k % fillZones.length];
            add('spoke', zone, edges[zone + 1], angle, (edges[zone] - edges[zone + 1]) * (k % 2 ? 0.45 : 0.7), LINE.hair, 0, k);
          }
        }
      }
    }
    return zones;
  };

  const zones = buildSystem(form.outer, true);
  if (form.kind === 'twin') {
    origin = 1;
    buildSystem(form.outer * (0.62 + random() * 0.2), false);
    origin = 0;
  }

  // What gives each form its silhouette beyond the concentric system.
  if (form.kind === 'core' || form.kind === 'horizon') {
    // Rays thrown from the rim past the edge of the frame.
    const rays = symmetry * Math.max(2, Math.round(RAYS / symmetry));
    for (let i = 0; i < rays; i++) {
      const long = i % symmetry === 0;
      const reach = (long ? 1.5 : 0.55 + 0.5 * random()) * RAY_REACH;
      add('tick', zones - 1, form.outer * 1.04, axis + (i * TAU) / rays, reach, long ? LINE.fine : LINE.hair, long ? 1 : i % 3 === 0 ? 2 : 0, tickSlot + (i % 3));
    }
    tickSlot += 3;
  } else if (form.kind === 'field') {
    // A lattice across the whole frame, indifferent to the rings moving through it.
    const pitch = 0.1 - 0.05 * density;
    for (let x = -Math.ceil(FIELD_HALF_WIDTH / pitch); x * pitch <= FIELD_HALF_WIDTH; x++) for (let y = -Math.ceil(FIELD_HALF_HEIGHT / pitch); y * pitch <= FIELD_HALF_HEIGHT; y++) {
      if (nodes >= MAX_NODES) break;
      const fromX = x * pitch - form.centreX, fromY = y * pitch - form.centreY;
      nodes++;
      add('node', zones - 1, Math.hypot(fromX, fromY), Math.atan2(fromY, fromX), 0.0042, LINE.hair, (x + y) % 5 === 0 ? 1 : (x - y) % 7 === 0 ? 2 : 0, ((x % 4) + 4) % 4 + nodeSlot, 'square', { fixed: true });
    }
    nodeSlot += 4;
  } else if (form.kind === 'spiral') {
    // Stepped arcs winding out from the centre on one logarithmic spiral per arm.
    const arms = Math.min(symmetry, 6), steps = 22, growth = (form.outer * 1.3 / SPIRAL_START) ** (1 / steps), pitch = TAU / 13;
    for (let arm = 0; arm < arms; arm++) for (let step = 0; step < steps; step++) {
      const radius = SPIRAL_START * growth ** step;
      add(step % 3 === 0 ? 'band' : 'arc', Math.min(zones - 1, step % zones), radius, axis + (arm * TAU) / arms + step * pitch, pitch * 0.72, step % 3 === 0 ? radius * 0.1 : LINE.fine, 1 + (step % 2), step % 8);
    }
  }

  const score: Score = { seed, symmetry, bars: count(params.scoreBars, 8, 1, 32), stateEnds, elements, rhythm, quality: 0, form };
  return { ...score, quality: scoreQuality(score).value };
}

function hardFailuresOf(score: Score): string[] {
  const failures: string[] = [];
  const heroes = score.elements.filter((e) => e.group === 'hero');
  if (heroes.length !== 1) failures.push(`expected one hero, found ${heroes.length}`);
  // A band's weight is its thickness in the frame, not a line weight.
  const weights = new Set(score.elements.filter((e) => e.group !== 'hero' && e.group !== 'band').map((e) => e.weight));
  if (weights.size > 3) failures.push(`${weights.size} line weights`);
  // Rings and spokes are only compared within one centre: a twin's second system cannot be tangent to the first by radius.
  const radii = score.elements.filter((e) => !e.origin && (e.group === 'ring' || e.group === 'hero')).map((e) => e.radius).sort((a, b) => a - b);
  for (let i = 1; i < radii.length; i++) if (radii[i] - radii[i - 1] < RING_GAP_LIMIT) failures.push(`rings too close at ${radii[i].toFixed(4)}`);
  const spokes = score.elements.filter((e) => !e.origin && e.group === 'spoke').sort((a, b) => a.angle - b.angle);
  const around = [...spokes, ...spokes.map((e) => ({ ...e, angle: e.angle + TAU }))];
  for (let i = 0; i < spokes.length; i++) for (let j = i + 1; j < around.length && around[j].angle - spokes[i].angle < SPOKE_GAP_LIMIT; j++) {
    const a = spokes[i];
    const b = around[j];
    if (j === i + spokes.length) continue;
    const overlap = a.radius < b.radius + b.length && b.radius < a.radius + a.length;
    const twins = a.slot === b.slot && a.radius === b.radius && a.length === b.length && b.angle - a.angle > 0.25 * DEGREE;
    if (overlap && !twins) failures.push(`spokes too close at ${a.angle.toFixed(4)}`);
  }
  const ends = score.stateEnds;
  if (ends.length !== 7 || ends[ends.length - 1] !== 1 || ends.some((end, i) => !(end > (i ? ends[i - 1] : 0)))) failures.push('stateEnds must rise to exactly 1');
  return failures;
}

/** Deterministic design score in 0..1, plus any hard limits the score breaks. */
export function scoreQuality(score: Score): { value: number; hardFailures: string[] } {
  const hardFailures = hardFailuresOf(score);
  const { elements, stateEnds } = score;
  const hero = elements.find((e) => e.group === 'hero');
  const radii = elements.filter((e) => !e.origin && (e.group === 'ring' || e.group === 'hero')).map((e) => e.radius).sort((a, b) => a - b);
  const steps = radii.slice(1).map((radius, i) => Math.log(radius / radii[i]));
  const mean = steps.reduce((sum, step) => sum + step, 0) / (steps.length || 1);
  const spread = Math.sqrt(steps.reduce((sum, step) => sum + (step - mean) ** 2, 0) / (steps.length || 1));
  const spacing = steps.length && mean > 0 ? 1 - clamp(spread / mean, 0, 1) : 0;

  const others = radii.filter((radius) => radius !== hero?.radius);
  const clearance = hero && others.length ? Math.min(...others.map((radius) => Math.abs(Math.log(radius / hero.radius)))) : 0;
  const heroPresence = hero ? clamp(clearance / 0.14, 0, 1) : 0;

  // Measured in log radius, so a quiet band scores the same at any distance from the centre.
  const widestGap = Math.max(0, ...steps);
  const emptySpace = 1 - clamp(Math.abs(widestGap - 0.4) / 0.4, 0, 1);

  const marks = elements.filter((e) => e.group !== 'hero');
  const outerShare = marks.filter((e) => e.radius > (score.form?.outer ?? DEFAULT_OUTER) * 0.43).length / (marks.length || 1);
  const balance = 1 - clamp(Math.abs(outerShare - 0.55) / 0.55, 0, 1);

  const peakAt = ((stateEnds[3] ?? 0) + (stateEnds[4] ?? 0)) / 2;
  const restAt = ((stateEnds[5] ?? 1) + 1) / 2;
  const live = (at: number) => elements.filter((e) => e.enter <= at && e.exit > at).length / (elements.length || 1);
  const contrast = clamp(live(peakAt) - live(restAt), 0, 1);

  const value = spacing * 0.25 + heroPresence * 0.25 + emptySpace * 0.2 + balance * 0.15 + contrast * 0.15;
  return { value, hardFailures };
}

/** Builds the eight candidates from `seed`..`seed + 7`. Mixing in `seed` keeps neighbouring seeds from sharing candidates. */
export function composeCandidates(seed: number, params: ComposeParams): Score[] {
  return Array.from({ length: CANDIDATES }, (_, k) =>
    composeCandidate(seed, createRandom(Math.imul(seed + k, 0x9e3779b1) ^ Math.imul(seed, 0x85ebca6b)), params));
}

/** Keeps the candidate with the fewest hard failures, then the highest quality. The earliest wins a tie. */
export function pickBest(candidates: readonly Score[]): Score {
  let best = candidates[0];
  let bestResult = scoreQuality(best);
  for (const candidate of candidates.slice(1)) {
    const result = scoreQuality(candidate);
    const fewer = result.hardFailures.length < bestResult.hardFailures.length;
    const level = result.hardFailures.length === bestResult.hardFailures.length;
    if (fewer || (level && result.value > bestResult.value)) {
      best = candidate;
      bestResult = result;
    }
  }
  return best;
}

export function compose(seed: number, params: ComposeParams): Score {
  return pickBest(composeCandidates(seed, params));
}
