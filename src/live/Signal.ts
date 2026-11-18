import * as THREE from 'three';
import type { Look, TrackingFeed } from './look';
import { personStillTimeout, type LiveSettings } from './settings';
import type { Pair, Passes } from './passes';
import { SignalEchoes, echoGLSL } from './signal-echoes';
import { gestureFragment } from './signal-gestures';
import { recolourGLSL, setRamp } from './recolour';

/** People are cut out BEFORE any feedback, so room pixels can never enter history. */
const subjectFragment = recolourGLSL + /* glsl */`
uniform sampler2D uCamera, uPeople, uFlow, uGesture;
uniform float uRemove, uThreshold, uSoftness, uVividness, uContours, uTime, uResponse;
float maskAt(vec2 p) { return mix(1., smoothstep(uThreshold-uSoftness, uThreshold+uSoftness, texture2D(uPeople, clamp(p,0.,1.)).r), uRemove); }
vec3 vivid(vec3 c, float amount) {
  float peak = max(c.r,max(c.g,c.b));
  c -= min(c.r,min(c.g,c.b)) * amount * .85;
  return c * peak / max(.0001,max(c.r,max(c.g,c.b)));
}
void main() {
  float alpha = maskAt(vUv);
  vec3 camera = texture2D(uCamera,vUv).rgb;
  vec3 flow = texture2D(uFlow,vUv).rgb;
  vec4 gesture=texture2D(uGesture,vec2(.25,.5));
  float charge=gesture.w;
  float energy = clamp(length(flow.rg)*100.*uResponse,0.,1.);
  float height = dot(camera,vec3(.299,.587,.114));
  // Height contours keep a face and clothing readable; motion changes their colour locally.
  float bands = .5+.5*cos(height*50. + energy*5. + charge*4. - uTime*uRampShift);
  float ink = pow(bands,12.) * uContours;
  vec2 px = vec2(2./640.,2./360.);
  float edge = max(max(abs(alpha-maskAt(vUv+vec2(px.x,0.))),abs(alpha-maskAt(vUv-vec2(px.x,0.)))),
    max(abs(alpha-maskAt(vUv+vec2(0.,px.y))),abs(alpha-maskAt(vUv-vec2(0.,px.y)))));
  vec3 pigment = recolour(camera,vUv,uTime);
  pigment = mix(pigment,rampAt(fract(height*.7+energy*.3+uTime*uRampShift*.025)),ink*.65);
  pigment = vivid(pigment,uVividness);
  pigment *= .65 + charge*.4 + ink*.7 + edge*uContours*1.5;
  gl_FragColor = vec4(clamp(pigment,0.,1.)*alpha,alpha);
}`;

const common = /* glsl */`
uniform sampler2D uCamera, uMemory, uFlow, uDepth, uGesture;
uniform vec2 uSize;
uniform float uShift, uRelief, uFocus, uChroma, uBlock, uTear, uResponse, uEcho, uRelease;
float luma(vec3 c) { return dot(c, vec3(.2126, .7152, .0722)); }
vec2 safe(vec2 p) { return clamp(p, .5 / uSize, 1. - .5 / uSize); }
float heightAt(vec2 p) { return texture2D(uDepth, safe(p)).r; }
vec2 reliefUV(vec2 p) {
  vec2 e = vec2(4. / 1280., 4. / 720.);
  vec2 gradient = vec2(heightAt(p + vec2(e.x, 0.)) - heightAt(p - vec2(e.x, 0.)),
    heightAt(p + vec2(0., e.y)) - heightAt(p - vec2(0., e.y)));
  float depth = heightAt(p) - uFocus;
  return safe(p - (vec2(depth * .035, -depth * .018) + gradient * .12) * uRelief * uShift);
}
vec3 toYCC(vec3 c) { float y = luma(c); return vec3(y, (c.b-y)/1.8556, (c.r-y)/1.5748); }
vec3 fromYCC(vec3 c) { return vec3(c.x+1.5748*c.z, c.x-.1873*c.y-.4681*c.z, c.x+1.8556*c.y); }
`;

