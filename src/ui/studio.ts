import { getMonstercatPreset, getRadialPulsePreset, getLofiChillPreset } from '../render/presets';
import JSZip from 'jszip';
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
import { el } from './dom';
import { ObjectUrlRegistry } from '../assets/registry';
import { isValidAssetUrl } from '../schema/validate';

export function rgbaToHex(rgba: [number, number, number, number]): string {
  const r = Math.round(rgba[0] * 255).toString(16).padStart(2, '0');
  const g = Math.round(rgba[1] * 255).toString(16).padStart(2, '0');
  const b = Math.round(rgba[2] * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

export function hexToRgba(hex: string, currentAlpha = 1.0): [number, number, number, number] {
  let clean = hex.trim().replace(/^#/, '');
  if (clean.length === 6) {
    const r = parseInt(clean.substring(0, 2), 16) / 255;
    const g = parseInt(clean.substring(2, 4), 16) / 255;
    const b = parseInt(clean.substring(4, 6), 16) / 255;
    return [r, g, b, currentAlpha];
  }
  return [0, 0, 0, currentAlpha];
}

export class StudioController {
  private container: HTMLElement;
  private scene: VisualizerScene;
  private audioEngine: AudioEngine;
  private template: OpenVizTemplate;
  private assetRegistry = new ObjectUrlRegistry();
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
      schemaVersion: 'openviz/1',
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
            url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPg5RUBAABZAC9GJy+hAAAAAElFTkSuQmCC',
            fit: 'cover',
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

  private showStatus(message: string, isError = false) {
    const statusLine = document.getElementById('statusLine');
    if (statusLine) {
      statusLine.textContent = message;
      statusLine.className = `absolute top-3 left-1/2 -translate-x-1/2 z-30 px-4 py-1.5 font-semibold text-xs rounded-full shadow-lg border ${
        isError ? 'bg-rose-600/90 text-white border-rose-400' : 'bg-emerald-600/90 text-white border-emerald-400'
      }`;
      statusLine.classList.remove('hidden');
      setTimeout(() => {
        statusLine.classList.add('hidden');
      }, 5000);
    }
  }

  private setupUIEvents() {
    // Template Import / File Drop
    const templateInput = document.getElementById('templateInput') as HTMLInputElement;
    if (templateInput) {
      templateInput.addEventListener('change', async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        try {
          this.assetRegistry.revokeAll();
          const buffer = await file.arrayBuffer();
          const filename = file.name.toLowerCase();

          if (filename.endsWith('.viz')) {
            this.template = await importAveeViz(buffer, { registry: this.assetRegistry });
          } else if (filename.endsWith('.ovz')) {
            this.template = await this.loadOvzBuffer(buffer);
          } else {
            const text = new TextDecoder().decode(buffer);
            this.template = JSON.parse(text);
          }
          this.scene.loadTemplate(this.template);
          this.renderLayersList();
          this.renderInspector();
          this.showStatus('Template loaded successfully.');
        } catch (err) {
          this.showStatus(`Template import error: ${(err as Error).message}`, true);
        }
      });
    }
    // Save .ovz Project Bundle
    const saveOvzBtn = document.getElementById('saveOvzBtn');
    if (saveOvzBtn) {
      saveOvzBtn.addEventListener('click', async () => {
        try {
          await this.saveTemplateAsOvz();
        } catch (err) {
          this.showStatus(`Failed to save .ovz project: ${(err as Error).message}`, true);
        }
      });
    }



    // Visualizer Preset Selection
    const presetSelect = document.getElementById('presetSelect') as HTMLSelectElement | null;
    if (presetSelect) {
      presetSelect.addEventListener('change', () => {
        const val = presetSelect.value;
        if (val === 'monstercat') {
          this.template = getMonstercatPreset();
        } else if (val === 'radial') {
          this.template = getRadialPulsePreset();
        } else if (val === 'lofi') {
          this.template = getLofiChillPreset();
        } else {
          this.template = this.getDefaultTemplate();
        }
        this.scene.loadTemplate(this.template);
        this.renderLayersList();
        this.renderInspector();
        this.showStatus(`Loaded ${this.template.name} preset.`);
      });
    }

    // Audio Input
    const audioInput = document.getElementById('audioInput') as HTMLInputElement;
    if (audioInput) {
      audioInput.addEventListener('change', async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        await this.audioEngine.loadAudio(file);
        this.audioBuffer = await this.audioEngine.decodeFile(file);
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
          this.showStatus('Export target error: ' + (err as Error).message, true);
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

          this.showStatus(statusMsg);
        } catch (err: any) {
          if (err?.name === 'AbortError') {
            console.log('Export cancelled by user.');
          } else {
            console.error('Export failed:', err?.name, err?.message, err?.stack);
            this.showStatus(`Export failed: ${err?.name ?? 'Error'}: ${err?.message ?? String(err)}`, true);
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

    // Add Spectrum Bars Button
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

    // Add Image Button & Hidden File Input
    const addImageBtn = document.getElementById('addImageBtn');
    let imageInput = document.getElementById('imagePickerInput') as HTMLInputElement | null;
    if (!imageInput && typeof document !== 'undefined') {
      imageInput = el('input', {
        type: 'file',
        id: 'imagePickerInput',
        accept: 'image/*',
        className: 'hidden',
      });
      document.body.appendChild(imageInput);
    }

    if (addImageBtn && imageInput) {
      addImageBtn.addEventListener('click', () => imageInput?.click());
      imageInput.addEventListener('change', (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        const url = this.assetRegistry.create(file);
        if (!isValidAssetUrl(url)) {
          this.showStatus('Invalid image URL created', true);
          return;
        }

        const newNode: OpenVizNode = {
          id: `image_${Date.now()}`,
          name: file.name.replace(/\.[^/.]+$/, '') || 'New Image',
          type: 'Image',
          transform: { position: [0, 0], scale: [1, 1], rotation: 0, opacity: 1 },
          bindings: [],
          imageData: {
            assetId: `asset_${Date.now()}`,
            url,
            fit: 'contain',
          },
        };
        this.scene.addNode(newNode);
        this.scene.selectNode(newNode.id);
        this.renderLayersList();
        imageInput.value = '';
      });
    }

    // Add Text Button
    document.getElementById('addTextBtn')?.addEventListener('click', () => {
      const newNode: OpenVizNode = {
        id: `text_${Date.now()}`,
        name: 'Text Layer',
        type: 'Text',
        transform: { position: [0, 0], scale: [1, 1], rotation: 0, opacity: 1 },
        bindings: [],
        textData: {
          text: 'Text',
          size: 28,
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

    const items: HTMLElement[] = [];
    const nodes = this.template.nodes;

    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      const isSelected = node.id === this.selectedNodeId;
      const isVisible = node.transform.opacity > 0;

      const titleSpan = el('span', { className: 'truncate font-medium flex-1 mr-2' }, `${node.name} (${node.type})`);

      const visBtn = el('button', {
        className: `p-1 hover:bg-white/20 rounded ${isVisible ? 'text-indigo-300' : 'text-slate-500'}`,
        title: isVisible ? 'Hide Layer' : 'Show Layer',
        onclick: (e: MouseEvent) => {
          e.stopPropagation();
          if (isVisible) {
            (node as any)._lastOpacity = node.transform.opacity;
            node.transform.opacity = 0;
          } else {
            node.transform.opacity = (node as any)._lastOpacity && (node as any)._lastOpacity > 0 ? (node as any)._lastOpacity : 1;
          }
          this.scene.updateNode(node.id);
          this.renderLayersList();
          this.renderInspector();
        }
      }, isVisible ? '👁️' : '🙈');

      const dupBtn = el('button', {
        className: 'p-1 hover:bg-white/20 rounded text-slate-300',
        title: 'Duplicate Layer',
        onclick: (e: MouseEvent) => {
          e.stopPropagation();
          this.duplicateNode(node.id);
        }
      }, '📄');

      const upBtn = el('button', {
        className: `p-1 hover:bg-white/20 rounded ${index === 0 ? 'opacity-30 cursor-not-allowed' : 'text-slate-300'}`,
        title: 'Move Up',
        onclick: (e: MouseEvent) => {
          e.stopPropagation();
          if (index > 0) {
            this.reorderNode(index, index - 1);
          }
        }
      }, '🔼');

      const downBtn = el('button', {
        className: `p-1 hover:bg-white/20 rounded ${index === nodes.length - 1 ? 'opacity-30 cursor-not-allowed' : 'text-slate-300'}`,
        title: 'Move Down',
        onclick: (e: MouseEvent) => {
          e.stopPropagation();
          if (index < nodes.length - 1) {
            this.reorderNode(index, index + 1);
          }
        }
      }, '🔽');

      const delBtn = el('button', {
        className: 'p-1 hover:bg-rose-500/30 rounded text-rose-400',
        title: 'Delete Layer',
        onclick: (e: MouseEvent) => {
          e.stopPropagation();
          this.deleteNode(node.id);
        }
      }, '🗑️');

      const actionsDiv = el('div', { className: 'flex items-center gap-0.5 text-[10px]' }, visBtn, dupBtn, upBtn, downBtn, delBtn);

      const item = el(
        'div',
        {
          className: `p-1.5 px-2 rounded text-xs cursor-pointer flex items-center justify-between border transition ${
            isSelected
              ? 'bg-indigo-600/30 border-indigo-500/50 text-indigo-200'
              : 'bg-white/5 border-white/5 text-slate-300 hover:bg-white/10'
          }`,
          onclick: () => this.scene.selectNode(node.id),
        },
        titleSpan,
        actionsDiv
      );
      items.push(item);
    }
    layersList.replaceChildren(...items);
  }

  private deleteNode(nodeId: string) {
    this.scene.removeNode(nodeId);
    this.renderLayersList();
    this.renderInspector();
  }

  private duplicateNode(nodeId: string) {
    const original = this.template.nodes.find((n) => n.id === nodeId);
    if (!original) return;

    const cloned: OpenVizNode = JSON.parse(JSON.stringify(original));
    cloned.id = `${original.type.toLowerCase()}_${Date.now()}`;
    cloned.name = `${original.name} Copy`;
    cloned.transform.position = [original.transform.position[0] + 20, original.transform.position[1] - 20];

    this.scene.addNode(cloned);
    this.scene.selectNode(cloned.id);
    this.renderLayersList();
    this.renderInspector();
  }

  private reorderNode(fromIdx: number, toIdx: number) {
    if (fromIdx < 0 || fromIdx >= this.template.nodes.length || toIdx < 0 || toIdx >= this.template.nodes.length) return;
    const [moved] = this.template.nodes.splice(fromIdx, 1);
    this.template.nodes.splice(toIdx, 0, moved);
    this.scene.loadTemplate(this.template);
    if (this.selectedNodeId) {
      this.scene.selectNode(this.selectedNodeId);
    }
    this.renderLayersList();
  }

    private renderInspector() {
    const inspectorContent = document.getElementById('inspectorContent');
    if (!inspectorContent) return;

    if (!this.selectedNodeId) {
      const postEffectsPanel = this.renderPostEffectsPanel();
      inspectorContent.replaceChildren(
        el('p', { className: 'text-slate-400 mb-4' }, 'Select a layer from the left panel or canvas to edit properties.'),
        postEffectsPanel
      );
      return;
    }

    const node = this.template.nodes.find((n) => n.id === this.selectedNodeId);
    if (!node) {
      inspectorContent.replaceChildren(
        el('p', { className: 'text-slate-400' }, 'Layer not found.')
      );
      return;
    }

    const nameInput = el('input', {
      type: 'text',
      id: 'nodeNameInput',
      value: node.name,
      className: 'w-full glass-input p-1.5 rounded text-xs',
      oninput: (e: Event) => {
        node.name = (e.target as HTMLInputElement).value;
        this.renderLayersList();
      },
    });

    const posXInput = el('input', {
      type: 'number',
      id: 'posXInput',
      value: node.transform.position[0],
      className: 'w-full glass-input p-1.5 rounded text-xs',
      oninput: (e: Event) => {
        node.transform.position[0] = parseFloat((e.target as HTMLInputElement).value) || 0;
        this.scene.updateNode(node.id);
      },
    });

    const posYInput = el('input', {
      type: 'number',
      id: 'posYInput',
      value: node.transform.position[1],
      className: 'w-full glass-input p-1.5 rounded text-xs',
      oninput: (e: Event) => {
        node.transform.position[1] = parseFloat((e.target as HTMLInputElement).value) || 0;
        this.scene.updateNode(node.id);
      },
    });

    const scaleXInput = el('input', {
      type: 'number',
      step: '0.1',
      id: 'scaleXInput',
      value: node.transform.scale[0],
      className: 'w-full glass-input p-1.5 rounded text-xs',
      oninput: (e: Event) => {
        node.transform.scale[0] = parseFloat((e.target as HTMLInputElement).value) || 1;
        this.scene.updateNode(node.id);
      },
    });

    const scaleYInput = el('input', {
      type: 'number',
      step: '0.1',
      id: 'scaleYInput',
      value: node.transform.scale[1],
      className: 'w-full glass-input p-1.5 rounded text-xs',
      oninput: (e: Event) => {
        node.transform.scale[1] = parseFloat((e.target as HTMLInputElement).value) || 1;
        this.scene.updateNode(node.id);
      },
    });

    // Rotation (UI in degrees, stored in radians)
    const rotDeg = Math.round((node.transform.rotation * 180) / Math.PI);
    const rotationInput = el('input', {
      type: 'number',
      step: '1',
      id: 'rotationInput',
      value: rotDeg,
      className: 'w-full glass-input p-1.5 rounded text-xs',
      oninput: (e: Event) => {
        const deg = parseFloat((e.target as HTMLInputElement).value) || 0;
        node.transform.rotation = (deg * Math.PI) / 180;
        this.scene.updateNode(node.id);
      },
    });

    // Opacity (0..1 slider)
    const opacityValDisplay = el('span', { className: 'text-indigo-400 font-mono text-[11px]' }, `${Math.round(node.transform.opacity * 100)}%`);
    const opacityInput = el('input', {
      type: 'range',
      min: '0',
      max: '1',
      step: '0.05',
      id: 'opacityInput',
      value: node.transform.opacity,
      className: 'w-full accent-indigo-500 cursor-pointer h-1 bg-slate-700 rounded appearance-none mt-1',
      oninput: (e: Event) => {
        const val = parseFloat((e.target as HTMLInputElement).value) || 0;
        node.transform.opacity = val;
        opacityValDisplay.textContent = `${Math.round(val * 100)}%`;
        this.scene.updateNode(node.id);
      },
    });

    const childrenList: HTMLElement[] = [
      el('div', null, el('label', { className: 'block text-slate-400 mb-1' }, 'Layer Name'), nameInput),
      el(
        'div',
        { className: 'grid grid-cols-2 gap-2' },
        el('div', null, el('label', { className: 'block text-slate-400 mb-1' }, 'Pos X'), posXInput),
        el('div', null, el('label', { className: 'block text-slate-400 mb-1' }, 'Pos Y'), posYInput)
      ),
      el(
        'div',
        { className: 'grid grid-cols-2 gap-2' },
        el('div', null, el('label', { className: 'block text-slate-400 mb-1' }, 'Scale X'), scaleXInput),
        el('div', null, el('label', { className: 'block text-slate-400 mb-1' }, 'Scale Y'), scaleYInput)
      ),
      el(
        'div',
        { className: 'grid grid-cols-2 gap-2' },
        el('div', null, el('label', { className: 'block text-slate-400 mb-1' }, 'Rotation (deg)'), rotationInput),
        el('div', null,
          el('div', { className: 'flex justify-between items-center mb-1' },
            el('label', { className: 'text-slate-400' }, 'Opacity'),
            opacityValDisplay
          ),
          opacityInput
        )
      ),
    ];

    // Image Node Controls
    if (node.type === 'Image' && node.imageData) {
      const imageData = node.imageData;
      const fitSelect = el('select', {
        className: 'w-full glass-input p-1.5 rounded text-xs bg-slate-800 text-slate-200 border border-white/10 cursor-pointer',
        onchange: (e: Event) => {
          imageData.fit = (e.target as HTMLSelectElement).value as 'contain' | 'cover';
          this.scene.updateNode(node.id);
        }
      },
        el('option', { value: 'contain', selected: imageData.fit !== 'cover' }, 'Contain'),
        el('option', { value: 'cover', selected: imageData.fit === 'cover' }, 'Cover (Wallpaper Mode)')
      );

      const replaceImgFileInput = el('input', {
        type: 'file',
        accept: 'image/*',
        className: 'hidden',
        onchange: (e: Event) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (!file) return;
          const url = this.assetRegistry.create(file);
          if (!isValidAssetUrl(url)) {
            this.showStatus('Invalid asset URL', true);
            return;
          }
          imageData.url = url;
          imageData.assetId = `asset_${Date.now()}`;
          this.scene.updateNode(node.id);
          this.showStatus('Image replaced.');
        }
      });

      const replaceImgBtn = el('button', {
        className: 'w-full py-1.5 px-3 bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 text-indigo-200 font-medium rounded transition flex items-center justify-center gap-1.5',
        onclick: () => replaceImgFileInput.click()
      }, '🖼️ Replace Image', replaceImgFileInput);

      childrenList.push(
        el('div', { className: 'border-t border-white/10 pt-3 space-y-3' },
          el('h3', { className: 'font-semibold text-slate-300 uppercase text-[10px] tracking-wider' }, 'Image Properties'),
          el('div', null, el('label', { className: 'block text-slate-400 mb-1' }, 'Fit Mode'), fitSelect),
          replaceImgBtn
        )
      );
    }

    // Spectrum Bars Node Controls
    if (node.type === 'Bars' && node.barsData) {
      const barsData = node.barsData;

      const radialToggle = el('input', {
        type: 'checkbox',
        checked: barsData.isRadial ?? true,
        className: 'accent-indigo-500 w-4 h-4 cursor-pointer',
        onchange: (e: Event) => {
          barsData.isRadial = (e.target as HTMLInputElement).checked;
          this.scene.updateNode(node.id);
          this.renderInspector();
        }
      });

      const radiusValDisplay = el('span', { className: 'text-indigo-400 font-mono text-[11px]' }, `${barsData.innerRadius ?? 240}px`);
      const radiusSlider = el('input', {
        type: 'range',
        min: '50',
        max: '600',
        step: '5',
        value: barsData.innerRadius ?? 240,
        className: 'w-full accent-indigo-500 cursor-pointer h-1 bg-slate-700 rounded appearance-none',
        oninput: (e: Event) => {
          const val = parseInt((e.target as HTMLInputElement).value, 10) || 240;
          barsData.innerRadius = val;
          radiusValDisplay.textContent = `${val}px`;
          this.scene.updateNode(node.id);
        }
      });

      const barWidthValDisplay = el('span', { className: 'text-indigo-400 font-mono text-[11px]' }, `${barsData.width ?? 4}px`);
      const barWidthSlider = el('input', {
        type: 'range',
        min: '1',
        max: '20',
        step: '1',
        value: barsData.width ?? 4,
        className: 'w-full accent-indigo-500 cursor-pointer h-1 bg-slate-700 rounded appearance-none',
        oninput: (e: Event) => {
          const val = parseInt((e.target as HTMLInputElement).value, 10) || 4;
          barsData.width = val;
          barWidthValDisplay.textContent = `${val}px`;
          this.scene.updateNode(node.id);
        }
      });

      const barCountValDisplay = el('span', { className: 'text-indigo-400 font-mono text-[11px]' }, `${barsData.count ?? 64}`);
      const barCountSlider = el('input', {
        type: 'range',
        min: '16',
        max: '256',
        step: '4',
        value: barsData.count ?? 64,
        className: 'w-full accent-indigo-500 cursor-pointer h-1 bg-slate-700 rounded appearance-none',
        oninput: (e: Event) => {
          const val = parseInt((e.target as HTMLInputElement).value, 10) || 64;
          barsData.count = val;
          barCountValDisplay.textContent = `${val}`;
          this.scene.updateNode(node.id);
        }
      });

      const colorStartInput = el('input', {
        type: 'color',
        id: 'colorStartInput',
        value: rgbaToHex(barsData.colorStart),
        className: 'w-full h-8 bg-transparent cursor-pointer rounded border border-white/10 p-0.5',
        oninput: (e: Event) => {
          const hex = (e.target as HTMLInputElement).value;
          barsData.colorStart = hexToRgba(hex, barsData.colorStart[3]);
          this.scene.updateNode(node.id);
        },
      });

      const colorEndInput = el('input', {
        type: 'color',
        id: 'colorEndInput',
        value: rgbaToHex(barsData.colorEnd),
        className: 'w-full h-8 bg-transparent cursor-pointer rounded border border-white/10 p-0.5',
        oninput: (e: Event) => {
          const hex = (e.target as HTMLInputElement).value;
          barsData.colorEnd = hexToRgba(hex, barsData.colorEnd[3]);
          this.scene.updateNode(node.id);
        },
      });

      const barsControls = [
        el('h3', { className: 'font-semibold text-slate-300 uppercase text-[10px] tracking-wider' }, 'Spectrum Bars Properties'),
        el('div', { className: 'flex items-center justify-between bg-white/5 p-2 rounded' },
          el('span', { className: 'text-slate-300 font-medium' }, 'Radial Circle Mode'),
          radialToggle
        ),
      ];

      if (barsData.isRadial) {
        barsControls.push(
          el('div', null,
            el('div', { className: 'flex justify-between items-center mb-1' },
              el('label', { className: 'text-slate-400' }, 'Inner Radius'),
              radiusValDisplay
            ),
            radiusSlider
          )
        );
      }

      barsControls.push(
        el('div', null,
          el('div', { className: 'flex justify-between items-center mb-1' },
            el('label', { className: 'text-slate-400' }, 'Bar Width'),
            barWidthValDisplay
          ),
          barWidthSlider
        ),
        el('div', null,
          el('div', { className: 'flex justify-between items-center mb-1' },
            el('label', { className: 'text-slate-400' }, 'Bar Count'),
            barCountValDisplay
          ),
          barCountSlider
        ),
        el('div', { className: 'grid grid-cols-2 gap-2 pt-1' },
          el('div', null, el('label', { className: 'block text-slate-400 mb-1' }, 'Color Start'), colorStartInput),
          el('div', null, el('label', { className: 'block text-slate-400 mb-1' }, 'Color End'), colorEndInput)
        )
      );

      childrenList.push(el('div', { className: 'border-t border-white/10 pt-3 space-y-3' }, ...barsControls));
    }

    // Text Node Controls
    if (node.type === 'Text' && node.textData) {
      const textData = node.textData;

      const textValInput = el('textarea', {
        id: 'textValInput',
        rows: '2',
        value: textData.text,
        className: 'w-full glass-input p-1.5 rounded text-xs resize-none',
        oninput: (e: Event) => {
          textData.text = (e.target as HTMLTextAreaElement).value;
          this.scene.updateNode(node.id);
        },
      });

      const fontSizeValDisplay = el('span', { className: 'text-indigo-400 font-mono text-[11px]' }, `${textData.size}px`);
      const fontSizeSlider = el('input', {
        type: 'range',
        min: '10',
        max: '120',
        step: '1',
        value: textData.size,
        className: 'w-full accent-indigo-500 cursor-pointer h-1 bg-slate-700 rounded appearance-none',
        oninput: (e: Event) => {
          const val = parseInt((e.target as HTMLInputElement).value, 10) || 24;
          textData.size = val;
          fontSizeValDisplay.textContent = `${val}px`;
          this.scene.updateNode(node.id);
        },
      });

      const textColorPicker = el('input', {
        type: 'color',
        value: textData.color || '#ffffff',
        className: 'w-full h-8 bg-transparent cursor-pointer rounded border border-white/10 p-0.5',
        oninput: (e: Event) => {
          textData.color = (e.target as HTMLInputElement).value;
          this.scene.updateNode(node.id);
        }
      });

      childrenList.push(
        el('div', { className: 'border-t border-white/10 pt-3 space-y-3' },
          el('h3', { className: 'font-semibold text-slate-300 uppercase text-[10px] tracking-wider' }, 'Text Properties'),
          el('div', null, el('label', { className: 'block text-slate-400 mb-1' }, 'Text Content'), textValInput),
          el('div', null,
            el('div', { className: 'flex justify-between items-center mb-1' },
              el('label', { className: 'text-slate-400' }, 'Font Size'),
              fontSizeValDisplay
            ),
            fontSizeSlider
          ),
          el('div', null, el('label', { className: 'block text-slate-400 mb-1' }, 'Text Color'), textColorPicker)
        )
      );
    }

    // Prominent Red Delete Layer Button
    const deleteLayerBtn = el('button', {
      className: 'w-full py-2 px-3 bg-rose-600/80 hover:bg-rose-600 text-white font-semibold rounded-lg shadow-lg transition flex items-center justify-center gap-1.5 mt-4',
      onclick: () => this.deleteNode(node.id)
    }, '🗑️ Delete Layer');

    const postEffectsPanel = this.renderPostEffectsPanel();

    const content = el('div', { className: 'space-y-4' }, ...childrenList, deleteLayerBtn, el('div', { className: 'border-t border-white/10 pt-4' }, postEffectsPanel));
    inspectorContent.replaceChildren(content);
  }

  private renderPostEffectsPanel(): HTMLElement {
    if (!this.template.postEffects) {
      this.template.postEffects = [];
    }

    let bloom = this.template.postEffects.find((p) => p.type === 'Bloom');
    if (!bloom) {
      bloom = { type: 'Bloom', threshold: 0.5, intensity: 1.0 };
      this.template.postEffects.push(bloom);
    }

    let ca = this.template.postEffects.find((p) => p.type === 'ChromaticAberration');
    if (!ca) {
      ca = { type: 'ChromaticAberration', amount: 0.02 };
      this.template.postEffects.push(ca);
    }

    const bloomThreshDisplay = el('span', { className: 'text-indigo-400 font-mono text-[11px]' }, `${bloom.threshold ?? 0.5}`);
    const bloomThreshSlider = el('input', {
      type: 'range',
      min: '0',
      max: '1',
      step: '0.05',
      value: bloom.threshold ?? 0.5,
      className: 'w-full accent-indigo-500 cursor-pointer h-1 bg-slate-700 rounded appearance-none',
      oninput: (e: Event) => {
        const val = parseFloat((e.target as HTMLInputElement).value) || 0;
        bloom!.threshold = val;
        bloomThreshDisplay.textContent = `${val}`;
      }
    });

    const bloomIntDisplay = el('span', { className: 'text-indigo-400 font-mono text-[11px]' }, `${bloom.intensity ?? 1.0}`);
    const bloomIntSlider = el('input', {
      type: 'range',
      min: '0',
      max: '3',
      step: '0.1',
      value: bloom.intensity ?? 1.0,
      className: 'w-full accent-indigo-500 cursor-pointer h-1 bg-slate-700 rounded appearance-none',
      oninput: (e: Event) => {
        const val = parseFloat((e.target as HTMLInputElement).value) || 0;
        bloom!.intensity = val;
        bloomIntDisplay.textContent = `${val}`;
      }
    });

    const caAmtDisplay = el('span', { className: 'text-indigo-400 font-mono text-[11px]' }, `${ca.amount ?? 0.02}`);
    const caAmtSlider = el('input', {
      type: 'range',
      min: '0',
      max: '0.1',
      step: '0.005',
      value: ca.amount ?? 0.02,
      className: 'w-full accent-indigo-500 cursor-pointer h-1 bg-slate-700 rounded appearance-none',
      oninput: (e: Event) => {
        const val = parseFloat((e.target as HTMLInputElement).value) || 0;
        ca!.amount = val;
        caAmtDisplay.textContent = `${val}`;
      }
    });

    return el('div', { className: 'space-y-3' },
      el('h3', { className: 'font-semibold text-slate-300 uppercase text-[10px] tracking-wider' }, 'Global Post-Effects'),
      el('div', { className: 'bg-white/5 p-2.5 rounded-lg border border-white/5 space-y-2' },
        el('span', { className: 'text-xs font-semibold text-slate-200 block' }, 'Bloom'),
        el('div', null,
          el('div', { className: 'flex justify-between items-center mb-1 text-[11px]' },
            el('label', { className: 'text-slate-400' }, 'Threshold'),
            bloomThreshDisplay
          ),
          bloomThreshSlider
        ),
        el('div', null,
          el('div', { className: 'flex justify-between items-center mb-1 text-[11px]' },
            el('label', { className: 'text-slate-400' }, 'Intensity'),
            bloomIntDisplay
          ),
          bloomIntSlider
        )
      ),
      el('div', { className: 'bg-white/5 p-2.5 rounded-lg border border-white/5 space-y-2' },
        el('span', { className: 'text-xs font-semibold text-slate-200 block' }, 'Chromatic Aberration'),
        el('div', null,
          el('div', { className: 'flex justify-between items-center mb-1 text-[11px]' },
            el('label', { className: 'text-slate-400' }, 'Amount'),
            caAmtDisplay
          ),
          caAmtSlider
        )
      )
    );
  }

private startRenderLoop() {
    const loop = () => {
      const audioData = this.audioEngine.getFrequencyData();
      const timeSeconds = this.audioEngine.getCurrentTime();
      this.scene.updateAudioReactivity(audioData, timeSeconds);

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


  public async saveTemplateAsOvz(): Promise<Blob> {
    const zip = new JSZip();

    // Create a clean copy of the template JSON to store
    const templateCopy: OpenVizTemplate = JSON.parse(JSON.stringify(this.template));

    // Ensure assets dictionary exists
    if (!templateCopy.assets) {
      templateCopy.assets = {};
    }

    const assetsFolder = zip.folder('assets');

    for (const node of templateCopy.nodes) {
      if (node.type === 'Image' && node.imageData) {
        const url = node.imageData.url;
        if (url) {
          try {
            let blob: Blob;
            if (url.startsWith('data:')) {
              const res = await fetch(url);
              blob = await res.blob();
            } else if (url.startsWith('blob:')) {
              const res = await fetch(url);
              blob = await res.blob();
            } else {
              const res = await fetch(url);
              blob = await res.blob();
            }

            const assetId = node.imageData.assetId || `asset_${Date.now()}`;
            const ext = blob.type.split('/')[1] || 'png';
            const fileName = `${assetId}.${ext}`;

            if (assetsFolder) {
              assetsFolder.file(fileName, blob);
            }

            templateCopy.assets[assetId] = `assets/${fileName}`;
            node.imageData.assetId = assetId;
            node.imageData.url = `assets/${fileName}`;
          } catch (err) {
            console.warn(`Could not bundle image asset for node ${node.id}:`, err);
          }
        }
      }
    }

    zip.file('scene.json', JSON.stringify(templateCopy, null, 2));

    const ovzBlob = await zip.generateAsync({ type: 'blob', mimeType: 'application/octet-stream' });

    if (typeof document !== 'undefined') {
      const downloadUrl = URL.createObjectURL(ovzBlob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `${templateCopy.name || 'project'}.ovz`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 10_000);
      this.showStatus('Project saved as .ovz bundle!');
    }

    return ovzBlob;
  }

  public async loadOvzBuffer(buffer: ArrayBuffer): Promise<OpenVizTemplate> {
    const zip = await JSZip.loadAsync(buffer);
    const sceneJsonFile = zip.file('scene.json');
    if (!sceneJsonFile) {
      throw new Error('Invalid .ovz project: missing scene.json');
    }

    const sceneJsonText = await sceneJsonFile.async('string');
    const parsedTemplate: OpenVizTemplate = JSON.parse(sceneJsonText);

    const assetUrls: Record<string, string> = {};

    for (const node of parsedTemplate.nodes) {
      if (node.type === 'Image' && node.imageData) {
        const path = node.imageData.url || (node.imageData.assetId ? `assets/${node.imageData.assetId}` : '');
        if (path) {
          const zipFile = zip.file(path) || zip.file(path.replace(/^assets\//, ''));
          if (zipFile) {
            const blob = await zipFile.async('blob');
            const url = this.assetRegistry.create(blob);
            node.imageData.url = url;
            if (node.imageData.assetId) {
              assetUrls[node.imageData.assetId] = url;
            }
          }
        }
      }
    }

    parsedTemplate.assets = assetUrls;
    return parsedTemplate;
  }

  public dispose() {
    if (this.animationFrameId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.assetRegistry.revokeAll();
    this.scene.dispose();
    this.audioEngine.dispose();
  }
}
