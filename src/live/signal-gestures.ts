/** Two GPU pixels: centre/energy/charge, and velocity/burst/presence. No camera readback. */
export const gestureFragment = /* glsl */`
uniform sampler2D uPrevious, uPeople, uFlow;
uniform float uStep, uResponse, uChargeSeconds, uRemove;
void main() {
  vec4 before = texture2D(uPrevious,vec2(.25,.5));
  vec4 previousMotion = texture2D(uPrevious,vec2(.75,.5));
  float weight=0., energy=0.; vec2 centre=vec2(0.), velocity=vec2(0.);
  for(int y=0;y<9;y++) for(int x=0;x<16;x++) {
    vec2 p=(vec2(float(x),float(y))+.5)/vec2(16.,9.);
    float mask=mix(1.,smoothstep(.3,.7,texture2D(uPeople,p).r),uRemove);
    vec3 flow=texture2D(uFlow,p).rgb;
    float speed=smoothstep(.0003,.009,length(flow.rg)*uResponse);
    weight+=mask; centre+=p*mask; velocity+=flow.rg*mask;
    energy+=speed*mask;
  }
  float present=step(.4,weight);
  centre=weight>.4?centre/weight:before.xy;
  velocity=weight>.4?velocity/weight:vec2(0.);
  energy=weight>.4?energy/weight:0.;
  float response=1.-exp(-uStep*10.);
  float moving=mix(before.z,energy,response);
  float charge=clamp(before.w+uStep*(1.-smoothstep(.08,.3,moving))/uChargeSeconds-uStep*moving*1.8,0.,1.)*present;
  // A charged pose releases once as movement accelerates, then the flare decays.
  float burst=max(previousMotion.z*exp(-uStep*2.5),clamp((moving-before.z)*before.w*14.,0.,1.))*present;
  vec2 position=mix(before.xy,centre,1.-exp(-uStep*8.));
  gl_FragColor=vUv.x<.5?vec4(position,moving,charge):vec4(velocity,burst,present);
}`;
