import JSZip from 'jszip';
import {
  OpenVizTemplate,
  OpenVizNode,
  AudioBinding,
  BindingSource,
  BindingTarget,
  PostEffect,
  BarsNodeData,
  ImageNodeData,
  TextNodeData,
} from '../types';
import { validateTemplate } from '../schema/validate';
import { ObjectUrlRegistry } from '../assets/registry';

export interface RawProp {
  v?: any;
  t?: string;
  o?: number;
  tag?: string;
  children?: Record<string, RawProp>;
  [key: string]: any;
}

export interface ImportOptions {
  maxEntries?: number;
  maxTotalBytes?: number;
  maxFileBytes?: number;
  assetMode?: 'blob' | 'dataUrl';
  registry?: ObjectUrlRegistry;
}

export function pick<T>(...candidates: (T | undefined | null)[]): T | undefined {
  for (const c of candidates) {
    if (c !== undefined && c !== null) {
      return c;
    }
  }
  return undefined;
}

export function parseRawProp(prop?: any): RawProp {
  if (!prop) return {};
  if (typeof prop === 'object' && !Array.isArray(prop)) {
    return prop as RawProp;
  }
  return { v: prop };
}

export function getF32(prop?: any, fallback = 0): number {
  if (prop === undefined || prop === null) return fallback;
  const p = parseRawProp(prop);
  const v = p.v !== undefined ? p.v : p;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const parsed = parseFloat(v);
    return isNaN(parsed) ? fallback : parsed;
  }
  if (Array.isArray(v) && v.length > 0) return getF32(v[0], fallback);
  return fallback;
}

export function getI32(prop?: any, fallback = 0): number {
  const val = getF32(prop, fallback);
  return Math.round(val);
}

export function getBool(prop?: any, fallback = false): boolean {
  if (prop === undefined || prop === null) return fallback;
  const p = parseRawProp(prop);
  const v = p.v !== undefined ? p.v : p;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.toLowerCase() === 'true' || v === '1';
  if (typeof v === 'number') return v !== 0;
  return fallback;
}

export function getF32Tuple2(prop?: any, fallback: [number, number] = [0, 0]): [number, number] {
  if (prop === undefined || prop === null) return fallback;
  const p = parseRawProp(prop);
  const v = p.v !== undefined ? p.v : p;
  if (typeof v === 'string') {
    const parts = v.trim().split(/\s+/).map((p) => parseFloat(p));
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      return [parts[0], parts[1]];
    } else if (parts.length === 1 && !isNaN(parts[0])) {
      return [parts[0], parts[0]];
    }
  }
  if (Array.isArray(v)) {
    if (v.length >= 2) return [getF32(v[0]), getF32(v[1])];
    if (v.length === 1) {
      const val = getF32(v[0]);
      return [val, val];
    }
  }
  if (typeof v === 'number') return [v, v];
  return fallback;
}

export function getString(prop?: any, fallback = ''): string {
  if (prop === undefined || prop === null) return fallback;
  const p = parseRawProp(prop);
  const v = p.v !== undefined ? p.v : p;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback;
}

export function getColorRGBA(prop?: any): [number, number, number, number] {
  if (prop === undefined || prop === null) return [0.0, 0.9, 1.0, 1.0];
  const p = parseRawProp(prop);
  const v = p.v !== undefined ? p.v : p;

  if (typeof v === 'number') {
    const valU = v >>> 0;
    const a = ((valU >> 24) & 0xff) / 255.0;
    const r = ((valU >> 16) & 0xff) / 255.0;
    const g = ((valU >> 8) & 0xff) / 255.0;
    const b = (valU & 0xff) / 255.0;
    return [r, g, b, a];
  }

  if (typeof v === 'string') {
    let hex = v.trim();
    if (hex.startsWith('#')) hex = hex.substring(1);
    if (hex.length === 8) {
      const valU = parseInt(hex, 16) >>> 0;
      const a = ((valU >> 24) & 0xff) / 255.0;
      const r = ((valU >> 16) & 0xff) / 255.0;
      const g = ((valU >> 8) & 0xff) / 255.0;
      const b = (valU & 0xff) / 255.0;
      return [r, g, b, a];
    } else if (hex.length === 6) {
      const valU = parseInt(hex, 16) >>> 0;
      const r = ((valU >> 16) & 0xff) / 255.0;
      const g = ((valU >> 8) & 0xff) / 255.0;
      const b = (valU & 0xff) / 255.0;
      return [r, g, b, 1.0];
    }
  }

  if (Array.isArray(v) && v.length >= 3) {
    const r = getF32(v[0]);
    const g = getF32(v[1]);
    const b = getF32(v[2]);
    const a = v.length >= 4 ? getF32(v[3]) : 1.0;
    return [r, g, b, a];
  }

  return [0.0, 0.9, 1.0, 1.0];
}

