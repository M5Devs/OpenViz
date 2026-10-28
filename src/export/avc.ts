export interface AvcLevelEntry {
  levelIdc: number; // e.g. 0x1E
  maxMbps: number;
  maxFs: number;
}

export const AVC_LEVEL_TABLE: AvcLevelEntry[] = [
  { levelIdc: 0x1e, maxMbps: 40500, maxFs: 1620 },
  { levelIdc: 0x1f, maxMbps: 108000, maxFs: 3600 },
  { levelIdc: 0x20, maxMbps: 216000, maxFs: 5120 },
  { levelIdc: 0x28, maxMbps: 245760, maxFs: 8192 },
  { levelIdc: 0x29, maxMbps: 245760, maxFs: 8192 },
  { levelIdc: 0x2a, maxMbps: 522240, maxFs: 8704 },
  { levelIdc: 0x32, maxMbps: 589824, maxFs: 22080 },
  { levelIdc: 0x33, maxMbps: 983040, maxFs: 36864 },
  { levelIdc: 0x34, maxMbps: 2073600, maxFs: 36864 },
];

/**
 * Calculates the lowest H.264 level (level_idc number) for the given resolution and frame rate.
 */
export function pickAvcLevel(width: number, height: number, fps: number): number {
  const mbs = Math.ceil(width / 16) * Math.ceil(height / 16);
  const mbps = mbs * fps;

  for (const lvl of AVC_LEVEL_TABLE) {
    if (mbs <= lvl.maxFs && mbps <= lvl.maxMbps) {
      return lvl.levelIdc;
    }
  }

  return 0x34; // Highest supported in table
}

/**
 * Calculates export width (forced to even integer) and height from target height and aspect ratio.
 */
export function computeExportSize(height: number, aspect: number): { width: number; height: number } {
  let width = Math.round(height * aspect);
  if (width % 2 !== 0) {
    width += 1;
  }
  return { width, height };
}