/** A small, filtered relief map avoids repeating camera neighbourhood reads at full resolution. */
const depthFragment = /* glsl */`
uniform sampler2D uCamera;
void main() {
  vec3 colour = vec3(0.);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++)
    colour += texture2D(uCamera, clamp(vUv + vec2(float(x), float(y)) / vec2(320.,180.), 0., 1.)).rgb;
  gl_FragColor = vec4(vec3(dot(colour / 9., vec3(.2126,.7152,.0722))), 1.);
}`;

/** Artistic codec simulation: motion vectors transport remembered pixels, with staggered block refresh. */
const memoryFragment = common + /* glsl */`
uniform float uKeep, uFresh, uTick, uSeed, uHold, uStamp, uStep;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 cell = floor(vUv * uSize / uBlock);
  vec2 centre = safe((cell + .5) * uBlock / uSize);
  vec3 flow = mix(texture2D(uFlow, vUv).rgb, texture2D(uFlow, centre).rgb, uTear);
  vec2 motion = flow.rg * uResponse * uFresh;
  float depth = heightAt(centre) - uFocus;
  vec2 tear = vec2(hash(cell) - .5, hash(cell + 7.) - .5) * uBlock / uSize;
  vec2 travel = motion * (1. + uShift * 5.) * (1. + depth * uRelief)
    + tear * uTear * min(1., flow.b * uResponse) * uFresh;
  // Motion carries isolated pigment outward. There is no random autonomous drift.
  travel += motion * uEcho * 7.;
  vec4 gesture=texture2D(uGesture,vec2(.25,.5));
  float burst=texture2D(uGesture,vec2(.75,.5)).z;
  travel += (vUv-gesture.xy)*burst*uRelease*uStep*.65;
  vec2 previous = vUv - travel;
  // Out-of-frame history is refreshed rather than stretching an edge indefinitely.
  float valid = step(0., previous.x) * step(previous.x, 1.) * step(0., previous.y) * step(previous.y, 1.);
  vec4 old = texture2D(uMemory, safe(previous)) * valid;
  vec4 current = texture2D(uCamera, reliefUV(vUv));
  float pulse = step(.93, hash(cell + floor(uTick * 5.))) * uFresh * uTear * (1. - uHold);
  old *= uKeep;
  vec4 stamp = current * uStamp * (1. - uHold);
  vec4 result = stamp + old * (1. - stamp.a);
  result = mix(result, current, pulse);
  gl_FragColor = mix(result, current, uSeed);
}`;

const displayFragment = common + recolourGLSL + echoGLSL + /* glsl */`
uniform float uMix, uVividness, uTime, uHalo;
vec3 saturated(vec3 c) {
  float peak = max(c.r,max(c.g,c.b));
  c -= min(c.r,min(c.g,c.b)) * uVividness * .85;
  return c * peak / max(.0001,max(c.r,max(c.g,c.b)));
}
void main() {
  vec2 p = reliefUV(vUv);
  vec3 flow = texture2D(uFlow, vUv).rgb;
  vec2 slip = (flow.rg * uResponse * 3. + vec2((heightAt(vUv)-uFocus) * .025, .003)) * uChroma;
  vec4 now = texture2D(uCamera, p);
  vec4 history = texture2D(uMemory, p);
  vec3 body = now.rgb + history.rgb * (1. - now.a);
  vec4 chromaHistory = texture2D(uMemory,safe(p-slip));
  vec3 wake = chromaHistory.rgb * (1.-now.a);
  vec3 ycc = toYCC(body);
  vec3 delayed = toYCC(now.rgb + wake);
  ycc.yz = mix(ycc.yz,delayed.yz,uChroma*.8);
  vec3 effect = saturated(clamp(fromYCC(ycc),0.,1.));
  vec4 gesture=texture2D(uGesture,vec2(.25,.5));
  vec4 movement=texture2D(uGesture,vec2(.75,.5));
  float burst=movement.z;
  vec2 relative=(vUv-gesture.xy)*vec2(16./9.,1.);
  float radius=.12+(1.-burst)*.35;
  float ring=1.-smoothstep(.002,.009,abs(length(relative)-radius));
  float angle=atan(relative.y,relative.x)/6.2831853+.5;
  vec3 flare=rampAt(fract(angle+uTime*.025))*ring*burst*burst*uHalo*uRelease;
  vec4 direct = texture2D(uCamera, vUv);
  vec3 echoes = poseEchoes(vUv) * (1. - max(now.a, direct.a));
  effect = saturated(clamp(effect + flare + echoes, 0., 1.));
  if (max(effect.r,max(effect.g,effect.b)) < .001) effect = vec3(0.);
  // Effect mix reveals the isolated, recoloured participant, never the original room.
  gl_FragColor = vec4(mix(direct.rgb,effect,uMix),1.);
}`;

