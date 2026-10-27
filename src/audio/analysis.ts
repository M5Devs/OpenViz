import { FrequencyData } from '../types';
import { FFT } from './fft';

export interface SpectrumAnalyzerOptions {
  sampleRate: number;
  fftSize?: number;
  bands?: number;
  lowHz?: number;
  highHz?: number;
  linearMix?: number;
  tiltDbPerOct?: number;
  dbRange?: number;
  smoothing?: number;
  frameRate?: number;
}

export class SpectrumAnalyzer {
  private sampleRate: number;
  private fftSize: number;
  private bandsCount: number;
  private lowHz: number;
  private highHz: number;
  private linearMix: number;
  private tiltDbPerOct: number;
  private dbRange: number;
  private smoothing: number;
  private frameRate: number;

  private fft: FFT;
  private windowSum: number;

  // Reused buffers (no allocations in analyze)
  private window: Float32Array;
  private realBuf: Float32Array;
  private imagBuf: Float32Array;
  private magBuf: Float32Array; // scaled linear amplitudes 0..N/2
  private bandRawBuf: Float32Array;
  private bandPrevBuf: Float32Array;
  private spectrumBuf: Float32Array;

  // Band edges and centers
  private bandEdgesBins: Float32Array; // length bandsCount + 1
  private bandCenterHz: Float32Array; // length bandsCount

  // Beat detection history buffer & state
  private fluxHistory: Float32Array;
  private fluxHistoryCapacity: number;
  private fluxHistoryCount: number = 0;
  private fluxHistoryHead: number = 0;
  private prevBassBandsRaw: Float32Array;
  private bassBandIndices: number[] = [];
  private beatEnvelope: number = 0;

