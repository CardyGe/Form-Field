/** Sides of the strip that carries a ring. The fragment shader draws the true circle, so this only bounds it. */
export const CURVE_SIDES = 96;

const placement = /* glsl */`
  attribute vec4 aHead, aTail, aInk;
  uniform mat3 uInverse; uniform mat2 uShape; uniform vec2 uField, uCentre;
  uniform float uTilt, uPixel, uMinWidth, uEdge, uHaloReach, uRes, uByRadius, uPeak;
  uniform vec3 uInks[3];
  varying vec2 vLocal; varying vec3 vColour; varying vec4 vLine; varying vec4 vMark; varying float vWobblePhase;
  const float TAU=6.28318530718;
  vec4 place(vec2 p) {
    vec2 q=uShape*p;
    q.x*=1.+q.y*uTilt*.55;           // A disc leaning away: the far side narrows.
    vec2 uv=(q+uCentre)/uField+.5;
    return vec4((uInverse*vec3(uv,1.)).xy*2.-1.,0.,1.);
  }
  vec3 ink(float colour, float radius) {
    float at=mod(floor(colour),3.), next=mod(at+1.,3.);
    vec3 c=mix(uInks[int(at)],uInks[int(next)],fract(colour));
    c=mix(c,uInks[int(next)],uByRadius*clamp(radius/.46,0.,1.));
    // At the peak, colour tears through part of the structure; which part follows each mark's seed.
    float torn=1.-smoothstep(.52,.66,aInk.w);
    return mix(c,aInk.w<.26?uInks[2]:uInks[1],uPeak*torn*.9*clamp(aInk.z*4.,0.,1.));
  }
  // Half a line in this pass's pixels, and how far its quad must reach in frame units.
  float halfLine() { return max(max(aTail.z,uMinWidth)*.5*uRes,uRes<1.?.8:0.); }
  float reach(float hw) { return (hw/uRes+uEdge+uHaloReach+1.)*uPixel; }
`;

export const curveVertex = /* glsl */`
  ${placement}
  void main() {
    float kind=aHead.x, radius=aHead.w, hw=halfLine(), pad=reach(hw);
    bool arc=kind>.5;
    float wobble=arc?0.:abs(aTail.x);
    float start=arc?aTail.x:0., sweep=arc?aTail.y:TAU;
    float cap=arc?min(pad/max(radius,1e-5),.6):0.;
    float angle=start-cap+position.x*(sweep+2.*cap);
    float sag=radius*(1./cos(TAU/${(CURVE_SIDES * 2).toFixed(1)})-1.);
    float rim=max(0.,radius+position.y*(pad+sag+wobble));
    vec2 at=aHead.yz+rim*vec2(cos(angle),sin(angle));
    vLocal=at-aHead.yz;
    vLine=vec4(kind,radius,start,sweep);
    vMark=vec4(hw,aTail.w,aInk.y,arc?0.:aTail.x);
    vColour=ink(aInk.x,radius);
    gl_Position=place(at);
    vWobblePhase=arc?0.:aTail.y;
  }`;

export const markVertex = /* glsl */`
  ${placement}
  void main() {
    float kind=aHead.x, hw=halfLine(), pad=reach(hw);
    vec2 at; vec2 local;
    if (kind<2.5) {
      // A segment: local x runs along it from its start, y across it.
      vec2 a=aHead.yz, b=vec2(aHead.w,aTail.x), d=b-a;
      float len=length(d);
      vec2 along=len>1e-7?d/len:vec2(1.,0.), across=vec2(-along.y,along.x);
      float ends=aTail.y>.5?0.:pad;      // A link in a chain stops exactly at its neighbour.
      local=vec2(mix(-ends,len+ends,position.x),position.y*pad);
      at=a+along*local.x+across*local.y;
      vLine=vec4(kind,len,aTail.y,0.);
      vColour=ink(aInk.x,length(a+b)*.5);
    } else {
      float size=kind>4.5?aHead.w:max(aHead.w,.8*uPixel), r=size+pad;
      float c=cos(aTail.x), s=sin(aTail.x);
      local=vec2(position.x*2.-1.,position.y)*r;
      at=aHead.yz+vec2(c*local.x-s*local.y,s*local.x+c*local.y);
      vLine=vec4(kind,size,0.,0.);
      vColour=ink(aInk.x,length(aHead.yz));
    }
    vLocal=local;
    vWobblePhase=0.;
    vMark=vec4(hw,aTail.w,aInk.y,0.);
    gl_Position=place(at);
  }`;

