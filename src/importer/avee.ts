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

export interface RawProp {
  v?: any;
  t?: string;
  o?: number;
  tag?: string;
  children?: Record<string, RawProp>;
  [key: string]: any;
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

export class AveeImporter {
  private extractedAssets: Record<string, string> = {};
  private nodes: OpenVizNode[] = [];
  private postEffects: PostEffect[] = [];
  private nodeIndex = 0;

  public async importViz(buffer: ArrayBuffer | Uint8Array): Promise<OpenVizTemplate> {
    const zip = await JSZip.loadAsync(buffer);
    let sceneJsonContent: string | null = null;

    for (const filename of Object.keys(zip.files)) {
      if (filename.includes('..') || filename.startsWith('/') || filename.startsWith('\\')) {
        throw new Error(`Security violation: path traversal detected '${filename}'`);
      }

      if (filename.toLowerCase() === 'scene.json' || filename.toLowerCase().endsWith('/scene.json')) {
        sceneJsonContent = await zip.files[filename].async('string');
      } else if (!zip.files[filename].dir) {
        const blob = await zip.files[filename].async('blob');
        const cleanName = filename.replace(/^local:/, '');
        this.extractedAssets[cleanName] = URL.createObjectURL(blob);
      }
    }

    if (!sceneJsonContent) {
      throw new Error('Invalid Avee .viz: Missing scene.json');
    }

    const rawData = JSON.parse(sceneJsonContent);
    this.extractAllCompositions(rawData);

    return {
      schemaVersion: 'openviz/1',
      name: 'Imported Avee Template',
      author: 'OpenViz Engine',
      canvasAspect: '16:9',
      clearColor: [0.03, 0.03, 0.06, 1.0],
      nodes: this.nodes,
      postEffects: this.postEffects,
      assets: this.extractedAssets,
    };
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
    const objType = getString(pEl.tag || pEl.t || pEl.objType || pEl.type || '');
    const name = getString(pEl._name, defaultName);

    const children = pEl.children || pEl;

    // 1. Position normalization: Avee [0.0, 1.0] (center 0.5, 0.5) -> Pixel Space [-960..960, -540..540]
    const rawPos = getF32Tuple2(children.position || el.position, [0.5, 0.5]);
    const posX = (rawPos[0] - 0.5) * 1920;
    const posY = (0.5 - rawPos[1]) * 1080;

    const rawScale = getF32Tuple2(children.scale || el.scale, [1.0, 1.0]);
    const rot = getF32(children.rotation || el.rotation, 0);
    const opacity = getF32(children.alpha || children.opacity || el.alpha || el.opacity, 1.0);

    const isWallpaper =
      name.toLowerCase().includes('background') ||
      name.toLowerCase().includes('wallpaper') ||
      name.toLowerCase().includes('bg') ||
      rawScale[0] >= 0.8;

    let mappedScale: [number, number] = [1.0, 1.0];
    if (rawScale[0] > 10) {
      mappedScale = rawScale;
    } else if (isWallpaper) {
      mappedScale = [1920, 1080];
    } else {
      mappedScale = [350 * rawScale[0], 350 * rawScale[1]];
    }

    if (objType === 'Bars') {
      const shapePath = getString(children.shapePath || children.ShapePath || el.ShapePath, 'Circle').toLowerCase();
      const isRadial = shapePath.includes('circle') || shapePath.includes('radial');
      const count = getI32(children.barCount || children.sampleCount || el.barCount || el.sampleCount, 64);

      const rawRadius = getF32(children.radius || el.radius, 0);
      const innerRadius = rawRadius > 0 ? rawRadius : 240;

      const rawWidth = getF32(children.barWidth || children.width || el.barWidth || el.width, 0);
      const width = rawWidth > 0 ? rawWidth : 4;

      const colorStart = getColorRGBA(children.colorStart || el.colorStart || children.color || el.color);
      const colorEnd = getColorRGBA(children.colorEnd || el.colorEnd || children.color || el.color);

      const bindings: AudioBinding[] = [];
      const extractedBinding = extractAudioBinding(children.scale || el.scale, 'ScaleUniform') ||
                               extractAudioBinding(children.barHeight || el.barHeight, 'BarHeight');
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
      const rawImg = getString(children.image || children.customImage || children.path || el.customImage || el.image || el.path, '');
      if (rawImg.startsWith('composition:') || rawImg.includes('mask')) {
        return;
      }

      const assetId = rawImg.replace(/^local:/, '');
      const imgUrl = this.extractedAssets[assetId];

      const bindings: AudioBinding[] = [];
      const extractedBinding = extractAudioBinding(children.scale || el.scale, 'ScaleUniform');
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
        imageData: { assetId, url: imgUrl },
      });
    } else if (objType === 'Text') {
      const text = getString(children.text || el.text, 'OpenViz');
      this.nodes.push({
        id: defaultName,
        name,
        type: 'Text',
        transform: { position: [posX, posY], scale: mappedScale, rotation: rot, opacity },
        bindings: [],
        textData: { text, size: 24 },
      });
    }
  }
}

export async function importAveeViz(buffer: ArrayBuffer | Uint8Array): Promise<OpenVizTemplate> {
  const importer = new AveeImporter();
  return importer.importViz(buffer);
}
