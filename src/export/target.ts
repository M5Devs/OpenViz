import { ArrayBufferTarget, FileSystemWritableFileStreamTarget, StreamTarget } from 'mp4-muxer';

export type MuxerTargetType = ArrayBufferTarget | FileSystemWritableFileStreamTarget | StreamTarget;

export interface OutputTargetOptions {
  suggestedName?: string;
  estimatedBytes: number;
}

export interface OutputTarget {
  kind: 'disk' | 'memory';
  muxerTarget: MuxerTargetType;
  finalize(): Promise<Blob | null>;
  abort(): Promise<void>;
}

export function getMemoryGuardThresholdBytes(): number {
  const deviceMemory = typeof navigator !== 'undefined' ? (navigator as any).deviceMemory : undefined;
  const isCoarse =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;

  if ((deviceMemory !== undefined && deviceMemory <= 4) || isCoarse) {
    return 400 * 1024 * 1024;
  }
  return 1.5 * 1024 * 1024 * 1024;
}

export async function createOutputTarget(options: OutputTargetOptions): Promise<OutputTarget> {
  const suggestedName = options.suggestedName || 'openviz_render.mp4';
  const estimatedBytes = options.estimatedBytes;

  if (typeof window !== 'undefined' && typeof (window as any).showSaveFilePicker === 'function') {
    // Disk mode: prompt for save file picker immediately
    const handle = await (window as any).showSaveFilePicker({
      suggestedName,
      types: [
        {
          description: 'MP4 video',
          accept: { 'video/mp4': ['.mp4'] },
        },
      ],
    });

    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      try {
        const { quota, usage } = await navigator.storage.estimate();
        if (quota !== undefined && usage !== undefined && quota - usage < estimatedBytes * 1.1) {
          console.warn(
            `Storage warning: estimated export size (${(estimatedBytes / (1024 * 1024)).toFixed(
              1
            )} MB) may exceed available space (${((quota - usage) / (1024 * 1024)).toFixed(1)} MB available).`
          );
        }
      } catch (e) {
        // Ignore storage estimate failures
      }
    }

    const writable = await handle.createWritable();
    const muxerTarget = new FileSystemWritableFileStreamTarget(writable);

    return {
      kind: 'disk',
      muxerTarget,
      async finalize() {
        await writable.close();
        return null;
      },
      async abort() {
        try {
          await writable.abort();
        } catch (e) {
          // Ignore abort errors if already closed or aborted
        }
      },
    };
  } else {
    // Memory mode
    const threshold = getMemoryGuardThresholdBytes();
    if (estimatedBytes > threshold) {
      const thresholdStr =
        threshold >= 1024 * 1024 * 1024
          ? `${(threshold / (1024 * 1024 * 1024)).toFixed(1)} GB`
          : `${(threshold / (1024 * 1024)).toFixed(0)} MB`;
      const estMB = (estimatedBytes / (1024 * 1024)).toFixed(0);
      throw new Error(
        `Estimated export size (${estMB} MB) exceeds the ${thresholdStr} in-memory limit. Please select a lower resolution, frame rate, or quality.`
      );
    }

    const muxerTarget = new ArrayBufferTarget();

    return {
      kind: 'memory',
      muxerTarget,
      async finalize() {
        const buffer = muxerTarget.buffer;
        return new Blob([buffer], { type: 'video/mp4' });
      },
      async abort() {
        // In-memory target cleanup is handled by JS garbage collection
      },
    };
  }
}
