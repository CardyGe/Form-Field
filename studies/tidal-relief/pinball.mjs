import * as T from 'three';

const TAU = Math.PI * 2;
const bumpers = [
  {x:-2.27,y:.78, radius:.53, ink:'#ff347c', motif:'star'},
  {x:2.15,y:.72, radius:.54, ink:'#00e4ce', motif:'bolt'},
  {x:-.08,y:-.76, radius:.77, ink:'#ffac22', motif:'smile'},
];
// Contact positions sit on the rims. Two rail shots break up the triangle.
const route = [
  [-1.80,.46,0],[-.64,-.37,2],[1.66,.47,1],[2.76,-1.30,-1],
  [.53,-.39,2],[-2.98,-.92,-1],[-2.00,.25,0],[1.64,.64,1],
  [.02,-.06,2],[2.67,-1.40,-1],[1.87,.23,1],[-.65,-.42,2],
];
const inks=[new T.Color('#ff347c'),new T.Color('#00e4ce'),new T.Color('#ffbd36')];
const enamel = color => new T.MeshPhysicalMaterial({color,roughness:.26,metalness:.28,clearcoat:.88});
function emblem(b) {
  const c=document.createElement('canvas'); c.width=c.height=512;
  const g=c.getContext('2d');
  g.translate(256,256);
  g.fillStyle=b.ink; g.fillRect(-256,-256,512,512);
  g.strokeStyle='#25132f';g.lineWidth=11;g.beginPath();g.arc(0,0,218,0,TAU);g.stroke();
  g.fillStyle='#fff2c9';
  for(let i=0;i<32;i++){g.save();g.rotate(i*TAU/32);g.fillRect(227,-5,i%4===0?25:13,10);g.restore();}
  const poly=points=>{g.beginPath();points.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.closePath();g.fill();g.stroke();};
  g.lineJoin='round';g.lineWidth=12;
  if(b.motif==='star'){
    poly(Array.from({length:10},(_,i)=>{const a=-Math.PI/2+i*Math.PI/5;const r=i%2?68:159;return [r*Math.cos(a),r*Math.sin(a)];}));
  }else if(b.motif==='bolt'){
    poly([[-15,-151],[102,-151],[35,-30],[118,-30],[-70,161],[-24,36],[-117,36]]);
  }else{
    g.fillStyle='#25132f';
    for(const x of [-61,61]){g.beginPath();g.ellipse(x,-50,19,46,.10,0,TAU);g.fill();}
    g.beginPath();g.moveTo(-130,20);g.quadraticCurveTo(0,78,130,4);g.bezierCurveTo(93,168,-72,190,-130,20);g.fill();
    g.fillStyle='#ff4384';g.beginPath();g.ellipse(15,100,47,15,-.08,0,TAU);g.fill();
  }
  const texture=new T.CanvasTexture(c);texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=8;return texture;
}
function mesh(parent,geometry,material,z=0){
  const object=new T.Mesh(geometry,material);object.position.z=z;object.castShadow=true;object.receiveShadow=true;parent.add(object);return object;
}
function disk(parent,r,depth,mat,z){
  const ring=mesh(parent,new T.CylinderGeometry(r,r,depth,80),mat,z);
  ring.rotation.x=Math.PI/2;return ring;
}
function torus(parent,r,t,mat,z){return mesh(parent,new T.TorusGeometry(r,t,12,80),mat,z);}
function track(beat){
  const b=T.MathUtils.euclideanModulo(beat,route.length),i=Math.floor(b),t=b-i;
  const [x,y]=route[i],[nx,ny]=route[(i+1)%route.length];
  return [x+(nx-x)*t,y+(ny-y)*t+.14*Math.sin(t*Math.PI)];
}

