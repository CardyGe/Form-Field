// A diagonal carrier and an asymmetric fold share one phase field. Only the
// fold moves with the opening, so the far bands stay anchored to the layer.
export const liquidFoldGLSL = /* glsl */`
uniform float uFoldX, uFoldY, uFoldSize, uFoldStretch, uFoldTilt;
uniform float uFoldSpacing, uFoldPinch, uFoldPhase, uFoldDirection;

float foldCarrier(vec2 point) {
  float x = point.x, y = point.y;
  float curved = .888*x*y - 1.802*x*x - .812*y*y
    + .857*x*y*y - 2.048*x*x*y;
  // Ease to a diagonal field beyond the portrait composition.
  return -.863 - 1.248*x + .604*y
    + curved*(1. - smoothstep(.29, .75, abs(x)));
}

float foldCoordinate(vec2 world) {
  vec2 centre = (vec2(uFoldX, uFoldY) - .5)*vec2(uAspect, 1.);
  float c = cos(uFoldTilt), s = sin(uFoldTilt);
  vec2 radii = vec2(.081/sqrt(uFoldStretch), .242*sqrt(uFoldStretch))*uFoldSize;
  vec2 p = mat2(c, s, -s, c)*(world - centre)/radii;
  float radius = sqrt(dot(p,p) + .000001);

  vec2 bulge = p + vec2(.7, -.2);
  float rise = .682*exp(-.48*dot(bulge*bulge, vec2(.75, 1.)));
  vec2 interior = p - vec2(.55, -.07);
  float insideCurve = .155*exp(-1.3*dot(interior*interior, vec2(.8, 1.4)));

  float nearSide = .5 + .5*tanh(clamp((p.x + .08)*2.1, -8., 8.));
  // The loose side turns back into the carrier without a second hard edge.
  float looseSide = 1. - smoothstep(.05, .88, nearSide);
  float width = .006 + .25*looseSide + .07*uSoftness*uSoftness;
  // The tails are saturated here. Bound the argument so implementations
  // that lower tanh to exponentials cannot produce NaNs far from the rim.
  float edge = (radius - 1.)/max(width, .65*fwidth(radius));
  float rim = .5 - .5*tanh(clamp(edge, -8., 8.));
  return (foldCarrier(world) + rise + insideCurve + uFoldPinch*nearSide*rim)/uFoldSpacing;
}

// Unequal stop widths give one broad wash and a tighter return through shadow.
vec3 foldPalette(float phase) {
  float t = fract(phase);
  if (t < .128) return mix(uPalette[0], uPalette[1], smoothstep(0., .128, t));
  if (t < .278) return mix(uPalette[1], uPalette[2], smoothstep(.128, .278, t));
  if (t < .613) return mix(uPalette[2], uPalette[3], smoothstep(.31, .613, t));
  if (t < .790) return mix(uPalette[3], uPalette[4], smoothstep(.613, .790, t));
  if (t < .876) return mix(uPalette[4], uPalette[5], smoothstep(.790, .876, t));
  return mix(uPalette[5], uPalette[0], smoothstep(.876, 1., t));
}

vec3 liquidFold(vec2 world) {
  float direction = uFoldDirection < .5 ? 1. : -1.;
  float phase = foldCoordinate(world) + uFoldPhase + direction*uPhase/TAU;
  float footprint = fwidth(phase);
  vec3 colour = foldPalette(phase);
  if (footprint < .02) return colour;
  float spread = min(footprint, 1.)*.33;
  vec3 filtered = (foldPalette(phase - spread) + colour + foldPalette(phase + spread))/3.;
  vec3 average = (uPalette[0]+uPalette[1]+uPalette[2]+uPalette[3]+uPalette[4]+uPalette[5])/6.;
  return mix(filtered, average, smoothstep(.55, 1.1, footprint));
}
`;
