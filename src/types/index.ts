export type BindingSource = 'Bass' | 'Mid' | 'High' | 'Beat' | 'Rms' | 'Spectrum';

export type BindingTarget =
  | 'ScaleUniform'
  | 'BarHeight'
  | 'Rotation'
  | 'Opacity'
  | 'CameraShakeIntensity'
  | 'Position';

export interface AudioBinding {
  source: BindingSource;
  target: BindingTarget;
  outputRange: [number, number];
}

/**
 * Node transform settings.
 * For Image nodes, transform.scale is a MULTIPLIER of the image's base display size.
 * Base display size: natural texture size fitted ('contain') into a 360x360 box.
 * If imageData.fit === 'cover', base size = natural size covering the logical canvas (1080 height x aspect width).
 */
export interface NodeTransform {
  position: [number, number];
  scale: [number, number];
  rotation: number; // radians or degrees in UI
  opacity: number;
}

export type NodeType = 'Bars' | 'Image' | 'Group' | 'Text';

export interface BarsNodeData {
  count: number;
  innerRadius: number;
  width: number;
  isRadial: boolean;
  colorStart: [number, number, number, number];
  colorEnd: [number, number, number, number];
}

export interface ImageNodeData {
  assetId: string;
  url?: string;
  fit?: 'contain' | 'cover';
}

export interface TextNodeData {
  text: string;
  size: number;
}

export interface GroupNodeData {
  childrenIds: string[];
}

export interface OpenVizNode {
  id: string;
  name: string;
  type: NodeType;
  transform: NodeTransform;
  bindings: AudioBinding[];
  barsData?: BarsNodeData;
  imageData?: ImageNodeData;
  textData?: TextNodeData;
  groupData?: GroupNodeData;
}

export type PostEffectType = 'ChromaticAberration' | 'MotionTrails' | 'Bloom';

export interface PostEffect {
  type: PostEffectType;
  amount?: number;
  angle?: number;
  decay?: number;
  threshold?: number;
  intensity?: number;
  radius?: number;
}

export interface OpenVizTemplate {
  schemaVersion: string;
  name: string;
  author: string;
  canvasAspect: string;
  clearColor: [number, number, number, number];
  nodes: OpenVizNode[];
  postEffects: PostEffect[];
  assets?: Record<string, string>; // assetId -> DataUrl or ObjectURL
}

export interface DSPState {
  bassBoostDb: number;
  slowedReverb: boolean;
  nightcore: boolean;
  eightD: boolean;
}

export interface FrequencyData {
  bass: number;
  mid: number;
  high: number;
  beat: number;
  rms: number;
  spectrum: Float32Array;
}

export interface ExportOptions {
  width: number;
  height: number;
  fps: number;
  bitrate: number;
}

export interface ExportProgress {
  frame: number;
  totalFrames: number;
  percent: number;
}
