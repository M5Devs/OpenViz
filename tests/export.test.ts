import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pickAvcLevel, computeExportSize } from '../src/export/avc';
import { exportVideo, downmixAudioBufferToMono } from '../src/export/webcodecs';
import { createOutputTarget, getMemoryGuardThresholdBytes, supportsDiskExport } from '../src/export/target';
import { acquireWakeLock } from '../src/export/wakelock';
import { recommendExportSettings, yieldToEventLoop } from '../src/export/defaults';

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

  it('closes VideoFrame in finally even when waitForBackpressure throws', async () => {
    let closedFrameCount = 0;
    class FrameTrackingVideoFrame {
      close() {
        closedFrameCount++;
      }
    }

    class FailingVideoEncoder {
      public state = 'configured';
      public encodeQueueSize = 10; // Trigger backpressure loop
      private callbacks: any;
      constructor(callbacks: any) {
        this.callbacks = callbacks;
      }
      static isConfigSupported = vi.fn().mockResolvedValue({ supported: true, hardwareAcceleration: 'prefer-hardware' });
      configure() {}
      encode() {}
      addEventListener(evt: string, fn: Function) {
        if (evt === 'dequeue') {
          // Immediately throw error in encoder callback
          setTimeout(() => {
            if (this.callbacks.error) {
              this.callbacks.error(new Error('Queue failure during backpressure'));
            }
          }, 1);
        }
      }
      removeEventListener() {}
      async flush() {}
      close() { this.state = 'closed'; }
    }

    (globalThis as any).VideoFrame = FrameTrackingVideoFrame;
    (globalThis as any).VideoEncoder = FailingVideoEncoder;

    const mockScene = {
      beginExport: vi.fn(),
      endExport: vi.fn(),
      renderer: { domElement: {} },
      updateAudioReactivity: vi.fn(),
      render: vi.fn(),
    } as any;

    try {
      await exportVideo(mockScene, null, 1, { height: 720, fps: 60 });
      expect.unreachable('Should have thrown error');
    } catch (err: any) {
      expect(err.message).toBe('Queue failure during backpressure');
    }

    expect(closedFrameCount).toBeGreaterThan(0);
  });

  it('stream target write rejecting with NotFoundError sets fatalError, removes unhandledrejection listener in finally, and aborts loop without unhandled rejection', async () => {
    let listenerAdded = false;
    let listenerRemoved = false;

    const mockWindow = {
      addEventListener: (evt: string, fn: Function) => {
        if (evt === 'unhandledrejection') {
          listenerAdded = true;
        }
      },
      removeEventListener: (evt: string, fn: Function) => {
        if (evt === 'unhandledrejection') {
          listenerRemoved = true;
        }
      },
      matchMedia: () => ({ matches: false }),
    };
    (globalThis as any).window = mockWindow;

    const notFoundErr = new DOMException('A requested file or directory could not be found.', 'NotFoundError');
    const mockWritable = {
      write: vi.fn().mockRejectedValue(notFoundErr),
      close: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
    };

    const mockHandle = {
      createWritable: vi.fn().mockResolvedValue(mockWritable),
    };
    (mockWindow as any).showSaveFilePicker = vi.fn().mockResolvedValue(mockHandle);

    const target = await createOutputTarget({ suggestedName: 'test.mp4', estimatedBytes: 10 * 1024 * 1024 });
    expect(target.kind).toBe('disk');

    const mockScene = {
      beginExport: vi.fn(),
      endExport: vi.fn(),
      renderer: { domElement: {} },
      updateAudioReactivity: vi.fn(),
      render: vi.fn(),
    } as any;

    try {
      await exportVideo(mockScene, null, 1, { height: 720, fps: 60, target });
      expect.unreachable('Should have thrown NotFoundError');
    } catch (err: any) {
      expect(err.name).toBe('NotFoundError');
    }

    expect(listenerAdded).toBe(true);
    expect(listenerRemoved).toBe(true);
    expect(target.fatalError).toBeDefined();
    expect(target.fatalError?.name).toBe('NotFoundError');

    delete (globalThis as any).window;
  });
});

