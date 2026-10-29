import * as THREE from 'three';
import passVert from '../shaders/passthrough.vert?raw';
import blurFrag from '../shaders/gaussian_blur.frag?raw';

export const BlurShader = {
  uniforms: {
    tDiffuse: { value: null },
    direction: { value: new THREE.Vector2(1.0, 0.0) },
    blurRadius: { value: 1.0 },
    blurMultiplier: { value: 1.0 },
    texelSize: { value: new THREE.Vector2(1 / 1920, 1 / 1080) },
  },
  vertexShader: passVert,
  fragmentShader: blurFrag,
};
