# Map Sound and Screen Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Map's Details gets Shape, Effect and Sound tabs for the selected shape. The Effect tab holds Studio's own settings for the shape's effect, each with ∿. The Sound tab holds that shape's reactions. One always-visible sound strip under the stage holds the input, meters, tempo, MIDI, scenes and a Show popover. ∿ appears only where it can work.

**Done when:**
- Every link in a show is reachable from a shape's Sound tab, or from Show › Reactions in other scenes.
- An Effect-tab slider moved on a playing effect changes the wall within a frame without preparing the effect again, and is one undo step.
- Studio looks and behaves as before.
- `npm run test:map` passes.

**Architecture:**
- **The effect's settings in Map:** Studio's settings for the selected layer come out of `src/ui/App.tsx` into `src/ui/LayerControls.tsx`, which both Studio and Map's Effect tab use.
- **New rules, as pure functions:**
  - which settings can react: `reactable`
  - which links a shape shows: `shapeLinks`, `offScreenLinks`, `linkInUse`
  - whether a changed composition needs preparing again: `needsPrepare`
- **The compositor** skips preparing again when only reactable numbers changed.
- **The screen:** the global Sound & MIDI tab is replaced by `MapSoundStrip`.

**Tech Stack:** Electron 45, React 19, TypeScript, node:test via tsx, Playwright scripted checks.

**Spec:** [docs/superpowers/specs/2026-11-18-map-sound-ux-design.md](../specs/2026-11-18-map-sound-ux-design.md), including its "Calls made after the builder check".

**Branch:** `map-stage-5`, in the `three VJ - main` folder. No branch switching.

**Execution:** native. One whole-work review at the end.

## Global Constraints

- **Studio:** it must look and behave exactly as before. Its loops, seeking and export are unchanged.
- **Matching Studio:** an effect setting in Map has the same range, step, grouping and visibility as in Studio.
- **The wall:** no Effect-tab edit blacks it out. A number change on a playing effect never prepares it again. A choice change (Style, Variant) or a preparation setting does, with the usual crossfade.
- **The engine and the show file stay as they are** (version 6). Only where things are shown changes, plus link copying on Make separate.
- **Limits:** 64 links per show. Copies past it are left out with a note.
- **Copy, from the spec:**
  - "Choose an effect first"
  - "Choose a sound input in the strip below"
  - "Changing this restarts the effect, so it can't follow sound"
  - "Not in use: this setting is hidden for this pattern"
  - "animated in Studio"
- **Words on screen:** no technical mapping jargon.

## Review Focus

1. **Dragging an Effect slider with the output open.** The wall follows the drag, and the whole drag is one undo step, not one per frame. → Task 3 check, in Task 5.
2. **A shared effect edited with "Change all" off.** Only this shape changes, it keeps its reactions, and the other shapes keep theirs. → Task 2 test.
3. **Switching Style on an effect whose settings have links.** Links on settings that are now hidden are marked "Not in use", and none is lost. → Task 2 test `linkInUse`.
4. **A shape whose effect has 2 or more layers.** The layer chips appear, the settings and labels follow the chosen layer, and ∿ targets that layer. → Task 3 check.
5. **The strip at a narrow window (1280 wide).** It wraps rather than hiding the input or the meters. → Task 4 check.

---

### Task 1: Studio's effect settings as a shared component

**Files:**
- Create: `src/ui/LayerControls.tsx`
- Modify: `src/ui/App.tsx`: the Shape tab content of the layer inspector (around lines 644–661), the `Parameter` and `ChoiceParameter` components, and the key lists (`gradingKeys`, `graphicChoiceKeys`, `choiceKeys`, `oilFineControls`, `secondaryShapeControls`, the pattern and variant name tables) move to the new file. App imports them.

**Interfaces:**
- Produces:
  - `export function Parameter(props: { definition: ParameterDefinition; value: number; animated: boolean; onChange: (n: number) => void; onAnimate?: () => void; onStart: () => void; onEnd: () => void; extra?: ReactNode })`. `extra` is rendered beside the label, and is Map's ∿ slot.
  - `export function LayerShapeControls(props: { layer: Layer; edit: (change: (l: Layer) => Layer) => void; onAnimate?: (key: string) => void; onStart: () => void; onEnd: () => void; paramExtra?: (d: ParameterDefinition) => ReactNode; readOnly?: (d: ParameterDefinition) => boolean })`. It contains:
    - Studio's choice selectors, then the setting groups in Studio's order and folding, then the finish and grading settings, then Opacity
    - not the Print screen section, `SurfaceEditor` or the Motion and Finish tabs

