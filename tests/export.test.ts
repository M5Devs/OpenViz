import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pickAvcLevel, computeExportSize } from '../src/export/avc';
import { exportVideo, downmixAudioBufferToMono } from '../src/export/webcodecs';

describe('AVC level selection (pickAvcLevel)', () => {
  it('correctly maps resolutions and framerates to H.264 level_idc values', () => {
    expect(pickAvcLevel(1920, 1080, 30)).toBe(0x28);
    expect(pickAvcLevel(1920, 1080, 60)).toBe(0x2a);
    expect(pickAvcLevel(2560, 1440, 60)).toBe(0x33);
    expect(pickAvcLevel(3840, 2160, 30)).toBe(0x33);
    expect(pickAvcLevel(3840, 2160, 60)).toBe(0x34);
    expect(pickAvcLevel(1280, 720, 60)).toBe(0x20);
  });
});

describe('Export dimension calculation (computeExportSize)', () => {
  it('forces even width dimensions across aspect ratios', () => {
    expect(computeExportSize(1080, 16 / 9)).toEqual({ width: 1920, height: 1080 });
    expect(computeExportSize(1080, 9 / 16)).toEqual({ width: 608, height: 1080 });
    expect(computeExportSize(1080, 1)).toEqual({ width: 1080, height: 1080 });

    const testAspects = [16 / 9, 9 / 16, 4 / 3, 21 / 9, 1.2345];
    for (const aspect of testAspects) {
      const size = computeExportSize(1080, aspect);
      expect(size.width % 2).toBe(0);
      expect(size.height % 2).toBe(0);
    }
  });
});

describe('Memory guard', () => {
  it('throws an error when estimated export exceeds 1.5 GB limit', async () => {
    const mockScene = {
      beginExport: vi.fn(),
      endExport: vi.fn(),
      renderer: { domElement: {} },
      updateAudioReactivity: vi.fn(),
      render: vi.fn(),
    } as any;

    (globalThis as any).VideoEncoder = vi.fn();
    (globalThis as any).VideoFrame = vi.fn();

    await expect(
      exportVideo(
        mockScene,
        null,
        600,
        {
          height: 2160,
          fps: 60,
          videoBitrate: 200_000_000,
        }
      )
    ).rejects.toThrow(/exceeds the 1.5 GB in-memory limit/i);

    delete (globalThis as any).VideoEncoder;
    delete (globalThis as any).VideoFrame;
  });
});

describe('Audio downmixing helper', () => {
  it('correctly downmixes multi-channel AudioBuffer to mono', () => {
    const channel1 = new Float32Array([1.0, -0.5, 0.0]);
    const channel2 = new Float32Array([0.0, 0.5, 1.0]);

    const mockBuffer = {
      numberOfChannels: 2,
      length: 3,
      getChannelData: (c: number) => (c === 0 ? channel1 : channel2),
    } as any;

    const mono = downmixAudioBufferToMono(mockBuffer);
    expect(mono.length).toBe(3);
    expect(mono[0]).toBeCloseTo(0.5);
    expect(mono[1]).toBeCloseTo(0.0);
    expect(mono[2]).toBeCloseTo(0.5);
  });
});