export function pinball(scene,faceMaterial){
  const nickel=enamel('#aecde8');nickel.metalness=.89;
  const plum=enamel('#291536');
  const stars=bumpers.map(b=>{
    const base=new T.Group();base.position.set(b.x,b.y,.68);scene.add(base);
    disk(base,b.radius*1.13,.17,plum,0);
    torus(base,b.radius*1.04,.043,nickel,.11);
    const head=new T.Group();base.add(head);
    disk(head,b.radius,.22,enamel(b.ink),.21);
    const art=new T.MeshPhysicalMaterial({map:emblem(b),roughness:.34,metalness:.12,clearcoat:.4});
    mesh(head,new T.CircleGeometry(b.radius*.91,80),art,.332);
    torus(head,b.radius*.95,.024,nickel,.323);
    return head;
  });
  const ball=mesh(scene,new T.SphereGeometry(.235,48,32),new T.MeshPhysicalMaterial({color:0xd8e9ff,metalness:.96,roughness:.115,clearcoat:1}));
  const stripeMat=enamel('#ff3169');
  torus(ball,.234,.013,stripeMat,0);
  const comet=Array.from({length:10},(_,i)=>{
    const m=mesh(scene,new T.SphereGeometry(.10*(1-i/12),14,10),enamel(i%2?'#ff4895':'#ffcc42'));
    m.castShadow=false;return m;
  });
  const rays=new T.Group();rays.position.set(bumpers[2].x,bumpers[2].y,.97);scene.add(rays);
  for(let i=0;i<14;i++){
    const a=i*TAU/14, blade=mesh(rays,new T.ConeGeometry(.09,.58,3),enamel(i%2?'#ffc53b':'#ff4488'));
    blade.rotation.z=a-Math.PI/2;blade.position.set(Math.cos(a)*1.15,Math.sin(a)*1.15,0);
  }
  // Each foil ticket follows a repeatable ballistic arc from the jackpot.
  const tickets=new T.InstancedMesh(new T.BoxGeometry(.11,.052,.009),enamel('#ffffff'),56);
  tickets.instanceMatrix.setUsage(T.DynamicDrawUsage);tickets.frustumCulled=false;scene.add(tickets);
  const foil=new T.Object3D();
  const confetti=['#ff287f','#ffcb35','#18efcd','#b890ff','#ff643d'];
  for(let i=0;i<tickets.count;i++)tickets.setColorAt(i,new T.Color(confetti[i%confetti.length]));
  function jackpot(age){
    const live=age>=0 && age<2.25;
    tickets.visible=rays.visible=live;
    if(!live)return;
    const boom=Math.sin(Math.PI*age/2.25)**.72;
    rays.scale.setScalar(.48+1.16*boom);rays.rotation.z=.22+age*.8;
    for(let i=0;i<tickets.count;i++){
      const angle=i*2.399963, speed=1.15+((i*19)%31)/11;
      const t=Math.max(0,age-(i%5)*.038);
      const length=speed*t;
      foil.position.set(bumpers[2].x+Math.cos(angle)*length,
        bumpers[2].y+Math.sin(angle)*length+.95*t-.85*t*t,
        .94+.35*Math.sin(i)*t+.24*Math.sin(Math.PI*t/2.25));
      foil.rotation.set(i+t*(i%5+3),angle-t*4,angle+t*3);
      foil.scale.setScalar(Math.min(1,t*12)*Math.max(0,Math.min(1,(2.25-age)*3)));
      foil.updateMatrix();tickets.setMatrixAt(i,foil.matrix);
    }
    tickets.instanceMatrix.needsUpdate=true;
  }
  const pulses=Array.from({length:4},()=>new T.Vector4());
  const shades=Array.from({length:4},()=>new T.Color());
  const compile=faceMaterial.onBeforeCompile;
  faceMaterial.color.set('#355898');faceMaterial.metalness=.64;
  faceMaterial.onBeforeCompile=(shader,renderer)=>{
    compile.call(faceMaterial,shader,renderer);
    shader.uniforms.uHits={value:pulses};shader.uniforms.uInks={value:shades};
    shader.vertexShader='varying vec2 vTable;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvTable=position.xy;');
    shader.fragmentShader='varying vec2 vTable;uniform vec4 uHits[4];uniform vec3 uInks[4];\n'+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      for(int i=3;i>=0;i--){
        vec4 h=uHits[i];float d=length(vTable-h.xy)-h.z;
        float band=smoothstep(-.5,-.20,d)*(1.-smoothstep(-.04,.13,d));
        float rim=1.-smoothstep(.014,.064,abs(d+.33));
        diffuseColor.rgb=mix(diffuseColor.rgb,uInks[i],band*h.w*.95);
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.98,.78,.48),rim*h.w*.84);
      }`);
  };
  const ages=stars.map(()=>0);
  return {
    update(phase, bonusAge=Infinity){
      const beat=phase*route.length,step=Math.floor(beat),fraction=beat-step;
      ages.fill(Infinity);
      for(let k=0;k<4;k++){
        const [x,y,id]=route[T.MathUtils.euclideanModulo(step-k,route.length)], age=fraction+k;
        if(id>=0)ages[id]=Math.min(ages[id],age);
        pulses[k].set(x,y,age*2.10,Math.max(0,1-age/3.8));
        shades[k].copy(inks[id<0?1:id]);
      }
      stars.forEach((head,i)=>{
        const age=ages[i],kick=Number.isFinite(age)?Math.cos(age*11)*Math.exp(-age*5):0;
        head.position.z=-.15*kick;
        head.scale.setScalar(1+.095*kick);
        head.rotation.z=.07*Math.sin(phase*TAU+i)+kick*.12;
      });
      const [x,y]=track(beat);ball.position.set(x,y,1.40+.09*Math.sin(Math.PI*fraction));
      ball.rotation.set(.65,beat*TAU*.5,phase*TAU*2);
      comet.forEach((m,i)=>{const [x,y]=track(beat-(i+1)*.025);m.position.set(x,y,1.28);});
      const age=T.MathUtils.euclideanModulo(beat-8,route.length);
      jackpot(Math.min(age,bonusAge));
      if(bonusAge<2.25){
        pulses[3].set(bumpers[2].x,bumpers[2].y,bonusAge*2.7,1-bonusAge/2.25);
        shades[3].copy(inks[2]);
      }
    },
    ripple(x,y){
      let lift=0;
      for(const p of pulses){const d=Math.hypot(x-p.x,y-p.y)-p.z;lift+=p.w*Math.exp(-d*d*5.7);}
      return Math.min(1.3,lift);
    }
  };
}
