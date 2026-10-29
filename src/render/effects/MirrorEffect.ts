import * as THREE from 'three';
import passVert from '../shaders/passthrough.vert?raw';
import mirrorFrag from '../shaders/mirror.frag?raw';

export const MirrorShader = {
  uniforms: {
    tDiffuse: { value: null },
    mode: { value: 0 },
  },
  vertexShader: passVert,
  fragmentShader: mirrorFrag,
};