export const lightFragment = /* glsl */`
  precision highp float;
  uniform float uEdge, uCore, uLineGlow, uGlowPass, uRes;
  uniform vec3 uHot, uHalo;
  varying vec2 vLocal; varying vec3 vColour; varying vec4 vLine; varying vec4 vMark;
  varying float vWobblePhase;
  const float TAU=6.28318530718;
  void main() {
    float kind=vLine.x, hw=vMark.x, glow=vMark.y, alpha=vMark.z;
    float signedPx, px;
    if (kind<1.5) {
      // Ring or arc: the true circle, whatever the strip around it looks like.
      float len=length(vLocal), unit=max(length(vec2(dFdx(len),dFdy(len))),1e-7);
      float target_=vLine.y;
      if (kind<.5 && vMark.w>0.) target_+=vMark.w*sin(atan(vLocal.y,vLocal.x)*5.+vWobblePhase);
      float d=abs(len-target_);
      if (kind>.5) {
        float t=mod(atan(vLocal.y,vLocal.x)-vLine.z,TAU), over=t-vLine.w;
        if (over>0.) d=length(vec2(d,min(over,TAU-t)*vLine.y));
      }
      px=d/unit; signedPx=px-hw;
    } else if (kind<2.5) {
      // Segment, with round ends unless it is a link in a chain.
      float unit=max(length(vec2(dFdx(vLocal.y),dFdy(vLocal.y))),1e-7);
      float over=vLine.z>.5?0.:max(max(-vLocal.x,vLocal.x-vLine.y),0.);
      px=length(vec2(vLocal.y,over))/unit; signedPx=px-hw;
    } else if (kind<3.5) {
      vec2 e=abs(vLocal)-vLine.y;
      float unit=max(length(vec2(dFdx(vLocal.x),dFdy(vLocal.x))),1e-7);
      signedPx=max(e.x,e.y)/unit; px=max(signedPx,0.); hw=0.;
    } else if (kind<4.5) {
      float len=length(vLocal), unit=max(length(vec2(dFdx(len),dFdy(len))),1e-7);
      signedPx=(len-vLine.y)/unit; px=max(signedPx,0.); hw=0.;
    } else {
      // Inner fill: light gathering towards the rim of the hero.
      float share=length(vLocal)/max(vLine.y,1e-5);
      float rim=share*share*share*(1.-smoothstep(.985,1.,share));
      vec3 fill=mix(vColour,uHalo,.5)*rim*alpha;
      gl_FragColor=vec4(uGlowPass>.5?fill*glow:fill,1.);
      return;
    }
    float cover=clamp(.5-signedPx/uEdge,0.,1.);
    if (uGlowPass>.5) {
      vec3 tint=mix(vColour,uHalo,smoothstep(.2,.8,glow));
      // Squared at the low end, so fine marks stay crisp and only heavy light spills.
      gl_FragColor=vec4(tint*glow*smoothstep(.04,.7,glow)*alpha*cover,1.);
      return;
    }
    // The core of a heavy line runs white-hot; a hairline stays its colour until lines cross.
    float hot=hw>1.5?exp(-px*px/(hw*hw*.42)):.28;
    float lift=clamp(glow,0.,2.);
    vec3 line=vColour*cover*(1.02+.7*lift)+uHot*cover*hot*uCore*(.22+2.6*lift);
    vec3 skirt=vColour*uLineGlow*(.045+.3*lift)*exp(-max(px-hw,0.)/1.7);
    gl_FragColor=vec4((line+skirt)*alpha,1.);
  }`;

