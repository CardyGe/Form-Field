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
    return mix(c,aInk.w<.26?uInks[2]:uInks[1],uPeak*torn*.9);
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