describe('Phase 3b Export Enhancements', () => {
  class MockFileSystemWritableFileStream {}

  beforeEach(() => {
    (globalThis as any).FileSystemWritableFileStream = MockFileSystemWritableFileStream;
  });

  afterEach(() => {
    delete (globalThis as any).FileSystemWritableFileStream;
  });

  describe('Output Target Selection', () => {
    it('creates disk target when showSaveFilePicker is present', async () => {
      const mockWritable = Object.create(MockFileSystemWritableFileStream.prototype);
      mockWritable.write = vi.fn().mockResolvedValue(undefined);
      mockWritable.close = vi.fn().mockResolvedValue(undefined);
      mockWritable.abort = vi.fn().mockResolvedValue(undefined);

      const mockHandle = {
        createWritable: vi.fn().mockResolvedValue(mockWritable),
      };
      (globalThis as any).window = globalThis;
      (globalThis as any).showSaveFilePicker = vi.fn().mockResolvedValue(mockHandle);

      const target = await createOutputTarget({ suggestedName: 'test.mp4', estimatedBytes: 50 * 1024 * 1024 });
      expect(target.kind).toBe('disk');
      expect((globalThis as any).showSaveFilePicker).toHaveBeenCalledWith({
        suggestedName: 'test.mp4',
        types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }],
      });

      const blob = await target.finalize();
      expect(blob).toBeNull();
      expect(mockWritable.close).toHaveBeenCalledTimes(1);

      delete (globalThis as any).showSaveFilePicker;
    });

    it('cancels quietly when showSaveFilePicker throws AbortError', async () => {
      (globalThis as any).window = globalThis;
      const abortErr = new DOMException('The user aborted a request.', 'AbortError');
      (globalThis as any).showSaveFilePicker = vi.fn().mockRejectedValue(abortErr);

      const mockScene = { beginExport: vi.fn(), endExport: vi.fn() } as any;

      let pickerFailed = false;
      try {
        await createOutputTarget({ suggestedName: 'test.mp4', estimatedBytes: 50 * 1024 * 1024 });
      } catch (e: any) {
        pickerFailed = true;
        expect(e.name).toBe('AbortError');
      }

      expect(pickerFailed).toBe(true);
      expect(mockScene.beginExport).not.toHaveBeenCalled();

      delete (globalThis as any).showSaveFilePicker;
    });

    it('creates memory target when showSaveFilePicker is absent', async () => {
      delete (globalThis as any).showSaveFilePicker;

      const target = await createOutputTarget({ suggestedName: 'test.mp4', estimatedBytes: 50 * 1024 * 1024 });
      expect(target.kind).toBe('memory');

      const blob = await target.finalize();
      expect(blob).toBeInstanceOf(Blob);
    });

    it('invokes target.abort() on export error in disk mode', async () => {
      const mockWritable = Object.create(MockFileSystemWritableFileStream.prototype);
      mockWritable.write = vi.fn().mockResolvedValue(undefined);
      mockWritable.close = vi.fn().mockResolvedValue(undefined);
      mockWritable.abort = vi.fn().mockResolvedValue(undefined);

      const mockHandle = {
        createWritable: vi.fn().mockResolvedValue(mockWritable),
      };
      (globalThis as any).window = globalThis;
      (globalThis as any).showSaveFilePicker = vi.fn().mockResolvedValue(mockHandle);

      const target = await createOutputTarget({ suggestedName: 'test.mp4', estimatedBytes: 50 * 1024 * 1024 });
      const mockScene = {
        beginExport: vi.fn(),
        endExport: vi.fn(),
        renderer: { domElement: {} },
        updateAudioReactivity: vi.fn(),
        render: vi.fn(),
      } as any;

      (globalThis as any).VideoFrame = class MockVideoFrame { close() {} };
      class FailingVideoEncoder {
        public encodeQueueSize = 0;
        public state = 'configured';
        private callbacks: any;
        constructor(callbacks: any) {
          this.callbacks = callbacks;
        }
        static isConfigSupported = vi.fn().mockResolvedValue({ supported: true, hardwareAcceleration: 'prefer-hardware' });
        configure() {}
        encode() {
          if (this.callbacks.error) {
            this.callbacks.error(new Error('Hardware encoding failed'));
          }
        }
        addEventListener() {}
        removeEventListener() {}
        async flush() {}
        close() { this.state = 'closed'; }
      }
      (globalThis as any).VideoEncoder = FailingVideoEncoder;

      try {
        await exportVideo(mockScene, null, 1, { target });
        expect.unreachable('Should have thrown error');
      } catch (err: any) {
        expect(err.message).toBe('Hardware encoding failed');
      }

      expect(mockWritable.abort).toHaveBeenCalledTimes(1);
      delete (globalThis as any).showSaveFilePicker;
    });
  });

  describe('Memory Guard Thresholds', () => {
    it('uses 400 MB threshold when deviceMemory <= 4 or coarse pointer matches', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: { deviceMemory: 4 },
        configurable: true,
        writable: true,
      });
      expect(getMemoryGuardThresholdBytes()).toBe(400 * 1024 * 1024);

      Object.defineProperty(globalThis, 'navigator', {
        value: { deviceMemory: 2 },
        configurable: true,
        writable: true,
      });
      expect(getMemoryGuardThresholdBytes()).toBe(400 * 1024 * 1024);

      Object.defineProperty(globalThis, 'navigator', {
        value: { deviceMemory: 8 },
        configurable: true,
        writable: true,
      });
      (globalThis as any).window = {
        matchMedia: (q: string) => ({ matches: q.includes('coarse') }),
      };
      expect(getMemoryGuardThresholdBytes()).toBe(400 * 1024 * 1024);
    });

    it('uses 1.5 GB threshold on standard desktop devices', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: { deviceMemory: 8 },
        configurable: true,
        writable: true,
      });
      (globalThis as any).window = {
        matchMedia: () => ({ matches: false }),
      };
      expect(getMemoryGuardThresholdBytes()).toBe(1.5 * 1024 * 1024 * 1024);
    });

    it('throws memory guard error when exceeding threshold in memory mode', async () => {
      delete (globalThis as any).showSaveFilePicker;
      Object.defineProperty(globalThis, 'navigator', {
        value: { deviceMemory: 4 },
        configurable: true,
        writable: true,
      });

      await expect(
        createOutputTarget({ estimatedBytes: 450 * 1024 * 1024 })
      ).rejects.toThrow(/exceeds the 400 MB in-memory limit/i);
    });
  });

  describe('recommendExportSettings', () => {
    it('recommends 720p30 for coarse pointer or low memory <= 4', () => {
      expect(recommendExportSettings({ deviceMemory: 4, coarsePointer: false })).toEqual({
        width: 1280,
        height: 720,
        fps: 30,
        label: '720p30',
      });

      expect(recommendExportSettings({ deviceMemory: 16, coarsePointer: true })).toEqual({
        width: 1280,
        height: 720,
        fps: 30,
        label: '720p30',
      });
    });

    it('recommends 1080p60 for deviceMemory >= 8 and non-coarse pointer', () => {
      expect(recommendExportSettings({ deviceMemory: 8, coarsePointer: false })).toEqual({
        width: 1920,
        height: 1080,
        fps: 60,
        label: '1080p60',
      });
    });

    it('recommends 1080p30 for mid-range desktop devices', () => {
      expect(recommendExportSettings({ deviceMemory: 6, coarsePointer: false })).toEqual({
        width: 1920,
        height: 1080,
        fps: 30,
        label: '1080p30',
      });

      expect(recommendExportSettings({ coarsePointer: false })).toEqual({
        width: 1920,
        height: 1080,
        fps: 30,
        label: '1080p30',
      });
    });
  });

  describe('Wake Lock & API Safety', () => {
    it('acquires wake lock and re-acquires on visibilitychange', async () => {
      const mockSentinel = { release: vi.fn().mockResolvedValue(undefined) };
      const requestFn = vi.fn().mockResolvedValue(mockSentinel);

      Object.defineProperty(globalThis, 'navigator', {
        value: { wakeLock: { request: requestFn } },
        configurable: true,
        writable: true,
      });

      const listeners: Record<string, Function> = {};
      (globalThis as any).document = {
        visibilityState: 'visible',
        addEventListener: (evt: string, fn: Function) => {
          listeners[evt] = fn;
        },
        removeEventListener: (evt: string, fn: Function) => {
          delete listeners[evt];
        },
      };

      const lock = await acquireWakeLock();
      expect(requestFn).toHaveBeenCalledWith('screen');

      if (listeners['visibilitychange']) {
        await listeners['visibilitychange']();
      }
      expect(requestFn).toHaveBeenCalledTimes(2);

      await lock.release();
      expect(mockSentinel.release).toHaveBeenCalledTimes(1);
      expect(listeners['visibilitychange']).toBeUndefined();
    });

    it('never throws when wakeLock is unsupported or rejects', async () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: {},
        configurable: true,
        writable: true,
      });
      const lock = await acquireWakeLock();
      await expect(lock.release()).resolves.not.toThrow();

      Object.defineProperty(globalThis, 'navigator', {
        value: { wakeLock: { request: vi.fn().mockRejectedValue(new Error('Low battery')) } },
        configurable: true,
        writable: true,
      });
      const lock2 = await acquireWakeLock();
      await expect(lock2.release()).resolves.not.toThrow();
    });
  });

  describe('yieldToEventLoop', () => {
    it('uses MessageChannel when present', async () => {
      let channelUsed = false;
      class MockMessageChannel {
        port1 = { onmessage: null as any };
        port2 = {
          postMessage: () => {
            channelUsed = true;
            if (this.port1.onmessage) this.port1.onmessage();
          },
        };
      }
      (globalThis as any).MessageChannel = MockMessageChannel;

      await yieldToEventLoop();
      expect(channelUsed).toBe(true);

      delete (globalThis as any).MessageChannel;
    });

    it('falls back to setTimeout when MessageChannel is absent', async () => {
      delete (globalThis as any).MessageChannel;
      const start = Date.now();
      await yieldToEventLoop();
      expect(Date.now() - start).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('Phase 3c Fail Safe Disk Export Tests Standalone', () => {
  it('supportsDiskExport is false when pointer is coarse even if showSaveFilePicker exists', () => {
    (globalThis as any).window = {
      showSaveFilePicker: vi.fn(),
      matchMedia: (q: string) => ({ matches: q.includes('coarse') }),
    };

    expect(supportsDiskExport()).toBe(false);

    (globalThis as any).window = {
      showSaveFilePicker: vi.fn(),
      matchMedia: (q: string) => ({ matches: false }),
    };

    expect(supportsDiskExport()).toBe(true);

    delete (globalThis as any).window;
  });
});
