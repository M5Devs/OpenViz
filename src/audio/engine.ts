import { DSPState, FrequencyData } from '../types';
import { createAnalyzer, AudioAnalyzer } from './factory';

export function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateImpulseResponse(ctx: AudioContext, durationSeconds = 2.5, decay = 3.0): AudioBuffer {
  const sampleRate = ctx.sampleRate || 44100;
  const length = Math.floor(sampleRate * durationSeconds);
  const buffer = ctx.createBuffer(2, length, sampleRate);

  const prngL = mulberry32(0x12345678);
  const prngR = mulberry32(0x87654321);

  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  for (let i = 0; i < length; i++) {
    const t = i / length;
    const env = Math.exp(-t * decay);
    left[i] = (prngL() * 2 - 1) * env;
    right[i] = (prngR() * 2 - 1) * env;
  }

  return buffer;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private audioEl: HTMLAudioElement;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private bassFilter: BiquadFilterNode | null = null;
  private stereoPanner: StereoPannerNode | null = null;
  private pannerOsc: OscillatorNode | null = null;
  private pannerGain: GainNode | null = null;
  private convolverNode: ConvolverNode | null = null;
  private wetGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;

  private dspState: DSPState = {
    bassBoostDb: 0,
    slowedReverb: false,
    nightcore: false,
    eightD: false,
  };

  private audioObjectUrl: string | null = null;
  private decodedAudioBuffer: AudioBuffer | null = null;
  private timeDomainBuffer: Float32Array = new Float32Array(4096);
  private spectrumAnalyzer: AudioAnalyzer | null = null;
  private analysisMode: 'openviz' | 'avee-classic' = 'openviz';

  constructor() {
    this.audioEl = new Audio();
    this.audioEl.crossOrigin = 'anonymous';
  }

  public init() {
    if (this.ctx) return;

    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) {
      console.warn('WebAudio API is not supported in this environment');
      return;
    }

    this.ctx = new AudioCtx();

    // Create source
    this.sourceNode = this.ctx.createMediaElementSource(this.audioEl);

    // Create Bass Boost low-shelf filter at 120Hz
    this.bassFilter = this.ctx.createBiquadFilter();
    this.bassFilter.type = 'lowshelf';
    this.bassFilter.frequency.setValueAtTime(120, this.ctx.currentTime);
    this.bassFilter.gain.setValueAtTime(0, this.ctx.currentTime);

    // Create Reverb via ConvolverNode
    if (typeof this.ctx.createConvolver === 'function') {
      this.convolverNode = this.ctx.createConvolver();
      this.convolverNode.buffer = generateImpulseResponse(this.ctx);
    }

    this.wetGain = this.ctx.createGain();
    this.wetGain.gain.setValueAtTime(0, this.ctx.currentTime);

    // Create 8D Audio Oscillator -> Gain -> StereoPanner.pan
    if (typeof this.ctx.createStereoPanner === 'function' && typeof this.ctx.createOscillator === 'function') {
      this.stereoPanner = this.ctx.createStereoPanner();

      this.pannerOsc = this.ctx.createOscillator();
      this.pannerOsc.type = 'sine';
      this.pannerOsc.frequency.setValueAtTime(0.125, this.ctx.currentTime);

      this.pannerGain = this.ctx.createGain();
      this.pannerGain.gain.setValueAtTime(0, this.ctx.currentTime);

      this.pannerOsc.connect(this.pannerGain);
      this.pannerGain.connect(this.stereoPanner.pan);
      this.pannerOsc.start();
    }

    // Create FFT Analyser
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 4096;

    this.spectrumAnalyzer = createAnalyzer(this.analysisMode, this.ctx.sampleRate || 44100);

    // Connect Graph
    this.sourceNode.connect(this.bassFilter);

    if (this.convolverNode && this.wetGain) {
      this.bassFilter.connect(this.convolverNode);
      this.convolverNode.connect(this.wetGain);
      this.wetGain.connect(this.analyser);
    }

    let lastNode: AudioNode = this.bassFilter;
    if (this.stereoPanner) {
      lastNode.connect(this.stereoPanner);
      lastNode = this.stereoPanner;
    }

    lastNode.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
  }

  public async loadAudio(source: string | File | Blob) {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    if (this.audioObjectUrl) {
      URL.revokeObjectURL(this.audioObjectUrl);
      this.audioObjectUrl = null;
    }

    if (typeof source === 'string') {
      this.audioEl.src = source;
    } else {
      this.audioObjectUrl = URL.createObjectURL(source);
      this.audioEl.src = this.audioObjectUrl;
    }
    this.audioEl.load();
  }

  public async decodeFile(file: File | Blob): Promise<AudioBuffer> {
    this.init();
    if (!this.ctx) {
      throw new Error('AudioContext unavailable');
    }
    const arrayBuffer = await file.arrayBuffer();
    this.decodedAudioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
    return this.decodedAudioBuffer;
  }

  public getAudioBuffer(): AudioBuffer | null {
    return this.decodedAudioBuffer;
  }

  public play() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.audioEl.play();
  }

  public pause() {
    this.audioEl.pause();
  }

  public seek(timeInSeconds: number) {
    this.audioEl.currentTime = timeInSeconds;
  }

  public getCurrentTime(): number {
    return this.audioEl.currentTime;
  }

  public getDuration(): number {
    return this.audioEl.duration || 0;
  }

  public isPaused(): boolean {
    return this.audioEl.paused;
  }

  public setBassBoost(db: number) {
    this.dspState.bassBoostDb = db;
    if (this.bassFilter && this.ctx) {
      this.bassFilter.gain.setValueAtTime(db, this.ctx.currentTime);
    }
  }

  public setSlowedReverb(active: boolean) {
    this.dspState.slowedReverb = active;
    if (active) {
      this.dspState.nightcore = false;
      this.audioEl.playbackRate = 0.85;
      (this.audioEl as any).preservesPitch = false;
      if (this.wetGain && this.ctx) {
        if (typeof this.wetGain.gain.setTargetAtTime === 'function') {
          this.wetGain.gain.setTargetAtTime(0.35, this.ctx.currentTime, 0.05);
        } else {
          this.wetGain.gain.setValueAtTime(0.35, this.ctx.currentTime);
        }
      }
    } else {
      if (!this.dspState.nightcore) {
        this.audioEl.playbackRate = 1.0;
      }
      if (this.wetGain && this.ctx) {
        if (typeof this.wetGain.gain.setTargetAtTime === 'function') {
          this.wetGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
        } else {
          this.wetGain.gain.setValueAtTime(0, this.ctx.currentTime);
        }
      }
    }
  }

  public setNightcore(active: boolean) {
    this.dspState.nightcore = active;
    if (active) {
      this.dspState.slowedReverb = false;
      if (this.wetGain && this.ctx) {
        if (typeof this.wetGain.gain.setTargetAtTime === 'function') {
          this.wetGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
        } else {
          this.wetGain.gain.setValueAtTime(0, this.ctx.currentTime);
        }
      }
      this.audioEl.playbackRate = 1.25;
      (this.audioEl as any).preservesPitch = false;
    } else {
      if (!this.dspState.slowedReverb) {
        this.audioEl.playbackRate = 1.0;
      }
    }
  }

  public set8DAudio(active: boolean) {
    this.dspState.eightD = active;
    if (this.pannerGain && this.ctx) {
      const target = active ? 1 : 0;
      if (typeof this.pannerGain.gain.setTargetAtTime === 'function') {
        this.pannerGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
      } else {
        this.pannerGain.gain.setValueAtTime(target, this.ctx.currentTime);
      }
    }
    if (!active && this.stereoPanner && this.ctx) {
      this.stereoPanner.pan.setValueAtTime(0, this.ctx.currentTime);
    }
  }

  public setAnalysisMode(mode: 'openviz' | 'avee-classic') {
    if (this.analysisMode !== mode) {
      this.analysisMode = mode;
      const sr = this.ctx?.sampleRate || 44100;
      this.spectrumAnalyzer = createAnalyzer(mode, sr);
    }
  }

  public getAnalysisMode(): 'openviz' | 'avee-classic' {
    return this.analysisMode;
  }

  public getDSPState(): DSPState {
    return { ...this.dspState };
  }

  public getFrequencyData(): FrequencyData {
    if (!this.spectrumAnalyzer) {
      this.spectrumAnalyzer = createAnalyzer(this.analysisMode, this.ctx?.sampleRate || 44100);
    }

    if (this.analyser) {
      this.analyser.getFloatTimeDomainData(this.timeDomainBuffer);
    } else {
      this.timeDomainBuffer.fill(0);
    }

    return this.spectrumAnalyzer.analyze(this.timeDomainBuffer);
  }

  public dispose() {
    if (this.audioObjectUrl) {
      URL.revokeObjectURL(this.audioObjectUrl);
      this.audioObjectUrl = null;
    }
    if (this.pannerOsc) {
      try { this.pannerOsc.stop(); } catch {}
      this.pannerOsc = null;
    }
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
  }
}
