# Real-time GPU kaleidoscope and symmetry maths for a WebGL2 / Three.js VJ instrument

Evidence labels used below:
- **Cited**: taken from the linked source.
- **Checked locally**: my own derivation, run numerically in Python on 2026-11-21. These are maths checks. They are not GPU benchmarks, and no shader was run.
- **Inference**: engineering judgement that was not separately tested.

All formulas and pseudocode are written from the maths for these notes. No shader source was copied.

Complex notation: `z = x + iy`, `cmul(a,b) = (a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x)`, `log z = (ln|z|, atan(y,x))`.

## How to implement all 17 wallpaper groups, rosette groups, hyperbolic and spherical tilings, circle inversion and Mobius transforms in fragment shaders?

### Takeaway
Use one table-driven symmetry engine, but treat groups differently by topology: only **pmm, p3m1, p4m, p6m** and the dihedral rosettes D_n can fold an arbitrary image with no visible seams. The other 13 wallpaper groups and C_n need a periodic, symmetrised motif (overlap-add), or they will show hard seams.

### Cited Findings
- There are exactly 17 planar wallpaper groups; Fedorov proved this in 1891 and Polya derived it independently in 1924 — [Wallpaper group](https://en.wikipedia.org/wiki/Wallpaper_group).
- IUC and orbifold names used in the table below (o, 2222, **, *x, etc.) follow the same reference — [Wallpaper group](https://en.wikipedia.org/wiki/Wallpaper_group).
- A Schwarz triangle (p,q,r) has angles pi/p, pi/q, pi/r. Hyperbolic cases satisfy 1/p + 1/q + 1/r < 1, and (2,3,7) is the smallest hyperbolic one — [Schwarz triangle](https://en.wikipedia.org/wiki/Schwarz_triangle).
- Reverse pixel lookup in the fragment shader is an established approach for hyperbolic floors, credited there to von Gagern — [Hyperbolic Floors](https://medium.com/@philogb/hyperbolic-floors-a2c5445144c6).
- Hyperbolic edges can be reflected by inversion in circles orthogonal to the unit circle — [Hyperbolic Tiling {3,7}](https://marcelpadilla.github.io/Projects/Hyperbolic_Tiling_3,7/).
- A recent O(1)-per-cell method builds tiling *adjacency graphs* on the CPU. It is not a per-pixel method and does not address GPU execution, so it suits mesh or graph generation rather than this shader — [arXiv 2508.04765](https://arxiv.org/html/2508.04765v1).
- A Japanese-language article implements all 17 patterns as separate GLSL functions and is a useful cross-check. Its licence was not verified — [Zenn](https://zenn.dev/aadebdeb/articles/363d6157d23e13).

### Inferences

**Wallpaper operation table (Checked locally).** Coordinates are lattice coordinates `u = B^-1 p`. Every set below was checked for closure modulo translations and for being an isometry on its lattice. `n` is the number of operations in the conventional cell, so it equals the tap count for direct symmetrisation.

| Group | Orbifold | Lattice | n | Operations beyond identity (x,y) | Raw fold with arbitrary image |
|---|---|---|---:|---|---|
| p1 | o | oblique | 1 | none | seam |
| p2 | 2222 | oblique | 2 | -x,-y | seam |
| pm | ** | rect | 2 | -x,y | seam |
| pg | xx | rect | 2 | -x,y+1/2 | seam |
| cm | *x | centred rect | 4 | -x,y; all +(1/2,1/2) | seam |
| **pmm** | *2222 | rect | 4 | -x,-y; -x,y; x,-y | **clean** |
| pmg | 22* | rect | 4 | -x,-y; 1/2-x,y; 1/2+x,-y | seam |
| pgg | 22x | rect | 4 | -x,-y; 1/2-x,1/2+y; 1/2+x,1/2-y | seam |
| cmm | 2*22 | centred rect | 8 | pmm; all +(1/2,1/2) | seam |
| p4 | 442 | square | 4 | -x,-y; -y,x; y,-x | seam |
| **p4m** | *442 | square | 8 | p4; -x,y; x,-y; y,x; -y,-x | **clean** |
| p4g | 4*2 | square | 8 | p4; 1/2-x,1/2+y; 1/2+x,1/2-y; 1/2+y,1/2+x; 1/2-y,1/2-x | seam |
| p3 | 333 | hex | 3 | -y,x-y; y-x,-x | seam |
| **p3m1** | *333 | hex | 6 | p3; -y,-x; y-x,y; x,x-y | **clean** |
| p31m | 3*3 | hex | 6 | p3; y,x; x-y,-y; -x,y-x | seam |
| p6 | 632 | hex | 6 | p3; -x,-y; y,y-x; x-y,x | seam |
| **p6m** | *632 | hex | 12 | p6; all six mirrors from p3m1 and p31m | **clean** |

Lattice bases used: hex `a1=(1,0), a2=(-1/2, sqrt(3)/2)`; square `I`; rectangular `diag(1, h)`. The Wikipedia page lists `pg` as the orbifold written with a cross-cross symbol; its fetched table rendering was garbled, so confirm that glyph before showing it in UI.

**Seam test (Checked locally).** I folded a smooth non-periodic test image to the nearest orbit image of a generic seed (a Dirichlet domain), then took 30,000 random 0.002-unit steps per group. pmm, p3m1, p4m and p6m had 0 discontinuities (max step change 0.005). The other 13 groups all had discontinuities (max step change 0.65 to 1.90). A first, smaller-step test missed the seams in pm and pmg, so the larger directed test is the one to trust.

Why: those four groups have fundamental polygons whose edges are all mirrors. In every other group, at least one edge is glued by a translation, rotation or glide, so an arbitrary image disagrees across it.

**Generic fold (for all 17):**
```
u = inverse(B) * p
best = infinity
for each op k:
    v = A[k] * u + t[k]
    v -= round(v - seed)
    d = squared metric length of B * (v - seed), checking neighbours -1..1 if the cell is skewed
    keep the v with smallest d, and A[k]
```
Cost: `n` affine evaluations, up to 9 neighbour checks per op for full correctness. Use this for bake passes or low-order groups. For runtime mirror groups, write direct folds:
- pmm: `tri(2x), tri(2y)` with `tri(t) = abs(fract(t*0.5)*2 - 1)`, which puts mirrors at the half-cell lines of the table above. About 2 fract and 2 abs.
- p4m: pmm, then `if (y > x) swap`. One extra comparison.
- p6m and p3m1: reduce to the hex cell, then apply 2 to 3 half-plane reflections. Inference: 3 to 6 dot products.

**Rosettes (Checked locally).**
- `C_n`: `a = mod(theta, 2pi/n)`. Showed seams for n = 3, 6, 12.
- `D_n`: `a = abs(mod(theta + pi/n, 2pi/n) - pi/n)`. No seams for n = 3, 6, 12 in 40,000 steps each.
- Atan-free option for integer n: repeated half-plane reflections take O(log n) dot products if n is a power of two. Otherwise use `atan` once.

**Circle inversion:** `p' = c + R^2 (p-c)/|p-c|^2`. Local scale is `R^2/|p-c|^2`. It reverses orientation.

**Disk Mobius (Checked locally):** `f(z) = e^(i phi) (z-a)/(1 - conj(a) z)`, `|a|<1`, with `f'(z) = e^(i phi)(1-|a|^2)/(1-conj(a) z)^2`. This is a rigid hyperbolic motion, so animating `a` pans through the tiling without changing tile shapes. Cost: 2 complex multiplies and 1 complex divide.

**Hyperbolic (p,q,2) triangle fold (Checked locally).** Mirrors are the x-axis, the line at angle pi/p, and a circle centred at `(d,0)` with radius `R`:
```
D = cos^2(pi/q) - sin^2(pi/p)        // positive only if 1/p + 1/q < 1/2
d = cos(pi/q) / sqrt(D)
R = sin(pi/p) / sqrt(D)
loop:
    fold angle into [0, pi/p]         // dihedral fold, O(1)
    if |z-c| >= R: break
    z = c + R^2 (z-c)/|z-c|^2         // accumulate scale and parity
```
Circle inversions needed, sampled over 40,000 points with `|z| <= 0.995`:

| (p,q) | mean | p99 | max |
|---|---:|---:|---:|
| (7,3) | 1.99 | 6 | 7 |
| (3,7) | 4.38 | 12 | 15 |
| (4,5) | 2.30 | 7 | 8 |
| (5,4) | 2.00 | 6 | 8 |
| (8,3) | 1.42 | 4 | 5 |
| (6,4) | 1.42 | 4 | 6 |

A loop cap of 16 covers these cases. Prefer the larger value as `p` when the visual allows it, since (7,3) costs less than half of (3,7) on average. Cost per iteration: 1 atan-free angular fold if possible, plus 1 inversion.

**Spherical (p,q,2) via stereographic projection (constants Checked locally):** `D = sin^2(pi/p) - cos^2(pi/q)`, `d = cos(pi/q)/sqrt(D)`, `R = sin(pi/p)/sqrt(D)`, giving `R^2 - d^2 = 1` for (3,3), (4,3), (5,3). The fold loop itself was not run for the spherical case.

### Gaps
- Conway, Burgiel and Goodman-Strauss, *The Symmetries of Things*, was not accessed. Orbifold names come from Wikipedia.
- General (p,q,r) with r != 2 was not derived or tested. A Coxeter/Gram-matrix setup in the hyperboloid model is the likely route.
- Direct half-plane sequences for p3m1 and p6m are described, not individually tested. The generic table fold is what was tested.
- No GPU timing was measured for any group.

## Log-polar and Droste maths: seamless infinite zoom, integer-lattice closure conditions, spiral arms

### Takeaway
Map `w = log z`, multiply by `gamma = b - i a L/(2 pi)` with integer `(a,b)` and `L = ln(lambda)`, then tile. Those integers are the closure condition, and animating the tile coordinate by one whole unit gives a perfect zoom loop.

### Cited Findings
- De Smit describes Escher's Print Gallery structure as a pull-back to a doubly periodic wallpaper followed by a push-forward through a conformal map — [de Smit, Bridges 2005](https://pub.math.leidenuniv.nl/~smitbde/papers/bridges-2005-desmit.pdf).
- Escher's four straight sketches combine into a Droste picture with scale factor 256 — [de Smit, Bridges 2005](https://pub.math.leidenuniv.nl/~smitbde/papers/bridges-2005-desmit.pdf).
- A Droste picture can be treated as a torus (genus-1 Riemann surface), and different twists can be connected by Dehn twists — [de Smit, Bridges 2005](https://pub.math.leidenuniv.nl/~smitbde/papers/bridges-2005-desmit.pdf).
- The Leiden group's Print Gallery value is `q = -20.883 + 8.596i`, with exact form `exp(2 pi i log 256 / (2 pi i + log 256))` — [Conrad, C*/q^Z notes](https://kconrad.math.uconn.edu/blurbs/grouptheory/CstarqZ.pdf).
- Reported magnitude and rotation for the idealised copy are about 22.58 and 157.63 degrees — [Print Gallery](https://en.wikipedia.org/wiki/Print_Gallery_(M._C._Escher)); [arXiv 2610.02210](https://arxiv.org/pdf/2610.02210).
- Primary project page: [Escher and the Droste effect, Leiden](https://pub.math.leidenuniv.nl/~smitbde/escherdroste/). The original paper is de Smit and Lenstra, *Notices of the AMS* 50(4), 2003, pp. 446-451 — [reference list in Bridges 2005](https://pub.math.leidenuniv.nl/~smitbde/papers/bridges-2005-desmit.pdf).

### Inferences

**Core map (Checked locally):**
```
L     = ln(lambda)                  // lambda > 1, radial scale per tile period
gamma = b - i*a*L/(2*pi)            // a, b integers
w     = log(z - center)
v     = cmul(gamma, w)
t     = vec2(v.x / L, v.y / (2*pi)) + vec2(phase, 0)
color = motif(t)                    // motif has period 1 on both axes
```
Closure: `gamma * 2 pi i = a L + b (2 pi i)`, so one trip round the screen moves `t` by the integer vector `(a,b)`. Numerical residual was 7e-15 over six `(a,b)` pairs.

- `(a,b) = (0,b)`: concentric rings with b-fold rotation, no spiral.
- `(a,b) = (1,1)`: the classic Escher-style single twist. With `lambda = 256`, this reproduces the published multiplier: `q = exp(L/gamma) = -20.8835 + 8.5966i`, `|q| = 22.5837`, angle 157.6256 degrees.
- General `(a,b)`: `|a|` and `|b|` count how many times the two tile-line families cross a circle around the centre, so they set the two spiral-arm counts.
- For square tiles in `t`, choose `L = 2 pi * rows / columns`. `L = 2 pi` means `lambda` of about 535.

**Infinite zoom.** Animate `phase` and wrap it at 1. The screen then multiplies by the complex factor `q^phase`, where `q = exp(L/gamma)`. Because the motif is periodic, the wrap is invisible. Do not animate a real zoom on `w` when `a != 0`: a real shift generally does not land on a lattice vector, so it will not loop.

**Scale-like mosaic.** Inside `motif(t)`, offset every second row by half a tile and draw an SDF scale per cell. The row offset requires an even row count around the closure, or an adjusted `(a,b)`, otherwise the brick pattern breaks at the seam.

**Analytic footprint (Checked locally).** With `s = exp(gamma log z)`, `ds/dz = gamma s / z`. For the tile coordinate, `dv = gamma * dz / z`. Compute `dz = dFdx(z)`, `dFdy(z)`, and apply these complex multiplies. This never differentiates `atan`, so the branch cut produces no mip spike.

**Per-pixel cost:** 1 log, 1 atan, 1 complex multiply for the map; 2 complex divides or multiplies for the gradients; then 1 motif evaluation or 1 `textureGrad`.

**Pixels at the centre.** The local scale `|gamma|/|z|` goes to infinity. Fade to the motif's average colour once the footprint exceeds about one tile.

### Gaps
- The full 2003 Notices paper was blocked (HTTP 403). Its results are cited here through de Smit's 2005 paper, Conrad's notes and secondary sources.
- A Droste image with a true transparent hole requires a multi-layer lookup. That case was not tested.

## Seam-free mirror folds: derivative discontinuities, correct texture gradients and mip selection, analytic antialiasing, Jacobian-based footprints

### Takeaway
Never let the GPU differentiate a folded coordinate. Differentiate the continuous pre-fold position, push those gradients through the accumulated Jacobian of the chosen fold, and call `textureGrad`.

### Cited Findings
- `atan` jumps by about 2 pi across its branch cut, which sends hardware derivatives to the smallest mip and leaves a visible line. The fix is to supply derivatives from a coordinate without that wrap and sample with `textureGrad` — [Quilez, Tunnel](https://iquilezles.org/articles/tunnel) (read through a search excerpt, because the full page fetch returned 404).
- The same discontinuity and the `textureGrad` fix were confirmed by a Babylon.js user. Disabling mipmaps is the quick alternative, at the price of aliasing — [Babylon.js forum](https://forum.babylonjs.com/t/strange-dots-appearing-in-proceduraltexture/47967).
- Ben Golus's radial grid takes derivatives of both `angle` and `frac(angle)` and keeps the smaller one. Line width is clamped to at least about one pixel, the edge uses roughly 1.5 times the derivative, and lines fade to average coverage at high density — [bgolus gist](https://gist.github.com/bgolus/3e32ae98654b9d47c389592f31fcd3bc). **No licence is stated, so use the idea and do not copy the code.**
- Quilez publishes analytically box-filtered checker, grid, square and XOR patterns driven by `dpdx` and `dpdy` — [Filterable procedurals](https://iquilezles.org/articles/filterableprocedurals/) (search excerpt only).
- Anisotropic filtering is Baseline Widely available through `EXT_texture_filter_anisotropic` — [MDN](https://developer.mozilla.org/docs/Web/API/EXT_texture_filter_anisotropic). It can significantly raise texture bandwidth — [Anisotropic filtering](https://en.wikipedia.org/wiki/Anisotropic_filtering).
- In WGSL, the derivative-uniformity rule lists derivative built-ins, `textureSample`, `textureSampleBias` and `textureSampleCompare`; `textureSampleGrad` and `textureSampleLevel` are not in that list — [WGSL spec, section 2.3.2](https://www.w3.org/TR/WGSL/). Tint explains that the restriction exists because these operations compare neighbouring pixels in a quad — [Tint uniformity analysis](https://dawn.googlesource.com/dawn/+/HEAD/docs/tint/uniformity_analysis.md).

### Inferences

**Gradient chain rule:**
```
dpx = dFdx(p);  dpy = dFdy(p)          // p is continuous, before any fold
(s, A, k) = fold(p)                    // A = linear part, k = conformal scale if used
color = textureGrad(tex, s, A*dpx, A*dpy)
```
Rules for updating the accumulated Jacobian:
- Reflection or rotation: `A = R * A`. Footprint size is unchanged.
- Lattice change: multiply by `B^-1`.
- Circle inversion at `v = p - c`: `J = (R^2/|v|^2) * (I - 2 v v^T / |v|^2)`. Apply `A = J * A`.
- Any holomorphic map `f`: gradient becomes `cmul(f'(z), dz)`.
- Anti-holomorphic step: conjugate, then multiply.

**Hardware-derivative hazard.** Derivatives are computed on 2x2 quads. A quad straddling a fold gets a wrong gradient even when the colour is continuous. Mirror folds therefore show thin bright or blurry lines unless the gradient is computed before the fold.

**Procedural line AA.** For a signed distance `d` in folded space:
```
w = length(vec2(dot(grad_d, dpx_folded), dot(grad_d, dpy_folded)))   // or |J| * pixel size
alpha = 1 - smoothstep(halfWidth - w, halfWidth + w, abs(d))
```
For conformal chains, `w = pixelSize * k`, where `k` is the product of local scales. This gives uniform thin neon lines across a whole tiling, and stays stable in the Poincare disk. When `w` exceeds about half a cell, fade toward average coverage, as in the Golus approach.

**Cost:** 2 derivative instructions, 1 mat2 accumulation per fold step, and `textureGrad` in place of `texture`. Analytic lines replace supersampling, which would otherwise multiply the full shader cost by 4 or more.

**WebGPU upgrades:**
- `textureSampleGrad` is a natural fit for loops and branches.
- Compute passes can build the motif and mip chain.
- Storage textures can hold per-cell parity or crossing tables.

### Gaps
- The Quilez articles returned 404 to the fetch tool and were read only through search excerpts. Re-check them in a browser before implementation.
- WGSL section 17.7 was not read in full. The exemption above rests on the list in section 2.3.2.
- GPU Gems was not consulted.
- Device-specific cost of `textureGrad` with anisotropy is unmeasured.

## How to compute over/under weaving for interlaced knots, Celtic and Islamic patterns procedurally?

### Takeaway
An alternating weave exists on any 4-regular planar design, and on a regular lattice it reduces to a one-line parity. The trap is that **mirrors bisecting a crossing and 90-degree rotations flip over/under**, so weave height cannot simply be copied through a kaleidoscope fold.

### Cited Findings
- Kaplan's interlace style applies when every graph vertex has degree two or four. Crossings can then be chosen so strands strictly alternate over and under — [Kaplan 2000](https://cs.uwaterloo.ca/~csk/publications/Papers/kaplan_2000.pdf).
- When all vertices have even degree, faces can be 2-coloured so same-colour faces never share an edge — [Kaplan 2000](https://cs.uwaterloo.ca/~csk/publications/Papers/kaplan_2000.pdf). This directly supports look (d).
- Extending rosette line segments into gaps guarantees an interlacing design except in degenerate cases — [Kaplan 2000](https://cs.uwaterloo.ca/~csk/publications/Papers/kaplan_2000.pdf).
- Hankin's polygons-in-contact method starts from a tiling and puts a pair of rays at each edge contact, each forming contact angle theta with the edge — [Kaplan 2005](https://cs.uwaterloo.ca/~csk/publications/Papers/kaplan_2005.pdf).
- A typical contact angle is 45 degrees, and varying it spatially produces parquet-deformation designs — [Kaplan 2005](https://cs.uwaterloo.ca/~csk/publications/Papers/kaplan_2005.pdf).
- Kaplan matches the 2n rays in an n-sided tile greedily: sort candidate pairs by path length and accept pairs whose rays are unused. Exhaustive search exceeds half a billion possibilities at 10 sides. The greedy result is perfect on regular polygons — [Kaplan 2005](https://cs.uwaterloo.ca/~csk/publications/Papers/kaplan_2005.pdf).
- CelticGraph assigns each thread +1 or -1 with neighbours along a circuit alternating. It proves every 4-regular plane graph has a consistent alternating assignment, computable in linear time — [CelticGraph](https://arxiv.org/pdf/2309.02852).
- Spline-based Celtic knotwork has been used as input to procedural shaders, using shortest distance from the shading point to the spline — [thesis via CORE](https://core.ac.uk/download/4268339.pdf).
- Open curves with loose ends can force non-alternating runs — [McNeel forum](https://discourse.mcneel.com/t/parametric-3d-weaving-pattern-with-over-under-effect/203053). This is a community source.

### Inferences

**Lattice weave.** Put strands along diagonals, `U = x+y`, `V = x-y`, with crossings at integer `(i,j) = round(U,V)`:
```
aOver   = mod(i + j, 2) == 0
dA, dB  = distance to the nearest strand in each family
topD    = aOver ? dA : dB
botD    = aOver ? dB : dA
draw bottom ribbon, then shadow from top, then top ribbon
```
Cost: 2 rounds, 2 distance evaluations, 1 parity test. No loop.

**Which symmetries preserve the weave (Checked locally, all crossings in a 9 x 9 patch):**

| Operation | Effect on over/under |
|---|---|
| Translate (2,0) in (U,V) | preserved |
| Translate (1,1) in (U,V) | preserved |
| Translate (1,0) in (U,V) | **flipped** |
| Rotate 180 degrees about a crossing | preserved |
| Rotate 90 degrees about a crossing | **flipped** |
| Mirror along a strand | preserved |
| Mirror bisecting a crossing | **flipped** |

Consequences:
1. **Do not use the fold determinant as the parity.** A 90-degree rotation has determinant +1 and still flips.
2. Track one `flip` bit per operation in the symmetry table, then use `aOver ^= flip`.
3. Alternatively, compute parity in *unfolded* coordinates, then fold only the ribbon shape.
4. Weave translation periods must have even `i + j` in `(U,V)`, for example `(2,0)` or `(1,1)`.
5. Around a closed rosette ring, the alternating crossing count must be even. An odd count per wedge needs an even `n`.

**Tube shading.** With `d` as distance from ribbon centre and `r` as half-width:
```
h = sqrt(max(0, 1 - (d/r)^2))
normal = normalize(T_perp * d/r + Z * h)
```
Add crossing elevation `z = zBase + side * smoothstep(crossRadius, 0, distToCrossing)`. Add a soft contact shadow on the lower ribbon near the upper ribbon's edge. Per-pixel: 1 sqrt, 1 normalise, and the lighting model.

**Islamic and irregular designs.** Build on the CPU with Hankin rays, walk the 4-regular graph, store a +1/-1 per crossing, and bake to a small data texture or SDF atlas. Rebuild on structural parameter changes only. Contact-angle changes can update geometry without changing the crossing topology until a degeneracy occurs. Treat that event as a rebuild trigger.

### Gaps
- No peer-reviewed real-time GPU weave shader was found. The lattice method here is a derivation, checked at crossing level but not rendered.
- The rosette-ring parity condition is reasoned and was not separately simulated.
- Kaplan's patterns are CPU constructions, so the bake latency for live parameter changes is unknown.

## How should a kaleidoscope take arbitrary inputs (video, camera, another layer, feedback), and what sampling and filtering is best?

### Takeaway
Use a three-stage pipeline: **input conditioning, a small periodic motif target, then a display map with analytic gradients.** Mirror groups can skip the motif target and sample the source directly, while non-mirror groups use it to get seam-free results from any input.

### Cited Findings
- Three.js `VideoTexture` has `generateMipmaps` off by default. A forum commenter guesses streaming mips carry a performance penalty, but this is unmeasured — [Three.js forum](https://discourse.threejs.org/t/does-videotexture-support-mipmapping/88796); [VideoTexture docs](https://threejs.org/docs/pages/VideoTexture.html).
- A full mip chain adds about 33% memory — [Mipmap](https://en.wikipedia.org/wiki/Mipmap).
- Anisotropy is queried with `MAX_TEXTURE_MAX_ANISOTROPY_EXT` and set with `TEXTURE_MAX_ANISOTROPY_EXT` — [MDN](https://developer.mozilla.org/docs/Web/API/EXT_texture_filter_anisotropic).
- The Vidvox ISF-Files repository is MIT licensed (GitHub licence metadata and LICENSE file) and contains `Kaleidoscope.fs`, `Kaleidoscope Tile.fs`, `Mirror.fs` and related filters — [Vidvox/ISF-Files](https://github.com/Vidvox/ISF-Files). Individual file headers may credit other authors, so check each file before reuse.

### Inferences

**Overlap-add symmetrisation (Checked locally).** This is what makes non-mirror groups safe for any image:
```
Pass A, periodise (4 taps):
  P(u) = sum over ox,oy in {0, 1/2}:
         wx(x,ox) * wy(y,oy) * Source(fract(u + (ox,oy)))
  with w(t,0) = sin^2(pi t), w(t,1/2) = cos^2(pi t)

Pass B, symmetrise (n taps, REPEAT wrap):
  M(u) = (1/n) * sum over k: P(A[k] u + t[k])

Display (1 tap):
  textureGrad(M, inverse(B)*p, inverse(B)*dpx, inverse(B)*dpy)   // do NOT fract u
```
Across all 17 groups, the largest change over a 0.002 step was 0.0031, compared with up to 1.90 for raw folds, and invariance error was at most 7e-16. Weights vanish exactly where `fract` jumps, so the periodised image is continuous by construction.

Do **not** make the source periodic with mirrored repeat for chiral groups: that adds mirrors and silently turns p1 or p4 into a higher-symmetry group.

**Cost comparison at 1920 x 1080 (2.07M pixels), arithmetic only:**

| Method | Taps per output pixel | Approx. taps per frame |
|---|---:|---:|
| Direct mirror fold | 1 | 2.1M |
| Direct overlap-add, n = 6 | 24 | 50M |
| Baked 512 x 512: P (4) + M (n = 6) + display (1) | n/a | 2.6M + 2.1M = 4.7M |
| Baked 512 x 512, n = 12 | n/a | 4.2M + 2.1M = 6.3M |

**Trade-off:** averaging n images lowers contrast and softens detail. Mitigate by contrast restoration after Pass B, or by weighting toward one image. The weighted variant was not tested.

**Recommended input handling:**
- **Video and camera:** copy into an instrument-owned RT at a fixed size. Generate mips only if the display map minifies. Use `textureGrad` with linear-mipmap-linear and anisotropy of 4 to 8 when the map is strongly non-uniform (log-polar, Poincare).
- **Another layer:** render into a linear RGBA16F target if available, so filtering happens in linear light. Convert to display space at the end.
- **Feedback:** keep two RTs and swap them. Apply the fold to the *previous output*, with a small decay and transform. Use `CLAMP_TO_EDGE` or fade near edges to avoid bright border streaks, and clamp HDR values so repeated folds cannot blow up.
- **Source aspect:** keep lattice coordinates separate from source UVs, with an explicit source transform (offset, rotate, scale). This becomes the performer's main "what is inside the mirror" control.
- **Bounds:** for direct mirror folds of a non-tiled source, fit the fundamental domain inside the source, or the fold will read outside it.

**Mapping the five reference looks to techniques (described as techniques only):**

| Look | Domain | Motif | Antialiasing |
|---|---|---|---|
| (a) Spiral scale mosaic with infinite zoom | log + gamma(a,b), `phase` loop | SDF scales, offset rows | analytic `dv = gamma dz/z` |
| (b) Thin neon curves in a lattice | p4m/p6m fold, then a smooth warp before the fold | SDF curves on black, additive | `w = pixel * k` |
| (c) Interlaced ribbons in a rosette | D_n or lattice, with `flip` table | two-strand SDF, tube normal | SDF edges and contact shadow |
| (d) Hard two-tone rosettes | D_n, circle-overlap distance field, optional inversion | parity of circles covering the point, stepped gradient | analytic step on each circle edge |
| (e) Mirrored dot tunnel with lens bulge | perspective or `1/r` map, radial bulge, pmm/p4m fold | filtered dots | full Jacobian (non-conformal), `textureGrad` if image-based |

For (b), a swirl applied *before* the fold keeps the group's symmetry only if the swirl itself is symmetric. Applied *after* the fold (to the sampling coordinate) it keeps symmetry for any swirl, so that is the safer default.

For (d), `parity = sum over circles of (inside ? 1 : 0) mod 2` gives a valid 2-colouring of any circle arrangement, which is the flower-of-life overlap look. Cost is one distance test per circle in the folded cell, so fold first and keep the local circle count small.

**Suggested instrument order:** source transform, domain warp, symmetry fold or motif lookup, post-fold warp, colour map or posterise, feedback mix. Exposing group, `(a,b)`, `lambda`, `phase` and `(p,q)` gives a small control surface over a large visual range.

**Licence guidance:**
- ISF-Files: MIT, with attribution retained.
- Shadertoy: treat as restrictive unless a shader states otherwise. Do not copy.
- bgolus gist and Quilez articles: use the published ideas and write original code, since a reusable licence was not confirmed.

### Gaps
- Shadertoy's terms page returned HTTP 403, so its default licence could not be verified in this session.
- No reliable measurement was found for per-frame `generateMipmap` cost on video in WebGL2. Profile with `EXT_disjoint_timer_query_webgl2` on target hardware.
- Taps-per-frame figures are arithmetic and do not predict GPU time. Bandwidth, cache behaviour and anisotropy will shift them.
- The feedback, colour-space and clamp recommendations are engineering judgement and were not tested in this app.
- The p31m, p4g and other non-mirror groups were verified mathematically, but their visual appeal after overlap-add averaging has not been assessed.
