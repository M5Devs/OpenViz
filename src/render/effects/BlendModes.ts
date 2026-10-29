export type BlendModeType = 'Normal' | 'Additive' | 'Multiply' | 'Screen';

export const BlendShader = {
  uniforms: {
    tBase: { value: null },
    tBlend: { value: null },
    blendMode: { value: 0 },
    opacity: { value: 1.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tBase;
    uniform sampler2D tBlend;
    uniform int blendMode;
    uniform float opacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(tBase, vUv);
      vec4 blend = texture2D(tBlend, vUv) * opacity;

      vec4 result = vec4(0.0);

      if (blendMode == 1) {
        result.rgb = base.rgb + blend.rgb;
        result.a = max(base.a, blend.a);
      } else if (blendMode == 2) {
        result.rgb = base.rgb * blend.rgb;
        result.a = base.a * blend.a;
      } else if (blendMode == 3) {
        result.rgb = vec3(1.0) - (vec3(1.0) - base.rgb) * (vec3(1.0) - blend.rgb);
        result.a = max(base.a, blend.a);
      } else {
        result.rgb = mix(base.rgb, blend.rgb, blend.a);
        result.a = base.a + blend.a * (1.0 - base.a);
      }

      gl_FragColor = result;
    }
  `,
};
