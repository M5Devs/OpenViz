import { AudioBinding, FrequencyData, OpenVizNode } from '../types';

export interface AnimatedState {
  scaleMul: number;
  rotAdd: number;
  opacityMul: number;
  shake: [number, number];
  barHeightMul: number;
  sceneShake: [number, number];
}

export function fnv1a(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mulberry32(a: number): () => number {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getSourceValue(source: AudioBinding['source'], audio: FrequencyData): number {
  switch (source) {
    case 'Bass':
      return audio.bass ?? 0;
    case 'Mid':
      return audio.mid ?? 0;
    case 'High':
      return audio.high ?? 0;
    case 'Beat':
      return audio.beat ?? 0;
    case 'Rms':
      return audio.rms ?? 0;
    case 'Spectrum': {
      if (!audio.spectrum || audio.spectrum.length === 0) return 0;
      let sum = 0;
      for (let i = 0; i < audio.spectrum.length; i++) {
        sum += audio.spectrum[i];
      }
      return sum / audio.spectrum.length;
    }
    default:
      return 0;
  }
}

// TODO: Verify whether importer/template emits degrees or radians for rotation bindings
export function computeAnimatedState(
  node: OpenVizNode,
  audio: FrequencyData,
  timeSeconds: number
): AnimatedState {
  let scaleMul = 1.0;
  let rotAdd = 0.0;
  let opacityMul = 1.0;
  let barHeightMul = 1.0;
  let posAmp = 0.0;
  let sceneAmp = 0.0;

  if (node.bindings && node.bindings.length > 0) {
    for (const binding of node.bindings) {
      const sourceVal = getSourceValue(binding.source, audio);
      const [minOut, maxOut] = binding.outputRange;
      const mapped = minOut + sourceVal * (maxOut - minOut);

      switch (binding.target) {
        case 'ScaleUniform':
          scaleMul *= mapped;
          break;
        case 'Rotation':
          rotAdd += mapped;
          break;
        case 'Opacity':
          opacityMul *= mapped;
          break;
        case 'BarHeight':
          barHeightMul *= mapped;
          break;
        case 'Position':
          posAmp += mapped;
          break;
        case 'CameraShakeIntensity':
          sceneAmp += mapped;
          break;
      }
    }
  }

  const frameIndex = Math.floor(timeSeconds * 60 + 1e-6);
  const seed = (fnv1a(node.id) ^ frameIndex) >>> 0;
  const rng = mulberry32(seed);

  const r1 = rng() * 2 - 1;
  const r2 = rng() * 2 - 1;
  const r3 = rng() * 2 - 1;
  const r4 = rng() * 2 - 1;

  const shake: [number, number] = [r1 * posAmp, r2 * posAmp];
  const sceneShake: [number, number] = [r3 * sceneAmp, r4 * sceneAmp];

  return {
    scaleMul,
    rotAdd,
    opacityMul,
    shake,
    barHeightMul,
    sceneShake,
  };
}
