import { describe, it, expect } from 'vitest';
import { logSpace } from '../src/audio/analysis';
import { getMonstercatPreset, getRadialPulsePreset, getLofiChillPreset } from '../src/render/presets';
import { CameraShakeEffect } from '../src/render/effects/CameraShakeEffect';

describe('Vetted Open-Source Presets and Effects', () => {
  it('computes logarithmic frequency spacing correctly with logSpace', () => {
    const minFreq = 20;
    const maxFreq = 20000;
    const total = 64;

    const f0 = logSpace(minFreq, maxFreq, 0, total, 0.0);
    const fMid = logSpace(minFreq, maxFreq, 32, total, 0.0);
    const fMax = logSpace(minFreq, maxFreq, 64, total, 0.0);

    expect(f0).toBeCloseTo(20);
    expect(fMid).toBeGreaterThan(20);
    expect(fMid).toBeLessThan(20000);
    expect(fMax).toBeCloseTo(20000);
  });

  it('generates Monstercat, Radial Pulse, and Lo-Fi Chill presets', () => {
    const monstercat = getMonstercatPreset();
    expect(monstercat.name).toBe('Monstercat Equalizer');
    expect(monstercat.nodes.length).toBeGreaterThan(0);

    const radial = getRadialPulsePreset();
    expect(radial.name).toBe('Radial Pulse Ring');
    expect(radial.nodes.some((n) => n.barsData?.isRadial)).toBe(true);

    const lofi = getLofiChillPreset();
    expect(lofi.name).toBe('Lo-Fi Chill Horizontal');
    expect(lofi.nodes.length).toBeGreaterThan(0);
  });

  it('calculates camera shake offset from time and bass intensity', () => {
    const shake = new CameraShakeEffect({ intensity: 0.1, frequency: 10 });
    const [dx, dy] = shake.getOffset(1.5, 1.0);
    expect(typeof dx).toBe('number');
    expect(typeof dy).toBe('number');
  });
});