export function extractAudioBinding(prop: any, target: BindingTarget): AudioBinding | null {
  if (!prop) return null;
  const p = parseRawProp(prop);

  let childNode: any = null;
  if (p.children) {
    if (p.children._child) childNode = p.children._child;
    else {
      const firstKey = Object.keys(p.children)[0];
      if (firstKey) childNode = p.children[firstKey];
    }
  }

  if (!childNode) return null;

  const grandChildren = childNode.children || childNode;
  const sourceStr = getString(grandChildren.measureWhat || grandChildren.source, 'Bass');
  const minOut = getF32(grandChildren.A, 1.0);
  const maxOut = getF32(grandChildren.B, 1.5);

  const sourceMap: Record<string, BindingSource> = {
    bass: 'Bass',
    mid: 'Mid',
    high: 'High',
    beat: 'Beat',
    rms: 'Rms',
    spectrum: 'Spectrum',
  };

  const normSource = sourceStr.toLowerCase();
  const source: BindingSource = sourceMap[normSource] || 'Bass';

  return {
    source,
    target,
    outputRange: [minOut, maxOut],
  };
}

export function isPathTraversal(filename: string): boolean {
  if (!filename) return false;
  if (/^[a-zA-Z]:/.test(filename) || filename.startsWith('/') || filename.startsWith('\\')) {
    return true;
  }
  const segments = filename.split(/[/\\]/);
  for (const seg of segments) {
    if (seg === '..') return true;
  }
  return false;
}

function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'webp': return 'image/webp';
    case 'gif': return 'image/gif';
    default: return 'image/png';
  }
}

function uint8ArrayToBase64(uint8: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(uint8).toString('base64');
  }
  let binary = '';
  const len = uint8.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return btoa(binary);
}

async function readEntryStream(
  entry: JSZip.JSZipObject,
  type: 'string' | 'blob' | 'uint8array',
  maxFileBytes: number,
  onBytesRead?: (added: number) => void
): Promise<any> {
  const uncompressedSize = (entry as any)._data?.uncompressedSize;
  if (typeof uncompressedSize === 'number' && uncompressedSize > maxFileBytes) {
    throw new Error(`Zip entry exceeds maximum file size limit of ${maxFileBytes} bytes`);
  }

  return new Promise((resolve, reject) => {
    let bytesRead = 0;
    const stream = (entry as any).internalStream(type as any);
    const chunks: any[] = [];

    stream.on('data', (chunk: any) => {
      const len = chunk.length || chunk.byteLength || 0;
      bytesRead += len;
      if (onBytesRead) {
        try {
          onBytesRead(len);
        } catch (err) {
          stream.pause();
          reject(err);
          return;
        }
      }
      if (bytesRead > maxFileBytes) {
        stream.pause();
        reject(new Error(`Zip entry exceeds maximum file size limit of ${maxFileBytes} bytes`));
        return;
      }
      chunks.push(chunk);
    });

    stream.on('error', (err: Error) => reject(err));

    stream.on('end', () => {
      if (type === 'string') {
        resolve(chunks.join(''));
      } else if (type === 'blob') {
        resolve(new Blob(chunks));
      } else if (type === 'uint8array') {
        const total = new Uint8Array(bytesRead);
        let offset = 0;
        for (const c of chunks) {
          const u8 = c instanceof Uint8Array ? c : new Uint8Array(c);
          total.set(u8, offset);
          offset += u8.length;
        }
        resolve(total);
      } else {
        resolve(chunks);
      }
    });

    stream.resume();
  });
}

export class AveeImporter {
  private extractedAssets: Record<string, string> = {};
  private nodes: OpenVizNode[] = [];
  private postEffects: PostEffect[] = [];
  private nodeCounter = 0;

