/*
Portions derived from Avee Open Player 1.0.34 (https://github.com/Azy-Kun/AveeOpenPlayer_1.0.34, commit c909d8b50dcabb5d2b54dc1bfd72f9431cdd7af6), Copyright 2019 Avee Player, licensed under the Apache License, Version 2.0. Modified: ported from Java to TypeScript and adapted to OpenViz.
*/

import { FrequencyData } from '../types';
import { FFT } from './fft';

export interface AveeClassicOptions {
  sampleRate: number;
  sampleInCountPower?: number; // default 9 (512 samples)
  barsCount?: number; // default 64
  loFreq?: number; // default 20.0
  hiFreq?: number; // default 18000.0
  frameRate?: number; // default 60
}

/**
 * Ported from SegmentAudioSpectrumData.java, DspCurves.java, and DspWindows.java
 */
export class AveeClassicAnalyzer {
  private sampleRate: number;
  private sampleInCountPower: number = 9;
  private dataCount: number = 512;
  private barsCount: number = 64;
  private loFreq: number = 20.0;
  private hiFreq: number = 18000.0;
  private frameRate: number = 60;

  private barFreq: Float32Array;
  private barValues: Float32Array;
  private barSmoothValues: Float32Array;
  private fftMag: Float64Array;

  // Smoothing & range parameters from SegmentAudioSpectrumData.java lines 39-48
  private readonly smoothFactorInc = 0.6; // SegmentAudioSpectrumData.java line 39
  private readonly smoothFactor = 0.6; // SegmentAudioSpectrumData.java line 40
  private readonly rangeTarget = 50.0; // SegmentAudioSpectrumData.java line 41
  private readonly rangeSmoothFactor = 0.1; // SegmentAudioSpectrumData.java line 42

  private rangeHiSmooth = 0.0; // SegmentAudioSpectrumData.java line 46
  private rangeLoSmooth = 0.0; // SegmentAudioSpectrumData.java line 47
  private windowedRms = 0.0; // SegmentAudioSpectrumData.java line 45

  private datamode = 0; // SegmentAudioSpectrumData.java line 30

  // Existing deterministic beat detector state (OpenViz)
  private fluxHistory: Float32Array;
  private fluxHistoryCapacity: number;
  private fluxHistoryCount: number = 0;
  private fluxHistoryHead: number = 0;
  private prevBassBandsRaw: Float32Array;
  private bassBandIndices: number[] = [];
  private beatEnvelope: number = 0;
  private frameCounter: number = 0;

  constructor(options: AveeClassicOptions) {
    this.sampleRate = options.sampleRate;
    this.frameRate = options.frameRate ?? 60;

    this.setSampleInCountPower(options.sampleInCountPower ?? 9);

    this.barsCount = options.barsCount ?? 64;
    this.loFreq = options.loFreq ?? 20.0;
    this.hiFreq = options.hiFreq ?? 18000.0;

    this.barFreq = new Float32Array(this.barsCount);
    this.barValues = new Float32Array(this.barsCount);
    this.barSmoothValues = new Float32Array(this.barsCount);
    this.fftMag = new Float64Array(this.dataCount);

    this.updateBandsFreq(this.barsCount, this.loFreq, this.hiFreq);

    // Initialize beat detector indices based on band frequencies (20 Hz .. 250 Hz)
    for (let i = 0; i < this.barsCount; i++) {
      const freq = this.barFreq[i];
      if (freq >= 20 && freq <= 250) {
        this.bassBandIndices.push(i);
      }
    }

    this.fluxHistoryCapacity = Math.max(1, Math.round(this.frameRate));
    this.fluxHistory = new Float32Array(this.fluxHistoryCapacity);
    this.prevBassBandsRaw = new Float32Array(this.barsCount);
  }

  // SegmentAudioSpectrumData.java line 55
  public setSampleInCountPower(sampleInCountPower: number): void {
    this.sampleInCountPower = sampleInCountPower;
    // SegmentAudioSpectrumData.java line 57
    this.dataCount = Math.min(Math.max(1 << sampleInCountPower, 32), 1024);
  }

  // DspWindows.java line 20
  public static hannWindow(n: number, N: number): number {
    return 0.5 * (1.0 - Math.cos((2.0 * Math.PI * n) / (N - 1)));
  }

  // DspCurves.java line 25
  public static freqd(index: number, count: number, sampleRate: number): number {
    return (index + 1) * (sampleRate / count);
  }

  // DspCurves.java line 43
  public static myAWeight(freq: number): number {
    const f2 = freq * freq;
    const f4 = freq * freq * freq * freq;

    const c12200 = 12200.0 * 12200.0;
    const c206 = 20.6 * 20.6;
    const c177 = 107.7 * 107.7;
    const c7379 = 737.9 * 737.9;

    let Ra = c12200 * f4;
    Ra = Ra / ((f2 + c206) * (f2 + c12200) * Math.sqrt(f2 + c177) * Math.sqrt(f2 + c7379));

    return Ra;
  }

