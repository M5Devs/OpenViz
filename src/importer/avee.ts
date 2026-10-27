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

export interface AveeRoot {
  ver?: any;
  root?: RawProp;
  compositions?: RawProp[] | RawProp;
  [key: string]: any;
}

export function parseRawProp(input: any): RawProp {
  if (input === null || input === undefined) {
    return { children: {} };
  }
  if (typeof input !== 'object') {
    return { v: input, children: {} };
  }
  if (Array.isArray(input)) {
    return { v: input, children: {} };
  }

  const result: RawProp = {
    v: input.v,
    t: input.t,
    o: input.o,
    tag: input.tag,
    children: {},
  };

  // Collect children from input.children or extra keys
  const childrenMap: Record<string, RawProp> = {};

  if (input.children && typeof input.children === 'object') {
    for (const [k, val] of Object.entries(input.children)) {
      childrenMap[k] = parseRawProp(val);
    }
  }

  for (const [k, val] of Object.entries(input)) {
    if (['v', 't', 'o', 'tag', 'children'].includes(k)) continue;
    if (!(k in childrenMap)) {
      childrenMap[k] = parseRawProp(val);
    }
  }

  result.children = childrenMap;
  return result;
}

export function getF32(prop?: RawProp, fallback = 0): number {
  if (!prop || prop.v === undefined || prop.v === null) return fallback;
  if (typeof prop.v === 'number') return prop.v;
  if (typeof prop.v === 'string') {
    const parsed = parseFloat(prop.v);
    return isNaN(parsed) ? fallback : parsed;
  }
  if (Array.isArray(prop.v) && prop.v.length > 0) {
    return getF32({ v: prop.v[0] }, fallback);
  }
  return fallback;
}

export function getF32Tuple2(prop?: RawProp, fallback: [number, number] = [0, 0]): [number, number] {
  if (!prop || prop.v === undefined || prop.v === null) return fallback;
  if (Array.isArray(prop.v)) {
    if (prop.v.length >= 2) {
      return [getF32({ v: prop.v[0] }), getF32({ v: prop.v[1] })];
    } else if (prop.v.length === 1) {
      const val = getF32({ v: prop.v[0] });
      return [val, val];
    }
  }
  if (typeof prop.v === 'number') {
    return [prop.v, prop.v];
  }
  return fallback;
}

export function getI32(prop?: RawProp, fallback = 0): number {
  return Math.round(getF32(prop, fallback));
}

export function getBool(prop?: RawProp, fallback = false): boolean {
  if (!prop || prop.v === undefined || prop.v === null) return fallback;
  if (typeof prop.v === 'boolean') return prop.v;
  if (typeof prop.v === 'number') return prop.v !== 0;
  if (typeof prop.v === 'string') {
    const lower = prop.v.toLowerCase();
    if (lower === 'true' || lower === '1') return true;
    if (lower === 'false' || lower === '0') return false;
  }
  return fallback;
}

export function getString(prop?: RawProp, fallback = ''): string {
  if (!prop || prop.v === undefined || prop.v === null) return fallback;
  if (typeof prop.v === 'string') return prop.v;
  if (typeof prop.v === 'number' || typeof prop.v === 'boolean') return String(prop.v);
  return fallback;
}

