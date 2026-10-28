/**
 * VHS Analog CRT / Scanline Shader:
 * MIT License, Copyright (c) halvves (https://github.com/halvves/shader-vhs)
 */

export const VHSShader = {
  uniforms: {
    tDiffuse: { value: null },
    iTime: { value: 0 },
    noiseAmount: { value: 0.03 },
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
    uniform float iTime;
    uniform float noiseAmount;
    varying vec2 vUv;

    float rand(vec2 co) {
      return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      float scanline = sin(uv.y * 800.0 + iTime * 10.0) * 0.04;

      vec4 color = texture2D(tDiffuse, uv);
      color.rgb -= scanline;
      color.rgb += (rand(uv + iTime) - 0.5) * noiseAmount;

      gl_FragColor = color;
    }
  `,
};