  // SegmentAudioSpectrumData.java line 204
  public updateBandsFreq(bandCount: number, loFreq: number, hiFreq: number): void {
    const freqScaleOff = 800.0; // line 206

    // SegmentAudioSpectrumData.java line 208
    const step = (Math.log(hiFreq / (loFreq + freqScaleOff)) / bandCount) / Math.log(2.0);
    this.barFreq[0] = loFreq + freqScaleOff;
    const stepMul = Math.pow(2.0, step);
    for (let i = 1; i < bandCount; ++i) {
      this.barFreq[i] = this.barFreq[i - 1] * stepMul * 1.0;
      this.barFreq[i - 1] += -freqScaleOff;
    }
  }

  public getBarFreqs(): Float32Array {
    return this.barFreq;
  }

  public reset(): void {
    this.barValues.fill(0);
    this.barSmoothValues.fill(0);
    this.fftMag.fill(0);
    this.rangeHiSmooth = 0;
    this.rangeLoSmooth = 0;
    this.windowedRms = 0;

    this.fluxHistory.fill(0);
    this.fluxHistoryCount = 0;
    this.fluxHistoryHead = 0;
    this.prevBassBandsRaw.fill(0);
    this.beatEnvelope = 0;
    this.frameCounter = 0;
  }

  // SegmentAudioSpectrumData.java line 80 (process)
  public analyze(samples: Float32Array): FrequencyData {
    this.frameCounter++;
    const N = this.dataCount;

    if (this.barValues.length !== this.barsCount) {
      this.barValues = new Float32Array(this.barsCount);
    }
    if (this.barSmoothValues.length !== this.barValues.length) {
      this.barSmoothValues = new Float32Array(this.barValues.length);
    }

    const realBuf = new Float64Array(N);
    const imagBuf = new Float64Array(N);

    let windowedRmsAvg = 0.0;

    // SegmentAudioSpectrumData.java lines 98-106
    for (let i = 0; i < N; i++) {
      const signal = i < samples.length ? samples[i] : 0.0;
      const multiplier = AveeClassicAnalyzer.hannWindow(i, N);
      const val = (signal / 1.0) * multiplier;
      windowedRmsAvg += val * val;
      realBuf[i] = val;
      imagBuf[i] = 0.0;
    }

    // SegmentAudioSpectrumData.java lines 108-110
    if (N > 0) {
      windowedRmsAvg = Math.sqrt(windowedRmsAvg / N);
    }
    this.windowedRms = windowedRmsAvg;

    // FFT transform using existing FFT class
    const fft = FFT.get(N);
    fft.transform(realBuf, imagBuf);

    const rangeOut = new Float32Array(2);
    this.fillBarValues(this.barValues, realBuf, imagBuf, N, this.sampleRate, rangeOut);

    // SegmentAudioSpectrumData.java lines 118-122
    const rangeMax = 1000.0;
    if (rangeOut[0] < -rangeMax) rangeOut[0] = -rangeMax;
    if (rangeOut[0] > rangeMax) rangeOut[0] = rangeMax;
    if (rangeOut[1] < -rangeMax) rangeOut[1] = -rangeMax;
    if (rangeOut[1] > rangeMax) rangeOut[1] = rangeMax;

    // SegmentAudioSpectrumData.java lines 124-125
    this.rangeLoSmooth = this.rangeLoSmooth * (1.0 - this.rangeSmoothFactor) + rangeOut[0] * this.rangeSmoothFactor;
    this.rangeHiSmooth = this.rangeHiSmooth * (1.0 - this.rangeSmoothFactor) + rangeOut[1] * this.rangeSmoothFactor;

    // SegmentAudioSpectrumData.java lines 127-129
    let rangeMul = this.rangeHiSmooth - this.rangeLoSmooth;
    if (rangeMul < 1.0) rangeMul = 1.0;
    rangeMul = this.rangeTarget / rangeMul;

    // SegmentAudioSpectrumData.java lines 131-144
    for (let j = 0; j < this.barValues.length; j++) {
      let val = this.barValues[j];

      if (this.datamode === 3) {
        val = (val - this.rangeLoSmooth) * rangeMul;
      } else {
        val = (val - this.rangeLoSmooth) * 15.0;
      }

      if (val > this.barSmoothValues[j]) {
        this.barSmoothValues[j] = this.barSmoothValues[j] * (1.0 - this.smoothFactorInc) + val * this.smoothFactorInc;
      } else {
        this.barSmoothValues[j] = this.barSmoothValues[j] * (1.0 - this.smoothFactor) + val * this.smoothFactor;
      }
    }

    // Prepare spectrum output (clamped to [0,1])
    const spectrum = new Float32Array(this.barsCount);
    for (let i = 0; i < this.barsCount; i++) {
      spectrum[i] = Math.max(0, Math.min(1, this.barSmoothValues[i]));
    }

    // Derive bass / mid / high from band centers
    let bassSum = 0, bassCount = 0;
    let midSum = 0, midCount = 0;
    let highSum = 0, highCount = 0;

    for (let b = 0; b < this.barsCount; b++) {
      const f = this.barFreq[b];
      const val = spectrum[b];
      if (f >= 20 && f <= 250) {
        bassSum += val;
        bassCount++;
      }
      if (f >= 250 && f <= 4000) {
        midSum += val;
        midCount++;
      }
      if (f >= 4000 && f <= 18000) {
        highSum += val;
        highCount++;
      }
    }

    const bass = bassCount > 0 ? Math.max(0, Math.min(1, bassSum / bassCount)) : 0;
    const mid = midCount > 0 ? Math.max(0, Math.min(1, midSum / midCount)) : 0;
    const high = highCount > 0 ? Math.max(0, Math.min(1, highSum / highCount)) : 0;

    // Deterministic beat detection (matching SpectrumAnalyzer)
    let flux = 0;
    for (const b of this.bassBandIndices) {
      const currentRaw = this.barValues[b];
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

    // RMS from SegmentAudioSpectrumData.java line 199: windowedRms * 2.0
    const rmsVal = Math.max(0, Math.min(1, this.windowedRms * 2.0));

    return {
      bass,
      mid,
      high,
      beat,
      beatRandomShake,
      constantShake,
      rms: rmsVal,
      spectrum,
    };
  }

  // SegmentAudioSpectrumData.java line 147 (fillBarValues)
  private fillBarValues(
    barVals: Float32Array,
    realBuf: Float64Array,
    imagBuf: Float64Array,
    fftSize: number,
    samplingRate: number,
    rangeOut: Float32Array
  ): void {
    if (barVals.length < 4) return;

    rangeOut[0] = 9999990.0; // lo - SegmentAudioSpectrumData.java line 150
    rangeOut[1] = -9999990.0; // hi - SegmentAudioSpectrumData.java line 151

    for (let i = 0; i < barVals.length; i++) {
      barVals[i] = 0.0;
    }

    if (this.fftMag.length !== fftSize) {
      this.fftMag = new Float64Array(fftSize);
    }

    // SegmentAudioSpectrumData.java lines 158-173
    for (let j = 0; j < fftSize; j++) {
      const mag = Math.sqrt(realBuf[j] * realBuf[j] + imagBuf[j] * imagBuf[j]);

      let weight: number;
      if (this.datamode === 0) {
        const freq = AveeClassicAnalyzer.freqd(j, fftSize * 0.5, samplingRate);
        weight = AveeClassicAnalyzer.myAWeight(freq);
      } else {
        const freq = AveeClassicAnalyzer.freqd(j, fftSize, samplingRate);
        weight = AveeClassicAnalyzer.myAWeight(freq);
      }

      this.fftMag[j] = mag * weight;
    }

    // SegmentAudioSpectrumData.java lines 176-203
    const df = samplingRate / fftSize;
    const valMul = (2.0 / samplingRate) * 200.0;

    let fftBinIndx = 0;
    let barIndx = 0;
    let freqLast = 0.0;
    let freqMultiplier: number;

    while (fftBinIndx <= Math.floor(fftSize / 2) && barIndx < barVals.length) {
      const freqLin = (fftBinIndx + 0.5) * df;
      const freqLog = this.barFreq[barIndx];
      const fftBinI = fftBinIndx;
      const barI = barIndx;

      if (freqLin <= freqLog) {
        freqMultiplier = freqLin - freqLast;
        freqLast = freqLin;
        fftBinIndx += 1;
      } else {
        freqMultiplier = freqLog - freqLast;
        freqLast = freqLog;
        barIndx += 1;
      }

      barVals[barI] += freqMultiplier * this.fftMag[fftBinI] * valMul;
    }

    // Quick fix - SegmentAudioSpectrumData.java lines 205-207
    barVals[0] = Math.min(barVals[0], barVals[1]);
    barVals[barVals.length - 1] = Math.min(barVals[barVals.length - 1], barVals[barVals.length - 2]);

    // SegmentAudioSpectrumData.java lines 209-218
    for (let i = 0; i < barVals.length; i++) {
      barVals[i] = barVals[i] * 2.0;

      if (barVals[i] < rangeOut[0]) rangeOut[0] = barVals[i];
      if (barVals[i] > rangeOut[1]) rangeOut[1] = barVals[i];
    }
  }
}