  public async importViz(
    buffer: ArrayBuffer | Uint8Array,
    options: ImportOptions = {}
  ): Promise<OpenVizTemplate> {
    const registry = options.registry;
    const maxTotalBytes = options.maxTotalBytes ?? 200 * 1024 * 1024;
    const maxFileBytes = options.maxFileBytes ?? 50 * 1024 * 1024;
    const assetMode = options.assetMode ?? 'blob';

    const zip = await JSZip.loadAsync(buffer);
    const fileKeys = Object.keys(zip.files);

    let totalBytesRead = 0;
    const checkTotalBytes = (added: number) => {
      totalBytesRead += added;
      if (totalBytesRead > maxTotalBytes) {
        throw new Error(`Zip archive exceeds total decompressed byte limit of ${maxTotalBytes} bytes`);
      }
    };

    let sceneJsonFilename: string | null = null;

    // استخراج الأصول فوراً
    for (const filename of fileKeys) {
      if (isPathTraversal(filename)) {
        throw new Error(`Security violation: path traversal detected '${filename}'`);
      }

      if (filename.toLowerCase() === 'scene.json' || filename.toLowerCase().endsWith('/scene.json')) {
        sceneJsonFilename = filename;
      } else if (!zip.files[filename].dir) {
        try {
          const cleanName = filename.replace(/^local:/, '').trim();
          if (assetMode === 'dataUrl') {
            const u8 = await readEntryStream(zip.files[filename], 'uint8array', maxFileBytes, checkTotalBytes);
            const mime = getMimeType(filename);
            const dataUrl = `data:${mime};base64,${uint8ArrayToBase64(u8)}`;
            this.extractedAssets[cleanName] = dataUrl;
            this.extractedAssets[filename] = dataUrl;
          } else {
            const blob = await readEntryStream(zip.files[filename], 'blob', maxFileBytes, checkTotalBytes);
            const url = registry ? registry.create(blob) : URL.createObjectURL(blob);
            this.extractedAssets[cleanName] = url;
            this.extractedAssets[filename] = url;
          }
        } catch (e) {
          console.warn(`Could not extract asset: ${filename}`);
        }
      }
    }

    if (!sceneJsonFilename) {
      throw new Error('Invalid Avee .viz: Missing scene.json');
    }

    const sceneJsonText = await readEntryStream(zip.files[sceneJsonFilename], 'string', maxFileBytes, checkTotalBytes);
    const rawData = JSON.parse(sceneJsonText);

    this.extractCompositions(rawData);

    const rawTemplate: OpenVizTemplate = {
      schemaVersion: 'openviz/1',
      name: 'Imported Avee Template',
      author: 'Avee Importer',
      canvasAspect: '16:9',
      clearColor: [0.03, 0.03, 0.06, 1.0],
      nodes: this.nodes,
      postEffects: this.postEffects,
      assets: this.extractedAssets,
    };

    const validation = validateTemplate(rawTemplate);
    if (!validation.ok) {
      console.warn('Template validation warnings:', validation.errors);
      return rawTemplate;
    }

    return validation.template;
  }

