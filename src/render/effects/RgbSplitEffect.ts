import * as THREE from 'three';
import passVert from '../shaders/passthrough.vert?raw';
import rgbSplitFrag from '../shaders/rgb_split.frag?raw';

export const RgbSplitShader = {
  uniforms: {
    tDiffuse: { value: null },
    u_redOffset: { value: new THREE.Vector2(0.005, 0.0) },
    u_blueOffset: { value: new THREE.Vector2(-0.005, 0.0) },
    amount: { value: 0.02 },
    angle: { value: 0.0 },
    beatShake: { value: 0.0 },
  },
  vertexShader: passVert,
  fragmentShader: rgbSplitFrag,
};