export class Signal implements Look {
  private readonly memory: Pair;
  private readonly echoes: SignalEchoes;
  private readonly gestures: Pair;
  private readonly recognise: THREE.ShaderMaterial;
  private readonly zeroGestures: THREE.ShaderMaterial;
  private readonly subject: THREE.WebGLRenderTarget;
  private readonly isolate: THREE.ShaderMaterial;
  private appearance = '';
  private readonly depth: THREE.WebGLRenderTarget;
  private readonly measureDepth: THREE.ShaderMaterial;
  private readonly image: THREE.WebGLRenderTarget;
  private readonly remember: THREE.ShaderMaterial;
  private readonly display: THREE.ShaderMaterial;
  private seed = true;
  private mirror: boolean | null = null;

  constructor(private readonly passes: Passes, width: number, height: number) {
    this.memory = passes.pair(width, height);
    this.echoes = new SignalEchoes(passes);
    this.gestures=passes.pair(2,1,{nearest:true});
    this.zeroGestures=passes.material('void main(){gl_FragColor=vec4(0.);}',{});
    this.recognise=passes.material(gestureFragment,{
      uPrevious:{value:null},uPeople:{value:null},uFlow:{value:null},uStep:{value:0},uResponse:{value:1},uChargeSeconds:{value:2.5},uRemove:{value:1},
    });
    this.resetGestures();
    this.subject = passes.target(width, height);
    this.isolate = passes.material(subjectFragment, {
      uGesture: { value: this.gestures.read.texture }, uCamera: { value: null }, uPeople: { value: null }, uFlow: { value: null },
      uRemove: { value: 1 }, uThreshold: { value: .45 }, uSoftness: { value: .06 }, uVividness: { value: 1 },
      uContours: { value: .65 }, uTime: { value: 0 }, uResponse: { value: 1 }, uRamp: { value: null }, uRampShift: { value: 0 },
    });
    this.depth = passes.target(320, 180);
    this.measureDepth = passes.material(depthFragment, { uCamera: { value: null } });
    this.image = passes.target(width, height);
    const uniforms = () => ({
      uGesture: { value: this.gestures.read.texture }, uDepth: { value: this.depth.texture }, uCamera: { value: null }, uMemory: { value: null }, uFlow: { value: null }, uSize: { value: new THREE.Vector2(width, height) },
      uShift: { value: 0 }, uRelief: { value: 0 }, uFocus: { value: 0 }, uChroma: { value: 0 }, uBlock: { value: 24 }, uTear: { value: 0 }, uResponse: { value: 1 }, uEcho: { value: .5 }, uRelease: { value: .65 },
    });
    this.remember = passes.material(memoryFragment, { ...uniforms(), uKeep: { value: 0 }, uFresh: { value: 0 }, uTick: { value: 0 }, uSeed: { value: 1 }, uHold: { value: 0 }, uStamp: { value: 0 }, uStep: { value: 0 } });
    this.display = passes.material(displayFragment, { ...uniforms(), uMix: { value: 1 }, uVividness: { value: 1 }, uTime: { value: 0 }, uHalo: { value: .55 }, ...this.echoes.uniforms(), uRamp: { value: null }, uRampShift: { value: 0 } });
  }

  get output(): THREE.Texture { return this.image.texture; }

