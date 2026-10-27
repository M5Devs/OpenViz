import { AudioEngine } from '../audio/engine';
import { VisualizerScene } from '../render/scene';
import { importAveeViz } from '../importer/avee';
import { exportVideo } from '../export/webcodecs';
import { OpenVizTemplate, OpenVizNode } from '../types';

export class StudioController {
  private audioEngine: AudioEngine;
  private scene: VisualizerScene;
  private template: OpenVizTemplate;
  private selectedNodeId: string | null = null;
  private animationFrameId: number | null = null;
  private audioBuffer: AudioBuffer | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.audioEngine = new AudioEngine();
    this.scene = new VisualizerScene(canvas);

    this.template = this.createDefaultTemplate();
    this.scene.loadTemplate(this.template);

    this.setupUIEvents();
    this.setupResizeObserver(canvas);

    this.scene.setOnSelectCallback((nodeId) => {
      this.selectedNodeId = nodeId;
      this.renderLayersList();
      this.renderInspector();
    });

    this.startRenderLoop();
  }

  private createDefaultTemplate(): OpenVizTemplate {
    return {
      schemaVersion: 'openviz/1',
      name: 'Default Spectrum Visualizer',
      author: 'OpenViz Studio',
      canvasAspect: '16:9',
      clearColor: [0.05, 0.05, 0.08, 1.0],
      nodes: [
        {
          id: 'radial_spectrum',
          name: 'Radial Spectrum',
          type: 'Bars',
          transform: { position: [0, 0], scale: [1, 1], rotation: 0, opacity: 1 },
          bindings: [{ source: 'Bass', target: 'ScaleUniform', outputRange: [0.95, 1.15] }],
          barsData: {
            count: 64,
            innerRadius: 18,
            width: 1.8,
            isRadial: true,
            colorStart: [0.0, 0.9, 1.0, 1.0],
            colorEnd: [1.0, 0.1, 0.7, 1.0],
          },
        },
        {
          id: 'center_logo',
          name: 'Center Logo',
          type: 'Image',
          transform: { position: [0, 0], scale: [0.8, 0.8], rotation: 0, opacity: 1 },
          bindings: [{ source: 'Beat', target: 'ScaleUniform', outputRange: [0.9, 1.1] }],
          imageData: {
            assetId: 'default_logo',
          },
        },
      ],
      postEffects: [],
    };
  }

  private setupUIEvents() {
    // Template Input
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

    // Export Video
    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', async () => {
        const duration = this.audioEngine.getDuration() || 10;
        exportBtn.textContent = 'Encoding...';
        exportBtn.setAttribute('disabled', 'true');

        try {
          const blob = await exportVideo(this.scene, this.audioBuffer, duration, {
            width: 1920,
            height: 1080,
            fps: 60,
            bitrate: 12_000_000,
          });

          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'openviz_render.mp4';
          a.click();
        } catch (err) {
          console.error('Export failed:', err);
          alert('Export failed: ' + (err as Error).message);
        } finally {
          exportBtn.textContent = 'Export MP4';
          exportBtn.removeAttribute('disabled');
        }
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
          innerRadius: 15,
          width: 2,
          isRadial: true,
          colorStart: [0, 0.8, 1, 1],
          colorEnd: [1, 0, 0.8, 1],
        },
      };
      this.template.nodes.push(newNode);
      this.scene.loadTemplate(this.template);
      this.scene.selectNode(newNode.id);
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
      this.scene.loadTemplate(this.template);
      this.scene.selectNode(node.id);
    });

    document.getElementById('posYInput')?.addEventListener('input', (e) => {
      node.transform.position[1] = parseFloat((e.target as HTMLInputElement).value) || 0;
      this.scene.loadTemplate(this.template);
      this.scene.selectNode(node.id);
    });
  }

  private startRenderLoop() {
    const loop = () => {
      const audioData = this.audioEngine.getFrequencyData();
      this.scene.updateAudioReactivity(audioData);

      // Update time display and scrubber
      const timeDisplay = document.getElementById('timeDisplay');
      const scrubber = document.getElementById('timelineScrubber') as HTMLInputElement;

      const curr = this.audioEngine.getCurrentTime();
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
