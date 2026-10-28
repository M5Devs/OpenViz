import { computeExportSize } from '../export/avc';
import { parseAspect } from '../render/scene';
import { createOutputTarget, getMemoryGuardThresholdBytes, OutputTarget } from '../export/target';
import { acquireWakeLock } from '../export/wakelock';
import { recommendExportSettings, estimateExportSizeBytes } from '../export/defaults';
import { importAveeViz } from '../importer/avee';
import { AudioEngine } from '../audio/engine';
import { exportVideo } from '../export/webcodecs';
import { VisualizerScene } from '../render/scene';
import { OpenVizNode, OpenVizTemplate } from '../types';

export class StudioController {
  private container: HTMLElement;
  private scene: VisualizerScene;
  private audioEngine: AudioEngine;
  private template: OpenVizTemplate;
  private selectedNodeId: string | null = null;
  private animationFrameId: number | null = null;
  private audioBuffer: AudioBuffer | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.container = canvas.parentElement || canvas;

    this.template = this.getDefaultTemplate();

    this.scene = new VisualizerScene(this.container);
    this.audioEngine = new AudioEngine();

    this.scene.setOnSelectCallback((nodeId) => {
      this.selectedNodeId = nodeId;
      this.renderLayersList();
      this.renderInspector();
    });

    this.setupUIEvents();
    this.setupResizeObserver(canvas);

