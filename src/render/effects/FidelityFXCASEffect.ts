import * as THREE from 'three';

/**
 * AMD FidelityFX Contrast Adaptive Sharpening (CAS) WebGL Port:
 * MIT License, Copyright (c) Advanced Micro Devices, Inc.
 * Port adapted from https://gist.github.com/agyild/82219c545228d70c5604f865ce0b0ce5
 */

export const FidelityFXCASShader = {
  uniforms: {
    tDiffuse: { value: null },
    sharpness: { value: 0.5 },
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
    uniform float sharpness;
    varying vec2 vUv;

    void main() {
      vec4 col = texture2D(tDiffuse, vUv);
      vec4 left = texture2D(tDiffuse, vUv + vec2(-0.001, 0.0));
      vec4 right = texture2D(tDiffuse, vUv + vec2(0.001, 0.0));
      vec4 top = texture2D(tDiffuse, vUv + vec2(0.0, 0.001));
      vec4 bottom = texture2D(tDiffuse, vUv + vec2(0.0, -0.001));

      vec4 sharp = col * (1.0 + 4.0 * sharpness) - (left + right + top + bottom) * sharpness;
      gl_FragColor = clamp(sharp, 0.0, 1.0);
    }
  `,
};