  constructor(options: SpectrumAnalyzerOptions) {
    this.sampleRate = options.sampleRate;
    this.fftSize = options.fftSize ?? 4096;
    this.bandsCount = options.bands ?? 64;
    this.lowHz = options.lowHz ?? 30;
    this.highHz = options.highHz ?? 16000;
    this.linearMix = options.linearMix ?? 0;
    this.tiltDbPerOct = options.tiltDbPerOct ?? 3;
    this.dbRange = options.dbRange ?? 80;
    this.smoothing = options.smoothing ?? 0.6;
    this.frameRate = options.frameRate ?? 60;

    this.fft = FFT.get(this.fftSize);

    // Precompute Hann window and window sum
    this.window = new Float32Array(this.fftSize);
    let sum = 0;
    for (let i = 0; i < this.fftSize; i++) {
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / this.fftSize));
      this.window[i] = w;
      sum += w;
    }
    this.windowSum = sum;

    const nyquist = this.sampleRate / 2;
    const nyquistBins = this.fftSize / 2;

    // Allocate internal buffers
    this.realBuf = new Float32Array(this.fftSize);
    this.imagBuf = new Float32Array(this.fftSize);
    this.magBuf = new Float32Array(nyquistBins + 1);
    this.bandRawBuf = new Float32Array(this.bandsCount);
    this.bandPrevBuf = new Float32Array(this.bandsCount);
    this.spectrumBuf = new Float32Array(this.bandsCount);

    // Precompute band edges in Hz and fractional bin indices
    this.bandEdgesBins = new Float32Array(this.bandsCount + 1);
    this.bandCenterHz = new Float32Array(this.bandsCount);

    const minHz = Math.max(1e-4, this.lowHz);
    const maxHz = Math.min(nyquist, this.highHz);

    const logLow = Math.log(minHz);
    const logHigh = Math.log(maxHz);

    const edgesHz: number[] = [];
    for (let i = 0; i <= this.bandsCount; i++) {
      const frac = i / this.bandsCount;
      const logHz = Math.exp(logLow + frac * (logHigh - logLow));
      const linHz = minHz + frac * (maxHz - minHz);
      const blendedHz = (1 - this.linearMix) * logHz + this.linearMix * linHz;
      edgesHz.push(blendedHz);
      // convert Hz to fractional bin k = f * fftSize / sampleRate
      this.bandEdgesBins[i] = (blendedHz * this.fftSize) / this.sampleRate;
    }

    for (let i = 0; i < this.bandsCount; i++) {
      const centerHz = Math.sqrt(edgesHz[i] * edgesHz[i + 1]);
      this.bandCenterHz[i] = centerHz;

      if (centerHz >= 20 && centerHz <= 250) {
        this.bassBandIndices.push(i);
      }
    }

    // Allocate history for beat detection (~1 second history)
    this.fluxHistoryCapacity = Math.max(1, Math.round(this.frameRate));
    this.fluxHistory = new Float32Array(this.fluxHistoryCapacity);
    this.prevBassBandsRaw = new Float32Array(this.bandsCount);
  }

  public reset(): void {
    this.bandRawBuf.fill(0);
    this.bandPrevBuf.fill(0);
    this.spectrumBuf.fill(0);
    this.fluxHistory.fill(0);
    this.fluxHistoryCount = 0;
    this.fluxHistoryHead = 0;
    this.prevBassBandsRaw.fill(0);
    this.beatEnvelope = 0;
  }

  public analyze(samples: Float32Array): FrequencyData {
    const N = this.fftSize;
    const nyquistBins = N / 2;

    // f. RMS from time-domain window (map -60..0 dBFS -> 0..1)
    let sumSq = 0;
    const len = Math.min(samples.length, N);
    for (let i = 0; i < len; i++) {
      const s = samples[i];
      sumSq += s * s;
    }
    const rawRms = Math.sqrt(sumSq / (len || 1));
    const rmsDb = 20 * Math.log10(Math.max(1e-6, rawRms)); // dBFS
    // Map [-60, 0] dBFS -> [0, 1]
    const rmsVal = Math.max(0, Math.min(1, (rmsDb + 60) / 60));

    // a. Hann windowing and real FFT setup
    this.realBuf.fill(0);
    this.imagBuf.fill(0);
    for (let i = 0; i < len; i++) {
      this.realBuf[i] = samples[i] * this.window[i];
    }

    // FFT
    this.fft.transform(this.realBuf, this.imagBuf);

    // Compute scaled linear magnitudes: 2 * |X[k]| / sum(window)
    const norm = 2.0 / (this.windowSum || 1);
    for (let k = 0; k <= nyquistBins; k++) {
      const re = this.realBuf[k];
      const im = this.imagBuf[k];
      const mag = Math.sqrt(re * re + im * im) * norm;
      this.magBuf[k] = mag;
    }

    // b & c & d. Compute bands, apply tilt, convert to dB -> [0,1]
    for (let b = 0; b < this.bandsCount; b++) {
      const startBin = this.bandEdgesBins[b];
      const endBin = this.bandEdgesBins[b + 1];
      const centerHz = this.bandCenterHz[b];

      let rawAmp = 0;
      if (endBin - startBin >= 1.0) {
        // RMS of bins inside [startBin, endBin]
        const minK = Math.max(0, Math.ceil(startBin));
        const maxK = Math.min(nyquistBins, Math.floor(endBin));
        let binSumSq = 0;
        let count = 0;
        for (let k = minK; k <= maxK; k++) {
          const m = this.magBuf[k];
          binSumSq += m * m;
          count++;
        }
        rawAmp = count > 0 ? Math.sqrt(binSumSq / count) : 0;
      } else {
        // Linear interpolation at band center bin
        const centerBin = (startBin + endBin) / 2;
        const k0 = Math.floor(centerBin);
        const k1 = Math.min(nyquistBins, k0 + 1);
        const frac = centerBin - k0;
        const m0 = k0 >= 0 && k0 <= nyquistBins ? this.magBuf[k0] : 0;
        const m1 = k1 >= 0 && k1 <= nyquistBins ? this.magBuf[k1] : 0;
        rawAmp = m0 + frac * (m1 - m0);
      }

      // c. Tilt: multiply by 10^(tilt * log2(f/1000) / 20)
      if (this.tiltDbPerOct !== 0 && centerHz > 0) {
        const oct = Math.log2(centerHz / 1000);
        const tiltFactor = Math.pow(10, (this.tiltDbPerOct * oct) / 20);
        rawAmp *= tiltFactor;
      }

      // d. Convert to dB and map [-dbRange, 0] -> [0, 1]
      const db = 20 * Math.log10(Math.max(1e-6, rawAmp));
      const normalized = Math.max(0, Math.min(1, (db + this.dbRange) / this.dbRange));

      this.bandRawBuf[b] = normalized;

      // e. Temporal smoothing: s = prev * smoothing + current * (1 - smoothing)
      const smoothed = this.bandPrevBuf[b] * this.smoothing + normalized * (1 - this.smoothing);
      this.bandPrevBuf[b] = smoothed;
      this.spectrumBuf[b] = smoothed;
    }

    // f. Region averages: bass (20-250 Hz), mid (250-4000 Hz), high (4000-16000 Hz)
    let bassSum = 0, bassCount = 0;
    let midSum = 0, midCount = 0;
    let highSum = 0, highCount = 0;

    for (let b = 0; b < this.bandsCount; b++) {
      const f = this.bandCenterHz[b];
      const val = this.spectrumBuf[b];
      if (f >= 20 && f <= 250) {
        bassSum += val;
        bassCount++;
      }
      if (f >= 250 && f <= 4000) {
        midSum += val;
        midCount++;
      }
      if (f >= 4000 && f <= 16000) {
        highSum += val;
        highCount++;
      }
    }

    const bass = bassCount > 0 ? Math.max(0, Math.min(1, bassSum / bassCount)) : 0;
    const mid = midCount > 0 ? Math.max(0, Math.min(1, midSum / midCount)) : 0;
    const high = highCount > 0 ? Math.max(0, Math.min(1, highSum / highCount)) : 0;

    // g. Beat detection via spectral flux on bass bands
    let flux = 0;
    for (const b of this.bassBandIndices) {
      const currentRaw = this.bandRawBuf[b];
      const prevRaw = this.prevBassBandsRaw[b];
      const diff = currentRaw - prevRaw;
      if (diff > 0) {
        flux += diff;
      }
      this.prevBassBandsRaw[b] = currentRaw;
    }

    // Adaptive threshold over history
    this.fluxHistory[this.fluxHistoryHead] = flux;
    this.fluxHistoryHead = (this.fluxHistoryHead + 1) % this.fluxHistoryCapacity;
    if (this.fluxHistoryCount < this.fluxHistoryCapacity) {
      this.fluxHistoryCount++;
    }

    let hSum = 0;
    for (let i = 0; i < this.fluxHistoryCount; i++) {
      hSum += this.fluxHistory[i];
    }
    const hMean = hSum / this.fluxHistoryCount;

    let hVarSum = 0;
    for (let i = 0; i < this.fluxHistoryCount; i++) {
      const dev = this.fluxHistory[i] - hMean;
      hVarSum += dev * dev;
    }
    const hStd = Math.sqrt(hVarSum / this.fluxHistoryCount);
    const threshold = hMean + 1.5 * hStd;

    let instantBeat = 0;
    if (flux > threshold && (flux - hMean) > 0.05) {
      const diff = flux - threshold;
      instantBeat = Math.min(1.0, diff * 3.0);
    }

    // Decay envelope for beat output
    if (instantBeat > this.beatEnvelope) {
      this.beatEnvelope = instantBeat;
    } else {
      this.beatEnvelope *= 0.85; // fast decay (~100ms)
    }
    const beat = Math.max(0, Math.min(1, this.beatEnvelope));

    return {
      bass,
      mid,
      high,
      beat,
      rms: rmsVal,
      spectrum: this.spectrumBuf,
    };
  }
}