export function getColorRGBA(prop?: RawProp): [number, number, number, number] {
  if (!prop || prop.v === undefined || prop.v === null) return [1, 1, 1, 1];

  // UInt32 ARGB color
  if (typeof prop.v === 'number') {
    const valU = prop.v >>> 0;
    const a = ((valU >> 24) & 0xff) / 255.0;
    const r = ((valU >> 16) & 0xff) / 255.0;
    const g = ((valU >> 8) & 0xff) / 255.0;
    const b = (valU & 0xff) / 255.0;
    return [r, g, b, a];
  }

  // Array of numbers
  if (Array.isArray(prop.v)) {
    const floats = prop.v.map((x) => (typeof x === 'number' ? x : parseFloat(x) || 0));
    if (floats.length >= 4) {
      const is255 = floats.some((f) => f > 1.0);
      const norm = (f: number) => (is255 ? f / 255.0 : f);
      return [norm(floats[0]), norm(floats[1]), norm(floats[2]), norm(floats[3])];
    } else if (floats.length === 3) {
      const is255 = floats.some((f) => f > 1.0);
      const norm = (f: number) => (is255 ? f / 255.0 : f);
      return [norm(floats[0]), norm(floats[1]), norm(floats[2]), 1.0];
    }
  }

  // Hex string
  if (typeof prop.v === 'string') {
    const clean = prop.v.replace(/^#/, '');
    if (clean.length === 8) {
      const valU = parseInt(clean, 16);
      if (!isNaN(valU)) {
        const a = ((valU >> 24) & 0xff) / 255.0;
        const r = ((valU >> 16) & 0xff) / 255.0;
        const g = ((valU >> 8) & 0xff) / 255.0;
        const b = (valU & 0xff) / 255.0;
        return [r, g, b, a];
      }
    } else if (clean.length === 6) {
      const valU = parseInt(clean, 16);
      if (!isNaN(valU)) {
        const r = ((valU >> 16) & 0xff) / 255.0;
        const g = ((valU >> 8) & 0xff) / 255.0;
        const b = (valU & 0xff) / 255.0;
        return [r, g, b, 1.0];
      }
    }
  }

  return [1, 1, 1, 1];
}

export function extractAudioBinding(prop?: RawProp, target: BindingTarget = 'ScaleUniform'): AudioBinding | null {
  if (!prop || !prop.children) return null;

  // Search for child node representing measure
  let childProp: RawProp | null = null;
  for (const [key, child] of Object.entries(prop.children)) {
    if (
      key === '_child' ||
      key.startsWith('_child') ||
      child.t === '_child' ||
      (child.tag && child.tag.includes('measure'))
    ) {
      childProp = child;
      break;
    }
  }

  if (!childProp) return null;

  const measureWhat =
    getString(childProp.children?.measureWhat) ||
    getString(childProp) ||
    'Bass';

  let source: BindingSource = 'Bass';
  if (['Beat', 'BeatRandomShake', 'ConstantShake'].includes(measureWhat)) {
    source = 'Beat';
  } else if (measureWhat === 'Bass') {
    source = 'Bass';
  } else if (measureWhat === 'Mid') {
    source = 'Mid';
  } else if (measureWhat === 'High') {
    source = 'High';
  } else if (['RMS', 'Rms'].includes(measureWhat)) {
    source = 'Rms';
  }

  const amountA = getF32(
    childProp.children?.A || childProp.children?.amountA || childProp.children?.lower,
    1.0
  );
  const amountB = getF32(
    childProp.children?.B || childProp.children?.amountB || childProp.children?.upper,
    1.3
  );

  return {
    source,
    target,
    outputRange: [amountA, amountB],
  };
}

export class AveeImporter {
  private compositions: Map<number, RawProp> = new Map();
  private postEffects: PostEffect[] = [];
  private extractedAssets: Record<string, string> = {};
  private nodes: OpenVizNode[] = [];

  constructor() {}

  public async importViz(buffer: ArrayBuffer | Uint8Array): Promise<OpenVizTemplate> {
    const zip = await JSZip.loadAsync(buffer);

    // Security path traversal check and file scanning
    let sceneJsonContent: string | null = null;

    for (const filename of Object.keys(zip.files)) {
      if (
        filename.includes('..') ||
        filename.startsWith('/') ||
        filename.startsWith('\\') ||
        filename.includes(':\\')
      ) {
        throw new Error(`Security violation: path traversal detected in ZIP entry '${filename}'`);
      }

      if (filename.toLowerCase() === 'scene.json' || filename.toLowerCase().endsWith('/scene.json')) {
        sceneJsonContent = await zip.files[filename].async('string');
      } else if (!zip.files[filename].dir) {
        // Extract asset file
        const blob = await zip.files[filename].async('blob');
        const cleanName = filename.replace(/^local:/, '');
        const url = URL.createObjectURL(blob);
        this.extractedAssets[cleanName] = url;
      }
    }

    if (!sceneJsonContent) {
      throw new Error('Invalid Avee .viz template: Missing scene.json archive entry');
    }

    const rawData = JSON.parse(sceneJsonContent);
    this.parseCompositions(rawData);
    this.convertCompositionTree();

    return {
      schemaVersion: 'openviz/1',
      name: 'Imported Avee Template',
      author: 'Avee Importer',
      canvasAspect: '16:9',
      clearColor: [0.05, 0.05, 0.08, 1.0],
      nodes: this.nodes,
      postEffects: this.postEffects,
      assets: this.extractedAssets,
    };
  }

  private parseCompositions(rootObj: any) {
    if (rootObj.compositions) {
      if (Array.isArray(rootObj.compositions)) {
        rootObj.compositions.forEach((comp: any, idx: number) => {
          this.compositions.set(idx, parseRawProp(comp));
        });
      } else if (typeof rootObj.compositions === 'object') {
        this.compositions.set(0, parseRawProp(rootObj.compositions));
      }
    }

    if (rootObj.root) {
      const parsedRoot = parseRawProp(rootObj.root);
      if (!this.compositions.has(0)) {
        this.compositions.set(0, parsedRoot);
      }
    }
  }

  private convertCompositionTree() {
    const rootComp = this.compositions.get(0) || { children: {} };

    // Traverse root composition children
    if (rootComp.children) {
      for (const [name, prop] of Object.entries(rootComp.children)) {
        this.processPropNode(name, prop);
      }
    }
  }

  private processPropNode(name: string, prop: RawProp, parentId?: string) {
    const tagType = prop.tag || prop.t || name;

    const pos = getF32Tuple2(prop.children?.position, [0, 0]);
    const scale = getF32Tuple2(prop.children?.scale, [1, 1]);
    const rot = getF32(prop.children?.rotation, 0);
    const opacity = getF32(prop.children?.alpha || prop.children?.opacity, 1.0);

    const bindings: AudioBinding[] = [];

    if (prop.children?.scale) {
      const b = extractAudioBinding(prop.children.scale, 'ScaleUniform');
      if (b) bindings.push(b);
    }
    if (prop.children?.position) {
      const b = extractAudioBinding(prop.children.position, 'CameraShakeIntensity');
      if (b) bindings.push(b);
    }
    if (prop.children?.rotation) {
      const b = extractAudioBinding(prop.children.rotation, 'Rotation');
      if (b) bindings.push(b);
    }
    if (prop.children?.alpha || prop.children?.opacity) {
      const b = extractAudioBinding(prop.children.alpha || prop.children.opacity, 'Opacity');
      if (b) bindings.push(b);
    }
    if (prop.children?.barHeight || prop.children?.height) {
      const b = extractAudioBinding(prop.children.barHeight || prop.children.height, 'BarHeight');
      if (b) bindings.push(b);
    }

    if (tagType.includes('Bars') || tagType.includes('Spectrum') || name.startsWith('C6')) {
      const count = getI32(prop.children?.barCount || prop.children?.count, 64);
      const width = getF32(prop.children?.barWidth || prop.children?.width, 2.0);
      const shapePath = getString(prop.children?.shapePath || prop.children?.path, '');
      const isRadial = shapePath.toLowerCase().includes('circle') || shapePath.toLowerCase().includes('radial');
      const innerRadius = isRadial
        ? getF32(prop.children?.radius || prop.children?.innerRadius, 10.0)
        : 0.0;
      const colorStart = getColorRGBA(prop.children?.colorStart || prop.children?.color);
      const colorEnd = getColorRGBA(prop.children?.colorEnd || prop.children?.color);

      const barsData: BarsNodeData = {
        count,
        innerRadius,
        width,
        isRadial,
        colorStart,
        colorEnd,
      };

      const node: OpenVizNode = {
        id: name,
        name: name,
        type: 'Bars',
        transform: { position: pos, scale, rotation: rot, opacity },
        bindings,
        barsData,
      };
      this.nodes.push(node);
    } else if (tagType.includes('Image') || tagType.includes('Texture') || name.startsWith('C5') || name.startsWith('C7')) {
      const rawPath = getString(
        prop.children?.image || prop.children?.path || prop.children?.src,
        'image.png'
      );
      const assetId = rawPath.replace(/^local:/, '');

      const imageData: ImageNodeData = {
        assetId,
        url: this.extractedAssets[assetId],
      };

      const node: OpenVizNode = {
        id: name,
        name: name,
        type: 'Image',
        transform: { position: pos, scale, rotation: rot, opacity },
        bindings,
        imageData,
      };
      this.nodes.push(node);
    } else if (tagType.includes('RgbSplitEffect')) {
      const amount = getF32(prop.children?.amount || prop.children?.splitAmount, 0.02);
      const angle = getF32(prop.children?.angle, 0.0);
      this.postEffects.push({ type: 'ChromaticAberration', amount, angle });
    } else if (tagType.includes('MotionBlurEffect')) {
      const decay = getF32(prop.children?.decay || prop.children?.amount, 0.8);
      this.postEffects.push({ type: 'MotionTrails', decay });
    } else if (tagType.includes('BlurEffect')) {
      this.postEffects.push({ type: 'Bloom', threshold: 0.5, intensity: 1.0, radius: 5.0 });
    } else if (tagType.includes('Text')) {
      const text = getString(prop.children?.text, 'OpenViz');
      const size = getF32(prop.children?.size, 24);

      const textData: TextNodeData = { text, size };
      const node: OpenVizNode = {
        id: name,
        name,
        type: 'Text',
        transform: { position: pos, scale, rotation: rot, opacity },
        bindings,
        textData,
      };
      this.nodes.push(node);
    } else if (prop.children) {
      // Traverse sub-children
      for (const [childName, childProp] of Object.entries(prop.children)) {
        if (!['position', 'scale', 'rotation', 'alpha', 'opacity', '_child'].includes(childName)) {
          this.processPropNode(childName, childProp, name);
        }
      }
    }
  }
}

export async function importAveeViz(buffer: ArrayBuffer | Uint8Array): Promise<OpenVizTemplate> {
  const importer = new AveeImporter();
  return importer.importViz(buffer);
}
