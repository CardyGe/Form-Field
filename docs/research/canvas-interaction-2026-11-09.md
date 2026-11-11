# Canvas interaction — 9 November 2026

## Decisions

Direct manipulation edits the selected layer's ordinary saved parameters and transforms. Reuse the existing source-view transform and compositor so preview and exports share coordinates. No temporary shader uniforms or preview-only CSS scaling are needed.

Click uses the existing coherent randomizer and current Keep settings. A four-CSS-pixel movement threshold distinguishes a click from a drag. Drag maps relative motion to two visible, continuous instrument parameters; this preserves the starting look without a jump. Julia uses its real and imaginary constants. Living Ink uses flow and warp, avoiding chemical preparation during dragging. Motion routes and locked categories are excluded.

Ctrl-drag translates in composition coordinates; Ctrl-wheel changes scale exponentially. Normalize wheel line/page units and cap each event's contribution. With cursor position p, translation t and scale ratio r, the new translation is `p - (p - t) * r`. This keeps the sampled source point under the cursor for any rotation and aspect ratio, until saved position limits constrain it. Navigation uses the schema's existing limits: position −2…2 and scale 0.05…8. The Finish sliders expose the same range.

Pointer capture retains a gesture outside the canvas. Pointer cancellation, lost capture, window blur, shortcuts, selection changes and export dialogs end a gesture. The initial modifier chooses the mode for the entire gesture, preventing an accidental variation when Ctrl is released first. On macOS, Ctrl-secondary pointer events are accepted for navigation and the contextual menu is suppressed only for Ctrl gestures on the canvas.

Apply pointer movement at most once per animation frame, flushing the final position on release. Shift scales incremental movement to 20%, including when pressed mid-gesture. A drag records its first actual change in history; wheel events within 250 ms share one history entry. New pointer actions and history shortcuts close that group. No-op clicks and clamped navigation do not record history.

## API references

- [MDN: setPointerCapture](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture) — retarget pointer events through release, even beyond the element.
- [MDN: wheel event](https://developer.mozilla.org/en-US/docs/Web/API/Element/wheel_event) — wheel unit modes, Ctrl zoom events and a non-passive listener for cancelling browser zoom. Bind only to the canvas so ordinary page scrolling remains available.
- [MDN: requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame) — schedule visual work with browser frames.

## Validation

Core tests check cursor invariance with the actual source-view matrix across rotations, aspect ratios, zoom limits, unit normalization, axis availability, authored route protection and validity of drag edits across every preset. Desktop automation uses the built Electron application, native autosave and the real GPU renderer. It covers click/drag, undo/redo, Ctrl pan and zoom, normal scrolling, fine control, keyboard input, capture outside the canvas, cancellation, blur, locks, hidden layers, animated routes, every procedural instrument, multi-layer targeting and narrower windows. Reports and screenshots are saved under `work/canvas-interaction/`.

## Zoom detail correction

Repeating graphic families previously rasterized one cell at the output resolution and magnified that texture in the compositor. Outlines which were subpixel in the original cell could disappear before zooming; enlarging the texture could not recover their detail. Preview buffers also used CSS pixels on high-density displays.

Magnified grids now draw visible repeated geometry into the current view. Compute repeat-cell bounds by inverting pattern and layer transforms, preserve the prepared layout, and cull offscreen glyphs. Clip grid quads to their cell in pattern coordinates before projection, retaining their original signed-distance coordinates. Fragment-only clipping loses multisample coverage at cell boundaries; clipping quads keeps neighboring cells connected. A conservative 0.02-pixel expansion closes float32 cracks in contiguous solid fills. The radial circuit cutout and masks retain their existing layer coordinates. Minified fields keep mipmapped cells; extreme-aspect projects use bounded, magnification-aware source resolution when the geometry would require more than 64 cells.

Preview layout stays in CSS pixels while GPU buffers use device density, capped at a 3840-pixel longest edge and 8,294,400 pixels. Moving a window between displays invalidates the preview density. No project migration or quality-setting changes are required.

The GPU regression compares six graphic looks at 2×, 4× and 8× against matching crops from larger native renders, including rotated and translated views, outlines, hollow paths and the single radial cutout. An optional older packaged bundle supplies a baseline renderer from its source map. Rotated solid tiles must remain fully opaque. The desktop interaction check also verifies the physical backing-buffer density.
