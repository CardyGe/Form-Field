import { isCellWave } from '../core/graphics';
import { delayOrder, stagedTime } from '../core/timing';
import type { Layer } from '../shared/types';
import { seededRandom } from '../core/project';

const TAU = Math.PI * 2;
export interface Point { x: number; y: number }
export interface Tile { x: number; y: number; w: number; h: number }
export interface GraphicLayout { columns: number[]; tiles: Tile[]; paths: Point[][]; columnsCount: number; rowsCount: number }
export interface Glyph {
  x: number; y: number; hx: number; hy: number; type: number; roundness: number; sides: number; angle: number;
  color: number; fill: number; stroke: number; spacing: number; duty: number; bandPhase: number; alpha: number; erase: boolean;
  cellX?: number; cellY?: number; textureSeed?: number;
}
type Params = Record<string, number>;
const clamp = (v: number, a: number, b: number) => Math.max(a,Math.min(b,v));
/** Radial fields add outer geometry when zoomed out, keeping a single centre. */
export function graphicPatternExtent(layer: Layer, phase: number, aspect: number): number {
  const p = layer.params, tr = layer.transform;
  const wrapped = ((phase % TAU) + TAU) % TAU;
  const angle = p.orientation + (p.style === 4 ? 0 : p.turns * wrapped);
  const c = Math.cos(angle), s = Math.sin(angle), lc = Math.cos(tr.rotation), ls = Math.sin(tr.rotation);
  let extent = 0;
  for (const x of [-aspect / 2, aspect / 2]) for (const y of [-.5, .5]) {
    const px = x - tr.x * aspect, py = y + tr.y;
    const qx = (px * lc - py * ls) / tr.scale - p.centerX * aspect * .5;
    const qy = (px * ls + py * lc) / tr.scale - p.centerY * .5;
    extent = Math.max(extent, Math.hypot((qx * c + qy * s) / (p.size * p.stretch), (-qx * s + qy * c) / p.size));
  }
  return Math.max(1, extent / Math.hypot(aspect / 2, .5));
}
export function graphicLayoutKey(p: Params, aspect: number): string {
  const style = p.style;
  const keys = style === 0 ? ['columns','widthScatter'] : style === 2 ? ['tileResolution', ...(isCellWave(style, p.variant) ? [] : ['tileArea'])] : style === 4 ? ['variant','pathResolution','pathLength','direction','bias'] : [];
  return [style,p.seed,aspect.toFixed(6),...keys.map(k => p[k])].join(':');
}
/** Geometry is generated from saved state only; seeking never consumes random state. */
export function generateGraphicLayout(p: Params, aspect: number): GraphicLayout {
  const random = seededRandom(p.seed);
  const result: GraphicLayout = {columns:[],tiles:[],paths:[],columnsCount:0,rowsCount:0};
  if (p.style === 0) {
    const count = Math.round(p.columns);
    const weights = Array.from({length:count},()=>1+(random()*2-1)*p.widthScatter);
    const sum = weights.reduce((a,b)=>a+b,0);
    result.columns = weights.map(w=>w/sum);return result;
  }
  if (p.style !== 2 && p.style !== 4) return result;
  let rows = Math.round(p.style === 2 ? p.tileResolution : p.pathResolution);
  const mirrored = p.style === 4 && p.variant === 2;
  if(mirrored)rows+=rows%2;
  // A legal very wide project must not allocate hundreds of thousands of
  // occupancy cells. Ordinary landscape/portrait sizes retain their density.
  let cols = Math.max(2,Math.min(Math.floor(12288/rows),Math.round(rows*aspect)));
  if(mirrored)cols-=cols%2;
  result.columnsCount=cols;result.rowsCount=rows;
  if (isCellWave(p.style, p.variant)) {
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      result.tiles.push({ x: ((x + .5) / cols - .5) * aspect, y: .5 - (y + .5) / rows, w: aspect / cols, h: 1 / rows });
    }
    return result;
  }
  const w = mirrored ? cols/2 : cols, h = mirrored ? rows/2 : rows;
  const used = new Uint8Array(w*h);
  const cells = Array.from({length:w*h},(_,i)=>i);
  for(let i=cells.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[cells[i],cells[j]]=[cells[j],cells[i]];}
  // Pack on a torus: a tile or wire can cross a repeat boundary rather than
  // stopping every shape at the edge of a rectangular screenshot. Keep the
  // mirrored quarter bounded so the reflection axes retain their symmetry.
  const index=(x:number,y:number)=>((y%h+h)%h)*w+(x%w+w)%w;
  const free=(x:number,y:number)=>(!mirrored||(x>=0&&y>=0&&x<w&&y<h))&&!used[index(x,y)];
  for(const cell of cells){
    if(used[cell])continue;
    const x=cell%w,y=Math.floor(cell/w);
    if(p.style===2){
      let tw=1,th=1;
      const targetW=Math.min(w,1+Math.floor(random()*p.tileArea));
      const targetH=Math.min(h,1+Math.floor(random()*Math.min(p.tileArea,targetW*2)));
      while(tw<targetW&&free(x+tw,y))tw++;
      while(th<targetH){let fits=true;for(let xx=x;xx<x+tw;xx++)if(!free(xx,y+th)){fits=false;break;}if(!fits)break;th++;}
      for(let yy=y;yy<y+th;yy++)for(let xx=x;xx<x+tw;xx++)used[index(xx,yy)]=1;
      result.tiles.push({x:(x+tw/2)/cols*aspect-aspect/2,y:.5-(y+th/2)/rows,w:tw/cols*aspect,h:th/rows});
    } else {
      const path:Point[]=[];let xx=x,yy=y;
      for(let step=0;step<Math.round(p.pathLength);step++){
        used[index(xx,yy)]=1;path.push({x:(xx+.5)/cols*aspect-aspect/2,y:.5-(yy+.5)/rows});
        const choices=[[1,0],[-1,0],[0,1],[0,-1]].filter(([dx,dy])=>free(xx+dx,yy+dy));
        if(!choices.length)break;
        let best=choices[0],score=-Infinity;
        for(const dir of choices){
          const [dx,dy]=dir;
          let value=random();
          if(p.variant===1)value=value*(1-p.bias)+p.bias*(dx*Math.cos(p.direction)-dy*Math.sin(p.direction));
          if(p.variant===3){const before=Math.hypot(xx-cols/2,yy-rows/2),after=Math.hypot(xx+dx-cols/2,yy+dy-rows/2);value=.15*value+before-after;}
          if(value>score){score=value;best=dir;}
        }
        xx+=best[0];yy+=best[1];
      }
      if(mirrored){for(const sx of [1,-1])for(const sy of [1,-1])result.paths.push(path.map(pt=>({x:pt.x*sx,y:pt.y*sy})));}
      else result.paths.push(path);
    }
  }
  return result;
}

