// Only the local field follows the opening. The diagonal carrier stays anchored.
export const liquidFoldGLSL = /* glsl */`
uniform float uFoldX, uFoldY, uFoldSize, uFoldStretch, uFoldTilt;
uniform float uFoldSpacing, uFoldPinch, uFoldPhase, uFoldDirection;
uniform float uFoldShape, uFoldSeparation, uFoldCurve, uFoldPitch;
uniform float uFoldPath, uFoldPathAmount, uFoldPathCycles, uLoopPhase;
uniform float uFoldBrightness, uFoldRimLight, uFoldInnerFlow, uFoldInnerStretch;
uniform float uFoldSatin, uFoldSatinAngle, uFoldRollOff;
uniform float uFoldMorphFrom, uFoldMorphMix, uFoldMorphDirection;

float foldCarrier(vec2 point) {
  float x = point.x, y = point.y;
  float curved = .888*x*y - 1.802*x*x - .812*y*y + .857*x*y*y - 2.048*x*x*y;
  return -.863 - 1.248*x + .604*y + curved*(1. - smoothstep(.29, .75, abs(x)));
}

vec2 foldOpening() {
  vec2 centre = vec2(uFoldX, uFoldY) - .5;
  float pathPhase = uLoopPhase*uFoldPathCycles;
  if (uFoldPath > 1.5) {
    centre += uFoldPathAmount*vec2(.82*cos(pathPhase), .44*sin(pathPhase));
  } else if (uFoldPath > .5) {
    centre += uFoldPathAmount*vec2(sin(pathPhase), .28*sin(2.*pathPhase));
  }
  return centre*vec2(uAspect, 1.);
}

float foldRimProfile(float edge, float width) {
  // Integrate a thin highlight across the pixel instead of pinning it to a sample.
  float pixel = .5*fwidth(edge);
  float span = max(width, pixel);
  return exp(-pow(min(abs(edge)/span, 10.), 2.))*min(1., width/span);
}

// Phase displacement, rim highlight, and a soft interior mask.
vec3 foldEllipse(vec2 p) {
  float radius = sqrt(dot(p,p) + .000001);
  vec2 bulge = p + vec2(.7, -.2);
  float rise = .682*exp(-.48*dot(bulge*bulge, vec2(.75, 1.)));
  vec2 interior = p - vec2(.55, -.07);
  float insideCurve = .155*exp(-1.3*dot(interior*interior, vec2(.8, 1.4)));
  float nearSide = .5 + .5*tanh(clamp((p.x + .08)*2.1, -8., 8.));
  float looseSide = 1. - smoothstep(.05, .88, nearSide);
  float distanceToRim = radius - 1.;
  // Soften the upper and lower tips where the opening turns away from the light.
  float width = .013 + .29*looseSide + .03*abs(p.y) + .095*uSoftness*uSoftness;
  float edge = distanceToRim/max(width, .6*fwidth(radius));
  float rim = .5 - .5*tanh(clamp(edge, -8., 8.));
  float highlight = nearSide*foldRimProfile(distanceToRim, .015 + .055*uSoftness);
  return vec3(rise + insideCurve + uFoldPinch*nearSide*rim, highlight, 1. - smoothstep(.36, .98, radius));
}

vec3 foldField(vec2 p, float shape) {
  if (shape < .5) return foldEllipse(p);
  if (shape < 1.5) {
    vec2 shift = vec2(uFoldSeparation, .32);
    vec3 first = foldEllipse((p + shift)*vec2(1.12, 1.1));
    vec3 second = foldEllipse((p - shift)*vec2(-1.22, 1.2));
    return vec3(first.x + second.x*.88, max(first.y, second.y), max(first.z, second.z));
  }
  if (shape < 2.5) {
    float bend = p.x - uFoldCurve*1.8*sin(.92*p.y);
    float envelope = exp(-.17*p.y*p.y);
    float band = exp(-.24*bend*bend);
    float width = .09 + .48*uSoftness;
    float fold = band*tanh(clamp(bend/max(width, .7*fwidth(bend)), -8., 8.));
    return vec3(envelope*(.26*band + .53*uFoldPinch*fold),
      envelope*foldRimProfile(bend, .055 + .09*uSoftness), envelope*band*smoothstep(.08, .72, bend));
  }
  float radius = length(p);
  float winding = 2.9*uFoldPitch*log(.38 + radius);
  float turn = dot(p, vec2(-sin(winding), cos(winding)))/max(radius, .00001);
  // Suppress the singularity at the centre and fade the winding into the field.
  float envelope = smoothstep(.08, .42, radius)*(1. - smoothstep(1.05, 4.4, radius));
  float width = .12 + .45*uSoftness;
  float fold = tanh(clamp(turn/max(width, .65*fwidth(turn)), -8., 8.));
  return vec3(envelope*(.54*uFoldPinch*fold + .19*radius),
    envelope*foldRimProfile(turn, .045 + .08*uSoftness), envelope*smoothstep(.05, .8, turn));
}

// The palette's smoothstep segments are integrated for exact box filtering in phase.
vec3 foldPalette(float phase) {
  float t = fract(phase);
  if (t < .128) return mix(uPalette[0], uPalette[1], smoothstep(0., .128, t));
  if (t < .278) return mix(uPalette[1], uPalette[2], smoothstep(.128, .278, t));
  if (t < .613) return mix(uPalette[2], uPalette[3], smoothstep(.31, .613, t));
  if (t < .790) return mix(uPalette[3], uPalette[4], smoothstep(.613, .790, t));
  if (t < .876) return mix(uPalette[4], uPalette[5], smoothstep(.790, .876, t));
  return mix(uPalette[5], uPalette[0], smoothstep(.876, 1., t));
}

vec3 foldRampIntegral(vec3 a, vec3 b, float t, float start, float end) {
  float width = end - start;
  float u = clamp((t - start)/width, 0., 1.);
  return width*(a*u + (b - a)*u*u*u*(1. - .5*u));
}

vec3 foldPaletteIntegral(float phase, vec3 period) {
  float t = fract(phase);
  vec3 integral = foldRampIntegral(uPalette[0], uPalette[1], t, 0., .128);
  integral += foldRampIntegral(uPalette[1], uPalette[2], t, .128, .278);
  integral += uPalette[2]*clamp(t - .278, 0., .032);
  integral += foldRampIntegral(uPalette[2], uPalette[3], t, .31, .613);
  integral += foldRampIntegral(uPalette[3], uPalette[4], t, .613, .790);
  integral += foldRampIntegral(uPalette[4], uPalette[5], t, .790, .876);
  integral += foldRampIntegral(uPalette[5], uPalette[0], t, .876, 1.);
  return integral + floor(phase)*period;
}

vec3 liquidFold(vec2 world) {
  float c = cos(uFoldTilt), s = sin(uFoldTilt);
  float stretch = sqrt(uFoldStretch);
  vec2 radii = vec2(.081/stretch, .242*stretch)*uFoldSize;
  vec2 p = mat2(c, s, -s, c)*(world - foldOpening())/radii;
  vec3 field = foldField(p, uFoldShape);
  if (uFoldMorphMix < 1.) {
    vec2 axis = vec2(cos(uFoldMorphDirection), sin(uFoldMorphDirection));
    float scan = dot(vUv - .5, axis)/(abs(axis.x) + abs(axis.y)) + .5;
    float mixAmount = smoothstep(0., 1., clamp((uFoldMorphMix - .4*scan)/.6, 0., 1.));
    field = mix(foldField(p, uFoldMorphFrom), field, mixAmount);
  }
  float direction = uFoldDirection < .5 ? 1. : -1.;
  float phase = (foldCarrier(world) + field.x)/uFoldSpacing + uFoldPhase + direction*uPhase/TAU;
  // Periodic slip changes apparent inner speed without a reset at the seam.
  phase += field.z*(.42*uFoldInnerStretch*tanh(clamp(p.y, -8., 8.))
    + .115*uFoldInnerFlow*sin(uPhase - .8*field.z));
  float footprint = fwidth(phase);
  vec3 colour = foldPalette(phase);
  if (footprint > .018) {
    // Bound huge footprints at discontinuities. Beyond four periods the mean is sufficient.
    vec3 average = .126*uPalette[0] + .139*uPalette[1] + .2585*uPalette[2]
      + .24*uPalette[3] + .1315*uPalette[4] + .105*uPalette[5];
    float halfWidth = .5*min(footprint, 4.);
    vec3 filtered = (foldPaletteIntegral(phase + halfWidth, average)
      - foldPaletteIntegral(phase - halfWidth, average))/(2.*halfWidth);
    colour = mix(colour, mix(filtered, average, smoothstep(2., 4., footprint)),
      smoothstep(.018, .065, footprint));
  }
  vec3 light = mix(vec3(1.), mix(uPalette[2], uPalette[5], .5), .7);
  vec3 shaded = max(colour, vec3(0.)) + light*(.54*uFoldRimLight*field.y);
  if (uFoldSatin > 0.) {
    float surfaceHeight = field.x + .24*field.z;
    vec2 gradient = vec2(dFdx(surfaceHeight)*uResolution.x/uAspect, dFdy(surfaceHeight)*uResolution.y);
    vec3 normal = normalize(vec3(-.22*gradient, 1.));
    vec3 key = normalize(vec3(.78*cos(uFoldSatinAngle), .78*sin(uFoldSatinAngle), .88));
    float sheen = pow(max(0., dot(normal, normalize(key + vec3(0., 0., 1.)))), 9.);
    shaded += light*(.42*uFoldSatin*sheen*smoothstep(.02, .65, abs(field.x) + field.z));
  }
  shaded *= exp2(uFoldBrightness);
  float peak = max(shaded.r, max(shaded.g, shaded.b));
  if (peak > .64 && uFoldRollOff > 0.) {
    // A common scale preserves hue as bright channels enter the shoulder.
    float shoulder = .64 + .36*(1. - exp(-(peak - .64)/.36));
    shaded *= mix(1., shoulder/peak, uFoldRollOff);
  }
  return shaded;
}
`;
