import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock Web Audio API & HTMLAudioElement for Node environment
if (typeof globalThis.Audio === 'undefined') {
  class MockAudio {
    crossOrigin = '';
    src = '';
    currentTime = 0;
    duration = 100;
    paused = true;
    playbackRate = 1.0;
    load() {}
    async play() {
      this.paused = false;
    }
    pause() {
      this.paused = true;
    }
  }
  (globalThis as any).Audio = MockAudio;
}

if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = globalThis;
}

if (typeof (globalThis as any).window.AudioContext === 'undefined') {
  class MockAudioNode {
    connect() { return this; }
    setValueAtTime() {}
  }
  class MockParam {
    setValueAtTime() {}
  }
  class MockBiquadFilter extends MockAudioNode {
    gain = new MockParam();
    frequency = new MockParam();
  }
  class MockDelay extends MockAudioNode {
    delayTime = new MockParam();
  }
  class MockGain extends MockAudioNode {
    gain = new MockParam();
  }
  class MockStereoPanner extends MockAudioNode {
    pan = new MockParam();
  }
  class MockAnalyser extends MockAudioNode {
    fftSize = 128;
    frequencyBinCount = 64;
    smoothingTimeConstant = 0.8;
    getByteFrequencyData(array: Uint8Array) {
      array.fill(128);
    }
  }

  class MockAudioContext {
    currentTime = 0;
    state = 'running';
    destination = new MockAudioNode();
    createMediaElementSource() { return new MockAudioNode(); }
    createBiquadFilter() { return new MockBiquadFilter(); }
    createDelay() { return new MockDelay(); }
    createGain() { return new MockGain(); }
    createStereoPanner() { return new MockStereoPanner(); }
    createAnalyser() { return new MockAnalyser(); }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
  }

  (globalThis as any).window.AudioContext = MockAudioContext;
}

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