export const resolveFragment = /* glsl */`
  precision highp float; varying vec2 vUv;
  uniform sampler2D uLight, uBloom0, uBloom1, uBloom2, uBloom3, uBloom4;
  uniform float uWeights[5];
  uniform vec3 uGround;
  uniform vec2 uCentre;
  uniform float uAspect, uFringe, uExposure, uContrast, uSaturation, uVignette, uLift, uBlack, uTransparent;
  void main() {
    // Red and blue are read a little apart, further towards the edge of the frame.
    vec2 from=(vUv-uCentre)*vec2(uAspect,1.);
    vec2 shift=from*uFringe*.006/vec2(uAspect,1.);
    vec3 light=vec3(texture2D(uLight,vUv-shift).r,texture2D(uLight,vUv).g,texture2D(uLight,vUv+shift).b);
    vec3 bloom=uWeights[0]*texture2D(uBloom0,vUv).rgb+uWeights[1]*texture2D(uBloom1,vUv).rgb+uWeights[2]*texture2D(uBloom2,vUv).rgb
      +uWeights[3]*texture2D(uBloom3,vUv).rgb+uWeights[4]*texture2D(uBloom4,vUv).rgb;
    float edge=dot(from,from);
    float vignette=1.-uVignette*smoothstep(.04,.62,edge);
    // Per channel roll-off: where light piles up, every channel saturates and it burns to white.
    vec3 c=1.-exp(-max(light+bloom,0.)*uExposure*vignette);
    c=pow(c,vec3(uContrast));
    float grey=dot(c,vec3(.2126,.7152,.0722));
    c=max(mix(vec3(grey),c,uSaturation),0.);
    float cover=clamp(max(c.r,max(c.g,c.b)),0.,1.);
    if (uTransparent>.5) { gl_FragColor=vec4(c,cover); return; }
    vec3 ground=uGround+uLift*(.35+.65*exp(-edge*2.6))*vec3(.32,.42,.62);
    c+=ground*(1.-cover);
    c=uBlack+c*(1.-uBlack);
    gl_FragColor=vec4(c,1.);
  }`;

/**
 * The tear. Reads the finished picture and breaks it along hard edges: rows of uneven blocks slide and smear,
 * wedges of the disc rotate out of true, channels part, and torn areas take flat palette colour.
 * Everything is chosen per cell from uNoise, which holds for several frames, so the picture jumps rather than flickers.
 */
