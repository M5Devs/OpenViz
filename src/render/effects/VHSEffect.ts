import * as THREE from 'three';
import passVert from '../shaders/passthrough.vert?raw';
import vhsFrag from '../shaders/vhs.frag?raw';

export const VHSShader = {
  uniforms: {
    tDiffuse: { value: null },
    iTime: { value: 0 },
    noiseAmount: { value: 0.03 },
  },
  vertexShader: passVert,
  fragmentShader: vhsFrag,
};
