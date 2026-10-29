import { describe, it, expect } from 'vitest';
import { logSpace, SpectrumAnalyzer } from '../src/audio/analysis';
import { expandTextTags, formatTimeMMSS } from '../src/render/text';
import { sampleShapePath } from '../src/render/shapePaths';
import { computeMeasureEnvelope } from '../src/render/bindings';

describe('Audio Reactivity & DSP Engine Tests', () => {
  describe('Phase 1: Audio DSP & Reactivity', () => {
    it('logSpace maps logarithmic frequency distribution correctly', () => {
      const minFreq = 30;
      const maxFreq = 16000;
      const total = 64;

      const f0 = logSpace(minFreq, maxFreq, 0, total, 0);
      const f32 = logSpace(minFreq, maxFreq, 32, total, 0);
      const f64 = logSpace(minFreq, maxFreq, 64, total, 0);

      expect(f0).toBeCloseTo(30, 1);
      expect(f64).toBeCloseTo(16000, 1);
      expect(f32).toBeGreaterThan(30);
      expect(f32).toBeLessThan(16000);
    });

    it('SpectrumAnalyzer uses asymmetric attack and decay smoothing', () => {
      const analyzer = new SpectrumAnalyzer({
        sampleRate: 44100,
        fftSize: 4096,
        bands: 64,
        attackSmoothing: 0.60,
        decaySmoothing: 0.15,
      });

      const samples1 = new Float32Array(4096);
      for (let i = 0; i < 4096; i++) {
        samples1[i] = Math.sin((2 * Math.PI * 100 * i) / 44100);
      }

      const res1 = analyzer.analyze(samples1);
      const peakVal1 = Math.max(...res1.spectrum);
      expect(peakVal1).toBeGreaterThan(0);

      const samplesSilence = new Float32Array(4096);
      const res2 = analyzer.analyze(samplesSilence);
      const peakVal2 = Math.max(...res2.spectrum);

      expect(peakVal2).toBeLessThan(peakVal1);
      expect(peakVal2).toBeGreaterThan(0);
    });

    it('computeMeasureEnvelope calculates value and derivative envelope', () => {
      const baseValue = 1.0;
      const measureVal1 = 0.5;
      const a = 2.0;
      const b = 0.1;
      const key = 'test_binding';

      const v1 = computeMeasureEnvelope(baseValue, measureVal1, a, b, key, 0.0);
      expect(v1).toBe(1.0 + 2.0 * 0.5);

      const measureVal2 = 0.8;
      const v2 = computeMeasureEnvelope(baseValue, measureVal2, a, b, key, 0.1);
      const derivative = (0.8 - 0.5) / 0.1;
      expect(v2).toBeCloseTo(1.0 + 2.0 * 0.8 + 0.1 * derivative, 4);
    });
  });

  describe('Phase 2: Shape Paths & Segment Geometries', () => {
    it('samples Circle shape path', () => {
      const pt = sampleShapePath('Circle', 0, 4, 100);
      expect(pt.x).toBeCloseTo(100, 1);
      expect(pt.y).toBeCloseTo(0, 1);
      expect(pt.normalX).toBeCloseTo(1, 1);
    });

    it('samples HorizontalLine shape path', () => {
      const pt0 = sampleShapePath('HorizontalLine', 0, 5, 100);
      const pt4 = sampleShapePath('HorizontalLine', 4, 5, 100);

      expect(pt0.y).toBe(0);
      expect(pt4.y).toBe(0);
      expect(pt0.x).toBeLessThan(pt4.x);
    });

    it('samples SidedPolygon shape path with rounding', () => {
      const ptSquare = sampleShapePath('SidedPolygon', 0, 4, 100, { sidedPolygonSides: 4, sidedPolygonRounding: 0 });
      expect(ptSquare).toBeDefined();
      expect(ptSquare.x).toBeCloseTo(100, 1);

      const ptRounded = sampleShapePath('SidedPolygon', 0, 4, 100, { sidedPolygonSides: 4, sidedPolygonRounding: 0.5 });
      expect(ptRounded).toBeDefined();
    });

    it('samples Letter glyph shape path', () => {
      const pt = sampleShapePath('Letter', 0, 32, 100, { letterChar: 'A' });
      expect(pt.x).toBeDefined();
      expect(pt.y).toBeDefined();
      expect(pt.normalX).toBeDefined();
    });
  });

  describe('Phase 4: Metadata Tag Expansion', () => {
    it('formats time MM:SS', () => {
      expect(formatTimeMMSS(65)).toBe('01:05');
      expect(formatTimeMMSS(0)).toBe('00:00');
      expect(formatTimeMMSS(undefined)).toBe('00:00');
    });

    it('expands metadata tags in text strings', () => {
      const tpl = '{Artist} - {Title} [{Position}/{Duration}] @ {Fps}FPS ({ArtistAndTitle})';
      const expanded = expandTextTags(tpl, {
        artist: 'The Midnight',
        title: 'Sunset',
        positionSec: 75,
        durationSec: 240,
        fps: 60,
      });

      expect(expanded).toBe('The Midnight - Sunset [01:15/04:00] @ 60FPS (The Midnight - Sunset)');
    });
  });
});