describe('Mocked WebCodecs export integration tests', () => {
  class MockEncodedVideoChunk {
    public type: 'key' | 'delta';
    public timestamp: number;
    public duration: number;
    public byteLength: number = 10;
    constructor(init: any) {
      this.type = init.type || 'key';
      this.timestamp = init.timestamp || 0;
      this.duration = init.duration || 16666;
    }
    copyTo(dst: ArrayBufferView) {}
  }

  class MockEncodedAudioChunk {
    public type: 'key' | 'delta';
    public timestamp: number;
    public duration: number;
    public byteLength: number = 10;
    constructor(init: any) {
      this.type = init.type || 'key';
      this.timestamp = init.timestamp || 0;
      this.duration = init.duration || 100000;
    }
    copyTo(dst: ArrayBufferView) {}
  }

  class MockVideoEncoder {
    public state: string = 'configured';
    public encodeQueueSize: number = 0;
    private config: any;
    private callbacks: any;
    private listeners: Record<string, Function[]> = {};

    static isConfigSupported = vi.fn().mockImplementation(async (config: any) => {
      return { supported: true, hardwareAcceleration: config.hardwareAcceleration };
    });

    constructor(callbacks: any) {
      this.callbacks = callbacks;
    }

    configure(config: any) {
      this.config = config;
    }

    encode(frame: any, opts?: any) {
      if (this.callbacks.output) {
        const chunk = new MockEncodedVideoChunk({
          type: opts?.keyFrame ? 'key' : 'delta',
          timestamp: frame.timestamp,
          duration: frame.duration,
        });
        const meta = opts?.keyFrame
          ? {
              decoderConfig: {
                codec: 'avc1.64002A',
                width: 1280,
                height: 720,
                colorSpace: { primarities: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false },
              },
            }
          : undefined;
        this.callbacks.output(chunk, meta);
      }
    }

    addEventListener(event: string, fn: Function, opts?: any) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(fn);
    }

    removeEventListener(event: string, fn: Function) {
      if (this.listeners[event]) {
        this.listeners[event] = this.listeners[event].filter((f) => f !== fn);
      }
    }

    async flush() {}

    close() {
      this.state = 'closed';
    }

    triggerDequeue() {
      if (this.listeners['dequeue']) {
        const copy = [...this.listeners['dequeue']];
        this.listeners['dequeue'] = [];
        copy.forEach((fn) => fn());
      }
    }

    triggerError(err: Error) {
      if (this.callbacks.error) {
        this.callbacks.error(err);
      }
    }
  }

  class MockAudioEncoder {
    public state: string = 'configured';
    public encodeQueueSize: number = 0;
    private config: any;
    private callbacks: any;
    private listeners: Record<string, Function[]> = {};

    static isConfigSupported = vi.fn().mockImplementation(async (config: any) => {
      if (config.codec === 'mp4a.40.2' || config.codec === 'opus') {
        return { supported: true };
      }
      return { supported: false };
    });

    constructor(callbacks: any) {
      this.callbacks = callbacks;
    }

    configure(config: any) {
      this.config = config;
    }

    encode(data: any) {
      if (this.callbacks.output) {
        const chunk = new MockEncodedAudioChunk({
          type: 'key',
          timestamp: data.timestamp,
          duration: Math.round((data.numberOfFrames * 1_000_000) / 44100),
        });
        const meta = { decoderConfig: { codec: 'mp4a.40.2', sampleRate: 44100, numberOfChannels: 2 } };
        this.callbacks.output(chunk, meta);
      }
    }

    addEventListener(event: string, fn: Function, opts?: any) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(fn);
    }

    removeEventListener(event: string, fn: Function) {
      if (this.listeners[event]) {
        this.listeners[event] = this.listeners[event].filter((f) => f !== fn);
      }
    }

    async flush() {}

    close() {
      this.state = 'closed';
    }

    triggerDequeue() {
      if (this.listeners['dequeue']) {
        const copy = [...this.listeners['dequeue']];
        this.listeners['dequeue'] = [];
        copy.forEach((fn) => fn());
      }
    }
  }

  class MockVideoFrame {
    public timestamp: number;
    public duration: number;
    public closed: boolean = false;

    constructor(canvas: any, init: any) {
      this.timestamp = init.timestamp;
      this.duration = init.duration;
    }

    close() {
      this.closed = true;
    }
  }

  class MockAudioData {
    public timestamp: number;
    public numberOfFrames: number;
    public closed: boolean = false;

    constructor(init: any) {
      this.timestamp = init.timestamp;
      this.numberOfFrames = init.numberOfFrames;
    }

    close() {
      this.closed = true;
    }
  }

  beforeEach(() => {
    (globalThis as any).EncodedVideoChunk = MockEncodedVideoChunk;
    (globalThis as any).EncodedAudioChunk = MockEncodedAudioChunk;
    (globalThis as any).VideoEncoder = MockVideoEncoder;
    (globalThis as any).AudioEncoder = MockAudioEncoder;
    (globalThis as any).VideoFrame = MockVideoFrame;
    (globalThis as any).AudioData = MockAudioData;
  });

  afterEach(() => {
    delete (globalThis as any).EncodedVideoChunk;
    delete (globalThis as any).EncodedAudioChunk;
    delete (globalThis as any).VideoEncoder;
    delete (globalThis as any).AudioEncoder;
    delete (globalThis as any).VideoFrame;
    delete (globalThis as any).AudioData;
  });

  it('verifies exact video timestamps with no drift for 600 frames at 60 fps', async () => {
    const videoTimestamps: number[] = [];

    const mockScene = {
      beginExport: vi.fn(),
      endExport: vi.fn(),
      renderer: { domElement: {} },
      updateAudioReactivity: vi.fn(),
      render: vi.fn(),
    } as any;

    const OriginalMockVideoFrame = (globalThis as any).VideoFrame;
    (globalThis as any).VideoFrame = class extends OriginalMockVideoFrame {
      constructor(canvas: any, init: any) {
        super(canvas, init);
        videoTimestamps.push(init.timestamp);
      }
    };

    const res = await exportVideo(mockScene, null, 10, { height: 720, fps: 60 });

    expect(videoTimestamps.length).toBe(600);
    for (let i = 0; i < 600; i++) {
      const expectedUs = Math.round((i * 1_000_000) / 60);
      expect(videoTimestamps[i]).toBe(expectedUs);
    }

    expect(mockScene.beginExport).toHaveBeenCalledTimes(1);
    expect(mockScene.endExport).toHaveBeenCalledTimes(1);
  });

  it('handles backpressure when encodeQueueSize > 8', async () => {
    const mockScene = {
      beginExport: vi.fn(),
      endExport: vi.fn(),
      renderer: { domElement: {} },
      updateAudioReactivity: vi.fn(),
      render: vi.fn(),
    } as any;

    let highestObservedQueue = 0;

    class BackpressureVideoEncoder extends MockVideoEncoder {
      encode(frame: any, opts?: any) {
        super.encode(frame, opts);
        this.encodeQueueSize++;
        if (this.encodeQueueSize > highestObservedQueue) {
          highestObservedQueue = this.encodeQueueSize;
        }

        if (this.encodeQueueSize > 8) {
          setTimeout(() => {
            this.encodeQueueSize = 0;
            this.triggerDequeue();
          }, 2);
        }
      }
    }

    (globalThis as any).VideoEncoder = BackpressureVideoEncoder;

    await exportVideo(mockScene, null, 1, { height: 720, fps: 60 });

    expect(highestObservedQueue).toBeGreaterThan(8);
    expect(highestObservedQueue).toBeLessThanOrEqual(10);
  });

  it('cleans up and restores scene on cancellation (AbortSignal)', async () => {
    const mockScene = {
      beginExport: vi.fn(),
      endExport: vi.fn(),
      renderer: { domElement: {} },
      updateAudioReactivity: vi.fn(),
      render: vi.fn(),
    } as any;

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);

    try {
      await exportVideo(mockScene, null, 10, { height: 720, fps: 60 }, undefined, controller.signal);
      expect.unreachable('Should have thrown AbortError');
    } catch (err: any) {
      expect(err.name).toBe('AbortError');
    }

    expect(mockScene.endExport).toHaveBeenCalledTimes(1);
  });

  it('falls back to opus or video-only depending on audio codec support', async () => {
    const mockScene = {
      beginExport: vi.fn(),
      endExport: vi.fn(),
      renderer: { domElement: {} },
      updateAudioReactivity: vi.fn(),
      render: vi.fn(),
    } as any;

    const channelData = new Float32Array(44100 * 2);
    const mockAudioBuffer = {
      numberOfChannels: 2,
      sampleRate: 44100,
      length: 44100 * 2,
      duration: 2.0,
      getChannelData: () => channelData,
    } as any;

    // Test Case 1: Opus supported, AAC unsupported
    (MockAudioEncoder.isConfigSupported as any).mockImplementation(async (cfg: any) => {
      if (cfg.codec === 'opus') return { supported: true };
      return { supported: false };
    });

    const resOpus = await exportVideo(mockScene, mockAudioBuffer, 2, { height: 720, fps: 60 });
    expect(resOpus.info.audioCodec).toBe('opus');

    // Test Case 2: Both unsupported
    (MockAudioEncoder.isConfigSupported as any).mockImplementation(async () => ({ supported: false }));
    const resNoAudio = await exportVideo(mockScene, mockAudioBuffer, 2, { height: 720, fps: 60 });
    expect(resNoAudio.info.audioCodec).toBeNull();

    // Test Case 3: No AudioEncoder at all
    delete (globalThis as any).AudioEncoder;
    const resNoEncoder = await exportVideo(mockScene, mockAudioBuffer, 2, { height: 720, fps: 60 });
    expect(resNoEncoder.info.audioCodec).toBeNull();
  });

  it('guarantees deterministic reactivity updates across multiple export runs', async () => {
    const mockScene1 = {
      beginExport: vi.fn(),
      endExport: vi.fn(),
      renderer: { domElement: {} },
      updateAudioReactivity: vi.fn(),
      render: vi.fn(),
    } as any;

    const mockScene2 = {
      beginExport: vi.fn(),
      endExport: vi.fn(),
      renderer: { domElement: {} },
      updateAudioReactivity: vi.fn(),
      render: vi.fn(),
    } as any;

    const channelData = new Float32Array(44100 * 2);
    for (let i = 0; i < channelData.length; i++) {
      channelData[i] = Math.sin(i * 0.05);
    }
    const mockAudioBuffer = {
      numberOfChannels: 1,
      sampleRate: 44100,
      length: channelData.length,
      duration: 2.0,
      getChannelData: () => channelData,
    } as any;

    await exportVideo(mockScene1, mockAudioBuffer, 2, { height: 720, fps: 60 });
    await exportVideo(mockScene2, mockAudioBuffer, 2, { height: 720, fps: 60 });

    const calls1 = mockScene1.updateAudioReactivity.mock.calls;
    const calls2 = mockScene2.updateAudioReactivity.mock.calls;

    expect(calls1.length).toBe(calls2.length);
    for (let i = 0; i < calls1.length; i++) {
      const freq1 = calls1[i][0];
      const freq2 = calls2[i][0];
      const time1 = calls1[i][1];
      const time2 = calls2[i][1];

      expect(time1).toBe(time2);
      expect(freq1.bass).toBeCloseTo(freq2.bass);
      expect(freq1.mid).toBeCloseTo(freq2.mid);
      expect(freq1.high).toBeCloseTo(freq2.high);
    }
  });
});
