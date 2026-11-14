import { sourceViewGLSL } from './source-view';
import { LIQUID_BINS, LIQUID_MAX_RADIUS, LIQUID_SLOTS, LIQUID_TILE } from './liquid-pack';

const f = (n: number) => n.toFixed(4);

/**
 * Liquid Light: oil droplets in dye on an overhead projector.
 *
 * Droplet positions come from a baked layout (liquid-pack.ts). The shader bends
 * the frame through a slow looping flow, looks up the droplet under each pixel
 * and colours it by its thickness: thin is the rim colour, thick is the hot
 * colour. Every moving term is a whole number of turns of uPhase, so the loop
 * closes exactly. Output is premultiplied.
 *
 * Three dishes are stacked from one layout read at different places and sizes:
 * a soft far layer, the sharp main layer that bends the far one like a lens,
 * and a few flat floaters on top.
 *
 * Palette: 0 rim, 1 body, 2 mid, 3 hot, 4 wash, 5 ground.
 */
export const liquidFragment = /* glsl */`
precision highp float;
varying vec2 vUv;
${sourceViewGLSL}
uniform vec3 uPalette[6];
uniform sampler2D uDroplets;
uniform float uAspect, uPhase, uSeed;
uniform float uScale, uDrift, uWarp, uBreathing, uShimmer, uThickness, uOutline, uBackgroundOpacity;
uniform float uCrowding, uDimple, uRim, uFloaters, uFarLayer, uFarBlur, uRefraction;
uniform float uVignette, uFocus, uFringe, uGrain;
uniform float uWash, uVein, uMerge, uPress, uPressRadius, uPressPulse, uPressX, uPressY;
const float TAU = 6.28318530718;
const float TILE = ${f(LIQUID_TILE)}, BINS = ${f(LIQUID_BINS)}, SLOTS = ${f(LIQUID_SLOTS)}, RMAX = ${f(LIQUID_MAX_RADIUS)};
// How far a crowded droplet may grow, and the gap it keeps from a larger neighbour.
const float GROW = .012, GAP = .005;
// Merging: how far a large droplet reaches towards the next, and how softly they join.
const float REACH = .012, JOIN = .010;

float hash(vec3 p) { p=fract(p*.1031); p+=dot(p,p.yzx+33.33); return fract((p.x+p.y)*p.z); }
float noise(vec3 p) {
  vec3 i=floor(p), f=fract(p);
  f=f*f*f*(f*(f*6.-15.)+10.);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
    mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
// A smooth push in two directions. The clock enters as a point on a circle, so
// the field returns to where it started after one loop.
vec2 flow(vec2 p, float z) {
  vec2 orbit=vec2(cos(uPhase),sin(uPhase))*.55;
  return vec2(noise(vec3(p+orbit,z)),noise(vec3(p-orbit.yx+19.7,z+7.3)))-.5;
}
vec3 ramp(float h) {
  vec3 c=mix(uPalette[0],uPalette[1],smoothstep(0.,.16,h));
  c=mix(c,uPalette[2],smoothstep(.34,.70,h));
  return mix(c,uPalette[3],smoothstep(.70,1.,h));
}
float smax(float a, float b, float k) { float h=max(k-abs(a-b),0.)/k; return max(a,b)+h*h*k*.25; }
float smin(float a, float b, float k) { float h=max(k-abs(a-b),0.)/k; return min(a,b)-h*h*k*.25; }

float gSeed;
struct Cell {
  float cover;   // 0 outside, 1 inside
  float edge;    // 0 at the deepest point, 1 at the rim
  float size;    // radius
  float id;      // random per droplet
  float inside;  // distance in from the rim
  vec2 out2;     // direction from the centre to this pixel
  float merged;  // 1 inside a blob of joined droplets
};
// The droplet under q. crowd grows every droplet into its neighbours; the
// smaller of two that meet gives way, which bends it into a bean around the
// larger one. merge joins the larger droplets into blobs and leaves the small
// ones as separate satellites along the blob's edge. soft widens the edge (out
// of focus).
Cell cells(vec2 q, float px, float crowd, float merge, float soft) {
  vec2 m=mod(q,TILE);
  vec2 bin=min(floor(m/TILE*BINS),BINS-1.);
  float rest[${LIQUID_SLOTS}], radius[${LIQUID_SLOTS}], dist[${LIQUID_SLOTS}], ids[${LIQUID_SLOTS}];
  vec2 dir[${LIQUID_SLOTS}];
  bool joins[${LIQUID_SLOTS}];
  int n=0;
  // The blob: distance to the joined outline, and the droplet nearest this pixel.
  float blob=1e3, fill=1e3, nearest=1e3, blobSize=0., blobId=0.; vec2 blobDir=vec2(0.);
  float joinAbove=RMAX*mix(.5,.16,merge);
  for(int s=0;s<${LIQUID_SLOTS};s++) {
    vec4 d=texture2D(uDroplets,vec2((bin.x*SLOTS+float(s)+.5)/(BINS*SLOTS),(bin.y+.5)/BINS));
    if(d.z<=0.) break;
    vec2 v=mod(m-d.xy+TILE*.5,TILE)-TILE*.5;
    // Each droplet breathes at one, two or three turns per loop from its own start.
    float turns=1.+floor(fract(d.w*7.13)*3.);
    float r=d.z*(1.-uBreathing*.25*(.5+.5*sin(turns*uPhase+d.w*TAU*5.)));
    // Droplets join in patches, so blobs form islands among separate cells.
    joins[s]=merge>0.&&d.z>joinAbove&&noise(vec3(d.xy*1.6,gSeed+53.))<mix(.25,.62,merge);
    rest[s]=d.z; radius[s]=r+crowd*min(d.z*.45,GROW)+(joins[s]?merge*REACH:0.); dist[s]=length(v); ids[s]=d.w;
    dir[s]=v/max(dist[s],1e-5); n++;
    if(joins[s]) {
      float sdf=dist[s]-radius[s];
      blob=smin(blob,sdf,JOIN*merge+.0005);
      // A much softer union for the oil's depth, so the seam between two joined
      // droplets fills in. Each droplet drops out of it before the lookup stops
      // listing it, which keeps the depth the same in every bin.
      fill=smin(fill,sdf+.09*smoothstep(.002,.011,sdf),.06);
      if(sdf<nearest) { nearest=sdf; blobSize=radius[s]; blobId=d.w; blobDir=dir[s]; }
    }
  }
  float aa=px+soft;
  Cell cell=Cell(0.,1.,0.,0.,0.,vec2(0.),0.);
  for(int i=0;i<${LIQUID_SLOTS};i++) {
    if(i>=n) break;
    if(joins[i]) continue;
    float sdf=dist[i]-radius[i];
    if(sdf>aa) continue;
    // A separate droplet keeps clear of the blob, as it does of a larger neighbour.
    if(merge>0.) sdf=smax(sdf,GAP-blob-smoothstep(.006,.011,blob),.006);
    if(crowd>0.) for(int j=0;j<${LIQUID_SLOTS};j++) {
      if(j>=n) break;
      if(rest[j]<=rest[i]||joins[j]) continue;
      // A neighbour presses only close to its own edge. Fading it out before
      // the lookup stops listing it keeps the result the same in every bin.
      float away=dist[j]-radius[j];
      sdf=smax(sdf,GAP-away-smoothstep(.006,.011,away),.006);
    }
    float c=smoothstep(aa,-aa,sdf);
    if(c>cell.cover) cell=Cell(c,clamp(1.+sdf/radius[i],0.,1.),radius[i],ids[i],-sdf,dir[i],0.);
  }
  float joined=smoothstep(aa,-aa,blob);
  if(joined>cell.cover) cell=Cell(joined,clamp(1.+min(fill,blob)/.03,0.,1.),blobSize,blobId,-blob,blobDir,1.);
  return cell;
}
// Thickness of the oil at this point of a droplet, 0 to about 1.
float thickness(Cell cell, float dimple, float rim, float px) {
  // Mostly flat like a disc of oil, with a thicker middle.
  float cap=.62*pow(max(1.-cell.edge*cell.edge,0.),.3)+.38*exp(-cell.edge*cell.edge*3.2);
  // Some droplets are dished: thin in the middle, so a bright ring surrounds a dark centre.
  float dished=(1.-cell.merged)*dimple*smoothstep(.25,.75,fract(cell.id*29.3)+dimple-.5);
  cap*=1.-dished*.85*exp(-cell.edge*cell.edge*5.);
  float weight=pow(clamp(cell.size/RMAX,0.,1.),.6)*mix(.45,1.25,fract(cell.id*13.7));
  weight=mix(weight,max(weight,.8),dished);
  // A blob is one body of oil: no per-droplet variation, and thick away from its edge.
  if(cell.merged>.5) { weight=1.; cap=.3+.7*smoothstep(1.,0.,cell.edge); }
  float swell=1.+(1.-cell.merged)*uShimmer*.4*sin((1.+floor(fract(cell.id*3.31)*2.))*uPhase+cell.id*TAU*9.);
  // The meniscus: a thin raised line just inside the rim.
  float width=cell.size*.07+px*1.5;
  float lip=rim*.3*exp(-pow((cell.inside-width*1.6)/width,2.))*smoothstep(.012,.035,cell.size);
  return clamp(uThickness*cap*weight*swell+lip,0.,1.);
}
vec3 shade(vec3 color, Cell cell, float px) {
  // A darker band just inside the rim keeps neighbouring droplets apart.
  float band=smoothstep(0.,cell.size*.10+px*2.,cell.inside);
  return color*mix(1.,.35+.65*band,uOutline);
}
// The dye under the oil: flat bands of ground and wash colour that fold through
// each other, with a thin dark vein where two bands meet.
vec3 wash(vec2 p, float z, float px) {
  vec2 a=flow(p*.7,z+31.);
  vec2 b=flow(p*1.6+a*2.2,z+37.);
  float t=noise(vec3(p*1.1+a*1.8+b*.9,z+41.))*7.;
  // Distance to the nearest band boundary, in layout units.
  float slope=max(length(vec2(dFdx(t),dFdy(t)))/max(px,1e-6),1e-4);
  float toEdge=abs(fract(t+.5)-.5)/slope;
  float band=mod(floor(t),3.);
  vec3 other=mix(uPalette[4],uPalette[1],.55);
  vec3 color=band<.5?uPalette[5]:band<1.5?uPalette[4]:other;
  float width=uVein*.006;
  float vein=uVein>0.?1.-smoothstep(width,width+px*1.5,toEdge):0.;
  return mix(uPalette[5],mix(color,uPalette[0]*.25,vein),uWash);
}
void main() {
  vec2 frame=(sourceUV(vUv)-.5)*vec2(uAspect,1.);
  vec2 lens=frame;
  // The press: a glass dome that magnifies the dish under it and squeezes the
  // oil there thicker. It eases off and returns once per loop.
  float press=uPress*(1.-uPressPulse*(.5-.5*cos(uPhase)));
  vec2 centre=vec2(uPressX*uAspect,uPressY)*.5;
  float within=clamp(1.-dot(frame-centre,frame-centre)/max(uPressRadius*uPressRadius,1e-4),0.,1.);
  float dome=press*within*within;
  float squeeze=press*smoothstep(0.,.5,within);
  frame=centre+(frame-centre)*(1.-.45*dome);
  vec2 base=frame/max(uScale,.05);
  float z=mod(uSeed,4093.)*.031;
  gSeed=z;
  vec2 drift=uDrift*vec2(.16*sin(uPhase),.10*sin(2.*uPhase+1.3));

  // Main dish.
  vec2 p=base+drift;
  vec2 q=p+uWarp*(.20*flow(p*1.15,z)+.07*flow(p*3.7+11.,z+3.));
  // Size of one pixel in layout units, for edge smoothing.
  float px=.5*(length(dFdx(q))+length(dFdy(q)));
  // The projector lens is never perfectly sharp, and its focus drifts once per loop.
  float focus=uFocus*.005*(.65+.35*sin(uPhase+1.));
  Cell cell=cells(q,px,uCrowding,uMerge,focus);
  float h=clamp(thickness(cell,uDimple,uRim,px+focus)*(1.+1.6*squeeze),0.,1.);
  vec3 color=shade(ramp(h),cell,px);
  // Colour fringe: the lens splits colour towards the edge of the frame, warm
  // on the outer side of each rim and violet on the inner side.
  float side=dot(cell.out2,normalize(lens+1e-5))*min(length(lens)*1.6,1.);
  float rimBand=1.-smoothstep(0.,cell.size*.14+px*3.,cell.inside);
  color=max(color+uFringe*rimBand*side*vec3(.32,.03,-.30),0.);
  // Thin oil lets the dish below show through.
  float alpha=cell.cover*(1.-.35*uRefraction*(1.-h));

  // Far dish: larger, slower, out of focus, and seen through the main droplets as through lenses.
  vec4 result=vec4(0.);
  if(uFarLayer>0.) {
    vec2 pf=base*.62+drift*.4+vec2(1.37,.61);
    pf-=uRefraction*.45*cell.out2*cell.edge*cell.size*cell.cover;
    vec2 qf=pf+uWarp*.16*flow(pf*1.15+5.,z+9.);
    float soft=uFarBlur*.022;
    Cell far=cells(qf,px*.62,0.,0.,soft);
    float hf=thickness(far,0.,0.,px*.62+soft);
    result=vec4(ramp(hf*.6)*.42,1.)*far.cover*uFarLayer;
  }
  result=vec4(color,1.)*alpha+result*(1.-alpha);

  // Floaters: a few flat discs of the hot colour riding above everything.
  if(uFloaters>0.) {
    vec2 pt=base*1.3+drift*1.7+vec2(.43,2.09);
    vec2 qt=pt+uWarp*.10*flow(pt*.9+13.,z+21.);
    Cell top=cells(qt,px*1.3,0.,0.,0.);
    float shown=top.cover*step(fract(top.id*91.7),uFloaters*.16);
    vec3 disc=uPalette[3]*(.86+.14*smoothstep(0.,top.size*.5,top.inside));
    result=vec4(disc,1.)*shown+result*(1.-shown);
  }
  float back=uBackgroundOpacity*(1.-result.a);
  vec3 ground=uWash>0.?wash(base+drift*.25,z,px):uPalette[5];
  vec3 lit=result.rgb+ground*back;
  // The lamp falls off towards the corners; dust on the glass leaves a fine still grain.
  float corner=length((vUv-.5)*vec2(uAspect,1.));
  lit*=1.-uVignette*.85*smoothstep(.3,.95,corner);
  vec2 dust=(vUv-.5)*vec2(uAspect,1.)*540.;
  lit*=1.+uGrain*.16*(noise(vec3(dust,z+77.))+noise(vec3(dust*2.3,z+91.))-1.);
  gl_FragColor=vec4(lit,result.a+back);
}
`;
