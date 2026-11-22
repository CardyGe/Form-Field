# Map: sound, effect settings and screen space, second pass

18 November 2026. Greg: "the sound UI… works, but it should be separate for each effect/shape; parameters seem to be missing… [you] can put sound reaction on parameters that aren't even working yet without the master effect being turned on… there's a lot of empty space on the screen around the canvas, maybe we can use that better." He chose layout **A** from the mockups: everything about a shape in its own panel, plus one always-visible sound strip.

## Intent

The pieces from stage 5 work but feel bolted on:
- One show-wide **Sound & MIDI** tab lists every link as a tall stack of dropdowns.
- The **effect's own settings** are not in Map at all; they are only reachable through Edit in Studio, which leaves Map.
- **∿** can be added to things that cannot do anything yet.
- The **stage** sits letterboxed in a large black area with two thin bars under it.

The goal is that working on one shape means looking at one place, and that the screen around the stage earns its space.

## Goals

**Details gets three tabs for the selected shape: Shape, Effect, Sound.** The shape's colour swatch and name stay above the tabs.

- **Shape:** Placement, Look, Edge and Shape, as today.
- **Effect:**
  - **The effect's own settings:** the ones Studio shows, in Studio's groups (Shape, Motion, Material, Camera), with Studio's advanced settings folded away. Each setting has ∿.
  - **The rest of today's instrument card:** what it plays (Change…), Palette, Speed with ∿, Vary, Loop with the tempo, Edit in Studio, Share with, Make separate, "Change all linked shapes" and Blocker.
  - **Editing:** an edit reaches the projector at once and is one undo step in Map. It changes the shared effect, so every shape playing it changes, unless "Change all" is off; then this shape gets its own copy first, as Change… does today.
  - **A Live shape:** this tab holds the Live controls (today's Live section).
  - **A shape playing its own colour or grid:** the tab says "Choose an effect first", with Change….
- **Sound:**
  - **This shape's reactions only:** links whose target is this shape, or the effect it plays, or Live if it plays Live. Each is a compact row: *listens to → moves · amount*.
  - **Details on click:** the row opens to the full controls (How, Amount or Low/High, Rise, Fall, Learn, on/off, remove).
  - **The ready-made reactions** sit at the top of the tab.
- **The tab label** shows a count when a shape has reactions (Sound ∿2). The shape list shows ∿n beside a shape that reacts.

**One sound strip along the bottom, always visible.** It replaces the Snap / Room photo bar and the scenes bar under the stage. It holds:
- the sound input (with Test beat), live meters for bass, mids, highs and level, and the beat
- the tempo source, BPM, Tap and the beat dots
- the MIDI on/off and its activity light
- the scenes (today's scene bar, unchanged in behaviour)
- a **Triggers** button that opens the triggers list in a popover, since triggers act on the whole show, not one shape

**Snap and Room photo** move into the tool row above the stage, next to the drawing tools.

**The global Sound & MIDI tab goes.** Every link stays reachable from the Sound tab of the shape it moves. A link whose target shape is gone is removed, as today.

**The stage gets the height** the two bars used.

**∿ only where it works:**
- **A setting Studio hides for this effect** (it depends on the chosen pattern, style or variant) is not shown, so it cannot be made to react.
- **A setting greyed in its own panel** has its ∿ greyed, with a note saying what to switch on. Today's cases:
  - Speed while Loop with the tempo is on
  - Signal Melt's pose sliders while Remove background is off
  - Smoke's Life while Forever is on
- **Sound reactions without a sound input:** they can be added, and the row says "Choose a sound input in the strip below", with the strip's input select highlighted. MIDI reactions and Learn work regardless.
- **A shape that plays nothing:** it has no Effect settings to react, and its Sound tab says so. Its Shape tab settings (brightness, zoom, turn, move) keep their ∿.

## Calls made after the builder check

My calls, for Greg to check:

1. **What the Effect tab holds:** what Studio's inspector shows for that layer.
   - **Included:** the choice selectors (Style or Pattern, Variant, Form, Render quality, and so on), then the setting groups in Studio's order and folding, Super 8's own groups included, then the finish and grading settings, then the layer's Opacity.
   - **Left out:** the Print screen section, the image editor (`SurfaceEditor`), and Studio's Animate. These belong to Studio's own export and editing.
   - **When a choice changes** (Style, Variant), the effect is prepared again with the usual crossfade, as Change… does. The settings it shows then follow the new choice.
2. **Preparation settings and seed:** shown and editable, as in Studio.
   - **Changing one** prepares the effect again with the crossfade. This is the one exception to "only adjusted, never restarted", because these settings only take effect that way.
   - **Their ∿ is greyed**, with the note "Changing this restarts the effect, so it can't follow sound".
3. **Effects with several layers:** a row of layer chips at the top of the Effect tab, shown only when there is more than one layer. It picks which layer's settings are shown. Links and labels name the layer ("Neon Shutters, layer 2 · Drift") only when there is more than one.
4. **Reactions no shape on screen shows:** for example, on an effect that only a scene not on screen plays. The strip's **Triggers** button becomes **Show**. Its popover lists the triggers and then "Reactions in other scenes", each one editable or removable there.
5. **"Change all" off, and an edit gives this shape its own copy:** the effect's reactions are copied to the new copy, so they stay in this shape's Sound tab and keep working. If copying would pass the 64-link limit, the ones that fit are copied and a note says how many were not. The same applies to Make separate.
6. **A setting animated in Studio** shows a small "animated in Studio" mark in the Effect tab, and its slider is read-only there. Studio's animation drives it. Map has no Animate of its own.
7. **A reaction on a setting that is now hidden** (its pattern changed): it stays in the show and its Sound-tab row is marked "Not in use: this setting is hidden for this pattern", so it can be removed or kept for when the pattern comes back.

## Non-goals

- Changing what reactions, links, triggers, scenes or tempo can do. The engine and the show file stay as they are; only where things are shown changes.
- Changing Studio's own screen.
- A mixer view of every shape at once (layout B was not chosen).
- Live screen changes beyond what sharing components brings.

## Anti-goals

These would be failures even if everything else worked:

- An effect setting in Map behaving differently from the same setting in Studio: a different range, step, grouping, or a setting shown in one and not the other.
- Sound controls scattered so that the input, meters or tempo are hidden while editing a shape.
- Any edit in the Effect tab blacking out the projector, or restarting an effect that was only adjusted.

## Constraints

- Studio's setting controls (`Parameter` and the rules that pick which settings to show, in `src/ui/App.tsx`) are taken out into shared components and rules that Studio and Map both use. Studio must look and behave exactly as before.
- An Effect-tab edit is a new Map edit (the effect's settings change, its revision goes up) and must arrive at the wall as today's source updates do. It must not re-prepare the effect when only a number changes, if the instrument supports a live update. Today a source change re-prepares; the builder checks the cost.
- The links and the show file stay as they are (version 6).

## Approaches considered

1. **Share Studio's own controls** (chosen). Take `Parameter` and the visibility rules out of `App.tsx` and use them in Map's Effect tab. Map then matches Studio exactly, and stays matched as Studio changes.
2. **Write Map's own simpler sliders.** Faster at first, but it drifts from Studio: ranges, groups and which settings show would differ. That is the first anti-goal.
3. **Embed Studio's whole inspector.** It carries layer lists, export and finish tabs that make no sense for one shape in Map, and it assumes Studio's project state.

## What is left to the builder

- **Taking out Studio's controls:** the exact way it is done, as long as Studio is unchanged to look at and use.
- **Fast updates:** whether a number change on a playing effect can update it without preparing it again.
- **The strip's layout** at narrow window widths (it may wrap to two rows).
- **The triggers popover's** position and size.