  step(seconds: number, time: number, feed: TrackingFeed, settings: LiveSettings): void {
    const p = settings.signal;
    const appearance = `${p.removeBackground}:${p.palette.join()}:${p.maskThreshold}:${p.maskSoftness}:${p.keepStill}:${settings.people.useEmptyRoom}:${personStillTimeout(settings)}`;
    if (appearance !== this.appearance) { this.clear(); this.appearance = appearance; }
    // Reset before drawing any pass with the new orientation.
    if (this.mirror !== settings.mirror) this.clear();
    this.mirror = settings.mirror;
    if (seconds > 0) {
      const g=this.recognise.uniforms;
      g.uPrevious.value=this.gestures.read.texture;g.uPeople.value=feed.people;g.uFlow.value=feed.flow;g.uStep.value=seconds;
      g.uChargeSeconds.value=p.chargeSeconds;g.uResponse.value=p.response;g.uRemove.value=p.removeBackground?1:0;
      this.passes.draw(this.recognise,this.gestures.write);this.gestures.swap();
    }
    const isolate = this.isolate.uniforms;
    isolate.uGesture.value=this.gestures.read.texture;
    setRamp(isolate,p.palette,p.colourChange);
    isolate.uCamera.value = feed.camera; isolate.uPeople.value = feed.people; isolate.uFlow.value = feed.flow;
    isolate.uRemove.value = p.removeBackground ? 1 : 0; isolate.uThreshold.value = p.maskThreshold; isolate.uSoftness.value = p.maskSoftness;
    isolate.uVividness.value = p.vividness; isolate.uContours.value = p.contours; isolate.uTime.value = time; isolate.uResponse.value = p.response;
    this.passes.draw(this.isolate,this.subject);
    if (feed.fresh || this.seed) {
      this.measureDepth.uniforms.uCamera.value = feed.camera;
      this.passes.draw(this.measureDepth, this.depth);
    }
    for (const material of [this.remember, this.display]) {
      const u = material.uniforms;
      u.uGesture.value=this.gestures.read.texture;u.uRelease.value=p.release;
      u.uCamera.value = this.subject.texture; u.uFlow.value = feed.flow;
      u.uShift.value = p.shift; u.uRelief.value = p.relief; u.uFocus.value = p.focus;
      u.uChroma.value = p.chroma; u.uBlock.value = p.blockSize; u.uTear.value = p.tear; u.uResponse.value = p.response; u.uEcho.value = p.echoSpread;
    }
    if (seconds > 0 || this.seed) {
      const u = this.remember.uniforms;
      u.uMemory.value = this.memory.read.texture;
      u.uKeep.value = p.hold ? 1 : Math.exp(-3 * seconds / p.memorySeconds);
      u.uFresh.value = feed.fresh ? 1 : 0; u.uTick.value = time;
      u.uStep.value=seconds;
      u.uStamp.value = 1 - Math.exp(-12 * seconds);
      u.uSeed.value = this.seed ? 1 : 0; u.uHold.value = p.hold ? 1 : 0;
      this.passes.draw(this.remember, this.memory.write); this.memory.swap(); this.seed = false;
    }
    this.echoes.apply(this.subject.texture, time, seconds > 0 && feed.fresh && feed.peopleReady, p, this.display.uniforms);
    setRamp(this.display.uniforms,p.palette,p.colourChange);
    this.display.uniforms.uTime.value=time;this.display.uniforms.uHalo.value=p.halo;
    this.display.uniforms.uMemory.value = this.memory.read.texture;
    this.display.uniforms.uMix.value = p.mix;
    this.display.uniforms.uVividness.value = p.vividness;
    this.passes.draw(this.display, this.image);
  }

  clear(): void { this.seed = true; this.echoes.clear(); this.resetGestures(); }
  private resetGestures(): void {
    this.passes.draw(this.zeroGestures,this.gestures.read);this.passes.draw(this.zeroGestures,this.gestures.write);
  }
  /** Read-only diagnostics for GPU checks; not called in the display loop. */
  readGesture(): { energy:number; charge:number; burst:number } {
    const data=new Uint16Array(8);this.passes.renderer.readRenderTargetPixels(this.gestures.read,0,0,2,1,data);
    const values=Array.from(data,THREE.DataUtils.fromHalfFloat);
    return {energy:values[2],charge:values[3],burst:values[6]};
  }
  resize(width: number, height: number): void {
    this.subject.setSize(width, height); this.memory.setSize(width, height); this.image.setSize(width, height);
    for (const m of [this.remember, this.display]) (m.uniforms.uSize.value as THREE.Vector2).set(width, height);
    this.clear();
  }
  dispose(): void { this.echoes.dispose(); this.gestures.dispose();this.recognise.dispose();this.zeroGestures.dispose();this.subject.dispose(); this.isolate.dispose(); this.memory.dispose(); this.depth.dispose(); this.measureDepth.dispose(); this.image.dispose(); this.remember.dispose(); this.display.dispose(); }
}
