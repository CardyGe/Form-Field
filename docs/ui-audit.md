# UI audit — 7 November 2026

Reviewed the instrument library, presets, layers, preview, timeline, Shape/Motion/Finish inspectors, imports, notifications and export workflow against the [linked UI rules](https://www.reddit.com/r/ClaudeDesign/comments/1xovgex/7_ui_dos_and_donts_cheat_sheets_i_use_to_keep/).

| Finding | Change |
| --- | --- |
| Decorative microcopy competed with the artwork. | Removed slogans, numbered toolkit labels, preview captions, promotional export headings and redundant preset descriptions. Replaced long motion-source names with direct labels. |
| Labels and controls used very small, faint text. | Established readable type sizes and increased text contrast. Headings and selected controls have a clear visual hierarchy. |
| Green tinted almost every surface and control. | Used neutral panels, sliders, tabs and selection states. The export action retains the accent; errors retain explicit messages. |
| Spacing varied between panels. | Standardized gaps and padding on a 4/8/16/24/32px scale, with more space between control groups. |
| The fixed minimum width clipped small windows. | Added stacked layouts, larger touch controls and a bottom export sheet. Fixed toolbar overflow at 320px. |
| Layer selection and keyframe editing depended on a pointer. | Added accessible layer buttons, pressed states, keyboard keyframe editing and larger keyframe hit areas. |
| Export did not contain keyboard focus. | Used a native modal dialog with focus containment, Escape dismissal and focus restoration. Background editing shortcuts are suspended while it is open. |
| Errors could be hidden behind the export dialog. | Placed notifications inside the active dialog. Disabled unavailable export actions and explained why. |
| Closing a render could leave stale status. | Stopped exports now report that completed frames remain available. |
| Development startup could show a false disposed-renderer error. | Ignored rejected preview preparation after its effect was cleaned up. |

Validation artifacts are in `work/ui-audit/`. The layout audit checked widths of 320, 390, 768, 900, 1024, 1180 and 1600px, visible text contrast, mobile target sizes, the three inspector tabs across instruments, presets, keyboard focus and browser export availability. All 19 checks passed. No renderer page errors were recorded.

The production build and all 51 core/native unit tests passed. All 21 native UI checks passed, covering real GPU changes, project persistence, imported assets, native export, cancellation/resume and recovery. The harness now freezes its application files so concurrent builds cannot remove assets during recovery tests. Its results and screenshots are retained in `work/ui-smoke/`. The final production build is in `work/ui-audit/final-build/`.

Dashboard-specific rules are not applicable: this interface has no analytics charts or data tables.
