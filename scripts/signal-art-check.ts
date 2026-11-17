/** GPU checks run in a small Electron preview, using the actual Live renderer. */
import { LiveRenderer } from '../src/live/LiveRenderer';
import { TestSource, TestMaskProvider } from '../src/live/test-source';
import { defaultLiveSettings, SIGNAL_STARTS } from '../src/live/settings';
import type { LiveSettings } from '../src/live/settings';
import type { MaskProvider } from '../src/live/MaskProvider';

const canvas = document.querySelector('canvas')!;
let renderer: LiveRenderer, source: TestSource;
const results: { name: string; passed: boolean; detail?: unknown }[] = [];
const make = (change: (s: LiveSettings) => void = () => {}, masks = true) => {
  renderer?.dispose();
  source = new TestSource(); source.figure = true;
  renderer = new LiveRenderer(canvas, source, masks ? () => new TestMaskProvider(() => source) : () => ({status:{state:'failed',reason:'test'},ready:false,submit(){},latest(){return null;},dispose(){}} as MaskProvider));
  renderer.settings = defaultLiveSettings(); renderer.settings.look = 'signal'; renderer.settings.quality = 720;
  renderer.settings.people.ignoreStillSeconds = null;
  change(renderer.settings);
};
const run = (frames: number) => { for (let i=0;i<frames;i++) { source.advance(1/60); renderer.frame(1/60); } };
const pixels = () => {const c=document.createElement('canvas');c.width=canvas.width;c.height=canvas.height;const ctx=c.getContext('2d')!;ctx.drawImage(canvas,0,0);return ctx.getImageData(0,0,c.width,c.height).data;};
const metrics = () => { const data=pixels();let lit=0,sat=0,edge=0,corners=0;for(let y=0;y<720;y++)for(let x=0;x<1280;x++){const i=(y*1280+x)*4; const hi=Math.max(data[i],data[i+1],data[i+2]),lo=Math.min(data[i],data[i+1],data[i+2]);if(hi>20){lit++;sat+=(hi-lo)/hi;}if(x<20||x>1260||y<10||y>710)edge=Math.max(edge,hi);if((x<20||x>1260)&&(y<10||y>710))corners=Math.max(corners,hi);}return {lit,saturation:sat/Math.max(1,lit),edge,corners};};
const check = (name:string,passed:boolean,detail?:unknown) => {results.push({name,passed,detail});console.log('SIGNAL_CHECK '+JSON.stringify(results.at(-1)));};

