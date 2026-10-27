import { DSPState, FrequencyData } from '../types';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private audioEl: HTMLAudioElement;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private bassFilter: BiquadFilterNode | null = null;
  private stereoPanner: StereoPannerNode | null = null;
  private analyser: AnalyserNode | null = null;
  private delayNode: DelayNode | null = null;
  private feedbackGain: GainNode | null = null;
  private wetGain: GainNode | null = null;

  private dspState: DSPState = {
    bassBoostDb: 0,
    slowedReverb: false,
    nightcore: false,
    eightD: false,
  };

  private lfoAngle = 0;
  private animationFrameId: number | null = null;
  private fftData: Uint8Array = new Uint8Array(0);

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

    // Create Delay / Reverb network for Slowed + Reverb
    this.delayNode = this.ctx.createDelay();
    this.delayNode.delayTime.setValueAtTime(0.35, this.ctx.currentTime);

    this.feedbackGain = this.ctx.createGain();
    this.feedbackGain.gain.setValueAtTime(0.4, this.ctx.currentTime);

    this.wetGain = this.ctx.createGain();
    this.wetGain.gain.setValueAtTime(0, this.ctx.currentTime); // disabled by default

    // Delay loop
    this.delayNode.connect(this.feedbackGain);
    this.feedbackGain.connect(this.delayNode);
    this.delayNode.connect(this.wetGain);

    // Create 8D Audio Stereo Panner
    if (typeof this.ctx.createStereoPanner === 'function') {
      this.stereoPanner = this.ctx.createStereoPanner();
    }

    // Create FFT Analyser Node
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 128; // 64 frequency bins
    this.analyser.smoothingTimeConstant = 0.8;
    this.fftData = new Uint8Array(this.analyser.frequencyBinCount);

    // Connect Audio Graph:
    // Source -> BassFilter -> (StereoPanner / Direct) -> Analyser -> Destination
    //                       -> Delay -> WetGain -----^
    this.sourceNode.connect(this.bassFilter);

    let lastNode: AudioNode = this.bassFilter;

    // Connect Delay
    this.bassFilter.connect(this.delayNode);
    this.wetGain.connect(this.analyser);

    if (this.stereoPanner) {
      lastNode.connect(this.stereoPanner);
      lastNode = this.stereoPanner;
    }

    lastNode.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    this.startLfoLoop();
  }

  public async loadAudio(source: string | File | Blob) {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    if (typeof source === 'string') {
      this.audioEl.src = source;
    } else {
      const url = URL.createObjectURL(source);
      this.audioEl.src = url;
    }
    this.audioEl.load();
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
        this.wetGain.gain.setValueAtTime(0.5, this.ctx.currentTime);
      }
    } else {
      if (!this.dspState.nightcore) {
        this.audioEl.playbackRate = 1.0;
      }
      if (this.wetGain && this.ctx) {
        this.wetGain.gain.setValueAtTime(0, this.ctx.currentTime);
      }
    }
  }

  public setNightcore(active: boolean) {
    this.dspState.nightcore = active;
    if (active) {
      this.dspState.slowedReverb = false;
      if (this.wetGain && this.ctx) {
        this.wetGain.gain.setValueAtTime(0, this.ctx.currentTime);
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
    if (!active && this.stereoPanner && this.ctx) {
      this.stereoPanner.pan.setValueAtTime(0, this.ctx.currentTime);
    }
  }

  public getDSPState(): DSPState {
    return { ...this.dspState };
  }

  private startLfoLoop() {
    const update = () => {
      if (this.dspState.eightD && this.stereoPanner && this.ctx) {
        this.lfoAngle += 0.02;
        const panValue = Math.sin(this.lfoAngle); // oscillates between -1 and +1
        this.stereoPanner.pan.setValueAtTime(panValue, this.ctx.currentTime);
      }
      if (typeof requestAnimationFrame === 'function') {
        this.animationFrameId = requestAnimationFrame(update);
      }
    };
    if (typeof requestAnimationFrame === 'function') {
      this.animationFrameId = requestAnimationFrame(update);
    }
  }

  public getFrequencyData(): FrequencyData {
    const binCount = 64;
    const spectrum = new Float32Array(binCount);

    if (this.analyser && this.fftData.length > 0) {
      this.analyser.getByteFrequencyData(this.fftData);

      const maxLen = Math.min(binCount, this.fftData.length);
      for (let i = 0; i < maxLen; i++) {
        spectrum[i] = this.fftData[i] / 255.0;
      }
    }

    // Partition into Bass (0-10), Mid (11-35), High (36-63)
    let bassSum = 0;
    let midSum = 0;
    let highSum = 0;
    let totalSum = 0;

    for (let i = 0; i < 10; i++) {
      bassSum += spectrum[i];
    }
    for (let i = 10; i < 35; i++) {
      midSum += spectrum[i];
    }
    for (let i = 35; i < 64; i++) {
      highSum += spectrum[i];
    }
    for (let i = 0; i < 64; i++) {
      totalSum += spectrum[i];
    }

    const bass = bassSum / 10;
    const mid = midSum / 25;
    const high = highSum / 29;
    const rms = Math.sqrt(totalSum / 64);
    const beat = bass > 0.65 ? bass * 1.2 : bass * 0.8;

    return {
      bass,
      mid,
      high,
      beat,
      rms,
      spectrum,
    };
  }

  public dispose() {
    if (this.animationFrameId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.animationFrameId);
    }
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
  }
}
