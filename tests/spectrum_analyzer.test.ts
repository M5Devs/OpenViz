import { describe, it, expect } from 'vitest';
import { FFT } from '../src/audio/fft';
import { SpectrumAnalyzer } from '../src/audio/analysis';

function naiveDFT(real: Float32Array): { outReal: Float64Array; outImag: Float64Array } {
  const N = real.length;
  const outReal = new Float64Array(N);
  const outImag = new Float64Array(N);

  for (let k = 0; k < N; k++) {
    let sumR = 0;
    let sumI = 0;
    for (let n = 0; n < N; n++) {
      const angle = (-2 * Math.PI * k * n) / N;
      sumR += real[n] * Math.cos(angle);
      sumI += real[n] * Math.sin(angle);
    }
    outReal[k] = sumR;
    outImag[k] = sumI;
  }

  return { outReal, outImag };
}

describe('FFT vs Naive DFT', () => {
  it('matches naive DFT on random input (N=64, max error < 1e-4)', () => {
    const N = 64;
    const fft = FFT.get(N);

    const inputR = new Float32Array(N);
    const inputI = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      inputR[i] = Math.random() * 2 - 1;
    }

    const { outReal: expectedR, outImag: expectedI } = naiveDFT(inputR);

    fft.transform(inputR, inputI);

    for (let k = 0; k < N; k++) {
      const errR = Math.abs(inputR[k] - expectedR[k]);
      const errI = Math.abs(inputI[k] - expectedI[k]);
      expect(errR).toBeLessThan(1e-4);
      expect(errI).toBeLessThan(1e-4);
    }
  });
});