export const tearFragment = /* glsl */`
  precision highp float; varying vec2 vUv;
  uniform sampler2D uImage;
  uniform vec3 uInks[3];
  uniform vec4 uNoise;
  uniform vec2 uGrid, uSlip, uCentre;
  uniform float uTear, uDrive, uAspect, uSplit, uBands, uPosterise, uRadial, uSpread, uShred;
  const float TAU=6.28318530718;
  float hash(vec2 p, float salt) {
    vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)+salt*.137);
    q+=dot(q,q.yzx+33.33);
    return fract((q.x+q.y)*q.z);
  }
  float faultDistance(float y, float at) { float d=abs(y-at); return min(d,1.-d); }
  void main() {
    // Slabs: the frame is cut into strata of uneven height, so whole slices of the disc move as one.
    float strata=uGrid.y*.5, course=floor(vUv.y*strata), courseKey=hash(vec2(course,3.),uNoise.x);
    float parts=courseKey<.35?1.:courseKey<.7?2.:courseKey<.88?4.:8.;
    float row=course*8.+floor(fract(vUv.y*strata)*parts)*8./parts;
    // Faults: two zones of the frame give way; Spread widens them until they meet.
    float rowMiddle=(course+.5)/strata;
    float first=hash(uNoise.xy,1.), second=fract(first+.38+.24*hash(uNoise.xy,2.));
    float reach=mix(.1,.62,uSpread)*(.4+.6*uTear);
    float fault=step(min(faultDistance(rowMiddle,first),faultDistance(rowMiddle,second)),reach);
    float rowKey=hash(vec2(row,22.),uNoise.x);
    vec2 shift=vec2(0.);
    if (fault>.5 && hash(vec2(row,23.),uNoise.y)<.3+.6*uTear) {
      shift.x=(hash(vec2(row,24.),uNoise.y)-.5)*.62*uSlip.x*uDrive*uTear;
      shift.y=(hash(vec2(row,25.),uNoise.y)-.5)*.3*uSlip.y*uDrive*uTear;
    }

    // Blocks: long runs inside a slab, each cut to its own length so the breaks never line up into a grid.
    float across=uGrid.x*.5*(.3+.9*rowKey);
    vec2 cell=vec2(floor(vUv.x*across+rowKey*7.),row);
    vec2 key=cell+uNoise.xy;
    float torn=fault*step(hash(key,4.),uTear*(.2+.5*uSpread));
    float ribbon=0.;
    if (torn>.5) {
      shift.x+=floor((hash(key,5.)-.5)*9.)/across*uSlip.x*1.4*uDrive;
      shift.y+=floor((hash(key,6.)-.5)*5.)/uGrid.y*uSlip.y*1.4*uDrive;
      // Some blocks drag one column of the disc along their whole length, so colour runs out of the structure.
      if (hash(key,7.)<.42) {
        float column=uCentre.x+(hash(key,8.)-.5)*.62/uAspect;
        ribbon=exp(-abs(vUv.x-column)*uAspect*(2.6+5.*hash(key,26.)));
        shift.x=column-vUv.x;
      }
    }

    // Scanline slip: thin runs of rows pulled sideways, changing faster than the blocks.
    float line=floor(vUv.y*180.), lineKey=hash(vec2(floor(line/3.),9.),uNoise.z);
    if (lineKey>.8-.3*uTear) {
      float pull=hash(vec2(line,10.),uNoise.w)-.5;
      shift.x+=pull*pull*pull*2.6*uSlip.x*uTear*uDrive*(.3+.7*fault);
    }

    // Radial tear: wedges of the disc turn and slide along their own radius.
    vec2 from=(vUv-uCentre)*vec2(uAspect,1.);
    float radius=length(from), angle=atan(from.y,from.x);
    float wedges=6.+2.*floor(hash(uNoise.xy,11.)*5.);
    vec2 wedge=vec2(floor((angle/TAU+.5)*wedges),floor(radius*7.));
    vec2 wedgeKey=wedge+uNoise.yx;
    float turned=step(hash(wedgeKey,12.),uRadial*uTear*.72);
    if (turned>.5) {
      float a=angle+(hash(wedgeKey,13.)-.5)*2.6/wedges*TAU*uDrive;
      float r=radius*(1.+(hash(wedgeKey,14.)-.5)*.5*uDrive);
      shift+=(r*vec2(cos(a),sin(a)))/vec2(uAspect,1.)+uCentre-vUv;
    }
    float broken=max(torn,turned);

    // Channels part further inside a break, each block along its own line.
    float lean=hash(broken>.5?key:vec2(row,15.),16.);
    vec2 part=vec2(cos(lean*TAU*.25),sin(lean*TAU*.25)*.35)*uSplit*.04*uDrive*(.22+.78*broken)*uTear;
    vec2 at=fract(vUv+shift);
    vec4 middle=texture2D(uImage,at);
    vec3 c=vec3(texture2D(uImage,fract(at+part)).r,middle.g,texture2D(uImage,fract(at-part)).b);

    // Colour shred: only light is recoloured, so the black stays black and the rip has edges to read against.
    if (broken>.5) {
      vec3 ink=uInks[int(floor(hash(key,17.)*2.999))];
      float light=max(c.r,max(c.g,c.b));
      if (ribbon>0.) {
        // A ribbon takes an accent colour and burns out as it leaves the structure it was pulled from.
        vec3 accent=uInks[1+int(step(.5,hash(key,27.)))];
        c=mix(c,accent*pow(max(light-.04,0.),.7)*1.4,step(.02,uShred))*ribbon;
        c*=.55+.45*step(.4,fract(vUv.y*uGrid.y*9.));
      } else if (hash(key,18.)<uShred*1.3) c=ink*pow(light,.62)*1.25;
    }

    // Posterise: glow falls into contour steps, hardest inside the breaks.
    if (uPosterise>0.) {
      float steps=mix(9.,2.,uPosterise);
      c=mix(c,floor(c*steps+.5)/steps,uPosterise*(.45+.55*broken));
    }

    // Scan bands: wide dim bars with a fine ruling, like a screen losing lock.
    float band=floor(vUv.y*34.);
    if (hash(vec2(band,21.),uNoise.y)<uBands*.8*uTear) c*=.26+.5*step(.5,fract(vUv.y*270.));

    float cover=clamp(max(middle.a,max(c.r,max(c.g,c.b))),0.,1.);
    gl_FragColor=vec4(c,cover);
  }`;
