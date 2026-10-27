import { describe, it, expect, beforeEach } from 'vitest';
import { AudioEngine } from '../src/audio/engine';

describe('AudioEngine DSP & Frequency Calculations', () => {
  let engine: AudioEngine;

  beforeEach(() => {
    engine = new AudioEngine();
  });

  it('starts with default DSP state', () => {
    const dsp = engine.getDSPState();
    expect(dsp.bassBoostDb).toBe(0);
    expect(dsp.slowedReverb).toBe(false);
    expect(dsp.nightcore).toBe(false);
    expect(dsp.eightD).toBe(false);
  });

  it('updates bass boost setting', () => {
    engine.setBassBoost(12);
    expect(engine.getDSPState().bassBoostDb).toBe(12);
  });

  it('toggles Slowed + Reverb and Nightcore mutually exclusively', () => {
    engine.setSlowedReverb(true);
    expect(engine.getDSPState().slowedReverb).toBe(true);
    expect(engine.getDSPState().nightcore).toBe(false);

    engine.setNightcore(true);
    expect(engine.getDSPState().nightcore).toBe(true);
    expect(engine.getDSPState().slowedReverb).toBe(false);
  });

  it('toggles 8D audio state', () => {
    engine.set8DAudio(true);
    expect(engine.getDSPState().eightD).toBe(true);
    engine.set8DAudio(false);
    expect(engine.getDSPState().eightD).toBe(false);
  });

  it('returns valid frequency data structure', () => {
    const freq = engine.getFrequencyData();
    expect(freq.spectrum).toBeInstanceOf(Float32Array);
    expect(freq.spectrum.length).toBe(64);
    expect(typeof freq.bass).toBe('number');
    expect(typeof freq.mid).toBe('number');
    expect(typeof freq.high).toBe('number');
    expect(typeof freq.beat).toBe('number');
    expect(typeof freq.rms).toBe('number');
  });
});
