import * as THREE from 'three';

export const MotionBlurShader = {
  uniforms: {
    tDiffuse: { value: null },
    tCurrent: { value: null },
    tPrev: { value: null },
    decay: { value: 0.8 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform sampler2D tCurrent;
    uniform sampler2D tPrev;
    uniform float decay;
    varying vec2 vUv;

    void main() {
      vec4 curr = texture2D(tDiffuse, vUv);
      vec4 prev = texture2D(tPrev, vUv);

      vec4 result = curr * (1.0 - decay) + prev * decay;
      gl_FragColor = result;
    }
  `,
};
