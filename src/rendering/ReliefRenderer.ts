import * as THREE from 'three';
import type { Layer } from '../shared/types';
import { sourceViewMatrix } from './source-view';
import { flowHash, phraseTime, smooth, TAU } from './flow-field';
import { surfaceFieldGLSL,type PreparedSurface } from './surface-fields';
import { delayOrder, stagedTime } from '../core/timing';
import { CONCERTINA_BEATS, concertinaProfile } from './concertina-pose';

/** Real hinged solids, lit together in one scene. Artistic references: Limelight
 * Interconnection and Bot & Dolly Box; see the source register in the projection plan.
 * The virtual audience/camera is fixed; this does not calibrate physical projectors.
 */
export class ReliefRenderer {
  private readonly scene=new THREE.Scene();
  private readonly camera=new THREE.PerspectiveCamera(38,1,.1,40);
  private readonly geometry=new THREE.BoxGeometry(1,1,1);
  private readonly material=new THREE.MeshPhysicalMaterial({roughness:.45,metalness:.12,clearcoatRoughness:.18});
  private readonly depthMaterial=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});
  private readonly pieces=new THREE.InstancedMesh(this.geometry,this.material,2048);
  private readonly boardGeometry=new THREE.PlaneGeometry(1,1);
  private readonly boardMaterial=new THREE.MeshStandardMaterial({color:0x101820,roughness:.8});
  private readonly board=new THREE.Mesh(this.boardGeometry,this.boardMaterial);
  private readonly key=new THREE.DirectionalLight(0xffe7ce,3);
  private readonly fill=new THREE.HemisphereLight(0xb4d9ea,0x13152b,.8);
  private readonly inverse={value:new THREE.Matrix3()};
  private readonly surfaceUniforms={uReliefView:{value:new THREE.Matrix3()},uReliefResolution:{value:new THREE.Vector2()},uSurface:{value:null as THREE.Texture|null},uSurfaceRole:{value:0},uSurfaceInfluence:{value:0}};
  private readonly audienceProjection={value:new THREE.Matrix4()};
  constructor(){
    this.camera.position.set(0,0,7);this.camera.lookAt(0,0,0);
    this.pieces.frustumCulled=false;this.pieces.castShadow=true;this.pieces.receiveShadow=true;
    this.pieces.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pieces.customDepthMaterial=this.depthMaterial;
    this.depthMaterial.onBeforeCompile=shader=>{
      Object.assign(shader.uniforms,this.surfaceUniforms,{uAudienceProjection:this.audienceProjection});
      shader.vertexShader='uniform mat4 uAudienceProjection;varying vec4 vSurfaceProjection;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>
        vec4 surfaceWorld=vec4(transformed,1.);
        #ifdef USE_INSTANCING
        surfaceWorld=instanceMatrix*surfaceWorld;
        #endif
        vSurfaceProjection=uAudienceProjection*modelMatrix*surfaceWorld;`);
      shader.fragmentShader='varying vec4 vSurfaceProjection;\n'+surfaceFieldGLSL+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>',`if(surfaceCoverage(vSurfaceProjection.xy/vSurfaceProjection.w*.5+.5)<.5)discard;\n#include <alphatest_fragment>`);
    };
    this.board.position.z=-.12;this.board.receiveShadow=true;this.board.frustumCulled=false;
    this.key.castShadow=true;this.key.shadow.mapSize.set(1024,1024);this.key.shadow.camera.left=-4;this.key.shadow.camera.right=4;this.key.shadow.camera.top=4;this.key.shadow.camera.bottom=-4;
    this.key.shadow.bias=-.0003;this.key.shadow.normalBias=.015;
    for(const mat of [this.material,this.boardMaterial]){
      mat.toneMapped=false;mat.transparent=true;mat.premultipliedAlpha=true;mat.onBeforeCompile=shader=>{
        shader.uniforms.uReliefInverse=this.inverse;
        Object.assign(shader.uniforms,this.surfaceUniforms);
        shader.vertexShader='uniform mat3 uReliefInverse;\n'+shader.vertexShader;
        shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>
          vec2 screen=(uReliefInverse*vec3(gl_Position.xy/gl_Position.w*.5+.5,1.)).xy;
          gl_Position.xy=(screen*2.-1.)*gl_Position.w;`);
        shader.fragmentShader='uniform mat3 uReliefView;uniform vec2 uReliefResolution;\n'+surfaceFieldGLSL+shader.fragmentShader;
        shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`diffuseColor.a*=surfaceCoverage((uReliefView*vec3(gl_FragCoord.xy/uReliefResolution,1.)).xy);if(diffuseColor.a<.001)discard;\n#include <opaque_fragment>`);
      };
    }
    this.scene.add(this.pieces,this.board,this.key,this.key.target,this.fill);
  }
  draw(renderer:THREE.WebGLRenderer,layer:Layer,phase:number,width:number,height:number,target:THREE.WebGLRenderTarget,surface?:PreparedSurface){
    const p=layer.params,aspect=width/height,scale=p.scale,spacing=1/p.columns;
    const view=sourceViewMatrix(layer.transform,aspect);this.inverse.value.copy(view).invert();
    const u=this.surfaceUniforms;u.uReliefView.value.copy(view);u.uReliefResolution.value.set(width,height);u.uSurface.value=surface?.texture??null;u.uSurfaceRole.value=surface?.role??0;u.uSurfaceInfluence.value=surface?.influence??0;
    // Match the source field at z=0. Perspective then supplies consistent depth foreshortening.
    this.camera.aspect=aspect;this.camera.fov=2*Math.atan(scale/14)*180/Math.PI;this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();this.audienceProjection.value.multiplyMatrices(this.camera.projectionMatrix,this.camera.matrixWorldInverse);
    const bounds=[[0,0],[1,0],[0,1],[1,1]].map(([x,y])=>new THREE.Vector3(x,y,1).applyMatrix3(view));
    const x0=Math.floor(Math.min(...bounds.map(v=>(v.x-.5)*aspect*scale))/spacing)-2,x1=Math.ceil(Math.max(...bounds.map(v=>(v.x-.5)*aspect*scale))/spacing)+2;
    const y0=Math.floor(Math.min(...bounds.map(v=>(v.y-.5)*scale))/spacing)-2,y1=Math.ceil(Math.max(...bounds.map(v=>(v.y-.5)*scale))/spacing)+2;
    const stride=Math.max(1,Math.ceil(Math.sqrt((x1-x0+1)*(y1-y0+1)/2048)));
    const time=phraseTime(phase/TAU*p.cycles+p.phaseOffset,p.motion,p.phrase)*TAU;
    const matrix=new THREE.Matrix4(),position=new THREE.Vector3(),rotation=new THREE.Quaternion(),size=new THREE.Vector3(),axis=new THREE.Vector3();
    const color=new THREE.Color(),colors=layer.palette.map(c=>new THREE.Color(c));let count=0;
    // Mixed panel sizes: a seeded 4×4 block becomes one large panel, or splits
    // into 2×2 panels, each of which may split into single cells.
    const mix=stride===1?(p.panelMix??0):0;
    const panelAt=(ix:number,iy:number)=>{
      if(mix<=0)return {ox:ix,oy:iy,n:1};
      const bx=Math.floor(ix/4)*4,by=Math.floor(iy/4)*4;
      if(flowHash(bx,by,p.seed+77)<mix*.35)return {ox:bx,oy:by,n:4};
      const mx=Math.floor(ix/2)*2,my=Math.floor(iy/2)*2;
      if(flowHash(mx,my,p.seed+131)<mix*.6)return {ox:mx,oy:my,n:2};
      return {ox:ix,oy:iy,n:1};
    };
    const timed=(p.delaySpread??0)>0||(p.pause??0)>0;
    if((p.concertina??0)>.5){count=this.placeConcertina(layer,time,aspect,scale,colors);}else{outer:for(let iy=Math.floor(y0/stride)*stride;iy<=y1;iy+=stride)for(let ix=Math.floor(x0/stride)*stride;ix<=x1;ix+=stride){
      if(count>=2048)break outer;
      const panel=panelAt(ix,iy);if(panel.ox!==ix||panel.oy!==iy)continue;
      const n=panel.n,cx=ix+n/2,cy=iy+n/2;
      const id=flowHash(ix,iy,p.seed),group=flowHash(Math.floor(ix/3),Math.floor(iy/3),p.seed+41);
      const clock=timed?stagedTime(time,delayOrder(cx*spacing/scale,cy*spacing/scale,aspect,p.delayShape),p.delaySpread,p.pause):time;
      const wave=clock-((cx-.5)*.17+(cy-.5)*.11)*p.waveCount+group*p.phaseSpread*2;
      const opening=p.opening*(.08+.92*smooth(.5+.5*Math.sin(wave)))*p.motion;
      const angle=opening*1.55,orientation=p.axis===0?0:p.axis===1?Math.PI/2:Math.PI/4;
      axis.set(-Math.sin(orientation),Math.cos(orientation),0);rotation.setFromAxisAngle(axis,angle);
      const piece=n===1?spacing*stride*(1-p.gap):spacing*stride*(n-p.gap),hinge=piece*(.5+p.hingeBias*.25);
      const center=new THREE.Vector3(hinge*Math.cos(orientation),hinge*Math.sin(orientation),0).applyQuaternion(rotation);
      position.set((cx+(n===1?(Math.abs(iy)%2)*p.stagger*.5:0))*spacing+center.x-hinge*Math.cos(orientation),cy*spacing+center.y-hinge*Math.sin(orientation),center.z);
      size.set(piece,piece*(1-p.organic*.18*id),spacing*(.08+p.depth*.22));matrix.compose(position,rotation,size);this.pieces.setMatrixAt(count,matrix);
      color.copy(colors[0]).lerp(colors[2],.15+id*.32).multiplyScalar(.85+group*.2);this.pieces.setColorAt(count,color);count++;
    }}
    this.pieces.count=count;this.pieces.instanceMatrix.needsUpdate=true;if(this.pieces.instanceColor)this.pieces.instanceColor.needsUpdate=true;
    this.material.roughness=p.roughness;this.material.clearcoat=p.clearcoat;
    this.board.visible=p.backgroundOpacity>0;this.boardMaterial.opacity=p.backgroundOpacity;this.boardMaterial.color.copy(colors[5]);this.board.scale.set(100,100,1);
    this.key.position.set(Math.cos(p.lightAngle)*4,Math.sin(p.lightAngle)*4,2+p.lightHeight*3);this.key.intensity=3;this.key.castShadow=p.shadow>0;this.key.shadow.intensity=p.shadow;this.fill.intensity=.2+p.fillLight*2;
    if((p.concertina??0)>.5){
      // Concertina: a low raking key from the side, so each fold throws a shadow onto its neighbours.
      this.key.position.set(Math.cos(p.lightAngle)*4,Math.sin(p.lightAngle)*4,.5);
      this.key.intensity=4.5;this.key.shadow.intensity=Math.max(.6,p.shadow);
      this.fill.intensity=.5;
    }
    const clear=renderer.autoClear;renderer.autoClear=false;
    try{renderer.setRenderTarget(target);renderer.render(this.scene,this.camera);}finally{renderer.autoClear=clear;}
  }
  /** Half the camera's visible width and height on the z=0 plane, read from the projection itself. */
  private visibleHalfExtent(view:THREE.Matrix3):{hx:number,hy:number}{
    let hx=0,hy=0;
    const eye=this.camera.position.clone();
    // The relief shader maps screen -> view inverse, so the frame's corners land on
    // view·corner in clip space. The sheet must cover that region, not the raw frustum.
    for(const [u,v] of [[0,0],[1,0],[1,1],[0,1]]){
      const c=new THREE.Vector3(u,v,1).applyMatrix3(view);
      const far=new THREE.Vector3(c.x*2-1,c.y*2-1,.5).unproject(this.camera);
      const dir=far.sub(eye).normalize();
      const t=-eye.z/dir.z;
      const hit=eye.clone().addScaledVector(dir,t);
      hx=Math.max(hx,Math.abs(hit.x));hy=Math.max(hy,Math.abs(hit.y));
    }
    return {hx,hy};
  }
  /** Copper Concertina: seven linked facets from concertinaProfile, one instance each.
   * Neighbouring facets share endpoints, so the hinges stay closed at every beat.
   * Depth is exaggerated (ZEXAG) so the folds read from the audience position.
   */
  private placeConcertina(layer:Layer,time:number,aspect:number,scale:number,colors:THREE.Color[]):number{
    const p=layer.params,ZEXAG=2.6,FACETS=7;
    const beat=time/TAU*CONCERTINA_BEATS;
    // Size the sheet from the camera's real frustum on the z=0 plane, so it covers the frame whatever the view.
    const {hx,hy}=this.visibleHalfExtent(this.inverse.value.clone().invert());
    const width=2*hx*1.06;
    const profile=concertinaProfile(beat,{facets:FACETS,width,maxTilt:1.25});
    const height=2*hy*1.06,thickness=scale*(.012+p.depth*.02);
    // Folding shortens the wall's horizontal span; stretch it back so the sheet keeps covering the frame.
    const span=Math.max(1e-3,profile.points[FACETS].x);
    const points=profile.points.map(v=>new THREE.Vector3(v.x*width/span-width/2,0,v.z*ZEXAG));
    const matrix=new THREE.Matrix4(),pos=new THREE.Vector3(),quat=new THREE.Quaternion(),size=new THREE.Vector3(),up=new THREE.Vector3(0,1,0);
    const color=new THREE.Color();
    for(let k=0;k<FACETS;k++){
      const a=points[k],b=points[k+1];
      const len=Math.hypot(b.x-a.x,b.z-a.z),ang=Math.atan2(b.z-a.z,b.x-a.x);
      pos.set((a.x+b.x)/2,0,(a.z+b.z)/2);
      // Rotate the facet's x axis onto the profile direction in the x–z plane.
      quat.setFromAxisAngle(up,-ang);
      size.set(len,height,thickness);
      matrix.compose(pos,quat,size);this.pieces.setMatrixAt(k,matrix);
      // Alternate the two copper faces so each fold reads as a front and a back.
      // Faces tilted toward the light and away from it take the two copper tones.
      color.copy(colors[k%2===0?0:2]).multiplyScalar(k%2===0?1:.7);this.pieces.setColorAt(k,color);
    }
    return FACETS;
  }
  dispose(){this.geometry.dispose();this.boardGeometry.dispose();this.material.dispose();this.depthMaterial.dispose();this.boardMaterial.dispose();this.key.shadow.dispose();this.pieces.dispose();}
}
