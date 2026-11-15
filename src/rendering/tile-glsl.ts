/** Periodic building blocks for Tile edges. tWave, tRate and tCells mirror
 * tileWave, tileRate and tileCells in src/core/tile-edges.ts line for line;
 * a period L <= 0 means that axis does not tile. Needs TAU, hash, gPhase,
 * uSeed and uDetail from the including shader. */
export const tileGLSL = /* glsl */`
float tWave(float k, float L) {
  if(L<=0.) return k;
  float n=max(1.,floor(abs(k)*L/TAU+.5));
  return (k<0.?-1.:1.)*TAU*n/L;
}
float tRate(float k, float L) { return L<=0.?k:floor(k*L+.5)/L; }
float tCells(float f, float L) { return max(1.,floor(f*L+.5)); }
// Lattice cells repeat every n along each axis with n > 0.
float hashT(vec3 i, vec2 n) {
  if(n.x>0.) i.x=mod(i.x,n.x);
  if(n.y>0.) i.y=mod(i.y,n.y);
  return hash(i);
}
float noiseT(vec3 p, vec2 n) {
  vec3 i=floor(p), f=fract(p);
  f=f*f*f*(f*(f*6.-15.)+10.);
  return mix(mix(mix(hashT(i,n),hashT(i+vec3(1,0,0),n),f.x),mix(hashT(i+vec3(0,1,0),n),hashT(i+vec3(1,1,0),n),f.x),f.y),
    mix(mix(hashT(i+vec3(0,0,1),n),hashT(i+vec3(1,0,1),n),f.x),mix(hashT(i+vec3(0,1,1),n),hashT(i+vec3(1,1,1),n),f.x),f.y),f.z);
}
// One octave of fieldT: multiplier m becomes a whole number of cells per period.
float octaveT(vec2 x, vec2 P, float m, vec2 offset, float z) {
  vec2 n=vec2(P.x>0.?tCells(m,P.x):0.,P.y>0.?tCells(m,P.y):0.);
  vec2 scale=vec2(P.x>0.?n.x/P.x:m,P.y>0.?n.y/P.y:m);
  return noiseT(vec3(x*scale+offset,z),n);
}
// field() with period P in x (an axis with P = 0 is not periodic).
float fieldT(vec2 x, vec2 P) {
  vec2 orbit=vec2(cos(gPhase),sin(gPhase));
  float z=mod(uSeed,4093.)*.031;
  float fine=uDetail*.13;
  return (.58*octaveT(x,P,1.,orbit*.47,z)+.29*octaveT(x,P,2.03,orbit*.58,z+9.)
    +fine*octaveT(x,P,4.07,orbit*.36,z+17.))/(.87+fine);
}
`;
