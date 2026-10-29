# OpenViz

**OpenViz** is a modern, web-native creative suite and audio visualizer engine inspired by open-source audio players and visualizers. Built entirely on a pure TypeScript/Web stack, OpenViz offers real-time audio reactivity, non-destructive DSP audio effects, interactive visual element editing, and hardware-accelerated video rendering directly in the browser.

---

## Stack Architecture

- **Core Renderer:** TypeScript + Three.js (`three`) with `EffectComposer`, `OutputPass`, `AfterimagePass`, and custom GLSL post-processing effects
- **Audio DSP Pipeline:** WebAudio API (`AnalyserNode`, `BiquadFilterNode`, `StereoPannerNode`, `DelayNode`) with 64-band logarithmic FFT analysis
- **Video Exporter:** Hardware-accelerated WebCodecs (`VideoEncoder`) with `mp4-muxer` (AVC H.264)
- **Avee Template Importer:** `jszip` for parsing `.viz` templates, asset extraction, and anchor/coordinate mapping
- **Interactive Web Studio:** Vite + Glassmorphic UI with Three.js `TransformControls` (live on-canvas Gizmo)
- **Terminal CLI:** Node.js CLI (`bin/openviz.js`) using `commander` for template inspection and utilities
- **Styling & Testing:** TailwindCSS + Vitest

---

## Features & Supported Scope

### Currently Implemented Features:
- **Live Interactive Web Studio**:
  - Fullscreen WebGL viewport with interactive on-canvas handles for translation, scaling, and rotation.
  - Layer tree manager for Spectrum Bars, Images, and Text elements.
  - Property Inspector for live tweaking of transforms, colors, and audio reactivity bindings.
  - Waveform timeline scrubber and audio playback controls.
- **Audio Reactivity & DSP Engine**:
  - 64-Band Spectrum Analysis with logarithmic frequency spacing (`logSpace`), asymmetric attack/decay smoothing, and flux-based beat detection.
  - Audio reactivity bindings (`Bass`, `Mid`, `High`, `Beat`, `RMS`, `Spectrum`) targeting scale, bar height, rotation, opacity, and camera shake.
  - Real-time DSP Audio Effects: Bass Boost, Slowed + Reverb, Nightcore, 8D Audio panning.
- **2D/3D Shapes & Geometries**:
  - Radial (Circle) and Linear (Horizontal Line) Spectrum Bars.
  - SidedPolygon path sampling with rounding controls and Letter glyph sampling.
  - Fullscreen wallpaper cover fitting and proportional image badge scaling.
- **Post-Processing Pipeline**:
  - sRGB gamma color correctness via `OutputPass`.
  - Temporal Motion Blur / Motion Trails using `AfterimagePass` feedback.
  - Separable 2-Pass Gaussian Blur with 5-tap kernel weights and mix blending.
  - Chromatic Aberration (RGB Split), Unreal Bloom, Mirror, VHS, and FidelityFX CAS sharpening.
- **Client-Side WebCodecs Video Export**:
  - Offline 1080p 60fps frame rendering with hardware H.264 WebCodecs encoding and MP4 muxing.
- **Avee `.viz` Importer**:
  - Unzips and converts `.viz` archives and `scene.json` into OpenViz JSON schema with path traversal security checks.

### Future Roadmap:
- Particle compute engine and custom WebGPU compute shaders.
- Audio stem separation (vocal/drum isolation).
- 3D mesh model support (.gltf / .glb) in visualizer compositions.

---

## Attribution & Acknowledgments

Selected algorithms (such as logarithmic frequency spacing and composition element parsing) are derived from or inspired by open-source projects, including:
- [AveeOpenPlayer_1.0.34](https://github.com/Azy-Kun/AveeOpenPlayer_1.0.34) (Apache License 2.0)

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Launch Web Studio local development server
# npm run dev

# 3. Build production bundle
npm run build

# 4. Run Vitest unit tests
npm test

# 5. Run OpenViz Terminal CLI
node bin/openviz.js --help
```

---

## CLI Usage

```bash
# Inspect a .viz template archive
node bin/openviz.js info template.viz

# Convert a .viz archive to OpenViz JSON schema
node bin/openviz.js convert template.viz -o output_template.json
```

---

## License

This project is licensed under the GNU General Public License v3.0 or later (GPL-3.0-or-later). See [LICENSE](LICENSE) for details.
