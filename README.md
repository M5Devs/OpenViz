# OpenViz Core

**OpenViz Core** is a high-performance, modular audio visualizer and multimedia processing engine written in pure Rust. It combines low-latency audio feature extraction, non-destructive DSP audio effects, wgpu hardware-accelerated rendering, an Avee Player `.viz` template importer, and a full-featured Web Studio.

---

## Features

- **Pure Rust DSP Audio Engine**:
  - Real-time FFT spectral analysis, multi-band RMS partitioning (Bass, Mid, High), Onset/Beat detection, and Automatic Gain Control (AGC).
  - Non-destructive audio effects: Slowed + Reverb, Nightcore/Sped-Up, Low-shelf biquad Bass Boost, Stereo Freeverb, Cross-feedback Delay, and 8D Equal-Power Auto-Panning.
- **wgpu / WGSL Rendering Engine**:
  - Hardware-accelerated offscreen rendering with 2D quad batching and dynamic transform hierarchies.
  - Support for `NodeType::Group` recursion, standard horizontal spectrum bars, and true radial bar layouts.
  - Dynamic clear colors, linear gradient fills, and customizable post-processing effects.
- **Avee Template Importer**:
  - Native deserialization and conversion of Avee Player `.viz` template archives into OpenViz scene graphs.
  - Resilient JSON property parsing handling raw scalar primitives and flexible property representations.
- **Web Studio & API Server**:
  - Axum-powered REST API and embedded interactive Web Studio interface.
  - Secure upload handling with file type validation, UUID filename sanitization, and path traversal defense.
  - Offline video export engine leveraging FFmpeg for crisp 1080p/4K video generation.

---

## Prerequisites

- **Rust Toolchain**: Rust 1.75+ (`cargo`, `rustc`).
- **FFmpeg**: Required for offline video export (`ffmpeg` binary must be on system `PATH`).
- **System Libraries (Linux)**:
  - `libasound2-dev` (ALSA development files)
  - `pkg-config`

```bash
# Ubuntu / Debian
sudo apt-get update && sudo apt-get install -y libasound2-dev pkg-config ffmpeg
```

---

## CLI Usage

```bash
# Build the binary
cargo build --release

# Show help
./target/release/openviz --help
```

### Subcommands

1. **Export Video** (`export`):
   Render an audio track into an MP4 visualizer video using a template.
   ```bash
   openviz export --audio track.mp3 --template template.json --output output.mp4 --width 1920 --height 1080 --fps 60
   ```
   *Audio Presets*:
   - `--slowed`: Apply Slowed + Reverb effect.
   - `--nightcore`: Apply Nightcore / Sped-Up effect.
   - `--bass-boost <DB>`: Apply low-shelf bass boost in dB.
   - `--eight-d`: Enable 8D auto-panning.

2. **Generate Template** (`generate-template`):
   Create a default spectrum visualizer template JSON file.
   ```bash
   openviz generate-template --output template.json
   ```

3. **Template & Audio Info** (`info`):
   Inspect template structure and audio track metadata.
   ```bash
   openviz info --template template.json --audio track.mp3
   ```

4. **Launch Web Studio Server** (`serve`):
   Start the interactive Web Studio local server.
   ```bash
   openviz serve --host 127.0.0.1 --port 3000
   ```

---

## Web Studio

Start the server using `openviz serve` and navigate to `http://127.0.0.1:3000` in your web browser to access Web Studio.

Features:
- Live visualizer preview.
- Import `.viz` templates directly.
- Tweak audio DSP effects in real time.
- Export full videos directly from the browser interface.

---

## License

This project is licensed under the GPL-3.0-or-later license. See [LICENSE](LICENSE) for details.
