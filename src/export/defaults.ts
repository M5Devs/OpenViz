export interface ExportEnvironment {
  deviceMemory?: number;
  hardwareConcurrency?: number;
  coarsePointer: boolean;
}

export interface RecommendedSettings {
  width: number;
  height: number;
  fps: number;
  label: '720p30' | '1080p30' | '1080p60';
}

export function recommendExportSettings(env: ExportEnvironment): RecommendedSettings {
  const { deviceMemory, coarsePointer } = env;

  if (coarsePointer || (deviceMemory !== undefined && deviceMemory <= 4)) {
    return {
      width: 1280,
      height: 720,
      fps: 30,
      label: '720p30',
    };
  }

  if (deviceMemory !== undefined && deviceMemory >= 8 && !coarsePointer) {
    return {
      width: 1920,
      height: 1080,
      fps: 60,
      label: '1080p60',
    };
  }

  return {
    width: 1920,
    height: 1080,
    fps: 30,
    label: '1080p30',
  };
}

export function yieldToEventLoop(): Promise<void> {
  if (typeof MessageChannel !== 'undefined') {
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => resolve();
      channel.port2.postMessage(null);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function estimateVideoBitrate(
  width: number,
  height: number,
  fps: number,
  quality: 'low' | 'medium' | 'high' = 'medium'
): number {
  const pixels = width * height;
  let baseBitrate = 8_000_000;

  if (pixels <= 1280 * 720) {
    baseBitrate = 4_000_000;
  } else if (pixels <= 1920 * 1080) {
    baseBitrate = 8_000_000;
  } else if (pixels <= 2560 * 1440) {
    baseBitrate = 14_000_000;
  } else {
    baseBitrate = 25_000_000;
  }

  if (fps > 30) {
    baseBitrate *= 1.4;
  }

  const mult = quality === 'low' ? 0.6 : quality === 'high' ? 1.5 : 1.0;
  return Math.round(baseBitrate * mult);
}

export function estimateExportSizeBytes(
  durationSeconds: number,
  width: number,
  height: number,
  fps: number,
  quality: 'low' | 'medium' | 'high' = 'medium',
  hasAudio: boolean = true
): number {
  const videoBitrate = estimateVideoBitrate(width, height, fps, quality);
  const audioBitrate = hasAudio ? 192_000 : 0;
  const totalBitrate = videoBitrate + audioBitrate;
  return Math.round((totalBitrate * durationSeconds) / 8);
}
