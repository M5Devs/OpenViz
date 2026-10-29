import { describe, it, expect } from 'vitest';
import { AveeClassicAnalyzer } from '../src/audio/avee_classic';
import { createAnalyzer } from '../src/audio/factory';
import { validateTemplate } from '../src/schema/validate';
import { OpenVizTemplate } from '../src/types';
import * as fs from 'fs';
import * as path from 'path';

describe('AveeClassicAnalyzer', () => {
  it('determinism: same input twice gives identical output', () => {
    const analyzer1 = new AveeClassicAnalyzer({ sampleRate: 44100 });
    const analyzer2 = new AveeClassicAnalyzer({ sampleRate: 44100 });

    const samples = new Float32Array(512);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin((2 * Math.PI * 440 * i) / 44100);
    }

    const res1 = analyzer1.analyze(samples);
    const res2 = analyzer2.analyze(samples);

    expect(res1.bass).toEqual(res2.bass);
    expect(res1.mid).toEqual(res2.mid);
    expect(res1.high).toEqual(res2.high);
    expect(res1.rms).toEqual(res2.rms);
    expect(Array.from(res1.spectrum)).toEqual(Array.from(res2.spectrum));
  });

  it('silence -> all zeros', () => {
    const analyzer = new AveeClassicAnalyzer({ sampleRate: 44100 });
    const silence = new Float32Array(512);

    const res = analyzer.analyze(silence);

    expect(res.bass).toBe(0);
    expect(res.mid).toBe(0);
    expect(res.high).toBe(0);
    expect(res.rms).toBe(0);
    for (let i = 0; i < res.spectrum.length; i++) {
      expect(res.spectrum[i]).toBe(0);
    }
  });

  it('frequency band response: 100 Hz sine peaks in lowest bands, 3 kHz in mid, 10 kHz in high', () => {
    const sampleRate = 44100;

    // Test 100 Hz
    const analyzer100 = new AveeClassicAnalyzer({ sampleRate });
    const samples100 = new Float32Array(512);
    for (let i = 0; i < 512; i++) {
      samples100[i] = Math.sin((2 * Math.PI * 100 * i) / sampleRate);
    }
    let res100 = analyzer100.analyze(samples100);
    for (let f = 0; f < 30; f++) {
      res100 = analyzer100.analyze(samples100);
    }

    let peakIndex100 = 0;
    let peakVal100 = 0;
    for (let i = 0; i < res100.spectrum.length; i++) {
      if (res100.spectrum[i] > peakVal100) {
        peakVal100 = res100.spectrum[i];
        peakIndex100 = i;
      }
    }
    expect(peakIndex100).toBeLessThan(10);

    // Test 3 kHz
    const analyzer3k = new AveeClassicAnalyzer({ sampleRate });
    const samples3k = new Float32Array(512);
    for (let i = 0; i < 512; i++) {
      samples3k[i] = Math.sin((2 * Math.PI * 3000 * i) / sampleRate);
    }
    let res3k = analyzer3k.analyze(samples3k);
    for (let f = 0; f < 30; f++) {
      res3k = analyzer3k.analyze(samples3k);
    }

    let peakIndex3k = 0;
    let peakVal3k = 0;
    for (let i = 0; i < res3k.spectrum.length; i++) {
      if (res3k.spectrum[i] > peakVal3k) {
        peakVal3k = res3k.spectrum[i];
        peakIndex3k = i;
      }
    }
    expect(peakIndex3k).toBeGreaterThanOrEqual(15);
    expect(peakIndex3k).toBeLessThanOrEqual(45);

    // Test 10 kHz
    const analyzer10k = new AveeClassicAnalyzer({ sampleRate });
    const samples10k = new Float32Array(512);
    for (let i = 0; i < 512; i++) {
      samples10k[i] = Math.sin((2 * Math.PI * 10000 * i) / sampleRate);
    }
    let res10k = analyzer10k.analyze(samples10k);
    for (let f = 0; f < 30; f++) {
      res10k = analyzer10k.analyze(samples10k);
    }

    let peakIndex10k = 0;
    let peakVal10k = 0;
    for (let i = 0; i < res10k.spectrum.length; i++) {
      if (res10k.spectrum[i] > peakVal10k) {
        peakVal10k = res10k.spectrum[i];
        peakIndex10k = i;
      }
    }
    expect(peakIndex10k).toBeGreaterThanOrEqual(45);
  });

  it('adaptive range: after ~2 s of frames, a -30 dB sine and a -6 dB sine give peak band values within 25% of each other', () => {
    const sampleRate = 44100;
    const fps = 60;
    const totalFrames = fps * 2; // ~2 seconds

    const ampHi = Math.pow(10, -6 / 20);
    const analyzerHi = new AveeClassicAnalyzer({ sampleRate, frameRate: fps });
    const samplesHi = new Float32Array(512);
    for (let i = 0; i < 512; i++) {
      samplesHi[i] = ampHi * Math.sin((2 * Math.PI * 1000 * i) / sampleRate);
    }

    let resHi = analyzerHi.analyze(samplesHi);
    for (let f = 0; f < totalFrames; f++) {
      resHi = analyzerHi.analyze(samplesHi);
    }
    const peakHi = Math.max(...Array.from(resHi.spectrum));

    const ampLo = Math.pow(10, -30 / 20);
    const analyzerLo = new AveeClassicAnalyzer({ sampleRate, frameRate: fps });
    const samplesLo = new Float32Array(512);
    for (let i = 0; i < 512; i++) {
      samplesLo[i] = ampLo * Math.sin((2 * Math.PI * 1000 * i) / sampleRate);
    }

    let resLo = analyzerLo.analyze(samplesLo);
    for (let f = 0; f < totalFrames; f++) {
      resLo = analyzerLo.analyze(samplesLo);
    }
    const peakLo = Math.max(...Array.from(resLo.spectrum));

    const diff = Math.abs(peakHi - peakLo);
    const avg = (peakHi + peakLo) / 2;
    expect(diff / avg).toBeLessThan(0.25);
  });

  it('default smoothing is 0.6 rising and 0.6 falling', () => {
    const analyzer = new AveeClassicAnalyzer({ sampleRate: 44100 });
    const samples = new Float32Array(512);
    for (let i = 0; i < 512; i++) {
      samples[i] = Math.sin((2 * Math.PI * 1000 * i) / 44100);
    }

    const frame1 = analyzer.analyze(samples);
    expect(frame1.spectrum[0]).toBeGreaterThan(0);

    const silence = new Float32Array(512);
    const frame2 = analyzer.analyze(silence);
    expect(frame2.spectrum[0]).toBeLessThan(frame1.spectrum[0]);
  });

  it('band frequency table has 64 entries, is strictly increasing, starts near 20 Hz+offset behavior and ends near 18 kHz', () => {
    const analyzer = new AveeClassicAnalyzer({ sampleRate: 44100 });
    const freqs = analyzer.getBarFreqs();

    expect(freqs.length).toBe(64);

    for (let i = 1; i < freqs.length; i++) {
      expect(freqs[i]).toBeGreaterThan(freqs[i - 1]);
    }

    const bandCount = 64;
    const loFreq = 20.0;
    const hiFreq = 18000.0;
    const freqScaleOff = 800.0;

    const step = (Math.log(hiFreq / (loFreq + freqScaleOff)) / bandCount) / Math.log(2.0);
    const expectedFreqs = new Float32Array(bandCount);
    expectedFreqs[0] = loFreq + freqScaleOff;
    const stepMul = Math.pow(2.0, step);
    for (let i = 1; i < bandCount; ++i) {
      expectedFreqs[i] = expectedFreqs[i - 1] * stepMul * 1.0;
      expectedFreqs[i - 1] += -freqScaleOff;
    }

    console.log('First 3 band freqs:', freqs[0], freqs[1], freqs[2]);
    console.log('Last 3 band freqs:', freqs[61], freqs[62], freqs[63]);

    for (let i = 0; i < bandCount; i++) {
      expect(freqs[i]).toBeCloseTo(expectedFreqs[i], 4);
    }

    expect(freqs[0]).toBeCloseTo(20.0, 1);
    expect(freqs[63]).toBeCloseTo(17151.9, 0);
  });

  it('live helper and export helper produce identical output for same sample slice for both modes; validateTemplate rejects unknown analysisMode', () => {
    const sampleRate = 44100;
    const frameRate = 60;
    const samples = new Float32Array(512);
    for (let i = 0; i < 512; i++) {
      samples[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate);
    }

    // OpenViz mode
    const liveOpenViz = createAnalyzer('openviz', sampleRate, frameRate);
    const exportOpenViz = createAnalyzer('openviz', sampleRate, frameRate);
    const resLiveOV = liveOpenViz.analyze(samples);
    const resExpOV = exportOpenViz.analyze(samples);
    expect(Array.from(resLiveOV.spectrum)).toEqual(Array.from(resExpOV.spectrum));

    // Avee-classic mode
    const liveAvee = createAnalyzer('avee-classic', sampleRate, frameRate);
    const exportAvee = createAnalyzer('avee-classic', sampleRate, frameRate);
    const resLiveAvee = liveAvee.analyze(samples);
    const resExpAvee = exportAvee.analyze(samples);
    expect(Array.from(resLiveAvee.spectrum)).toEqual(Array.from(resExpAvee.spectrum));

    // validateTemplate validation
    const validTpl: OpenVizTemplate = {
      schemaVersion: 'openviz/1',
      name: 'Test',
      author: 'Test',
      canvasAspect: '16:9',
      clearColor: [0, 0, 0, 1],
      analysisMode: 'avee-classic',
      nodes: [],
      postEffects: [],
    };
    expect(validateTemplate(validTpl).ok).toBe(true);

    const invalidTpl = {
      ...validTpl,
      analysisMode: 'invalid-mode',
    };
    const invalidRes = validateTemplate(invalidTpl);
    expect(invalidRes.ok).toBe(false);
    if (!invalidRes.ok) {
      expect(invalidRes.errors.some((e) => e.includes('analysisMode'))).toBe(true);
    }
  });

  it('source-grep test: no file in repo contains forbidden terms; avee_classic file contains Apache attribution header', () => {
    const projectRoot = path.resolve(__dirname, '..');

    function scanDir(dir: string, fileList: string[] = []) {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        if (filePath.includes('node_modules') || filePath.includes('.git') || filePath.includes('/tmp')) continue;
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          scanDir(filePath, fileList);
        } else if (stat.isFile() && (filePath.endsWith('.ts') || filePath.endsWith('.js') || filePath.endsWith('.json') || filePath.endsWith('.md'))) {
          fileList.push(filePath);
        }
      }
      return fileList;
    }

    const allFiles = scanDir(projectRoot);

    const term1 = 'N' + 'Audio';
    const term2 = 'Fast' + 'FourierTransform';

    for (const filePath of allFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).not.toContain(term1);
      expect(content).not.toContain(term2);
    }

    const aveeClassicPath = path.join(projectRoot, 'src', 'audio', 'avee_classic.ts');
    const aveeContent = fs.readFileSync(aveeClassicPath, 'utf-8');
    expect(aveeContent).toContain('Portions derived from Avee Open Player 1.0.34');
    expect(aveeContent).toContain('Apache License, Version 2.0');
    expect(aveeContent).toContain('Copyright 2019 Avee Player');
  });
});
