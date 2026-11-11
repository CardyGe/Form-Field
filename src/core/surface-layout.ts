export interface SurfaceGrid {size:number;distance:Float32Array;coverage:Float32Array}
export interface SurfaceSample {distance:number;nx:number;ny:number;coverage:number}
export function isSimplePolygon(points:{x:number;y:number}[]):boolean {
  if(points.length<3||points.length>12||points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>1||p.y<0||p.y>1))return false;
  const cross=(a:{x:number;y:number},b:{x:number;y:number},c:{x:number;y:number})=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  let area=0;
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length];if(Math.hypot(a.x-b.x,a.y-b.y)<.001)return false;area+=a.x*b.y-b.x*a.y;
    for(let j=i+2;j<points.length;j++){if(i===0&&j===points.length-1)continue;const c=points[j],d=points[(j+1)%points.length];const overlap=Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x))<=Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x))&&Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y))<=Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y));if(overlap&&cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0)return false;}
  }
  return Math.abs(area)>=.002;
}
export function polygonDistance(x:number,y:number,points:{x:number;y:number}[]):number {
  let inside=false,distance=Infinity;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[i],b=points[j];
    if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)inside=!inside;
    const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/Math.max(1e-12,dx*dx+dy*dy)));
    distance=Math.min(distance,Math.hypot(x-a.x-t*dx,y-a.y-t*dy));
  }
  return (inside?-1:1)*distance;
}
/** Bounded 8-neighbour distance approximation for raster masks, in source-UV units. */
export function distanceGrid(coverage:Float32Array,size:number):SurfaceGrid {
  if(coverage.length!==size*size||size<2)throw new Error('Invalid surface grid.');
  const distance=new Float32Array(size*size);distance.fill(size*2);
  const inside=(x:number,y:number)=>x>=0&&x<size&&y>=0&&y<size&&coverage[y*size+x]>=.5;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)if([[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>inside(x,y)!==inside(x+dx,y+dy)))distance[y*size+x]=.5;
  for(const direction of [1,-1])for(let Y=0;Y<size;Y++)for(let X=0;X<size;X++){
    const x=direction===1?X:size-1-X,y=direction===1?Y:size-1-Y,i=y*size+x;
    for(const [dx,dy] of [[-direction,0],[0,-direction],[-direction,-direction],[direction,-direction]]){const xx=x+dx,yy=y+dy;if(xx>=0&&xx<size&&yy>=0&&yy<size)distance[i]=Math.min(distance[i],distance[yy*size+xx]+(dx&&dy?Math.SQRT2:1));}
  }
  for(let i=0;i<distance.length;i++)distance[i]=Math.min(2,distance[i]/size)*(coverage[i]>=.5?-1:1);
  return {size,distance,coverage};
}
export function sampleSurface(grid:SurfaceGrid,x:number,y:number):SurfaceSample {
  const {size,distance,coverage}=grid;
  const sample=(values:Float32Array,u:number,v:number)=>{
    const X=Math.max(0,Math.min(size-1,u*size-.5)),Y=Math.max(0,Math.min(size-1,v*size-.5)),a=Math.floor(X),b=Math.floor(Y),s=X-a,t=Y-b;
    return (values[b*size+a]*(1-s)+values[b*size+Math.min(a+1,size-1)]*s)*(1-t)+(values[Math.min(b+1,size-1)*size+a]*(1-s)+values[Math.min(b+1,size-1)*size+Math.min(a+1,size-1)]*s)*t;
  };
  const edge=1/size,dx=sample(distance,x+edge,y)-sample(distance,x-edge,y),dy=sample(distance,x,y+edge)-sample(distance,x,y-edge),length=Math.max(1e-9,Math.hypot(dx,dy));
  const outside=Math.hypot(Math.max(0,-x,x-1),Math.max(0,-y,y-1));
  return {distance:outside?Math.max(0,sample(distance,x,y))+outside:sample(distance,x,y),nx:dx/length,ny:dy/length,coverage:outside?0:sample(coverage,x,y)};
}