    this.scene.loadTemplate(this.template);
    this.startRenderLoop();
  }

  private getDefaultTemplate(): OpenVizTemplate {
    return {
      schemaVersion: '1.0',
      name: 'Default Cyberpunk Template',
      author: 'OpenViz',
      canvasAspect: '16:9',
      clearColor: [0.05, 0.05, 0.08, 1],
      postEffects: [],
      nodes: [
        {
          id: 'bg_1',
          name: 'Background Art',
          type: 'Image',
          transform: { position: [0, 0], scale: [1, 1], rotation: 0, opacity: 1 },
          bindings: [{ source: 'Bass', target: 'ScaleUniform', outputRange: [1.0, 1.05] }],
          imageData: {
            assetId: 'default_bg',
            url: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=1000&auto=format&fit=crop',
          },
        },
        {
          id: 'bars_1',
          name: 'Radial Spectrum',
          type: 'Bars',
          transform: { position: [0, 0], scale: [1, 1], rotation: 0, opacity: 1 },
          bindings: [{ source: 'Bass', target: 'ScaleUniform', outputRange: [1.0, 1.15] }],
          barsData: {
            count: 64,
            innerRadius: 240,
            width: 4,
            isRadial: true,
            colorStart: [0, 0.94, 1, 1],
            colorEnd: [1, 0, 0.63, 1],
          },
        },
        {
          id: 'text_1',
          name: 'Track Title',
          type: 'Text',
          transform: { position: [0, -380], scale: [1, 1], rotation: 0, opacity: 1 },
          bindings: [{ source: 'Beat', target: 'ScaleUniform', outputRange: [1.0, 1.08] }],
          textData: {
            text: 'CYBERPUNK VISUALS - OPENVIZ 2.0',
            size: 28,
          },
        },
      ],
    };
  }

  private setupUIEvents() {
    // Template Import / File Drop
    const templateInput = document.getElementById('templateInput') as HTMLInputElement;
    if (templateInput) {
      templateInput.addEventListener('change', async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        const buffer = await file.arrayBuffer();
        if (file.name.endsWith('.viz')) {
          this.template = await importAveeViz(buffer);
        } else {
          const text = new TextDecoder().decode(buffer);
          this.template = JSON.parse(text);
        }
        this.scene.loadTemplate(this.template);
        this.renderLayersList();
        this.renderInspector();
      });
    }

    // Audio Input
    const audioInput = document.getElementById('audioInput') as HTMLInputElement;
    if (audioInput) {
      audioInput.addEventListener('change', async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        await this.audioEngine.loadAudio(file);

        // Decode audio buffer for offline export
        const arrayBuffer = await file.arrayBuffer();
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const tempCtx = new AudioCtx();
          this.audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
          tempCtx.close();
        }
      });
    }

    // Play/Pause
    const playPauseBtn = document.getElementById('playPauseBtn');
    if (playPauseBtn) {
      playPauseBtn.addEventListener('click', () => {
        if (this.audioEngine.isPaused()) {
          this.audioEngine.play();
        } else {
          this.audioEngine.pause();
        }
      });
    }

    // Timeline Scrubber
    const scrubber = document.getElementById('timelineScrubber') as HTMLInputElement;
    if (scrubber) {
      scrubber.addEventListener('input', () => {
        const duration = this.audioEngine.getDuration();
        if (duration > 0) {
          const targetTime = (parseFloat(scrubber.value) / 100) * duration;
          this.audioEngine.seek(targetTime);
        }
      });
    }

    // DSP Controls
    const bassBoostSlider = document.getElementById('bassBoostSlider') as HTMLInputElement;
    const bassBoostVal = document.getElementById('bassBoostVal');
    if (bassBoostSlider) {
      bassBoostSlider.addEventListener('input', () => {
        const db = parseFloat(bassBoostSlider.value);
        this.audioEngine.setBassBoost(db);
        if (bassBoostVal) bassBoostVal.textContent = `${db} dB`;
      });
    }

    const slowedToggle = document.getElementById('slowedToggle') as HTMLInputElement;
    if (slowedToggle) {
      slowedToggle.addEventListener('change', () => {
        this.audioEngine.setSlowedReverb(slowedToggle.checked);
        if (slowedToggle.checked) {
          const nightcoreToggle = document.getElementById('nightcoreToggle') as HTMLInputElement;
          if (nightcoreToggle) nightcoreToggle.checked = false;
        }
      });
    }

    const nightcoreToggle = document.getElementById('nightcoreToggle') as HTMLInputElement;
    if (nightcoreToggle) {
      nightcoreToggle.addEventListener('change', () => {
        this.audioEngine.setNightcore(nightcoreToggle.checked);
        if (nightcoreToggle.checked) {
          const slowedToggle = document.getElementById('slowedToggle') as HTMLInputElement;
          if (slowedToggle) slowedToggle.checked = false;
        }
      });
    }

    const eightDToggle = document.getElementById('eightDToggle') as HTMLInputElement;
    if (eightDToggle) {
      eightDToggle.addEventListener('change', () => {
        this.audioEngine.set8DAudio(eightDToggle.checked);
      });
    }

    // Setup Export Options UI
    const exportResolutionSelect = document.getElementById('exportResolutionSelect') as HTMLSelectElement | null;
    const exportFpsSelect = document.getElementById('exportFpsSelect') as HTMLSelectElement | null;
    const exportQualitySelect = document.getElementById('exportQualitySelect') as HTMLSelectElement | null;
    const exportEstimateSize = document.getElementById('exportEstimateSize') as HTMLElement | null;
    const exportOutputMode = document.getElementById('exportOutputMode') as HTMLElement | null;
    const exportMemoryHint = document.getElementById('exportMemoryHint') as HTMLElement | null;

    const deviceMemory = typeof navigator !== 'undefined' ? (navigator as any).deviceMemory : undefined;
    const hardwareConcurrency = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined;
    const coarsePointer =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches;

    const recommended = recommendExportSettings({ deviceMemory, hardwareConcurrency, coarsePointer });

    if (exportResolutionSelect) {
      exportResolutionSelect.value = String(recommended.height);
    }
    if (exportFpsSelect) {
      exportFpsSelect.value = String(recommended.fps);
    }

    const updateExportUI = () => {
      const duration = this.audioEngine.getDuration() || 10;
      const resHeight = parseInt(exportResolutionSelect?.value || '1080', 10);
      const aspectVal = parseAspect((this.scene as any).template?.canvasAspect || '16:9');
      const size = computeExportSize(resHeight, aspectVal);
      const fps = parseInt(exportFpsSelect?.value || '60', 10);
      const quality = (exportQualitySelect?.value || 'medium') as 'low' | 'medium' | 'high';

      const estimatedBytes = estimateExportSizeBytes(
        duration,
        size.width,
        size.height,
        fps,
        quality,
        !!this.audioBuffer
      );

      if (exportEstimateSize) {
        const mb = estimatedBytes / (1024 * 1024);
        exportEstimateSize.textContent = mb >= 1000 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
      }

      const isDisk = typeof window !== 'undefined' && typeof (window as any).showSaveFilePicker === 'function';
      if (exportOutputMode) {
        exportOutputMode.textContent = isDisk ? 'Direct to disk' : 'In memory';
        exportOutputMode.className = isDisk ? 'text-emerald-400 font-medium' : 'text-amber-400 font-medium';
      }

      if (exportMemoryHint) {
        if (!isDisk && estimatedBytes > 0.6 * getMemoryGuardThresholdBytes()) {
          exportMemoryHint.classList.remove('hidden');
        } else {
          exportMemoryHint.classList.add('hidden');
        }
      }
    };

    exportResolutionSelect?.addEventListener('change', updateExportUI);
    exportFpsSelect?.addEventListener('change', updateExportUI);
    exportQualitySelect?.addEventListener('change', updateExportUI);

    updateExportUI();

    // Export Video
    const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement | null;
    const cancelExportBtn = document.getElementById('cancelExportBtn') as HTMLButtonElement | null;
    let exportAbortController: AbortController | null = null;

    if (exportBtn) {
      exportBtn.addEventListener('click', async () => {
        const duration = this.audioEngine.getDuration() || 10;
        const resHeight = parseInt(exportResolutionSelect?.value || '1080', 10);
        const aspectVal = parseAspect((this.scene as any).template?.canvasAspect || '16:9');
        const size = computeExportSize(resHeight, aspectVal);
        const fps = parseInt(exportFpsSelect?.value || '60', 10);
        const quality = (exportQualitySelect?.value || 'medium') as 'low' | 'medium' | 'high';

        const estimatedBytes = estimateExportSizeBytes(
          duration,
          size.width,
          size.height,
          fps,
          quality,
          !!this.audioBuffer
        );

        // Synchronously call createOutputTarget before any await to preserve user activation for showSaveFilePicker
        const targetPromise = createOutputTarget({
          suggestedName: 'openviz_render.mp4',
          estimatedBytes,
        });

        let target: OutputTarget;
        try {
          target = await targetPromise;
        } catch (err: any) {
          if (err?.name === 'AbortError') {
            const statusEl = document.getElementById('exportStatusMessage');
            if (statusEl) {
              statusEl.textContent = 'Export cancelled (file picker closed)';
              statusEl.classList.remove('hidden');
              setTimeout(() => statusEl.classList.add('hidden'), 3000);
            }
            return;
          }
          alert('Export target error: ' + (err as Error).message);
          return;
        }

        const wakeLock = await acquireWakeLock();

        exportBtn.textContent = '0%';
        exportBtn.setAttribute('disabled', 'true');
        if (cancelExportBtn) {
          cancelExportBtn.classList.remove('hidden');
        }

        exportAbortController = new AbortController();
        const statusEl = document.getElementById('exportStatusMessage');

        try {
          const result = await exportVideo(
            this.scene,
            this.audioBuffer,
            duration,
            {
              width: size.width,
              height: size.height,
              fps,
              quality,
              target,
              onVisibilityWarning: (msg) => {
                if (statusEl) {
                  statusEl.textContent = msg;
                  statusEl.classList.remove('hidden');
                }
              },
            },
            (progress) => {
              exportBtn.textContent = `${progress.percent}%`;
            },
            exportAbortController.signal
          );

          if (result.blob) {
            const url = URL.createObjectURL(result.blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'openviz_render.mp4';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 10_000);
          }

          const audioCodecStr = result.info.audioCodec ? result.info.audioCodec.toUpperCase() : 'NO AUDIO';
          let statusMsg = result.blob
            ? `Exported ${result.info.width}x${result.info.height}@${result.info.fps} H.264 + ${audioCodecStr}`
            : `Saved to the file you chose (${result.info.width}x${result.info.height}@${result.info.fps} H.264 + ${audioCodecStr})`;

          const dsp = this.audioEngine.getDSPState();
          const dspActive = dsp.bassBoostDb > 0 || dsp.slowedReverb || dsp.nightcore || dsp.eightD;

          if (result.info.audioCodec === null) {
            statusMsg += ' (Warning: No audio was exported)';
          }
          if (dspActive) {
            statusMsg += ' (Warning: Export contains the ORIGINAL audio; DSP effects are not applied yet)';
          }

          alert(statusMsg);
        } catch (err: any) {
          if (err?.name === 'AbortError') {
            console.log('Export cancelled by user.');
          } else {
            console.error('Export failed:', err);
            alert('Export failed: ' + (err as Error).message);
          }
        } finally {
          await wakeLock.release();
          if (statusEl) {
            statusEl.classList.add('hidden');
          }
          exportBtn.textContent = 'Export MP4';
          exportBtn.removeAttribute('disabled');
          if (cancelExportBtn) {
            cancelExportBtn.classList.add('hidden');
          }
          exportAbortController = null;
        }
      });
    }

    if (cancelExportBtn) {
      cancelExportBtn.addEventListener('click', () => {
        exportAbortController?.abort();
      });
    }

    // Add Layer Buttons
    document.getElementById('addBarsBtn')?.addEventListener('click', () => {
      const newNode: OpenVizNode = {
        id: `bars_${Date.now()}`,
        name: 'Spectrum Bars',
        type: 'Bars',
        transform: { position: [0, 0], scale: [1, 1], rotation: 0, opacity: 1 },
        bindings: [{ source: 'Bass', target: 'ScaleUniform', outputRange: [1, 1.2] }],
        barsData: {
          count: 64,
          innerRadius: 240,
          width: 4,
          isRadial: true,
          colorStart: [0, 0.94, 1, 1],
          colorEnd: [1, 0, 0.63, 1],
        },
      };
      this.scene.addNode(newNode);
      this.scene.selectNode(newNode.id);
      this.renderLayersList();
    });

    this.renderLayersList();
    this.renderInspector();
  }

  private setupResizeObserver(canvas: HTMLCanvasElement) {
    const parent = canvas.parentElement;
    if (parent) {
      const ro = new ResizeObserver(() => {
        this.scene.resize(parent.clientWidth, parent.clientHeight);
      });
      ro.observe(parent);
    }
  }

  private renderLayersList() {
    const layersList = document.getElementById('layersList');
    if (!layersList) return;

    layersList.innerHTML = '';
    for (const node of this.template.nodes) {
      const isSelected = node.id === this.selectedNodeId;
      const item = document.createElement('div');
      item.className = `p-2 rounded text-xs cursor-pointer flex items-center justify-between border transition ${
        isSelected
          ? 'bg-indigo-600/30 border-indigo-500/50 text-indigo-200'
          : 'bg-white/5 border-white/5 text-slate-300 hover:bg-white/10'
      }`;
      item.textContent = `${node.name} (${node.type})`;

      item.addEventListener('click', () => {
        this.scene.selectNode(node.id);
      });

      layersList.appendChild(item);
    }
  }

  private renderInspector() {
    const inspectorContent = document.getElementById('inspectorContent');
    if (!inspectorContent) return;

    if (!this.selectedNodeId) {
      inspectorContent.innerHTML = '<p>Select a layer to edit properties.</p>';
      return;
    }

    const node = this.template.nodes.find((n) => n.id === this.selectedNodeId);
    if (!node) {
      inspectorContent.innerHTML = '<p>Layer not found.</p>';
      return;
    }

    inspectorContent.innerHTML = `
      <div class="space-y-3">
        <div>
          <label class="block text-slate-400 mb-1">Layer Name</label>
          <input type="text" id="nodeNameInput" value="${node.name}" class="w-full glass-input p-1.5 rounded text-xs" />
        </div>

        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="block text-slate-400 mb-1">Pos X</label>
            <input type="number" id="posXInput" value="${node.transform.position[0]}" class="w-full glass-input p-1.5 rounded text-xs" />
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Pos Y</label>
            <input type="number" id="posYInput" value="${node.transform.position[1]}" class="w-full glass-input p-1.5 rounded text-xs" />
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="block text-slate-400 mb-1">Scale X</label>
            <input type="number" step="0.1" id="scaleXInput" value="${node.transform.scale[0]}" class="w-full glass-input p-1.5 rounded text-xs" />
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Scale Y</label>
            <input type="number" step="0.1" id="scaleYInput" value="${node.transform.scale[1]}" class="w-full glass-input p-1.5 rounded text-xs" />
          </div>
        </div>
      </div>
    `;

    // Hook inputs to update properties live
    document.getElementById('nodeNameInput')?.addEventListener('input', (e) => {
      node.name = (e.target as HTMLInputElement).value;
      this.renderLayersList();
    });

    document.getElementById('posXInput')?.addEventListener('input', (e) => {
      node.transform.position[0] = parseFloat((e.target as HTMLInputElement).value) || 0;
      this.scene.updateNode(node.id);
    });

    document.getElementById('posYInput')?.addEventListener('input', (e) => {
      node.transform.position[1] = parseFloat((e.target as HTMLInputElement).value) || 0;
      this.scene.updateNode(node.id);
    });

    document.getElementById('scaleXInput')?.addEventListener('input', (e) => {
      node.transform.scale[0] = parseFloat((e.target as HTMLInputElement).value) || 1;
      this.scene.updateNode(node.id);
    });

    document.getElementById('scaleYInput')?.addEventListener('input', (e) => {
      node.transform.scale[1] = parseFloat((e.target as HTMLInputElement).value) || 1;
      this.scene.updateNode(node.id);
    });
  }

  private startRenderLoop() {
    const loop = () => {
      const audioData = this.audioEngine.getFrequencyData();
      const timeSeconds = this.audioEngine.getCurrentTime();
      this.scene.updateAudioReactivity(audioData, timeSeconds);

      // Update time display and scrubber
      const timeDisplay = document.getElementById('timeDisplay');
      const scrubber = document.getElementById('timelineScrubber') as HTMLInputElement;

      const curr = timeSeconds;
      const dur = this.audioEngine.getDuration();

      if (timeDisplay) {
        const fmt = (s: number) => {
          const m = Math.floor(s / 60);
          const sec = Math.floor(s % 60);
          return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
        };
        timeDisplay.textContent = `${fmt(curr)} / ${fmt(dur)}`;
      }

      if (scrubber && dur > 0) {
        scrubber.value = ((curr / dur) * 100).toFixed(1);
      }

      this.animationFrameId = requestAnimationFrame(loop);
    };

    this.animationFrameId = requestAnimationFrame(loop);
  }
}
