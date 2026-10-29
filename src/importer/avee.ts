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

/*
 * Derived algorithms and element mapping patterns adapted from:
 * Azy-Kun/AveeOpenPlayer_1.0.34 (Apache License 2.0)
 * https://github.com/Azy-Kun/AveeOpenPlayer_1.0.34
 */

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
    throw new Error(`Zip entry exceeds maximum file size limit of ${maxFileBytes} bytes (${uncompressedSize} bytes)`);
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
  private nodeIndex = 0;

  public async importViz(
    buffer: ArrayBuffer | Uint8Array,
    options: ImportOptions = {}
  ): Promise<OpenVizTemplate> {
    const maxEntries = options.maxEntries ?? 500;
    const maxTotalBytes = options.maxTotalBytes ?? 200 * 1024 * 1024;
    const maxFileBytes = options.maxFileBytes ?? 50 * 1024 * 1024;
    const assetMode = options.assetMode ?? 'blob';
    const registry = options.registry;

    const zip = await JSZip.loadAsync(buffer);
    const fileKeys = Object.keys(zip.files);

    if (fileKeys.length > maxEntries) {
      throw new Error(`Zip archive exceeds maximum entry count limit of ${maxEntries} entries (${fileKeys.length} entries)`);
    }

    let totalBytesRead = 0;
    const checkTotalBytes = (added: number) => {
      totalBytesRead += added;
      if (totalBytesRead > maxTotalBytes) {
        throw new Error(`Zip archive exceeds total decompressed byte limit of ${maxTotalBytes} bytes`);
      }
    };

    let sceneJsonFilename: string | null = null;
    for (const filename of fileKeys) {
      if (isPathTraversal(filename)) {
        throw new Error(`Security violation: path traversal detected '${filename}'`);
      }
      if (filename.toLowerCase() === 'scene.json' || filename.toLowerCase().endsWith('/scene.json')) {
        sceneJsonFilename = filename;
      }
    }

    if (!sceneJsonFilename) {
      throw new Error('Invalid Avee .viz: Missing scene.json');
    }

    // Pass 1: Inflate scene.json and parse composition elements
    const sceneJsonEntry = zip.files[sceneJsonFilename];
    const sceneJsonContent: string = await readEntryStream(
      sceneJsonEntry,
      'string',
      maxFileBytes,
      checkTotalBytes
    );

    const rawData = JSON.parse(sceneJsonContent);
    this.extractAllCompositions(rawData);

    // Collect referenced asset IDs from Image nodes
    const referencedAssetIds = new Set<string>();
    for (const node of this.nodes) {
      if (node.type === 'Image' && node.imageData?.assetId) {
        referencedAssetIds.add(node.imageData.assetId);
      }
    }

    // Pass 2: Inflate ONLY files referenced by Image nodes
    for (const filename of fileKeys) {
      if (zip.files[filename].dir || filename === sceneJsonFilename) continue;

      const cleanName = filename.replace(/^local:/, '');
      if (referencedAssetIds.has(cleanName) || referencedAssetIds.has(filename)) {
        const entry = zip.files[filename];

        try {
          if (assetMode === 'dataUrl') {
            const u8: Uint8Array = await readEntryStream(entry, 'uint8array', maxFileBytes, checkTotalBytes);
            const mime = getMimeType(filename);
            const base64 = uint8ArrayToBase64(u8);
            const dataUrl = `data:${mime};base64,${base64}`;
            this.extractedAssets[cleanName] = dataUrl;
          } else {
            const blob: Blob = await readEntryStream(entry, 'blob', maxFileBytes, checkTotalBytes);
            const url = registry ? registry.create(blob) : URL.createObjectURL(blob);
            this.extractedAssets[cleanName] = url;
          }
        } catch (err) {
          if (assetMode === 'dataUrl' && (err as Error).message.includes('exceeds maximum file size limit')) {
            console.warn(`Warning: Skipping asset '${filename}' larger than 5 MB`);
          } else {
            throw err;
          }
        }
      }
    }

    // Attach asset URLs to nodes
    for (const node of this.nodes) {
      if (node.type === 'Image' && node.imageData?.assetId) {
        node.imageData.url = this.extractedAssets[node.imageData.assetId];
      }
    }

    const rawTemplate: OpenVizTemplate = {
      schemaVersion: 'openviz/1',
      name: 'Imported Avee Template',
      author: 'OpenViz Engine',
      canvasAspect: '16:9',
      clearColor: [0.03, 0.03, 0.06, 1.0],
      nodes: this.nodes,
      postEffects: this.postEffects,
      assets: this.extractedAssets,
    };

    const validationResult = validateTemplate(rawTemplate);
    if (!validationResult.ok) {
      throw new Error(`Template validation failed: ${validationResult.errors.join('; ')}`);
    }

    return validationResult.template;
  }

  private extractAllCompositions(rawData: any) {
    this.nodes = [];
    this.postEffects = [];
    this.nodeIndex = 0;

    if (rawData.compositions) {
      const rawComps = Array.isArray(rawData.compositions)
        ? rawData.compositions
        : [rawData.compositions];

      for (let cIdx = 0; cIdx < rawComps.length; cIdx++) {
        const comp = rawComps[cIdx];
        const elements = Array.isArray(comp.elements) ? comp.elements : [];
        for (let eIdx = 0; eIdx < elements.length; eIdx++) {
          const el = elements[eIdx];
          this.processElement(el, `${el.objType || el.type || 'element'}_C${cIdx}_E${eIdx}`);
        }
      }
    }

    if (rawData.root) {
      this.processRootNode(rawData.root);
    }
  }

  private processRootNode(node: any) {
    const pNode = parseRawProp(node);
    if (!pNode.children) return;

    for (const key of Object.keys(pNode.children)) {
      const child = pNode.children[key];
      const childTag = child.tag || child.t || key;

      if (childTag === 'RgbSplitEffect' || childTag === 'ChromaticAberration') {
        const splitAmount = getF32(child.children?.splitAmount || child.splitAmount, 0.05);
        this.postEffects.push({
          type: 'ChromaticAberration',
          amount: splitAmount,
        });
      } else {
        this.processElement(child, key);
      }
    }
  }

  private processElement(el: any, defaultName: string) {
    const pEl = parseRawProp(el);
    const objType = getString(pick(pEl.tag, pEl.t, pEl.objType, pEl.type), '');
    const name = getString(pEl._name, defaultName);

    const children = pEl.children || pEl;

    // 1. Position & Anchor normalization:
    // Avee [0.0, 1.0] (center 0.5, 0.5) -> Pixel Space [-960..960, -540..540]
    // Handles anchorX, anchorY, alignmentPosition offsets relative to 1920x1080 canvas bounds
    const rawPos = getF32Tuple2(pick(children.position, el.position), [0.5, 0.5]);
    const anchor = getF32Tuple2(pick(children.anchor, children.alignmentPosition, el.anchor, el.alignmentPosition), [0.5, 0.5]);

    const posX = (rawPos[0] - anchor[0]) * 1920;
    const posY = (anchor[1] - rawPos[1]) * 1080;

    const rawScale = getF32Tuple2(pick(children.scale, el.scale), [1.0, 1.0]);
    const rot = getF32(pick(children.rotation, el.rotation), 0);
    const opacity = getF32(pick(children.alpha, children.opacity, el.alpha, el.opacity), 1.0);

    const isWallpaper = /(^|[\s_\-.])(background|wallpaper|bg)($|[\s_\-.])/i.test(name);

    let mappedScale: [number, number] = [1.0, 1.0];
    let fitMode: 'contain' | 'cover' | undefined = undefined;

    if (isWallpaper) {
      mappedScale = [1.0, 1.0];
      fitMode = 'cover';
    } else if (rawScale[0] > 10) {
      mappedScale = [rawScale[0] / 360, rawScale[1] / 360];
      fitMode = 'contain';
    } else {
      mappedScale = rawScale;
      fitMode = 'contain';
    }

    if (objType === 'Bars') {
      const shapePath = getString(pick(children.shapePath, children.ShapePath, el.ShapePath), 'Circle').toLowerCase();
      const isRadial = shapePath.includes('circle') || shapePath.includes('radial');
      const count = getI32(pick(children.barCount, children.sampleCount, el.barCount, el.sampleCount), 64);

      const rawRadius = getF32(pick(children.radius, el.radius), 0);
      const innerRadius = rawRadius > 0 ? rawRadius : 240;

      const rawWidth = getF32(pick(children.barWidth, children.width, el.barWidth, el.width), 0);
      const width = rawWidth > 0 ? rawWidth : 4;

      const colorStart = getColorRGBA(pick(children.colorStart, el.colorStart, children.color, el.color));
      const colorEnd = getColorRGBA(pick(children.colorEnd, el.colorEnd, children.color, el.color));

      const bindings: AudioBinding[] = [];
      const extractedBinding = extractAudioBinding(pick(children.scale, el.scale), 'ScaleUniform') ||
                               extractAudioBinding(pick(children.barHeight, el.barHeight), 'BarHeight');
      if (extractedBinding) {
        bindings.push(extractedBinding);
      } else {
        bindings.push({ source: 'Bass', target: 'BarHeight', outputRange: [0.05, 0.35] });
      }

      const barsData: BarsNodeData = {
        count: count || 64,
        innerRadius,
        width,
        isRadial,
        colorStart,
        colorEnd,
      };

      this.nodes.push({
        id: defaultName,
        name,
        type: 'Bars',
        transform: { position: [posX, posY], scale: [1.0, 1.0], rotation: rot, opacity },
        bindings,
        barsData,
      });
    } else if (objType === 'Image') {
      const rawImg = getString(pick(children.image, children.customImage, children.path, el.customImage, el.image, el.path), '');
      if (rawImg.startsWith('composition:') || rawImg.includes('mask')) {
        return;
      }

      const assetId = rawImg.replace(/^local:/, '');

      const bindings: AudioBinding[] = [];
      const extractedBinding = extractAudioBinding(pick(children.scale, el.scale), 'ScaleUniform');
      if (extractedBinding) {
        bindings.push(extractedBinding);
      } else {
        bindings.push({ source: 'Bass', target: 'ScaleUniform', outputRange: [1.0, 1.15] });
      }

      this.nodes.push({
        id: defaultName,
        name,
        type: 'Image',
        transform: { position: [posX, posY], scale: mappedScale, rotation: rot, opacity },
        bindings,
        imageData: { assetId, fit: fitMode },
      });
    } else if (objType === 'Text') {
      const text = getString(pick(children.text, el.text), 'OpenViz');
      const fontSize = getI32(pick(children.fontSize, children.textSize, children.size, el.fontSize, el.textSize, el.size), 24);
      this.nodes.push({
        id: defaultName,
        name,
        type: 'Text',
        transform: { position: [posX, posY], scale: mappedScale, rotation: rot, opacity },
        bindings: [],
        textData: { text, size: fontSize },
      });
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
