# OpenViz

**OpenViz** is a modern, web-native creative suite and audio visualizer inspired by Vizzy.io. Built entirely on a pure TypeScript/Web stack, OpenViz offers real-time audio reactivity, non-destructive DSP audio effects, interactive visual element editing, and hardware-accelerated video rendering directly in the browser.

---

## Stack Architecture

- **Core Renderer:** TypeScript + Three.js (`three`)
- **Audio DSP Pipeline:** WebAudio API (`AnalyserNode`, `BiquadFilterNode`, `StereoPannerNode`, `DelayNode`)
- **Video Exporter:** Hardware-accelerated WebCodecs (`VideoEncoder`) with `mp4-muxer` (AVC H.264)
- **Avee Template Importer:** `jszip` for parsing legacy `.viz` templates and local assets
- **Interactive Web Studio:** Vite + Glassmorphic UI with Three.js `TransformControls` (live on-canvas Gizmo)
- **Terminal CLI:** Node.js CLI (`bin/openviz.js`) using `commander` for template inspection and utilities
- **Styling & Testing:** TailwindCSS + Vitest

---

## Features

- **Live Glassmorphic Web Studio**:
  - Fullscreen WebGL viewport with interactive on-canvas handles for translation, scaling, and rotation.
  - Layer tree manager for adding Spectrum Bars, Images, and Text.
  - Property Inspector for live tweaking of transforms, colors, and audio reactivity bindings.
  - Waveform timeline scrubber and audio playback controls.
- **Real-Time WebAudio DSP Effects**:
  - **Bass Boost:** Low-shelf biquad filter at 120Hz (+0dB to +18dB).
  - **Slowed + Reverb:** Pitch-altered playback (0.85x) with cross-feedback delay network.
  - **Nightcore:** Sped-up playback rate (1.25x).
  - **8D Audio:** Smooth continuous LFO stereo panning.
  - **64-Band Spectrum Analysis:** Normalized FFT partitioning for Bass, Mid, High, Beat, and RMS reactivity.
- **Client-Side WebCodecs Video Export**:
  - Frame-by-frame offline rendering at 1080p 60fps with H.264 hardware acceleration.
  - Fast in-memory MP4 muxing via `mp4-muxer` for instant MP4 video downloads.
- **Avee `.viz` Importer**:
  - Unzips and converts `.viz` archives and `scene.json` into clean OpenViz JSON schema.
  - Extracts local asset image buffers into textures.
  - Maps audio reactivity measures (`Beat`, `Bass`, `Mid`, `High`, `RMS`) to scale, rotation, height, and opacity bindings.
  - Built-in path traversal security protection for ZIP entries.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Launch Web Studio local development server
npm run dev

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

# Launch local Vite studio server via CLI
node bin/openviz.js dev
```

---

## License

This project is licensed under the GNU General Public License v3.0 or later (GPL-3.0-or-later). See [LICENSE](LICENSE) for details.
