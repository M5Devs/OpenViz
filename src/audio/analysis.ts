/*
 * Frequency distribution and DSP spectrum analysis algorithms adapted from:
 * Azy-Kun/AveeOpenPlayer_1.0.34 (Apache License 2.0)
 * https://github.com/Azy-Kun/AveeOpenPlayer_1.0.34
 */

export function logSpace(minFreq: number, maxFreq: number, index: number, total: number, linearFactor: number): number {
  if (total <= 0) return minFreq;
  const centerFreq = minFreq * Math.pow(maxFreq / minFreq, index / total);
  const linFreq = minFreq + (maxFreq - minFreq) * (index / total);
  return centerFreq * (1.0 - linearFactor) + linFreq * linearFactor;
}

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
  attackSmoothing?: number;
  decaySmoothing?: number;
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
  private attackSmoothing: number;
  private decaySmoothing: number;
  private frameRate: number;

  private fft: FFT;
  private windowSum: number;

  private window: Float32Array;
  private realBuf: Float32Array;
  private imagBuf: Float32Array;
  private magBuf: Float32Array;
  private bandRawBuf: Float32Array;
  private bandPrevBuf: Float32Array;
  private spectrumBuf: Float32Array;

  private bandEdgesBins: Float32Array;
  private bandCenterHz: Float32Array;

  private fluxHistory: Float32Array;
  private fluxHistoryCapacity: number;
  private fluxHistoryCount: number = 0;
  private fluxHistoryHead: number = 0;
  private prevBassBandsRaw: Float32Array;
  private bassBandIndices: number[] = [];
  private beatEnvelope: number = 0;

  private frameCounter: number = 0;

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
    if (options.smoothing === 0) {
      this.attackSmoothing = 1.0;
      this.decaySmoothing = 1.0;
    } else {
      this.attackSmoothing = options.attackSmoothing ?? 0.60;
      this.decaySmoothing = options.decaySmoothing ?? 0.15;
    }
    this.frameRate = options.frameRate ?? 60;

    this.fft = FFT.get(this.fftSize);

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

    this.realBuf = new Float32Array(this.fftSize);
    this.imagBuf = new Float32Array(this.fftSize);
    this.magBuf = new Float32Array(nyquistBins + 1);
    this.bandRawBuf = new Float32Array(this.bandsCount);
    this.bandPrevBuf = new Float32Array(this.bandsCount);
    this.spectrumBuf = new Float32Array(this.bandsCount);

    this.bandEdgesBins = new Float32Array(this.bandsCount + 1);
    this.bandCenterHz = new Float32Array(this.bandsCount);

    const minHz = Math.max(1e-4, this.lowHz);
    const maxHz = Math.min(nyquist, this.highHz);

    const edgesHz: number[] = [];
    for (let i = 0; i <= this.bandsCount; i++) {
      const blendedHz = logSpace(minHz, maxHz, i, this.bandsCount, this.linearMix);
      edgesHz.push(blendedHz);
      this.bandEdgesBins[i] = Math.round((blendedHz * this.fftSize) / this.sampleRate);
    }

    for (let i = 0; i < this.bandsCount; i++) {
      const centerHz = Math.sqrt(edgesHz[i] * edgesHz[i + 1]);
      this.bandCenterHz[i] = centerHz;

      if (centerHz >= 20 && centerHz <= 250) {
        this.bassBandIndices.push(i);
      }
    }

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
    this.frameCounter = 0;
  }

  public analyze(samples: Float32Array): FrequencyData {
    this.frameCounter++;
    const N = this.fftSize;
    const nyquistBins = N / 2;

    let sumSq = 0;
    const len = Math.min(samples.length, N);
    for (let i = 0; i < len; i++) {
      const s = samples[i];
      sumSq += s * s;
    }
    const rawRms = Math.sqrt(sumSq / (len || 1));
    const rmsDb = 20 * Math.log10(Math.max(1e-6, rawRms));
    const rmsVal = Math.max(0, Math.min(1, (rmsDb + 60) / 60));

    this.realBuf.fill(0);
    this.imagBuf.fill(0);
    for (let i = 0; i < len; i++) {
      this.realBuf[i] = samples[i] * this.window[i];
    }

    this.fft.transform(this.realBuf, this.imagBuf);

    const norm = 2.0 / (this.windowSum || 1);
    for (let k = 0; k <= nyquistBins; k++) {
      const re = this.realBuf[k];
      const im = this.imagBuf[k];
      const mag = Math.sqrt(re * re + im * im) * norm;
      this.magBuf[k] = mag;
    }

    for (let b = 0; b < this.bandsCount; b++) {
      const startBin = this.bandEdgesBins[b];
      const endBin = this.bandEdgesBins[b + 1];
      const centerHz = this.bandCenterHz[b];

      let rawAmp = 0;
      if (endBin > startBin) {
        let binSumSq = 0;
        let count = 0;
        const minK = Math.max(0, Math.min(nyquistBins, startBin));
        const maxK = Math.max(0, Math.min(nyquistBins, endBin - 1));
        for (let k = minK; k <= maxK; k++) {
          const m = this.magBuf[k];
          binSumSq += m * m;
          count++;
        }
        rawAmp = count > 0 ? Math.sqrt(binSumSq / count) : 0;
      } else {
        const k0 = Math.max(0, Math.min(nyquistBins, startBin));
        rawAmp = this.magBuf[k0];
      }

      if (this.tiltDbPerOct !== 0 && centerHz > 0) {
        const oct = Math.log2(centerHz / 1000);
        const tiltFactor = Math.pow(10, (this.tiltDbPerOct * oct) / 20);
        rawAmp *= tiltFactor;
      }

      const db = 20 * Math.log10(Math.max(1e-6, rawAmp));
      const normalized = Math.max(0, Math.min(1, (db + this.dbRange) / this.dbRange));

      this.bandRawBuf[b] = normalized;

      const prevSmoothed = this.bandPrevBuf[b];
      let smoothed: number;
      if (normalized > prevSmoothed) {
        smoothed = prevSmoothed + this.attackSmoothing * (normalized - prevSmoothed);
      } else {
        smoothed = prevSmoothed + this.decaySmoothing * (normalized - prevSmoothed);
      }

      this.bandPrevBuf[b] = smoothed;
      this.spectrumBuf[b] = smoothed;
    }

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

    if (instantBeat > this.beatEnvelope) {
      this.beatEnvelope = instantBeat;
    } else {
      this.beatEnvelope *= 0.85;
    }
    const beat = Math.max(0, Math.min(1, this.beatEnvelope));

    const pseudoRandom = Math.sin(this.frameCounter * 12.9898 + 78.233);
    const beatRandomShake = beat * pseudoRandom;

    const tSec = this.frameCounter / this.frameRate;
    const constantShake = Math.sin(tSec * 2.5) * 0.5 + Math.cos(tSec * 5.7) * 0.5;

    return {
      bass,
      mid,
      high,
      beat,
      beatRandomShake,
      constantShake,
      rms: rmsVal,
      spectrum: this.spectrumBuf,
    };
  }
}
