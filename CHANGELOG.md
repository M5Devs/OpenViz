# Changelog

All notable changes to OpenViz will be documented in this file.

## [2.0.0] - 2.0.0 Release (Phase 4 + Phase 5)

### Security & Input Validation (Phase 4)
- **DOM Helper:** Added `el()` helper in `src/ui/dom.ts` for safe DOM element construction without `innerHTML` string interpolation.
- **Schema Validation:** Added hand-written `validateTemplate()` and `parseTemplateJSON()` in `src/schema/validate.ts` enforcing strict rules for node counts (<= 500), unique IDs, transform bounds (|pos| <= 50000, |scale| <= 100), finite numbers, opacity, bars data, and strict URL allow-list (`blob:` and `data:image/(png|jpeg|jpg|webp|gif);base64,`).
- **Asset URL Registry:** Created `ObjectUrlRegistry` in `src/assets/registry.ts` for managing and revoking blob URLs.
- **Importer Limits & Hardening:** Hardened `importAveeViz` in `src/importer/avee.ts` with entry count/byte limits, segment-level path traversal sanitization, and two-pass extraction (only inflating referenced image assets).
- **CLI Security:** Updated CLI `convert` command to output base64 data URLs, skip assets > 5 MB with a console warning, eliminate `blob:` URLs in output, and validate generated JSON.
- **UI Error Line:** Added `#statusLine` in `index.html` to display validation and import messages directly in the UI instead of using `alert()`.

### Honest UI, Audio Engine & Importer Fixes (Phase 5)
- **Unit Scale Normalization:** Documented `transform.scale` as a multiplier in `src/types/index.ts` and updated `VisualizerScene` in `src/render/scene.ts` to use a unit `PlaneGeometry(1,1)` scaled by natural image dimensions.
- **Wallpaper Detection & Falsy-Zero Bug:** Restricted wallpaper detection to explicit name regex `/(^|[\s_\-.])(background|wallpaper|bg)($|[\s_\-.])/i` and added `pick(...)` helper to safely preserve numeric 0 (alpha 0, rotation 0).
- **Text Auto-Sizing & RTL:** Sized text canvas using `ctx.measureText`, implemented `detectTextDirection()` for Hebrew/Arabic ranges, and applied `"Noto Sans Arabic","Segoe UI",Tahoma,Arial,sans-serif` fallback font stack.
- **UI Inspector Enhancements:** Wired Add Image and Add Text buttons, integrated `ObjectUrlRegistry` in studio, and expanded Inspector controls for rotation (degrees), opacity slider, text data, and bars color pickers.
- **AudioEngine Overhaul:** Replaced rAF loop with `OscillatorNode` (0.125 Hz) -> `GainNode` for 8D panning, replaced delay with `ConvolverNode` using a 2.5s deterministic mulberry32 impulse response for reverb, consolidated AudioContext ownership with `decodeFile()` caching, and added object URL revocation.
- **Documentation:** Rewrote `README.md` with pledge, architecture, browser support, and known limitations.

---

## [1.3.0] - Phase 3b: Real Device Video Export Optimization (#18)
- Added `createOutputTarget` supporting `FileSystemWritableFileStreamTarget` (disk mode via `showSaveFilePicker`) and `ArrayBufferTarget` (memory mode with 1.5 GB / 400 MB memory guard thresholds).
- Added `acquireWakeLock` in `src/export/wakelock.ts` to maintain screen wake lock during video export.
- Added recommended export settings, bitrate estimation, size estimation, and non-throttled event loop yielding using `MessageChannel` in `src/export/defaults.ts`.

---

## [1.2.0] - Phase 3: Client-Side WebCodecs Video Export
- Added WebCodecs `VideoEncoder` and `AudioEncoder` video export in `src/export/webcodecs.ts` with `mp4-muxer`.
- Implemented AVC H.264 level selection (`pickAvcLevel`), backpressure queue management, AbortSignal cancellation, and canvas scene state restoration via `beginExport`/`endExport`.

---

## [1.1.0] - Phase 2: Visualizer Scene & Audio Reactivity
- Added Three.js `VisualizerScene` rendering engine supporting `Bars`, `Image`, and `Text` nodes.
- Integrated `TransformControls` gizmo for interactive translation, scaling, and rotation.
- Added audio binding evaluation in `src/render/bindings.ts` mapping audio bands to visual parameters.

---

## [1.0.0] - Phase 0 & Phase 1: Engine Foundation
- Initialized WebGL viewport, Three.js renderer, and Vite dev server.
- Built `SpectrumAnalyzer` with Radix-2 FFT and WebAudio API live audio engine.

---

## Known Limitations / Unfinished Items
- `postEffects` are schema-supported and imported but not yet rendered in the WebGL scene pass.
- No visual binding editor in the UI (bindings are read from template JSON).
- Real-time WebAudio DSP effects apply during live playback; exported MP4 contains the clean source audio stream.