  private extractCompositions(rawData: any) {
    this.nodes = [];
    this.postEffects = [];
    this.nodeCounter = 0;

    const rawComps = Array.isArray(rawData.compositions)
      ? rawData.compositions
      : rawData.compositions
      ? [rawData.compositions]
      : [];

    for (let cIdx = 0; cIdx < rawComps.length; cIdx++) {
      const comp = rawComps[cIdx];
      const elements = Array.isArray(comp.elements) ? comp.elements : [];

      for (let eIdx = 0; eIdx < elements.length; eIdx++) {
        const el = elements[eIdx];
        if (!el || typeof el !== 'object') continue;

        const objType = String(el.objType || el.type || '').trim();
        const name = String(el._name || `${objType}_C${cIdx}_E${eIdx}`).trim();

        // تطبيع إحداثيات ومحاذاة أيفي
        const rawPos = getF32Tuple2(pick(el.position, el.children?.position), [0.5, 0.5]);
        const anchor = getF32Tuple2(pick(el.anchor, el.alignmentPosition, el.children?.alignmentPosition), [0.5, 0.5]);

        const posX = Math.round((rawPos[0] - anchor[0]) * 1920);
        const posY = Math.round((anchor[1] - rawPos[1]) * 1080);

        const rawScale = getF32Tuple2(pick(el.scale, el.children?.scale), [1.0, 1.0]);
        const rot = getF32(pick(el.rotation, el.children?.rotation), 0);
        const opacity = getF32(pick(el.alpha, el.opacity, el.children?.alpha, el.children?.opacity), 1.0);

        const nodeId = `node_${this.nodeCounter++}`;

        // فحص ذكي للخلفية: إما بالاسم أو لو واخدة أبعاد كاملة وفي أول الطبقات
        const nameMatches = /(^|[\s_\-.])(background|wallpaper|bg)($|[\s_\-.])/i.test(name);
        const isFullScale = (rawScale[0] >= 1.0 && rawScale[1] >= 1.0 && Math.abs(rawPos[0] - 0.5) < 0.1 && Math.abs(rawPos[1] - 0.5) < 0.1);
        const isWallpaper = nameMatches || (isFullScale && this.nodes.length === 0);

        // 1. معالجة البارات
        if (objType === 'Bars') {
          const shapePath = String(pick(el.ShapePath?.v, el.ShapePath, 'Circle')).toLowerCase();
          const isRadial = shapePath.includes('circle') || shapePath.includes('radial');
          const count = Math.round(getF32(pick(el.barCount, el.sampleCount), 64)) || 64;

          const rawRadius = getF32(pick(el.radius, el.innerRadius), 0);
          const innerRadius = rawRadius > 0 ? (rawRadius < 1.0 ? rawRadius * 960 : rawRadius) : 300;
          const width = getF32(pick(el.barWidth, el.width), 5) || 5;

          const colorStart = getColorRGBA(pick(el.colorStart, el.color));
          const colorEnd = getColorRGBA(pick(el.colorEnd, el.color));

          const barsData: BarsNodeData = {
            count,
            innerRadius,
            width,
            isRadial,
            colorStart,
            colorEnd,
          };

          this.nodes.push({
            id: nodeId,
            name,
            type: 'Bars',
            transform: { position: [posX, posY], scale: [1.0, 1.0], rotation: rot, opacity },
            bindings: [{ source: 'Bass', target: 'BarHeight', outputRange: [0.05, 0.4] }],
            barsData,
          });
        }

        // 2. معالجة الصور
        else if (objType === 'Image') {
          const rawImg = String(pick(el.customImage?.v, el.customImage, el.image?.v, el.image, el.path?.v, el.path) || '').trim();

          if (!rawImg || rawImg.startsWith('composition:') || rawImg.includes('mask')) {
            continue;
          }

          const cleanAssetId = rawImg.replace(/^local:/, '').trim();
          const imgUrl = this.extractedAssets[cleanAssetId] || this.extractedAssets[rawImg];

          let mappedScale: [number, number] = [1.0, 1.0];
          let fitMode: 'contain' | 'cover' = isWallpaper ? 'cover' : 'contain';

          if (!isWallpaper) {
            mappedScale = rawScale[0] > 10 ? [rawScale[0] / 360, rawScale[1] / 360] : rawScale;
          }

          this.nodes.push({
            id: nodeId,
            name,
            type: 'Image',
            transform: { position: [posX, posY], scale: mappedScale, rotation: rot, opacity },
            bindings: isWallpaper ? [] : [{ source: 'Bass', target: 'ScaleUniform', outputRange: [1.0, 1.08] }],
            imageData: {
              assetId: cleanAssetId,
              url: imgUrl,
              fit: fitMode,
            },
          });
        }

        // 3. معالجة النصوص
        else if (objType === 'Text') {
          const text = String(pick(el.text?.v, el.text, 'OpenViz')).trim();
          const fontSize = Math.round(getF32(pick(el.fontSize, el.textSize, el.size), 28)) || 28;

          this.nodes.push({
            id: nodeId,
            name,
            type: 'Text',
            transform: { position: [posX, posY], scale: [1.0, 1.0], rotation: rot, opacity },
            bindings: [],
            textData: { text, size: fontSize },
          });
        }
      }
    }
  }
}

export async function importAveeViz(
  buffer: ArrayBuffer | Uint8Array,
  options?: ImportOptions
): Promise<OpenVizTemplate> {
  const importer = new AveeImporter();
  return importer.importViz(buffer, options);
}