- [ ] **Step 1: Record Studio's baseline:** `npm run test:ui 2>&1 | tail -15`. Expected: it fails at "Project saved.", the known baseline. Note the passing checks before it.
- [ ] **Step 2: Move the code out unchanged**, so App renders `LayerShapeControls` in its Shape tab with the same props behaviour.
- [ ] **Step 3: Verify.** Run `npx tsc --noEmit -p . && npx tsx --test tests/*.test.ts && npm run test:ui 2>&1 | tail -15`. Expected: types and tests pass, and `test:ui` matches Step 1's output line for line.
- [ ] **Step 4: Commit** `Map sound pass, task 1: Studio's effect settings in a shared component`

### Task 2: The rules: what can react, which links a shape shows, when an effect is prepared again

**Files:**
- Modify:
  - `src/map/targets.ts`: `reactable`, `shapeLinks`, `offScreenLinks`, `linkInUse`
  - `src/map/playout.ts`: `needsPrepare`
  - `src/map/editor.ts`: `makeSeparate` copies links, and a new `setSourceLayer` action
- Test: `tests/map-sound-ux.test.ts`

**Interfaces:**
- Produces:
  - `reactable(d: ParameterDefinition): { ok: true } | { ok: false; why: 'restarts' }`, false for `d.preparation`, `d.key === 'seed'`, or `d.step >= 1`
  - `shapeLinks(show: ShowDocument, shapeId: string): Link[]`: targets `shape.<id>.*`, or `source.<its sourceId>.*`, or (when it plays `LIVE_SOURCE_ID`) none, since Live's links live in Live's settings
  - `offScreenLinks(show: ShowDocument): Link[]`: links whose source no shape on screen plays
  - `linkInUse(show: ShowDocument, link: Link): boolean`: false when the target is a param that `visibleParameterDefinitions(layer)` no longer lists
  - `needsPrepare(before: Project, after: Project): boolean`: false only when the layer count, ids and kinds match, and every changed value is a number param that is `reactable` and visible
  - **Edit action** `{ type: 'setSourceLayer'; sourceId: string; layer: number; params: Record<string, number> }`: merges `params` into that layer (clamped to each definition's range) and bumps the revision
  - **`makeSeparate`** gains `linkIds: string[]`, one per copied link

- [ ] **Step 1: Write the failing tests** in `tests/map-sound-ux.test.ts`:
  - `only numbers that can follow sound are reactable`: a preparation def, `seed`, and a `step: 1` def give `{ ok: false, why: 'restarts' }`; a 0..1 step .01 def gives ok
  - `a shape shows its own links and its effect's, not other shapes'`
  - `links on an effect only a scene off screen plays are listed as off screen`
  - `a link on a setting hidden after a Style change is not in use, and is kept`
  - `changing a reactable number needs no preparing; a preparation setting, a choice or a new layer does`
  - `setSourceLayer clamps to the definition and bumps the revision; one drag merged under one key is one undo step`: use `mapReducer` with `merge: 'param-sa-drift'` 20 times, then `past.length` grows by 1
  - `Make separate copies the effect's links to the new copy; past 64 links, the rest are left and counted`: the result's `refusal` is null, and the new links target `source.<new>.…`

- [ ] **Step 2: Run them to verify they fail.** Run: `npx tsx --test tests/map-sound-ux.test.ts`. Expected: FAIL (no exports).
- [ ] **Step 3: Implement the four target functions, `needsPrepare`, `setSourceLayer` and link copying.** The compositor's `prepare` call (compositor.ts:274) runs only when `needsPrepare(slot.project, project)`; otherwise it adopts `slot.project = project` in place.
- [ ] **Step 4: Run all the tests.** Run: `npx tsc --noEmit -p . && npx tsx --test tests/*.test.ts`. Expected: all pass.
- [ ] **Step 5: Commit** `Map sound pass, task 2: what can react, a shape's links, effects adjusted without preparing again`

### Task 3: Details: the Shape, Effect and Sound tabs

**Files:**
- Create:
  - `src/ui/MapEffectTab.tsx`
  - `src/ui/MapSoundTab.tsx`
- Modify:
  - `src/ui/MapDetails.tsx`: the tabs; the instrument card moves into the Effect tab; the Reacts section moves into the Sound tab
  - `src/ui/MapShapeList.tsx`: ∿n beside a shape that reacts
  - `src/ui/ReactControls.tsx`: `LinkRow` gains a compact one-line summary, and opens to today's controls

**Interfaces:**
- Consumes: `LayerShapeControls` and `Parameter` (Task 1); `reactable`, `shapeLinks`, `linkInUse` and `setSourceLayer` (Task 2)
- Produces:
  - `MapEffectTab({ map, shape, locked, linked, setLinked, onOpenLooks, onEditInStudio })`:
    - layer chips when there are 2 or more layers
    - `LayerShapeControls`, with:
      - `paramExtra` set to a ∿ (greyed with the restarts note when `reactable` is not ok)
      - `readOnly` for animated settings (the "animated in Studio" mark)
      - edits dispatched as `setSourceLayer` with merge key `param-<sourceId>-<layer>-<key>`, or for choices and preparation settings, `setSourceProject`
    - with "Change all" off on a shared effect: Make separate first, then the edit
    - Live shapes show `MapLiveCard`; a shape with no effect shows "Choose an effect first" with Change…
  - `MapSoundTab({ map, shape })`: the ready-made reactions, then `shapeLinks` rows. Each row is marked:
    - "Not in use…" when `!linkInUse`
    - "Choose a sound input in the strip below" when its input is a sound signal and no input is chosen

- [ ] **Step 1: Write the failing test** `the shape list marks a reacting shape with ∿ and its count`: a pure `reactsLabel(show, shapeId): string`, `''` or `'∿2'`, in `src/map/targets.ts`.
- [ ] **Step 2: Run it to verify it fails.**
- [ ] **Step 3: Build the tabs, then remove the Sound & MIDI tab from MapPanel.** The Reacts section and the instrument card leave the Shape tab.
- [ ] **Step 4: Run** `npx tsc --noEmit -p . && npx tsx --test tests/*.test.ts`. Expected: all pass.
- [ ] **Step 5: Commit** `Map sound pass, task 3: Shape, Effect and Sound tabs`

### Task 4: The sound strip, the tool row and the stage's space

**Files:**
- Create: `src/ui/MapSoundStrip.tsx`
- Modify:
  - `src/ui/MapPanel.tsx`: the strip replaces `.map-stage-bar` and the scenes bar; Snap and Room photo (with Shown, Opacity, Remove) move into `.map-tools`
  - `src/ui/ReactControls.tsx`: `ReactDevices` gains `layout: 'column' | 'strip'`
  - `src/ui/MapReactivity.tsx`: becomes the Show popover's content (triggers, then "Reactions in other scenes" from `offScreenLinks`)
  - `src/ui/map.css`

**Interfaces:**
- Consumes: `offScreenLinks` (Task 2), `MapScenes` (unchanged), `ReactDevices`
- Produces: `MapSoundStrip({ map })`, with a `Show` button (`aria-label="Show-wide sound and triggers"`) opening a popover that closes on Escape or a click outside. The meters run while the strip is visible and the engine exists.

- [ ] **Step 1: Build the strip, move Snap and Room photo, remove the old bars.** The stage area grows to fill the freed height.
- [ ] **Step 2: Verify the layout by a screenshot** at 1600×950 and 1280×800 with `work/ux-shots.mjs` (updated to the new screen). Expected: the input, meters and scenes are visible at both sizes, and the strip wraps at 1280.
- [ ] **Step 3: Run** `npx tsc --noEmit -p . && npx tsx --test tests/*.test.ts`.
- [ ] **Step 4: Commit** `Map sound pass, task 4: one sound strip, tools above the stage, more room for the stage`

### Task 5: Checks, notes, review

**Files:**
- Modify:
  - `scripts/verify-map.mjs`: the trigger check and the reaction checks move to the Sound tab and the Show popover; new checks below
  - `scripts/long-run-map.mjs`: same moves
  - `docs/projection-mapping-design-2026-11-16.md`: a results section

- [ ] **Step 1: Add the checks:**
  - `an Effect-tab slider moved with the output open changes the wall without preparing the effect again, as one undo step`: `__mapStats.prepares` is unchanged, and one Undo puts it back
  - `∿ on an Effect setting with the test beat moves the wall`
  - `a preparation setting's ∿ is greyed with the restarts note`
  - `a Style change marks a link on a now-hidden setting Not in use`
  - `Show lists triggers and reactions in other scenes`
  - `a two-layer effect shows layer chips` (the layer chips appear with 2 or more layers)
  - `the strip keeps the input and meters visible at 1280 wide`
- [ ] **Step 2: Run** `npm run test:map` and `npm run test:ui 2>&1 | tail -15`. Expected: `MAP CHECK PASSED`; `test:ui` the same as Task 1 Step 1.
- [ ] **Step 3: Results and known limits in the design notes;** whole-work review and its fixes.
- [ ] **Step 4: Commit, then relaunch the app:**
  ```bash
  open -n -a "/Users/grego/Documents/ChatGPT/three VJ - main/node_modules/electron/dist/Electron.app" --args "/Users/grego/Documents/ChatGPT/three VJ - main"
  ```
