# 14. Crystal Reef

**Recommendation: separate the polygon mosaic from an actual clustered growth instrument. Scope: L — topology, geometry and growth authoring.**

4 presets reviewed. [All source references](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/references.md>). [Audit index](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/README.md>).

## Current result and cause

The four looks are mostly a full-frame Voronoi mosaic with beveled facets and bright borders. The preset names promise mineral veins, reefs and geodes, but the primary form stays a tiled sheet. [instrument-shaders.ts](</Users/grego/Documents/ChatGPT/three VJ/src/rendering/instrument-shaders.ts>) uses nearest-site data, quantized local angular facets and a height field; growth changes per-cell coverage/height. A traveling front is more spatial than uniform pulsing, but it still reveals pre-existing cells. It does not grow a connected branching skeleton or a 3D crystal cluster.

Fresh evidence: [three-phase contact sheet](</Users/grego/Documents/ChatGPT/three VJ/work/effect-audit-2026-11-11/reef-contact.png>). Twelve-sample branch sheets are linked in the [preset evidence index](</Users/grego/Documents/ChatGPT/three VJ/docs/effect-audit-2026-11-11/preset-index.md>).

## Branch-by-branch plan

| Look | Plan |
| --- | --- |
| Amethyst Veins | Choose branching mineral veins with a connected skeleton and sparse crystal deposits, or rename the current mode as Amethyst mosaic. |
| Porcelain Reef | Construct several irregular 3D clusters with a readable base and height differences. |
| Amber Fault | Follow one dominant crack, with branching hierarchy and delayed internal illumination. |
| Opal Geode | Make an actual cavity with clustered faceted forms pointing inward, rather than a flat grid of facets. |

## Comparison and reference lessons

TouchDesigner: [Pao Olea — Crystal Material [04]](https://derivative.ca/community-post/tutorial/crystal-material-touchdesigner-tutorial-04/69966) starts from a 3D base and refines shape/material/light; [Pao Olea — Creating Plants [35]](https://derivative.ca/community-post/tutorial/creating-plants-touchdesigner-tutorial-35/75697) illustrates current attribute/trail construction but is not mineral simulation. MadMapper: [MadMapper Crystalline Sphere](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Online%20Library/Crystalline%20Sphere/Crystalline%20Sphere.fs) supplies an optical 3D comparison and [MadMapper Voronoi Glass Panes](https://github.com/madmappersoftware/MadMapper-Materials/blob/d7ff211281f1878feeccd8ead05ce855c0eac5ee/Materials/Online%20Library/Voronoi%20Glass%20Panes/Voronoi%20Glass%20Panes.fs) adds layered optical depth to cells. [Julius Horsthuis — ConsciousCoral](https://resolume.com/footage/ConsciousCoral) is a commercial morphology/lighting benchmark. [Runions, Lane & Prusinkiewicz — Space Colonization](https://www.algorithmicbotany.org/papers/colonization.egwnp2007.html) offers an artist-controllable branching mechanism if veins are chosen; biological space colonization is an analogy, not crystal physics.

## Proposed authored target

**Amber fault**—one fracture develops secondary branches; sparse facet clusters emerge along it and illuminate after growth. **Geode opening**—a dark cavity reveals facets at several scales under a moving light. **Porcelain colony**—a few large forms establish the cluster, fine growth appears only near their edges. Pick veins or crystals first; they need different representations.

## Implementation sequence

1. Keep the existing Voronoi surface as Mineral mosaic. Build a separate new geometry mode rather than continuously adding heightfield controls.
2. For veins, prepare a stable branch graph guided by free space/region masks, assign birth times and widths, and reveal it by graph distance. For crystals, instance a small original mesh library with controlled orientation and size classes.
3. Use real depth, occlusion, differentiated faces and material thickness/tint cues. Separate internal illumination from an outline glow.
4. Author growth timing, gaps and dominant clusters; add the surface boundary as a growth envelope/guide. Preserve deterministic preparation and graph IDs.

## Controls, timing and mapping

Expose growth envelope, branch/cluster hierarchy, crystal aspect, scale distribution, onset timing and light/transmission treatment. Prepared graph growth can be deterministic and economical. Forward growth is normally finite; a loop may use a designed reveal/retreat or lighting cycle, explicitly described. Do not reverse a physical growth claim silently.

## Proof required before broadening

The silhouette must show different cluster heights and directions. Require connected vein topology where the name promises veins, persistent identities during reveal, no facet/shadow popping and stable small highlights. Review an unlit material-ID render and a neutral clay view so glow cannot conceal a flat representation. Keep enough open space to read the growth path.

## Cost, risk and alternative

A branch graph plus instanced crystal meshes is a manageable stylized construction, though still a new subsystem. True mineral growth, refraction and multiple scattering would be much larger. If the ambition is only a textured wall, the honest alternative is a carefully authored mosaic family.
