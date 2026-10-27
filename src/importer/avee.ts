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

// دالة ذكية تقرأ أي رقم عشري سواء كان رقم أو نص
export function getF32(prop?: any, fallback = 0): number {
  if (!prop) return fallback;
  const v = prop.v !== undefined ? prop.v : prop;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const parsed = parseFloat(v);
    return isNaN(parsed) ? fallback : parsed;
  }
  if (Array.isArray(v) && v.length > 0) return getF32(v[0], fallback);
  return fallback;
}

// دالة جبارة تقرأ نصوص أيفي "0.500000 0.500000" وتحولها لزوج أرقام
export function getF32Tuple2(prop?: any, fallback: [number, number] = [0, 0]): [number, number] {
  if (!prop) return fallback;
  const v = prop.v !== undefined ? prop.v : prop;
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
  if (!prop) return fallback;
  const v = prop.v !== undefined ? prop.v : prop;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback;
}

export function getColorRGBA(prop?: any): [number, number, number, number] {
  if (!prop) return [0.0, 0.9, 1.0, 1.0];
  const v = prop.v !== undefined ? prop.v : prop;

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

export class AveeImporter {
  private extractedAssets: Record<string, string> = {};
  private nodes: OpenVizNode[] = [];
  private postEffects: PostEffect[] = [];

  public async importViz(buffer: ArrayBuffer | Uint8Array): Promise<OpenVizTemplate> {
    const zip = await JSZip.loadAsync(buffer);
    let sceneJsonContent: string | null = null;

    // استخراج الملفات والصور وفحص الأمان
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

  // الدوران على كل الكومبوزيشنز واستخراج كل العناصر الحقيقية
  private extractAllCompositions(rawData: any) {
    const rawComps = Array.isArray(rawData.compositions)
      ? rawData.compositions
      : rawData.compositions
      ? [rawData.compositions]
      : [];

    let nodeIndex = 0;

    for (let cIdx = 0; cIdx < rawComps.length; cIdx++) {
      const comp = rawComps[cIdx];
      const elements = Array.isArray(comp.elements) ? comp.elements : [];

      for (let eIdx = 0; eIdx < elements.length; eIdx++) {
        const el = elements[eIdx];
        const objType = el.objType || el.type || '';
        const name = el._name || `${objType}_C${cIdx}_E${eIdx}`;

        // 1. تحويل الإحداثيات من سنتر أيفي (0.5, 0.5) لسنتر 3D (0.0, 0.0)
        const rawPos = getF32Tuple2(el.position, [0.5, 0.5]);
        const posX = (rawPos[0] - 0.5) * 2.0;
        const posY = (0.5 - rawPos[1]) * 2.0;

        const rawScale = getF32Tuple2(el.scale, [1.0, 1.0]);
        const rot = getF32(el.rotation, 0);
        const opacity = getF32(el.alpha || el.opacity, 1.0);

        // 2. معالجة البارات (سواء كانت دايرة أو خط أفقي)
        if (objType === 'Bars') {
          const shapePath = getString(el.ShapePath, 'Circle').toLowerCase();
          const isRadial = shapePath.includes('circle') || shapePath.includes('radial');
          const count = getF32(el.barCount || el.sampleCount, 64);
          const innerRadius = isRadial ? getF32(el.radius, 0.25) : 0.0;
          const width = getF32(el.width, 0.015);

          const colorStart = getColorRGBA(el.colorStart || el.color);
          const colorEnd = getColorRGBA(el.colorEnd || el.color);

          const barsData: BarsNodeData = {
            count: Math.round(count) || 64,
            innerRadius: innerRadius || 0.25,
            width: width || 0.015,
            isRadial,
            colorStart,
            colorEnd,
          };

          this.nodes.push({
            id: `bars_${nodeIndex++}`,
            name,
            type: 'Bars',
            transform: { position: [posX, posY], scale: rawScale, rotation: rot, opacity },
            bindings: [{ source: 'Bass', target: 'BarHeight', outputRange: [0.05, 0.35] }],
            barsData,
          });
        }

        // 3. معالجة الصور والخلفيات
        else if (objType === 'Image') {
          const rawImg = getString(el.customImage || el.image || el.path, '');
          // تخطي صور المرايات والماسكات الافتراضية
          if (!rawImg || rawImg.startsWith('composition:') || rawImg.includes('mask')) {
            continue;
          }

          const assetId = rawImg.replace(/^local:/, '');
          const imgUrl = this.extractedAssets[assetId];

          if (imgUrl || assetId) {
            this.nodes.push({
              id: `img_${nodeIndex++}`,
              name,
              type: 'Image',
              transform: { position: [posX, posY], scale: rawScale, rotation: rot, opacity },
              bindings: [{ source: 'Bass', target: 'ScaleUniform', outputRange: [1.0, 1.15] }],
              imageData: { assetId, url: imgUrl },
            });
          }
        }

        // 4. معالجة النصوص
        else if (objType === 'Text') {
          const text = getString(el.text, 'OpenViz');
          this.nodes.push({
            id: `text_${nodeIndex++}`,
            name,
            type: 'Text',
            transform: { position: [posX, posY], scale: rawScale, rotation: rot, opacity },
            bindings: [],
            textData: { text, size: 24 },
          });
        }
      }
    }
  }
}

export async function importAveeViz(buffer: ArrayBuffer | Uint8Array): Promise<OpenVizTemplate> {
  const importer = new AveeImporter();
  return importer.importViz(buffer);
}
