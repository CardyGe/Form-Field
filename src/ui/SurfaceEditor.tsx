import {useRef,useState} from 'react';
import type {Layer} from '../shared/types';
import {isSimplePolygon} from '../core/surface-layout';

type Surface=NonNullable<Layer['surface']>;
const initial:Surface={source:'polygon',role:'obstacle',influence:1,points:[{x:.34,y:.3},{x:.66,y:.3},{x:.66,y:.7},{x:.34,y:.7}]};
export function SurfaceEditor({layer,onChange,onStart,onEnd}:{layer:Layer;onChange:(s:Surface|undefined)=>void;onStart:()=>void;onEnd:()=>void}){
 const surface=layer.surface,drag=useRef<number|null>(null),[selected,setSelected]=useState(0);
 const move=(index:number,x:number,y:number)=>{if(!surface)return;const points=surface.points.map((p,i)=>i===index?{x:Math.max(0,Math.min(1,x)),y:Math.max(0,Math.min(1,y))}:p);if(isSimplePolygon(points))onChange({...surface,points});};
 return <details className="control-section inspector-section surface-editor"><summary>Surface influence<span>{surface?'On':'Off'}</span></summary>
  <label className="stacked-label">Surface source<select aria-label="Surface source" value={surface?.source??'off'} onChange={e=>{if(e.target.value==='off')onChange(undefined);else onChange({...structuredClone(surface??initial),source:e.target.value as Surface['source']});}}><option value="off">Off</option><option value="polygon">Editable polygon</option><option value="mask" disabled={layer.mask.kind!=='image'}>Imported image mask</option></select></label>
  {surface&&<><label className="stacked-label">Surface behaviour<select aria-label="Surface behaviour" value={surface.role} onChange={e=>onChange({...surface,role:e.target.value as Surface['role']})}><option value="obstacle">Flow around shape</option><option value="emitter">Emit inside shape</option><option value="edge">Trace shape edges</option></select></label>
   {surface.source==='mask'&&<label className="stacked-label"><span><input type="checkbox" aria-label="Also clip output with mask" checked={surface.clipMask??false} onChange={e=>onChange({...surface,clipMask:e.target.checked})}/> Also clip output with mask</span></label>}
   {surface.source==='polygon'&&<><svg viewBox="0 0 240 160" role="group" aria-label="Surface polygon editor" onPointerMove={e=>{if(drag.current===null)return;const r=e.currentTarget.getBoundingClientRect();move(drag.current,(e.clientX-r.left)/r.width,1-(e.clientY-r.top)/r.height);}} onPointerUp={()=>{drag.current=null;onEnd();}} onPointerCancel={()=>{drag.current=null;onEnd();}}>
    <rect width="240" height="160" fill="#10151b"/><path d="M120 0v160M0 80h240" stroke="#333d45"/>
    <polygon points={surface.points.map(p=>`${p.x*240},${(1-p.y)*160}`).join(' ')} fill="#65cfc42b" stroke="#87e8d7" strokeWidth="1.5"/>
    {surface.points.map((p,i)=><circle key={i} cx={p.x*240} cy={(1-p.y)*160} r={i===selected?7:5} fill="#b8f4e9" tabIndex={0} role="slider" aria-label={`Surface vertex ${i+1}`} aria-valuetext={`${Math.round(p.x*100)}, ${Math.round(p.y*100)}`} onPointerDown={e=>{onStart();drag.current=i;setSelected(i);e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId);}} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();onStart();const delta=e.shiftKey?.002:.01;move(i,p.x+(e.key==='ArrowRight'?delta:e.key==='ArrowLeft'?-delta:0),p.y+(e.key==='ArrowUp'?delta:e.key==='ArrowDown'?-delta:0));onEnd();}}/>)}
   </svg><div className="surface-vertex-actions"><button className="wide-button" disabled={surface.points.length>=12} onClick={()=>{const i=Math.min(selected,surface.points.length-1),a=surface.points[i],b=surface.points[(i+1)%surface.points.length],points=[...surface.points];points.splice(i+1,0,{x:(a.x+b.x)/2,y:(a.y+b.y)/2});onChange({...surface,points});setSelected(i+1);}}>Add vertex</button><button className="wide-button" disabled={surface.points.length<=3} onClick={()=>{const points=surface.points.filter((_,i)=>i!==selected);if(isSimplePolygon(points)){onChange({...surface,points});setSelected(0);}}}>Remove vertex</button></div></>}
   <label className="stacked-label">Influence<input aria-label="Surface influence" type="range" min="0" max="1" step=".01" value={surface.influence} onPointerDown={onStart} onPointerUp={onEnd} onChange={e=>onChange({...surface,influence:Number(e.target.value)})}/></label>
   <p className="motion-help">Shapes use layer coordinates. Transported fibres and evolving pigment respond during generation; other treatments use the shape for reveals. Mask clipping is independent. Active obstacles stay solid as Influence blends the visible treatment.</p>
  </>}
 </details>;
}
