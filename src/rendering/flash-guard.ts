/**
 * The flash guard: the last step before the picture reaches the audience.
 *
 * The frame is measured on a 320 x 180 grid. Each cell has a budget of brightness reversals: two in hand, refilled
 * at four a second, which is at most six reversals (three flashes) in any second. The guard only acts when cells
 * over budget cover a large part of the screen, because flashing is judged by area: small flashes and fine moving
 * detail pass untouched. Once it acts, the whole picture gets a brief, even motion smoothing, which calms flicker
 * while everything keeps moving. Any reversal still over budget is then held back by blending that cell further
 * towards what it showed last frame, so it keeps the artwork's own colours and never turns grey or black.
 *
 * This is a risk control modelled on ITU-R BT.1702. It is not a certified analyser and makes no compliance claim.
 */
export const GUARD_COLUMNS = 320;
export const GUARD_ROWS = 180;
/** 20 cd/m2 on a 1,500-nit wall: the strictest brightness this screen is designed for. */
export const GUARD_DELTA = 20 / 1500;
/** Two in hand plus four a second: at most six reversals in any second, and a steady 2 Hz pulse passes untouched. */
export const GUARD_BUDGET = 2;
export const GUARD_REFILL = 4;
/** How close to the last extreme a held cell sits: inside the delta, so holding it is not itself a reversal. */
export const GUARD_HOLD = .9;
/** A long stall refills the budget but must not skip the rule. */
export const GUARD_MAX_STEP = .5;
/** A cell counts as flashing once its budget is overdrawn: its sixth reversal inside a second, one before the limit. */
/** Those cells must cover this much of the screen before anything is held: a margin under the 25% limit. */
export const GUARD_AREA = .15;
/** Once triggered the guard stays on this long, past the one-second window flashes are counted over. */
export const GUARD_ENGAGE = 1.25;
/** While the guard is off, a cell's overspending is remembered down to this, so it still counts as over budget. */
export const GUARD_DEBT = -4;
/** The motion smoothing's time constant while the guard is on, in seconds. */
export const GUARD_SOFT_TIME = .075;
/** The smoothing fades out over the last part of the guard's time on, so letting go is never a jump. */
export const GUARD_SOFT_FADE = .25;

export interface GuardTile { extreme: number; direction: number; tokens: number; blend: number; last: number }

export const newGuardTile = (level: number): GuardTile => ({ extreme: level, direction: 0, tokens: GUARD_BUDGET, blend: 0, last: level });

/** How far to blend from this frame towards the last one to land on the target level. */
export function guardBlend(level: number, target: number, last: number): number {
  const span = last - level;
  if (Math.abs(span) < 1e-5) return 0;
  return Math.max(0, Math.min(1, (target - level) / span));
}

/** The time left holding, given how much of the screen is over budget. */
export function stepGuardGate(timer: number, area: number, seconds: number): number {
  const step = Number.isFinite(seconds) ? Math.max(0, Math.min(GUARD_MAX_STEP, seconds)) : 0;
  return area >= GUARD_AREA ? GUARD_ENGAGE : Math.max(0, timer - step);
}

/** How far this frame is smoothed towards the last one, given the time the guard has left. */
export function guardSoftness(timer: number, seconds: number): number {
  const step = Number.isFinite(seconds) ? Math.max(0, Math.min(GUARD_MAX_STEP, seconds)) : 0;
  // A redraw with no time passed, such as a clear or a palette change, is shown as it is.
  if (timer <= 0 || step <= 0) return 0;
  const t = Math.min(1, timer / GUARD_SOFT_FADE);
  return Math.exp(-step / GUARD_SOFT_TIME) * t * t * (3 - 2 * t);
}

/** One frame for one cell. The shader below does exactly this. holding is false while the screen-wide gate is open. */
export function stepGuardTile(tile: GuardTile, raw: number, seconds: number, holding = true, soft = 0): GuardTile & { shown: number } {
  const step = Number.isFinite(seconds) ? Math.max(0, Math.min(GUARD_MAX_STEP, seconds)) : 0;
  const level = raw + (tile.last - raw) * soft;
  let { extreme, direction } = tile, tokens = Math.min(GUARD_BUDGET, tile.tokens + GUARD_REFILL * step), blend = soft;
  if (direction > 0 && level > extreme || direction < 0 && level < extreme) extreme = level;
  const moved = level - extreme;
  if (Math.abs(moved) >= GUARD_DELTA && (direction === 0 || Math.sign(moved) === -direction)) {
    if (tokens >= 1) { tokens -= 1; direction = Math.sign(moved); extreme = level; }
    else if (!holding) { tokens = Math.max(GUARD_DEBT, tokens - 1); direction = Math.sign(moved); extreme = level; }
    else blend = Math.max(soft, guardBlend(raw, extreme + Math.sign(moved) * GUARD_DELTA * GUARD_HOLD, tile.last));
  }
  const shown = blend === 0 ? raw : raw + (tile.last - raw) * blend;
  return { extreme, direction, tokens, blend, last: shown, shown };
}