export class GraphicLayoutCache {
  private readonly entries = new Map<string,GraphicLayout>();
  get(p:Params,aspect:number):GraphicLayout {
    const key=graphicLayoutKey(p,aspect),existing=this.entries.get(key);
    if(existing)return existing;
    const layout=generateGraphicLayout(p,aspect);this.entries.set(key,layout);
    if(this.entries.size>12)this.entries.delete(this.entries.keys().next().value!);
    return layout;
  }
  clear():void {this.entries.clear();}
}

function smoothBetween(low: number, high: number, value: number): number {
  const t = clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Integer spatial harmonics keep both axes continuous when the grid is repeated. */
function cellWaveField(variant: number, x: number, y: number, phase: number, angle: number, detail: number): number {
  if (variant === 6) {
    const radius = Math.hypot(Math.sin(x * .5), Math.sin(y * .5));
    return Math.cos(radius * (7 + detail * 3) - phase) * .89 + .11 * Math.sin(x - y + phase);
  }
  const across = Math.cos(angle), up = Math.sin(angle);
  // The temporal phase itself must complete an integer turn. Use the direction
  // for spatial weighting, and blend opposing travelling waves continuously.
  const cosPhase = Math.cos(phase), sinPhase = Math.sin(phase);
  const fine = Math.sin(2 * x - y + phase) * detail;
  if (variant === 5) {
    const first = Math.sin(x - y) * cosPhase - Math.cos(x - y) * sinPhase * across;
    const second = Math.cos(x + y) * cosPhase + Math.sin(x + y) * sinPhase * up;
    return .5 * first + .5 * second + .09 * fine;
  }
  const bentX = x + .32 * Math.cos(y - phase), bentY = y + .61 * Math.sin(x + phase);
  const waveX = Math.sin(bentX) * cosPhase - across * Math.cos(bentX) * sinPhase;
  const waveY = Math.sin(bentY) * cosPhase - up * Math.cos(bentY) * sinPhase;
  return (waveX * Math.abs(across) + waveY * Math.abs(up)
    + .21 * Math.sin(x + y + phase) + .14 * fine) / (Math.abs(across) + Math.abs(up) + .35);
}

/** Pure frame sampling. All spatial units are fractions of canvas height. */
export function sampleGraphicGlyphs(layer:Layer,phase:number,aspect:number,layout:GraphicLayout):Glyph[] {
  const p=layer.params;
  const wrapped=((phase%TAU)+TAU)%TAU;
  const t=wrapped*Math.round(p.cycles)+p.phaseOffset*TAU;
  const oscillation=Math.sin(t),motion=p.motion;
  const rotation=p.orientation+(p.style===4?0:p.turns*wrapped);
  const c=Math.cos(rotation),s=Math.sin(rotation);
  const lc=Math.cos(-layer.transform.rotation),ls=Math.sin(-layer.transform.rotation);
  const result:Glyph[]=[];
  const emit=(g:Glyph)=>{
    const px=g.x*p.size*p.stretch,py=g.y*p.size;
    const qx=(px*c-py*s+p.centerX*aspect*.5)*layer.transform.scale;
    const qy=(px*s+py*c+p.centerY*.5)*layer.transform.scale;
    const worldX=qx*lc-qy*ls+layer.transform.x*aspect,worldY=qx*ls+qy*lc-layer.transform.y;
    // Keep shape coordinates local. The GPU transforms complete glyphs after
    // their local rotation so stretched vertical path segments still meet.
    const bound=Math.hypot(g.hx,g.hy)*p.size*Math.max(p.stretch,1)*layer.transform.scale+.01;
    if(g.hx>0&&g.hy>0&&Math.abs(worldX)<aspect/2+bound&&Math.abs(worldY)<.5+bound)result.push(g);
  };
  const push=(x:number,y:number,hx:number,hy:number,color:number,options:Partial<Glyph>={})=>{
    const g:Glyph={x,y,hx,hy,color,type:0,roundness:1,sides:6,angle:0,fill:0,stroke:p.stroke/1080,spacing:p.contourSpacing/1080,duty:p.contourDuty,bandPhase:0,alpha:1,erase:false,...options};
    if(p.style===1||p.style===3){emit(g);return;}
    const ca=Math.abs(Math.cos(g.angle)),sa=Math.abs(Math.sin(g.angle));
    const bx=ca*hx+sa*hy+.01*Math.min(aspect,1),by=sa*hx+ca*hy+.01;
    const x0=Math.ceil((-.5*aspect-bx-x)/aspect),x1=Math.floor((.5*aspect+bx-x)/aspect);
    const y0=p.style===0?0:Math.ceil(-.5-by-y),y1=p.style===0?0:Math.floor(.5+by-y);
    for(let iy=y0;iy<=y1;iy++)for(let ix=x0;ix<=x1;ix++)emit({...g,x:x+ix*aspect,y:y+iy});
  };
  // Per-element clock: an element at (x, y) runs behind the first by its delay order.
  const staged=(time:number,x:number,y:number)=>p.delaySpread>0||p.pause>0?stagedTime(time,delayOrder(x,y,aspect,p.delayShape),p.delaySpread,p.pause):time;
  const colour=(v:number)=>v*p.colorDensity+p.colorOffset*2+motion*p.colorDrift*oscillation;
  if(p.style===0){
    let x=-aspect/2;
    layout.columns.forEach((fraction,i)=>{
      const width=fraction*aspect,half=Math.max(.00001,(width-p.gutter/1080)/2);
      // Fractional wave counts blend neighbouring closed waves; they never
      // leave a phase jump at the horizontal join.
      const phase=i/layout.columns.length*TAU, time=staged(t,x+width/2,0)*Number(motion>0);
      const waves=Math.floor(p.waveCount),blend=p.waveCount-waves;
      const wave=(1-blend)*Math.sin(phase*waves+time)+blend*Math.sin(phase*(waves+1)+time);
      const split=p.amplitude*wave*(.25+.75*motion),gap=p.gap;
      const top=clamp(split+gap/2,-.5,.5),bottom=clamp(split-gap/2,-.5,.5);
      const color=colour(.5+.5*Math.sin(phase));
      // Extend the outer ends outside the repeat cell. Only the inner ends
      // have visible rounded caps; adjoining rows share the same pigment.
      push(x+width/2,(.8+top)/2,half,(.8-top)/2,color,{roundness:p.roundness});
      push(x+width/2,(-.8+bottom)/2,half,(bottom+.8)/2,color,{roundness:p.roundness});
      x+=width;
    });
  }else if(p.style===1){
    const n=Math.round(p.circleCount),wanted=Math.ceil(n*graphicPatternExtent(layer,phase,aspect)-1e-8);
    const stride=Math.max(1,Math.ceil(wanted/12288)),count=Math.ceil(wanted/stride);
    for(let i=count-1;i>=0;i--){
      const index=i*stride,k=(index+1)/n,tk=stagedTime(t,k,p.delaySpread,p.pause),r=p.radius*k*(1+motion*p.breathing*Math.cos(tk));
      const sign=i%2?1:-1,pivot=sign*p.orbit*r;
      const a=sign*(p.coil*index+motion*p.coilDepth*index*.12*Math.sin(tk));
      push(pivot*(1-Math.cos(a)),-pivot*Math.sin(a),r,r,colour(k),{type:1});
    }
  }else if(isCellWave(p.style, p.variant)){
    const seed = (p.seed % 4093) / 4093 * TAU;
    for (const tile of layout.tiles) {
      const x = TAU * tile.x / aspect, y = TAU * tile.y;
      const time = seed + staged(t, tile.x, tile.y);
      const detail = p.sweepSpread;
      const fieldX = x + .4 * Math.sin(y + seed), fieldY = y + .36 * Math.sin(x - seed);
      const sample = (phase: number) => cellWaveField(p.variant, fieldX, fieldY, phase, p.sweepAngle, detail);
      const lead = p.cellColourLead * TAU;
      const field = sample(seed) * (1 - motion) + sample(time) * motion;
      const pigment = sample(seed + lead) * (1 - motion) + sample(time + lead) * motion;
      const level = Math.abs(field);
      const edge = .23 + p.sweepWidth * .35;
      const growth = smoothBetween(.13, edge + .22, level);
      const frames = smoothBetween(.13, edge, level) * (1 - smoothBetween(edge + .06, edge + .24, level));
      const speckle = .5 + .5 * Math.sin(3 * x - 5 * y + seed);
      const diameter = p.cellMinimum * (.78 + .30 * speckle) * (1 - growth) + growth;
      const size = Math.min(tile.w, tile.h) * (.5 - p.tileGap) * diameter;
      const colourBand = p.variant === 4
        ? .12 + .76 * smoothBetween(-.16, .16, pigment)
        : .1 + .8 * smoothBetween(-.62, .62, pigment);
      push(tile.x, tile.y, size, size, colour(colourBand + .065 * (speckle - .5)), {
        roundness: 1 + (p.roundness - 1) * growth,
        fill: 3, duty: p.cellFrames * frames,
        bandPhase: p.cellInset * frames * frames * p.cellFrames,
        textureSeed: speckle,
      });
    }
  }else if(p.style===2){
    const cell=Math.min(aspect/layout.columnsCount,1/layout.rowsCount);
    for(const tile of layout.tiles){
      // A periodic wave phase and palette close over both axes, including
      // tiles that straddle a boundary. The radial phase closes
      // smoothly too, so changing wave layout never exposes a cell border.
      const a=TAU*tile.x/aspect,b=TAU*tile.y;
      const spatial=p.sweep===2?(Math.cos(a)+Math.cos(b))*.18:(Math.sin(a)*Math.cos(p.sweepAngle)+Math.sin(b)*Math.sin(p.sweepAngle))*.25;
      const relative=((staged(t,tile.x,tile.y)/TAU-spatial*p.sweepSpread)%1+1)%1;
      const dist=Math.min(relative,1-relative),width=p.sweepWidth*.5;
      const pulse=p.sweep===0?0:motion*(dist<width?.5+.5*Math.cos(Math.PI*dist/width):0);
      const shrink=1-p.shrink*pulse;
      push(tile.x,tile.y,Math.max(.00001,tile.w/2-cell*p.tileGap)*shrink,Math.max(.00001,tile.h/2-cell*p.tileGap)*shrink,colour(.5+.5*Math.sin(a+b)),{
        roundness:clamp(p.roundness+p.rounding*pulse,0,1),fill:p.fill,bandPhase:pulse*p.contourSpacing/2160,
      });
    }
  }else if(p.style===3){
    const timed=p.delaySpread>0||p.pause>0;
    let step=p.angularStep+motion*p.twistDepth*oscillation;
    const count=Math.round(p.glyphCount);
    const wanted=Math.ceil(count*graphicPatternExtent(layer,phase,aspect)-1e-8);
    const stride=Math.max(1,Math.ceil(wanted/24576));
    for(let i=1;i<=wanted;i+=stride){
      if(timed)step=p.angularStep+motion*p.twistDepth*Math.sin(stagedTime(t,i/Math.max(1,count),p.delaySpread,p.pause));
      const r=i*p.spacing,a=i*step;
      const radius=p.glyphSize*Math.pow(r,p.growth);
      const profile=Math.round(p.profile);
      push(r*Math.cos(a),r*Math.sin(a),radius,profile===1?p.stroke/2160:radius,colour(i/count),{
        type:profile<2?(profile===0?1:0):2,sides:profile+1,roundness:1,angle:p.profileAngle,
        // Separate fill and border are evaluated inside one shape, preserving painter order.
        fill:0,
      });
    }
  }else if(p.style===4){
    const cell=Math.min(aspect/layout.columnsCount,1/layout.rowsCount);
    const width=cell*p.pathWidth;
    const openAt=(time:number)=>Math.min(1,(1-Math.cos(time))*.5/Math.max(.2,1-p.hold));
    const segment=(a:Point,b:Point,pathColor:number,erase:boolean)=>{
      const d=Math.hypot(b.x-a.x,b.y-a.y),thickness=width*(erase?p.hollow:1);
      push((a.x+b.x)/2,(a.y+b.y)/2,d/2+thickness/2,thickness/2,pathColor,{angle:Math.atan2(b.y-a.y,b.x-a.x),roundness:p.corners===1?1:p.corners===2?.3:0,erase});
    };
    layout.paths.forEach(path=>{
      const lengths=path.slice(1).map((pt,i)=>Math.hypot(pt.x-path[i].x,pt.y-path[i].y));
      const progress=p.reveal*(1-motion+motion*openAt(staged(t,path[0].x,path[0].y)));
      const total=lengths.reduce((a,b)=>a+b,0),limit=total*progress;
      const color=colour(.15+.7*(1-path.length/Math.max(1,p.pathLength)));
      for(const erase of [false,true]){
        if(erase&&p.hollow<=0)continue;
        if(path.length===1){const r=width*.5*(erase?p.hollow:1);push(path[0].x,path[0].y,r,r,color,{type:1,erase});continue;}
        let travelled=0;
        for(let i=1;i<path.length;i++){
          const len=lengths[i-1];if(travelled>=limit)break;
          const fraction=Math.min(1,(limit-travelled)/len),a=path[i-1],b=path[i];
          segment(a,{x:a.x+(b.x-a.x)*fraction,y:a.y+(b.y-a.y)*fraction},color,erase);travelled+=len;
        }
      }
    });
  }
  return result;
}
