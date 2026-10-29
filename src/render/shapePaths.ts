import { ShapePathType } from '../types';

export interface ShapePoint {
  x: number;
  y: number;
  normalX: number;
  normalY: number;
  angle: number;
}

const letterContourCache: Map<string, { x: number; y: number }[]> = new Map();

function generateFallbackLetterContour(symbol: string): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  const N = 64;
  for (let i = 0; i < N; i++) {
    const angle = (i / N) * Math.PI * 2;
    points.push({
      x: Math.cos(angle),
      y: Math.sin(angle),
    });
  }
  return points;
}

function extractLetterContour(char: string): { x: number; y: number }[] {
  const symbol = (char || 'A').charAt(0).toUpperCase();
  if (letterContourCache.has(symbol)) {
    return letterContourCache.get(symbol)!;
  }

  if (typeof document === 'undefined') {
    const fallbackPoints = generateFallbackLetterContour(symbol);
    letterContourCache.set(symbol, fallbackPoints);
    return fallbackPoints;
  }

  const canvas = document.createElement('canvas');
  const size = 256;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    const fallbackPoints = generateFallbackLetterContour(symbol);
    letterContourCache.set(symbol, fallbackPoints);
    return fallbackPoints;
  }

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 180px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(symbol, size / 2, size / 2);

  const imgData = ctx.getImageData(0, 0, size, size);
  const data = imgData.data;

  const edgePixels: { x: number; y: number }[] = [];
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const idx = (y * size + x) * 4;
      const val = data[idx];
      if (val > 128) {
        const top = data[((y - 1) * size + x) * 4];
        const bottom = data[((y + 1) * size + x) * 4];
        const left = data[(y * size + (x - 1)) * 4];
        const right = data[(y * size + (x + 1)) * 4];
        if (top <= 128 || bottom <= 128 || left <= 128 || right <= 128) {
          edgePixels.push({
            x: (x - size / 2) / (size / 2),
            y: -(y - size / 2) / (size / 2),
          });
        }
      }
    }
  }

  if (edgePixels.length < 3) {
    const fallbackPoints = generateFallbackLetterContour(symbol);
    letterContourCache.set(symbol, fallbackPoints);
    return fallbackPoints;
  }

  edgePixels.sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x));
  letterContourCache.set(symbol, edgePixels);
  return edgePixels;
}

export function sampleShapePath(
  shapePath: ShapePathType | undefined,
  index: number,
  total: number,
  innerRadius: number,
  options?: {
    sidedPolygonSides?: number;
    sidedPolygonRounding?: number;
    letterChar?: string;
  }
): ShapePoint {
  const pathType = shapePath || 'Circle';
  const N = Math.max(1, total);

  if (pathType === 'HorizontalLine') {
    const totalWidth = innerRadius > 0 ? innerRadius * 2 : 1400;
    const t = N > 1 ? index / (N - 1) : 0.5;
    const x = -totalWidth / 2 + t * totalWidth;
    const y = 0;
    return {
      x,
      y,
      normalX: 0,
      normalY: 1,
      angle: 0,
    };
  }

  if (pathType === 'SidedPolygon') {
    const sides = Math.max(3, Math.min(12, options?.sidedPolygonSides ?? 4));
    const rounding = Math.max(0, Math.min(1, options?.sidedPolygonRounding ?? 0));
    const t = (index / N) % 1.0;
    const angleStep = (Math.PI * 2) / sides;

    const sideIdx = Math.floor(t * sides);
    const sideFrac = t * sides - sideIdx;

    const a1 = sideIdx * angleStep;
    const a2 = (sideIdx + 1) * angleStep;

    const v1x = Math.cos(a1) * innerRadius;
    const v1y = Math.sin(a1) * innerRadius;
    const v2x = Math.cos(a2) * innerRadius;
    const v2y = Math.sin(a2) * innerRadius;

    let polyX = v1x + sideFrac * (v2x - v1x);
    let polyY = v1y + sideFrac * (v2y - v1y);

    if (rounding > 0) {
      const circleAngle = t * Math.PI * 2;
      const circX = Math.cos(circleAngle) * innerRadius;
      const circY = Math.sin(circleAngle) * innerRadius;
      polyX = (1 - rounding) * polyX + rounding * circX;
      polyY = (1 - rounding) * polyY + rounding * circY;
    }

    const circleAngle = Math.atan2(polyY, polyX);
    const normalX = Math.cos(circleAngle);
    const normalY = Math.sin(circleAngle);
    const angle = circleAngle - Math.PI / 2;

    return {
      x: polyX,
      y: polyY,
      normalX,
      normalY,
      angle,
    };
  }

  if (pathType === 'Letter') {
    const contour = extractLetterContour(options?.letterChar || 'A');
    const contourLen = contour.length;
    const idx = Math.floor((index / N) * contourLen) % contourLen;
    const pt = contour[idx];
    const r = innerRadius > 0 ? innerRadius : 200;

    const x = pt.x * r;
    const y = pt.y * r;

    const nextIdx = (idx + 1) % contourLen;
    const nextPt = contour[nextIdx];
    const dx = (nextPt.x - pt.x) * r;
    const dy = (nextPt.y - pt.y) * r;

    let normalX = -dy;
    let normalY = dx;
    const len = Math.hypot(normalX, normalY);
    if (len > 1e-5) {
      normalX /= len;
      normalY /= len;
    } else {
      normalX = Math.cos((index / N) * Math.PI * 2);
      normalY = Math.sin((index / N) * Math.PI * 2);
    }

    const angle = Math.atan2(normalY, normalX) - Math.PI / 2;

    return {
      x,
      y,
      normalX,
      normalY,
      angle,
    };
  }

  // Default: Circle
  const angle = (index / N) * Math.PI * 2;
  const x = Math.cos(angle) * innerRadius;
  const y = Math.sin(angle) * innerRadius;
  return {
    x,
    y,
    normalX: Math.cos(angle),
    normalY: Math.sin(angle),
    angle: angle - Math.PI / 2,
  };
}