/** Reads this frame and the last shown frame, and advances every cell. State: extreme, direction, tokens, blend. */
export const flashGuardStepGLSL = /* glsl */`
uniform sampler2D uGuardSource, uGuardLast, uGuardState, uGuardGate;
uniform float uGuardSeconds, uGuardReset, uGuardEncoded;
vec3 guardLinear(vec3 c) {
  c = clamp(c, 0., 1.);
  return uGuardEncoded > .5 ? mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c)) : c;
}
float guardLevel(vec3 c) {
  // Saturated red counts extra, so a red flash is caught even when its brightness alone looks small.
  return dot(c, vec3(.2126, .7152, .0722)) + .2126 * max(c.r - c.g - c.b, 0.);
}
// Every pixel in the cell, so the guard judges the same average the audience sees.
float guardMeasure(sampler2D image, vec2 uv) {
  ivec2 grid = ivec2(${GUARD_COLUMNS}, ${GUARD_ROWS}), size = textureSize(image, 0), cell = ivec2(uv * vec2(grid));
  ivec2 from = cell * size / grid, to = max((cell + 1) * size / grid, from + 1);
  float sum = 0.;
  for (int y = from.y; y < to.y; y++) for (int x = from.x; x < to.x; x++)
    sum += guardLevel(guardLinear(texelFetch(image, ivec2(x, y), 0).rgb));
  return sum / float((to.x - from.x) * (to.y - from.y));
}
vec4 flashGuardStep(vec2 uv) {
  float raw = guardMeasure(uGuardSource, uv);
  if (uGuardReset > .5) return vec4(raw, 0., ${GUARD_BUDGET}., 0.);
  float timer = texelFetch(uGuardGate, ivec2(0), 0).g, soft = 0., last = raw;
  if (timer > 0.) {
    soft = uGuardSeconds > 0. ? exp(-uGuardSeconds / ${GUARD_SOFT_TIME}) * smoothstep(0., ${GUARD_SOFT_FADE}, timer) : 0.;
    last = guardMeasure(uGuardLast, uv);
  }
  float level = mix(raw, last, soft);
  vec4 s = texelFetch(uGuardState, ivec2(uv * vec2(${GUARD_COLUMNS}., ${GUARD_ROWS}.)), 0);
  float extreme = s.r, direction = s.g > .5 ? 1. : s.g < -.5 ? -1. : 0.;
  float tokens = min(${GUARD_BUDGET}., s.b + ${GUARD_REFILL}. * uGuardSeconds), blend = soft;
  if ((direction > 0. && level > extreme) || (direction < 0. && level < extreme)) extreme = level;
  float moved = level - extreme, way = moved > 0. ? 1. : -1.;
  if (abs(moved) >= ${GUARD_DELTA} && (direction == 0. || way == -direction)) {
    if (tokens >= 1.) { tokens -= 1.; direction = way; extreme = level; }
    else if (timer <= 0.) { tokens = max(${GUARD_DEBT}., tokens - 1.); direction = way; extreme = level; }
    else {
      float span = last - raw;
      if (abs(span) >= .00001) blend = max(soft, clamp((extreme + way * ${GUARD_DELTA * GUARD_HOLD} - raw) / span, 0., 1.));
    }
  }
  return vec4(extreme, direction, tokens, blend);
}`;

/** One pixel: x is the share of the screen over budget, y the time left holding. Read by the next frame's step. */
export const flashGuardGateGLSL = /* glsl */`
uniform sampler2D uGuardCells, uGuardGateLast;
uniform float uGuardSeconds, uGuardReset;
vec4 flashGuardGate() {
  if (uGuardReset > .5) return vec4(0.);
  float over = 0., total = 0.;
  for (int y = 0; y < ${GUARD_ROWS}; y += 2) for (int x = 0; x < ${GUARD_COLUMNS}; x += 2) {
    total += 1.;
    if (texelFetch(uGuardCells, ivec2(x, y), 0).b < 0.) over += 1.;
  }
  float area = over / total, timer = texelFetch(uGuardGateLast, ivec2(0), 0).g;
  return vec4(area, area >= ${GUARD_AREA} ? ${GUARD_ENGAGE} : max(0., timer - uGuardSeconds), 0., 1.);
}`;

/** Makes the frame the audience sees: each cell's own blend of this frame and the last shown one, in linear light. */
export const flashGuardApplyGLSL = /* glsl */`
uniform sampler2D uGuardImage, uGuardPrevious, uGuardCells;
uniform float uGuardImageEncoded;
vec3 guardDecode(vec3 c) { c = clamp(c, 0., 1.); return uGuardImageEncoded > .5 ? mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c)) : c; }
vec3 guardEncode(vec3 c) { c = clamp(c, 0., 1.); return uGuardImageEncoded > .5 ? mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)) : c; }
// A held cell keeps its full hold and fades out across one neighbouring cell, so no grid shows in the picture.
float guardSoftBlend(vec2 uv) {
  vec2 p = uv * vec2(${GUARD_COLUMNS}., ${GUARD_ROWS}.);
  ivec2 c = clamp(ivec2(floor(p)), ivec2(0), ivec2(${GUARD_COLUMNS - 1}, ${GUARD_ROWS - 1}));
  float soft = 0.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    ivec2 n = c + ivec2(x, y);
    if (n.x < 0 || n.y < 0 || n.x >= ${GUARD_COLUMNS} || n.y >= ${GUARD_ROWS}) continue;
    float held = texelFetch(uGuardCells, n, 0).a;
    if (held <= soft) continue;
    vec2 away = max(max(vec2(n) - p, p - vec2(n + ivec2(1))), vec2(0.));
    soft = max(soft, held * (1. - smoothstep(0., 1., length(away))));
  }
  return soft;
}
vec4 flashGuardShow(vec2 uv) {
  vec4 now = texture(uGuardImage, uv);
  float blend = guardSoftBlend(uv);
  // An untouched area keeps its exact pixels.
  if (blend <= .0005) return vec4(now.rgb, 1.);
  return vec4(guardEncode(mix(guardDecode(now.rgb), guardDecode(texture(uGuardPrevious, uv).rgb), blend)), 1.);
}`;
