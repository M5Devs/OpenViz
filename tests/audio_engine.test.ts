import { describe, it, expect, beforeEach, vi } from 'vitest';

if (typeof globalThis.requestAnimationFrame === 'undefined') {
  (globalThis as any).requestAnimationFrame = (fn: any) => setTimeout(fn, 16);
}

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
    setTargetAtTime() {}
  }
  class MockParam {
    value = 0;
    setValueAtTime(v: number) { this.value = v; }
    setTargetAtTime(v: number) { this.value = v; }
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
  class MockOscillator extends MockAudioNode {
    frequency = new MockParam();
    type = 'sine';
    start() {}
    stop() {}
  }
  class MockConvolver extends MockAudioNode {
    buffer: any = null;
  }
  class MockStereoPanner extends MockAudioNode {
    pan = new MockParam();
  }
  class MockAnalyser extends MockAudioNode {
    fftSize = 4096;
    frequencyBinCount = 2048;
    smoothingTimeConstant = 0.8;
    getFloatTimeDomainData(array: Float32Array) {
      array.fill(0);
    }
  }

  class MockAudioContext {
    currentTime = 0;
    sampleRate = 44100;
    state = 'running';
    destination = new MockAudioNode();
    createMediaElementSource() { return new MockAudioNode(); }
    createBiquadFilter() { return new MockBiquadFilter(); }
    createDelay() { return new MockDelay(); }
    createGain() { return new MockGain(); }
    createOscillator() { return new MockOscillator(); }
    createConvolver() { return new MockConvolver(); }
    createStereoPanner() { return new MockStereoPanner(); }
    createAnalyser() { return new MockAnalyser(); }
    createBuffer(channels: number, length: number, sampleRate: number) {
      const data = new Float32Array(length);
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        getChannelData: () => data,
      };
    }
    async decodeAudioData(ab: ArrayBuffer) {
      return this.createBuffer(2, 44100, 44100);
    }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
  }

  (globalThis as any).window.AudioContext = MockAudioContext;
}

import { AudioEngine, generateImpulseResponse, mulberry32 } from '../src/audio/engine';

describe('AudioEngine Overhaul & DSP Calculations', () => {
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

  it('toggles 8D audio state and sets panner gain target without requestAnimationFrame', () => {
    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame');
    engine.init();

    engine.set8DAudio(true);
    expect(engine.getDSPState().eightD).toBe(true);

    engine.set8DAudio(false);
    expect(engine.getDSPState().eightD).toBe(false);

    expect(rafSpy).not.toHaveBeenCalled();
    rafSpy.mockRestore();
  });

  it('generates a deterministic and decaying impulse response', () => {
    const prng1 = mulberry32(0x12345678);
    const prng2 = mulberry32(0x12345678);

    const samples1 = [prng1(), prng1(), prng1()];
    const samples2 = [prng2(), prng2(), prng2()];

    expect(samples1).toEqual(samples2);

    const ctx = new (window.AudioContext as any)();
    const buf = generateImpulseResponse(ctx, 1.0, 4.0);
    const ch0 = buf.getChannelData(0);

    const earlyAmp = Math.abs(ch0[10]);
    const lateAmp = Math.abs(ch0[ch0.length - 100]);
    expect(earlyAmp).toBeGreaterThan(lateAmp);
  });

  it('revokes previous object URL on loading a new audio file and on dispose', async () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:mock-url-1');

    const fakeFile1 = new Blob(['audio1'], { type: 'audio/mp3' });
    await engine.loadAudio(fakeFile1);

    createSpy.mockImplementation(() => 'blob:mock-url-2');
    const fakeFile2 = new Blob(['audio2'], { type: 'audio/mp3' });
    await engine.loadAudio(fakeFile2);

    expect(revokeSpy).toHaveBeenCalledWith('blob:mock-url-1');

    engine.dispose();
    expect(revokeSpy).toHaveBeenCalledWith('blob:mock-url-2');

    revokeSpy.mockRestore();
    createSpy.mockRestore();
  });

  it('decodes audio file using the single AudioContext instance and caches buffer', async () => {
    const fakeFile = new Blob(['audio-data'], { type: 'audio/mp3' });
    fakeFile.arrayBuffer = async () => new ArrayBuffer(8);

    const decoded = await engine.decodeFile(fakeFile);
    expect(decoded).toBeDefined();
    expect(engine.getAudioBuffer()).toBe(decoded);
  });
});