async function checks() {
  make(undefined,false); run(30); const missing=metrics(); check('Missing person masks keep the entire room black', missing.lit===0,missing);
  make(); run(180); let m=metrics(); check('A masked participant is vivid on a black surround',m.lit>4000&&m.saturation>.5&&m.edge===0,m);
  const before=pixels().slice(); for(let i=0;i<5;i++)renderer.frame(0); const after=pixels();check('Zero-time redraw leaves feedback unchanged',before.every((v,i)=>v===after[i]));
  const presetPixels:Uint8ClampedArray[]=[];
  for(const preset of SIGNAL_STARTS){make(s=>Object.assign(s.signal,preset.values));run(180);presetPixels.push(pixels().slice());m=metrics();check(preset.label+' stays vivid without filling the frame',m.lit>2000&&m.saturation>.45&&m.corners===0&&m.lit<1280*720*.4,m);}
  check('Starting points produce visibly different images',presetPixels.slice(1).every(data=>{let delta=0;for(let i=0;i<data.length;i+=16)delta+=Math.abs(data[i]-presetPixels[0][i]);return delta>10000;}));
  make(s=>{s.signal.removeBackground=false;});run(5);m=metrics();check('The room appears only when background removal is explicitly off',m.edge>20,m);
  renderer.settings.signal.removeBackground=true;renderer.frame(1/60);m=metrics();check('Enabling cutout immediately purges room pixels from memory',m.edge===0,m);
  make();run(180);renderer.settings.signal.hold=true;renderer.settings.signal.mix=1;renderer.frame(1/60);renderer.blackout=true;renderer.frame(0);m=metrics();check('Blackout remains fully black',m.lit===0,m);
  make(s=>{s.people.ignoreStillSeconds=10;});source.moving=false;run(720);
  const charged=renderer.signalInteraction()!;m=metrics();
  check('Still participants remain visible beyond the normal still-object timeout',m.lit>4000,m);
  check('Holding still builds a full pose charge',charged.charge>.9&&charged.energy<.05,charged);
  source.moving=true;let released=0;for(let i=0;i<60;i++){run(1);released=Math.max(released,renderer.signalInteraction()!.burst);}
  check('Moving after a held pose releases stored energy',released>.08,{released,state:renderer.signalInteraction()});
  const redraw=renderer.signalInteraction()!;for(let i=0;i<5;i++)renderer.frame(0);
  check('Zero-time redraw cannot charge or release a gesture',JSON.stringify(redraw)===JSON.stringify(renderer.signalInteraction()));
  renderer.clear();renderer.frame(0);const cleared=renderer.signalInteraction()!;
  check('Clear also resets stored pose energy',cleared.charge===0&&cleared.burst===0,cleared);
  const poseTest = (amount: number, count = 8, fill = .07, frames = 180) => {
    make(s => Object.assign(s.signal, { poseEcho: amount, poseCount: count, poseFill: fill, poseSpacing: .25, memorySeconds: .1, release: 0, relief: 0, chroma: 0, tear: 0 }));
    source.signalDemo = true;
    run(frames);
    return pixels().slice();
  };
  const bare = poseTest(0), echoed = poseTest(1);
  let addedOutlinePixels = 0;
  for (let i = 0; i < bare.length; i += 4)
    if (Math.max(bare[i], bare[i + 1], bare[i + 2]) < 3 && Math.max(echoed[i], echoed[i + 1], echoed[i + 2]) > 35) addedOutlinePixels++;
  check('Pose echoes reveal earlier positions outside the live silhouette', addedOutlinePixels > 100, { addedOutlinePixels });
  renderer.clear();
  renderer.frame(0);
  const reset = pixels();
  let removedOutlinePixels = 0;
  for (let i = 0; i < reset.length; i += 4)
    if (Math.max(reset[i], reset[i + 1], reset[i + 2]) < 3 && Math.max(echoed[i], echoed[i + 1], echoed[i + 2]) > 35) removedOutlinePixels++;
  check('Clear removes the cached poses immediately', removedOutlinePixels > 100, { removedOutlinePixels });
  const cleanDemo = metrics();
  check('The demonstration mask excludes the synthetic room poster',
    Math.max(...[0, 1, 2].map(channel => reset[(250 * 1280 + 100) * 4 + channel])) === 0 && cleanDemo.lit > 4000);
  const shortHistory = poseTest(1, 4, 0, 305);
  const longHistory = poseTest(1, 16, 0, 305);
  const filledHistory = poseTest(1, 16, .7, 305);
  let olderPosePixels = 0, filledPosePixels = 0;
  for (let i = 0; i < shortHistory.length; i += 4) {
    const shortPeak = Math.max(shortHistory[i], shortHistory[i + 1], shortHistory[i + 2]);
    const longPeak = Math.max(longHistory[i], longHistory[i + 1], longHistory[i + 2]);
    const filledPeak = Math.max(filledHistory[i], filledHistory[i + 1], filledHistory[i + 2]);
    if (shortPeak < 3 && longPeak > 24) olderPosePixels++;
    if (longPeak < 3 && filledPeak > 24) filledPosePixels++;
  }
  check('Sixteen poses retain outlines that disappear at four, after the atlas wraps', olderPosePixels > 200, { olderPosePixels });
  check('Pose fill reveals interiors independently of the outline history', filledPosePixels > 200, { filledPosePixels });
  console.log('SIGNAL_RESULTS '+JSON.stringify(results));
  document.querySelector('#results')!.textContent=results.map(r=>(r.passed?'PASS ':'FAIL ')+r.name).join('\n');
  make(s=>Object.assign(s.signal,SIGNAL_STARTS.at(-1)!.values));source.signalDemo=true;run(180);
  let last=performance.now();const animate=(now:number)=>{const dt=Math.min(.05,(now-last)/1000);last=now;source.moving=source.seconds%7>=3;source.advance(dt);renderer.frame(dt);requestAnimationFrame(animate);};requestAnimationFrame(animate);
  const select=document.querySelector('select')!;SIGNAL_STARTS.forEach((p,i)=>{const o=document.createElement('option');o.textContent=p.label;o.value=String(i);select.append(o);});select.value=String(SIGNAL_STARTS.length - 1);select.onchange=()=>{Object.assign(renderer.settings.signal,SIGNAL_STARTS[Number(select.value)].values);renderer.clear();};
}
checks().catch(e=>console.error('SIGNAL_FATAL '+String(e.stack||e)));
