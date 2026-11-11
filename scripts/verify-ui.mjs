// The current workspace and gesture suites use the real desktop app, isolated
// profiles, native persistence and actual GPU/PNG/movie output. An optional
// packaged .app path is forwarded by both modules through process.argv[2].
await import('./verify-workspace-ui.mjs');
await import('./verify-canvas-interaction.mjs');
