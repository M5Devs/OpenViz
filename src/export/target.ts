import { ArrayBufferTarget, FileSystemWritableFileStreamTarget, StreamTarget } from 'mp4-muxer';

export type MuxerTargetType = ArrayBufferTarget | FileSystemWritableFileStreamTarget | StreamTarget;

export interface OutputTargetOptions {
  suggestedName?: string;
  estimatedBytes: number;
  forceMemoryMode?: boolean;
}

export interface OutputTarget {
  kind: 'disk' | 'memory';
  muxerTarget: MuxerTargetType;
  fatalError?: Error | null;
  finalize(): Promise<Blob | null>;
  abort(): Promise<void>;
}

export function supportsDiskExport(): boolean {
  if (typeof window === 'undefined') return false;
  const hasSavePicker = typeof (window as any).showSaveFilePicker === 'function';
  const isCoarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return hasSavePicker && !isCoarse;
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

  if (supportsDiskExport() && !options.forceMemoryMode) {
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

    let writeQueue: Promise<void> = Promise.resolve();

    const targetObj: OutputTarget = {
      kind: 'disk',
      muxerTarget: null as any,
      fatalError: null,
      async finalize() {
        await writeQueue;
        if (targetObj.fatalError) {
          throw targetObj.fatalError;
        }
        await writable.close();
        return null;
      },
      async abort() {
        try {
          await writeQueue;
        } catch (e) {
          // Ignore write errors on abort
        }
        try {
          await writable.abort();
        } catch (e) {
          // Ignore abort errors if already closed or aborted
        }
      },
    };

    const muxerTarget = new StreamTarget({
      onData: (data: Uint8Array, position: number) => {
        if (targetObj.fatalError) return;
        writeQueue = writeQueue
          .then(async () => {
            if (targetObj.fatalError) return;
            await writable.write({ type: 'write', data, position });
          })
          .catch((err) => {
            if (!targetObj.fatalError) {
              targetObj.fatalError = err instanceof Error ? err : new Error(String(err));
            }
          });
      },
    });

    targetObj.muxerTarget = muxerTarget;
    return targetObj;
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
      fatalError: null,
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
