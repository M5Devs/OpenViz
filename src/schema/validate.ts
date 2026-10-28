import { OpenVizTemplate, OpenVizNode, AudioBinding, BindingSource, BindingTarget, PostEffect } from '../types';

export interface ValidationSuccess {
  ok: true;
  template: OpenVizTemplate;
}

export interface ValidationFailure {
  ok: false;
  errors: string[];
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

const KNOWN_NODE_TYPES = new Set(['Bars', 'Image', 'Group', 'Text']);
const KNOWN_BINDING_SOURCES: Set<BindingSource> = new Set(['Bass', 'Mid', 'High', 'Beat', 'Rms', 'Spectrum']);
const KNOWN_BINDING_TARGETS: Set<BindingTarget> = new Set([
  'ScaleUniform',
  'BarHeight',
  'Rotation',
  'Opacity',
  'CameraShakeIntensity',
  'Position',
]);
const KNOWN_POST_EFFECT_TYPES = new Set(['ChromaticAberration', 'MotionTrails', 'Bloom']);

export function isValidAssetUrl(url: string): boolean {
  if (typeof url !== 'string' || !url) return false;
  if (url.startsWith('blob:')) return true;
  const dataUrlRegex = /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i;
  return dataUrlRegex.test(url);
}

export function validateTemplate(input: unknown): ValidationResult {
  const errors: string[] = [];

  if (!input || typeof input !== 'object') {
    return { ok: false, errors: ['Input template must be a non-null object'] };
  }

  const t = input as Record<string, any>;

  // schemaVersion
  if (typeof t.schemaVersion !== 'string' || !t.schemaVersion.startsWith('openviz/')) {
    errors.push('schemaVersion must be a string starting with "openviz/"');
  }

  // name & author
  const name = typeof t.name === 'string' ? t.name : 'Untitled';
  const author = typeof t.author === 'string' ? t.author : '';
  const canvasAspect = typeof t.canvasAspect === 'string' ? t.canvasAspect : '16:9';

  // clearColor
  let clearColor: [number, number, number, number] = [0, 0, 0, 1];
  if (Array.isArray(t.clearColor) && t.clearColor.length >= 4) {
    const r = Number(t.clearColor[0]);
    const g = Number(t.clearColor[1]);
    const b = Number(t.clearColor[2]);
    const a = Number(t.clearColor[3]);
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b) || !Number.isFinite(a)) {
      errors.push('clearColor must contain finite numbers');
    } else {
      clearColor = [
        Math.max(0, Math.min(1, r)),
        Math.max(0, Math.min(1, g)),
        Math.max(0, Math.min(1, b)),
        Math.max(0, Math.min(1, a)),
      ];
    }
  }

  // assets
  const validatedAssets: Record<string, string> = {};
  if (t.assets && typeof t.assets === 'object') {
    for (const [key, val] of Object.entries(t.assets)) {
      if (typeof val !== 'string' || !isValidAssetUrl(val as string)) {
        errors.push(`Invalid asset URL for key '${key}': must be blob: or base64 data image URL`);
      } else {
        validatedAssets[key] = val as string;
      }
    }
  }

  // postEffects
  const validatedPostEffects: PostEffect[] = [];
  if (Array.isArray(t.postEffects)) {
    for (let i = 0; i < t.postEffects.length; i++) {
      const pe = t.postEffects[i];
      if (!pe || typeof pe !== 'object') {
        errors.push(`PostEffect at index ${i} must be an object`);
        continue;
      }
      if (!KNOWN_POST_EFFECT_TYPES.has(pe.type)) {
        errors.push(`PostEffect at index ${i} has unknown type '${pe.type}'`);
      } else {
        validatedPostEffects.push(pe);
      }
    }
  }

  // nodes
  if (!Array.isArray(t.nodes)) {
    errors.push('nodes must be an array');
    return { ok: false, errors };
  }

  if (t.nodes.length > 500) {
    errors.push(`Too many nodes: maximum allowed is 500, received ${t.nodes.length}`);
  }

  const seenIds = new Set<string>();
  const validatedNodes: OpenVizNode[] = [];

  for (let i = 0; i < t.nodes.length; i++) {
    const rawNode = t.nodes[i];
    if (!rawNode || typeof rawNode !== 'object') {
      errors.push(`Node at index ${i} is not an object`);
      continue;
    }

    // id
    if (typeof rawNode.id !== 'string' || rawNode.id.trim() === '') {
      errors.push(`Node at index ${i} must have a non-empty string id`);
      continue;
    }
    if (seenIds.has(rawNode.id)) {
      errors.push(`Duplicate node id '${rawNode.id}' found at index ${i}`);
    } else {
      seenIds.add(rawNode.id);
    }

    // type
    if (typeof rawNode.type !== 'string' || !KNOWN_NODE_TYPES.has(rawNode.type)) {
      errors.push(`Node '${rawNode.id}' has unknown type '${rawNode.type}'`);
      continue;
    }

    // name
    let nodeName = typeof rawNode.name === 'string' ? rawNode.name : rawNode.id;
    if (nodeName.length > 120) {
      nodeName = nodeName.substring(0, 120);
    }

    // transform
    const rawT = rawNode.transform || {};
    const pos = Array.isArray(rawT.position) ? rawT.position : [0, 0];
    const scale = Array.isArray(rawT.scale) ? rawT.scale : [1, 1];
    const rot = Number(rawT.rotation ?? 0);
    const op = Number(rawT.opacity ?? 1);

    const posX = Number(pos[0]);
    const posY = Number(pos[1]);
    const scaleX = Number(scale[0]);
    const scaleY = Number(scale[1]);

    if (!Number.isFinite(posX) || !Number.isFinite(posY)) {
      errors.push(`Node '${rawNode.id}' has non-finite position coordinates`);
    } else if (Math.abs(posX) > 50000 || Math.abs(posY) > 50000) {
      errors.push(`Node '${rawNode.id}' position exceeds limit of 50000`);
    }

    if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) {
      errors.push(`Node '${rawNode.id}' has non-finite scale values`);
    } else if (Math.abs(scaleX) > 100 || Math.abs(scaleY) > 100) {
      errors.push(`Node '${rawNode.id}' scale exceeds limit of 100`);
    }

    if (!Number.isFinite(rot)) {
      errors.push(`Node '${rawNode.id}' has non-finite rotation value`);
    }

    if (!Number.isFinite(op)) {
      errors.push(`Node '${rawNode.id}' has non-finite opacity value`);
    }

    const clampedOpacity = Math.max(0, Math.min(1, Number.isFinite(op) ? op : 1));

    // bindings
    const validatedBindings: AudioBinding[] = [];
    if (Array.isArray(rawNode.bindings)) {
      for (let bIdx = 0; bIdx < rawNode.bindings.length; bIdx++) {
        const b = rawNode.bindings[bIdx];
        if (!b || typeof b !== 'object') continue;
        if (!KNOWN_BINDING_SOURCES.has(b.source) || !KNOWN_BINDING_TARGETS.has(b.target)) {
          errors.push(`Node '${rawNode.id}' binding at index ${bIdx} has invalid source or target`);
          continue;
        }
        const minRange = Number(b.outputRange?.[0]);
        const maxRange = Number(b.outputRange?.[1]);
        if (!Number.isFinite(minRange) || !Number.isFinite(maxRange)) {
          errors.push(`Node '${rawNode.id}' binding at index ${bIdx} has non-finite outputRange`);
          continue;
        }
        validatedBindings.push({
          source: b.source,
          target: b.target,
          outputRange: [minRange, maxRange],
        });
      }
    }

    const node: OpenVizNode = {
      id: rawNode.id,
      name: nodeName,
      type: rawNode.type,
      transform: {
        position: [posX || 0, posY || 0],
        scale: [scaleX || 1, scaleY || 1],
        rotation: Number.isFinite(rot) ? rot : 0,
        opacity: clampedOpacity,
      },
      bindings: validatedBindings,
    };

    // type-specific data
    if (rawNode.type === 'Bars' && rawNode.barsData) {
      const bd = rawNode.barsData;
      const count = Math.round(Number(bd.count ?? 64));
      if (!Number.isFinite(count) || count < 1 || count > 512) {
        errors.push(`Node '${rawNode.id}' bars count must be an integer between 1 and 512`);
      }
      const cStart = Array.isArray(bd.colorStart) ? bd.colorStart.map(Number) : [0, 0.94, 1, 1];
      const cEnd = Array.isArray(bd.colorEnd) ? bd.colorEnd.map(Number) : [1, 0, 0.63, 1];

      for (const [idx, c] of [...cStart, ...cEnd].entries()) {
        if (!Number.isFinite(c) || c < 0 || c > 1) {
          errors.push(`Node '${rawNode.id}' bars color component at index ${idx} must be in [0, 1]`);
          break;
        }
      }

      node.barsData = {
        count: Math.max(1, Math.min(512, count || 64)),
        innerRadius: Number(bd.innerRadius) || 240,
        width: Number(bd.width) || 4,
        isRadial: Boolean(bd.isRadial ?? true),
        colorStart: [cStart[0], cStart[1], cStart[2], cStart[3]],
        colorEnd: [cEnd[0], cEnd[1], cEnd[2], cEnd[3]],
      };
    } else if (rawNode.type === 'Image' && rawNode.imageData) {
      const idData = rawNode.imageData;
      if (idData.url && !isValidAssetUrl(idData.url)) {
        errors.push(`Node '${rawNode.id}' imageData.url is invalid: must be blob: or base64 data image URL`);
      }
      node.imageData = {
        assetId: String(idData.assetId || ''),
        url: idData.url,
        fit: idData.fit === 'cover' ? 'cover' : idData.fit === 'contain' ? 'contain' : undefined,
      };
    } else if (rawNode.type === 'Text' && rawNode.textData) {
      const td = rawNode.textData;
      let textStr = typeof td.text === 'string' ? td.text : '';
      if (textStr.length > 500) {
        textStr = textStr.substring(0, 500);
      }
      node.textData = {
        text: textStr,
        size: Number(td.size) || 24,
      };
    }

    validatedNodes.push(node);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    template: {
      schemaVersion: t.schemaVersion,
      name,
      author,
      canvasAspect,
      clearColor,
      nodes: validatedNodes,
      postEffects: validatedPostEffects,
      assets: validatedAssets,
    },
  };
}

export function parseTemplateJSON(text: string, maxBytes = 20 * 1024 * 1024): ValidationResult {
  const byteLen = typeof Buffer !== 'undefined' ? Buffer.byteLength(text, 'utf-8') : new TextEncoder().encode(text).length;
  if (byteLen > maxBytes) {
    return {
      ok: false,
      errors: [`JSON payload size (${byteLen} bytes) exceeds maximum limit of ${maxBytes} bytes`],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      errors: [`Invalid JSON string: ${(err as Error).message}`],
    };
  }

  return validateTemplate(parsed);
}
