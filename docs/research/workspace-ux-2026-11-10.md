# Workspace UI audit — 10 November 2026

## Findings

The previous layout reserved two wide sidebars plus separate header, viewer, hint, variation and transport rows. At a 1180 × 728 content viewport, the actual 16:9 artwork occupied only 19.4% of the window. Instruments appeared as large browsing cards even during editing. Each numeric control occupied roughly two lines plus a large bottom margin, with reset and animation buttons competing with its label. Library, layer, preview and inspector titles repeated context already visible elsewhere.

## Research and application

[Nielsen Norman Group: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/) recommends prioritizing frequent tasks while making secondary controls easy to find. Applied here: keep direct canvas interaction, playback, layer selection, current shape controls and Vary immediately available. Put discovery, variation settings and secondary geometry in clearly named drawers/disclosures. Inspector tabs and numeric editing remain familiar.

[Ableton: First Steps](https://www.ableton.com/en/manual/first-steps/) documents optional views and contextual help. [Ableton: Working with the Browser](https://www.ableton.com/en/live-manual/12/working-with-the-browser/) describes browsing and optional filter visibility. Applied here: make the Library available on demand, keep searching close to browsing, and make panels reversible without changing the composition. A slim layer rail preserves selection while the full layer list is collapsed. Focus mode temporarily hides surrounding panels and restores the user's prior layout on exit.

[MDN: Popover](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/popover) documents native top-layer, outside-click and Escape behavior. Library and variation settings use native popovers. Search inputs can consume Escape themselves, so the workspace explicitly dismisses its popovers and restores focus before interpreting Escape as an exit from focus mode.

These references guide the design; the particular widths, defaults and control groupings are implementation choices tested against this application.

## Implementation

- 52px application header, 40px viewer toolbar, 50px playback/variation dock and 22px status footer.
- Default 48px layer rail with persistent layer selection; an expanded layer list is optional.
- Searchable instrument/preset drawer with compact rendered thumbnails and the existing family filters.
- 34px numeric control rows with label, slider, precise value, reset and animation actions.
- Primary shape controls open by default. Secondary shape settings and other base control groups use native disclosure sections.
- Variation amount and Keep locks live beside Vary in a named settings popover.
- Canvas hints appear on hover/focus. Pan/zoom feedback and framing reset remain available.
- B toggles Library, L the layer list, I the inspector, and F focus mode. Escape dismisses popovers first, then focus mode. Shortcuts leave editable fields and export dialogs alone.
- Panel preferences persist locally, independently of saved projects and undo history. Focus mode is temporary and starts off after relaunch.
- Native minimum window size is reduced to 960 × 640. Narrow-browser layouts use an inspector drawer and retain the canvas rather than stacking every panel below it.

## Measured canvas area

Measurements use the same app, default composition, display and content viewport. Canvas area excludes letterboxing and all controls. The operating system constrained the largest test window's height.

| Content viewport | Before | After | Area increase |
| --- | ---: | ---: | ---: |
| 1180 × 728 | 166,464 px² | 391,250 px² | 2.35× |
| 1440 × 863 | 371,284 px² | 658,532 px² | 1.77× |
| 1920 × 863 | 371,284 px² | 839,052 px² | 2.26× |

Reports and screenshots are under `work/workspace-ui/`. Verification covers layout/overflow, instrument and preset search, rail selection, disclosure, precise editing and undo, variation locks, shortcut conflicts, popover dismissal/focus, animation key editing, Finish controls, persisted layout, minimum window size, all sixteen instrument inspectors and export-dialog focus. The canvas regression separately verifies gestures, Retina density, native save/open and actual PNG/movie export.
