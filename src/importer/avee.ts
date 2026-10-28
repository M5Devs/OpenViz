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

export interface ImportOptions {
  maxEntries?: number;
  maxTotalBytes?: number;
  maxFileBytes?: number;
  assetMode?: 'blob' | 'dataUrl';
  registry?: ObjectUrlRegistry;
}

// دالة فك غلاف الخصائص في أيفي واستخراج القيمة الحقيقية
function unwrap(val: any): any {
  if (val === null || val === undefined) return undefined;
  if (typeof val === 'object' && !Array.isArray(val) && 'v' in val) {
    return val.v;
  }
  return val;
}

function getF32(val: any, fallback = 0): number {
  const v = unwrap(val);
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const parsed = parseFloat(v);
    return isNaN(parsed) ? fallback : parsed;
  }
  return fallback;
}

function getF32Tuple2(val: any, fallback: [number, number] = [0, 0]): [number, number] {
  const v = unwrap(val);
  if (v === null || v === undefined) return fallback;
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
      const n = getF32(v[0]);
      return [n, n];
    }
  }
  if (typeof v === 'number') return [v, v];
  return fallback;
}

function getColorRGBA(val: any): [number, number, number, number] {
  const v = unwrap(val);
  if (v === null || v === undefined) return [0.0, 0.9, 1.0, 1.0];

  if (typeof v === 'number') {
    const valU = v >>> 0;
    const a = ((valU >> 24) & 0xff) / 255.0;
    const r = ((valU >> 16) & 0xff) / 255.0;
    const g = ((valU >> 8) & 0xff) / 255.0;
    const b = (valU & 0xff) / 255.0;
    return [r, g, b, a];
  }
  return [0.0, 0.9, 1.0, 1.0];
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
    const zip = await JSZip.loadAsync(buffer);
    const fileKeys = Object.keys(zip.files);

    let sceneJsonFilename: string | null = null;

    // 1. فك كل الصور فوراً وحفظها في الـ Registry (بدون لف ودوران)
    for (const filename of fileKeys) {
      if (isPathTraversal(filename)) {
        throw new Error(`Security violation: path traversal detected '${filename}'`);
      }

      if (filename.toLowerCase() === 'scene.json' || filename.toLowerCase().endsWith('/scene.json')) {
        sceneJsonFilename = filename;
      } else if (!zip.files[filename].dir) {
        try {
          const blob = await zip.files[filename].async('blob');
          const cleanName = filename.replace(/^local:/, '').trim();
          const url = registry ? registry.create(blob) : URL.createObjectURL(blob);
          this.extractedAssets[cleanName] = url;
          this.extractedAssets[filename] = url;
        } catch (e) {
          console.warn(`Could not extract asset: ${filename}`);
        }
      }
    }

    if (!sceneJsonFilename) {
      throw new Error('Invalid Avee .viz: Missing scene.json');
    }

    // 2. قراءة وتحليل scene.json
    const sceneJsonText = await zip.files[sceneJsonFilename].async('string');
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
      console.warn('Template validation warning, proceeding anyway:', validation.errors);
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

        // قراءة نوع العنصر الحقيقي مباشرة بدون اللف وراء tag
        const objType = String(el.objType || el.type || '').trim();
        const name = String(el._name || `${objType}_C${cIdx}_E${eIdx}`).trim();

        // 1. حساب الإحداثيات (تحويل سنتر 0.5 0.5 إلى بيكسلات من -960 لـ 960)
        const rawPos = getF32Tuple2(el.position, [0.5, 0.5]);
        const posX = Math.round((rawPos[0] - 0.5) * 1920);
        const posY = Math.round((0.5 - rawPos[1]) * 1080);

        const rawScale = getF32Tuple2(el.scale, [1.0, 1.0]);
        const rot = getF32(el.rotation, 0);
        const opacity = getF32(el.alpha !== undefined ? el.alpha : el.opacity, 1.0);

        const nodeId = `node_${this.nodeCounter++}`;

        // 2. معالجة البارات (سواء دايرة أو خط أفقي)
        if (objType === 'Bars') {
          const shapePath = String(unwrap(el.ShapePath) || 'Circle').toLowerCase();
          const isRadial = shapePath.includes('circle') || shapePath.includes('radial');
          const count = Math.round(getF32(el.barCount || el.sampleCount, 64)) || 64;

          const rawRadius = getF32(el.radius, 0);
          const innerRadius = rawRadius > 0 ? rawRadius : 240;
          const width = getF32(el.width || el.barWidth, 4) || 4;

          const colorStart = getColorRGBA(el.colorStart || el.color);
          const colorEnd = getColorRGBA(el.colorEnd || el.color);

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
            bindings: [{ source: 'Bass', target: 'BarHeight', outputRange: [0.05, 0.35] }],
            barsData,
          });
        }

        // 3. معالجة الصور والخلفيات
        else if (objType === 'Image') {
          const rawImg = String(unwrap(el.customImage) || unwrap(el.image) || unwrap(el.path) || '').trim();

          // تخطي المرايات والماسكات الافتراضية
          if (!rawImg || rawImg.startsWith('composition:') || rawImg.includes('mask')) {
            continue;
          }

          const cleanAssetId = rawImg.replace(/^local:/, '').trim();
          const imgUrl = this.extractedAssets[cleanAssetId] || this.extractedAssets[rawImg];

          const isWallpaper = /(background|wallpaper|bg)/i.test(name) || rawScale[0] >= 1.5;

          this.nodes.push({
            id: nodeId,
            name,
            type: 'Image',
            transform: { position: [posX, posY], scale: rawScale, rotation: rot, opacity },
            bindings: isWallpaper ? [] : [{ source: 'Bass', target: 'ScaleUniform', outputRange: [1.0, 1.15] }],
            imageData: {
              assetId: cleanAssetId,
              url: imgUrl,
              fit: isWallpaper ? 'cover' : 'contain',
            },
          });
        }

        // 4. معالجة النصوص
        else if (objType === 'Text') {
          const text = String(unwrap(el.text) || 'OpenViz');
          const fontSize = Math.round(getF32(el.fontSize || el.textSize || el.size, 24)) || 24;

          this.nodes.push({
            id: nodeId,
            name,
            type: 'Text',
            transform: { position: [posX, posY], scale: rawScale, rotation: rot, opacity },
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