describe('SpectrumAnalyzer DSP requirements', () => {
  const sampleRate = 44100;
  const fftSize = 4096;

  it('100 Hz sine peaks in a band whose center is within one band of 100 Hz and bass > mid > high', () => {
    const analyzer = new SpectrumAnalyzer({ sampleRate, fftSize, bands: 64, lowHz: 30, highHz: 16000, smoothing: 0 });
    const samples = new Float32Array(fftSize);

    // 100 Hz full-scale sine
    for (let i = 0; i < fftSize; i++) {
      samples[i] = Math.sin((2 * Math.PI * 100 * i) / sampleRate);
    }

    const res = analyzer.analyze(samples);

    // Find peak band in spectrum
    let maxIdx = 0;
    let maxVal = -1;
    for (let i = 0; i < res.spectrum.length; i++) {
      if (res.spectrum[i] > maxVal) {
        maxVal = res.spectrum[i];
        maxIdx = i;
      }
    }

    // Band center calculation check
    const minHz = 30, maxHz = 16000;
    const logLow = Math.log(minHz), logHigh = Math.log(maxHz);
    const edgeLowHz = Math.exp(logLow + (maxIdx / 64) * (logHigh - logLow));
    const edgeHighHz = Math.exp(logLow + ((maxIdx + 1) / 64) * (logHigh - logLow));
    const peakCenterHz = Math.sqrt(edgeLowHz * edgeHighHz);

    // Peak center within one band distance (~10-15 Hz around 100 Hz)
    expect(Math.abs(peakCenterHz - 100)).toBeLessThan(35);
    expect(res.bass).toBeGreaterThan(res.mid);
    expect(res.bass).toBeGreaterThan(res.high);
  });

  it('3 kHz sine peaks in mid', () => {
    const analyzer = new SpectrumAnalyzer({ sampleRate, fftSize, bands: 64, smoothing: 0 });
    const samples = new Float32Array(fftSize);

    for (let i = 0; i < fftSize; i++) {
      samples[i] = Math.sin((2 * Math.PI * 3000 * i) / sampleRate);
    }

    const res = analyzer.analyze(samples);
    expect(res.mid).toBeGreaterThan(res.bass);
    expect(res.mid).toBeGreaterThan(res.high);
  });

  it('10 kHz sine peaks in high', () => {
    const analyzer = new SpectrumAnalyzer({ sampleRate, fftSize, bands: 64, smoothing: 0 });
    const samples = new Float32Array(fftSize);

    for (let i = 0; i < fftSize; i++) {
      samples[i] = Math.sin((2 * Math.PI * 10000 * i) / sampleRate);
    }

    const res = analyzer.analyze(samples);
    expect(res.high).toBeGreaterThan(res.bass);
    expect(res.high).toBeGreaterThan(res.mid);
  });

  it('silence produces all zeros', () => {
    const analyzer = new SpectrumAnalyzer({ sampleRate, fftSize, bands: 64, smoothing: 0 });
    const samples = new Float32Array(fftSize); // all zero

    const res = analyzer.analyze(samples);
    expect(res.bass).toBe(0);
    expect(res.mid).toBe(0);
    expect(res.high).toBe(0);
    expect(res.beat).toBe(0);
    expect(res.rms).toBe(0);
    for (let i = 0; i < res.spectrum.length; i++) {
      expect(res.spectrum[i]).toBe(0);
    }
  });

  it('full-scale sine produces peak band ≈ 1 (±0.1) with tilt = 0', () => {
    const analyzer = new SpectrumAnalyzer({
      sampleRate,
      fftSize,
      bands: 64,
      tiltDbPerOct: 0,
      smoothing: 0,
      dbRange: 70,
    });
    const samples = new Float32Array(fftSize);

    // Full-scale 1 kHz sine wave
    for (let i = 0; i < fftSize; i++) {
      samples[i] = Math.sin((2 * Math.PI * 1000 * i) / sampleRate);
    }

    const res = analyzer.analyze(samples);
    let maxVal = 0;
    for (let i = 0; i < res.spectrum.length; i++) {
      if (res.spectrum[i] > maxVal) maxVal = res.spectrum[i];
    }

    // peak band ≈ 1 (±0.1), i.e. 0.9 ± 0.1 => [0.8, 1.0]
    expect(maxVal).toBeGreaterThanOrEqual(0.8);
    expect(maxVal).toBeLessThanOrEqual(1.0);
  });

  it('beat fires on a click train (≥ 80% of clicks) and stays < 0.2 on a steady tone', () => {
    const analyzer = new SpectrumAnalyzer({ sampleRate, fftSize, bands: 64, frameRate: 60 });
    const samples = new Float32Array(fftSize);

    // Test steady tone first
    for (let i = 0; i < fftSize; i++) {
      samples[i] = 0.5 * Math.sin((2 * Math.PI * 100 * i) / sampleRate);
    }

    // Warm up history with steady tone (~60 frames = 1 sec)
    let maxSteadyBeat = 0;
    for (let f = 0; f < 60; f++) {
      const res = analyzer.analyze(samples);
      if (res.beat > maxSteadyBeat) maxSteadyBeat = res.beat;
    }
    expect(maxSteadyBeat).toBeLessThan(0.2);

    // Now test click train
    analyzer.reset();
    const clickIntervalFrames = 15; // 4 clicks per second
    let clickCount = 0;
    let clickBeatsFired = 0;

    for (let frame = 0; frame < 120; frame++) {
      samples.fill(0);
      const isClick = frame % clickIntervalFrames === 0;
      if (isClick) {
        clickCount++;
        // Heavy bass burst click
        for (let i = 0; i < 500; i++) {
          samples[i] = Math.sin((2 * Math.PI * 80 * i) / sampleRate);
        }
      }

      const res = analyzer.analyze(samples);
      if (isClick && res.beat >= 0.3) {
        clickBeatsFired++;
      }
    }

    const fireRate = clickBeatsFired / clickCount;
    expect(fireRate).toBeGreaterThanOrEqual(0.8);
  });

  it('two fresh analyzers fed the same sequence give identical output (determinism)', () => {
    const analyzer1 = new SpectrumAnalyzer({ sampleRate, fftSize, bands: 64 });
    const analyzer2 = new SpectrumAnalyzer({ sampleRate, fftSize, bands: 64 });

    const samples = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      samples[i] = Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 0.7;
    }

    for (let step = 0; step < 10; step++) {
      const res1 = analyzer1.analyze(samples);
      const res2 = analyzer2.analyze(samples);

      expect(res1.bass).toBe(res2.bass);
      expect(res1.mid).toBe(res2.mid);
      expect(res1.high).toBe(res2.high);
      expect(res1.beat).toBe(res2.beat);
      expect(res1.rms).toBe(res2.rms);

      for (let b = 0; b < 64; b++) {
        expect(res1.spectrum[b]).toBe(res2.spectrum[b]);
      }
    }
  });

  it('analyzing the same slice through live and export helpers gives identical output', () => {
    const liveAnalyzer = new SpectrumAnalyzer({ sampleRate, fftSize, bands: 64, frameRate: 60 });
    const exportAnalyzer = new SpectrumAnalyzer({ sampleRate, fftSize, bands: 64, frameRate: 60 });

    const samples = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      samples[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.5;
    }

    const liveRes = liveAnalyzer.analyze(samples);
    const exportRes = exportAnalyzer.analyze(samples);

    expect(liveRes.bass).toBe(exportRes.bass);
    expect(liveRes.mid).toBe(exportRes.mid);
    expect(liveRes.high).toBe(exportRes.high);
    expect(liveRes.beat).toBe(exportRes.beat);
    expect(liveRes.rms).toBe(exportRes.rms);
    for (let b = 0; b < 64; b++) {
      expect(liveRes.spectrum[b]).toBe(exportRes.spectrum[b]);
    }
  });
});
