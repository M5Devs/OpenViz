export const RgbSplitShader = {
  uniforms: {
    tDiffuse: { value: null },
    amount: { value: 0.02 },
    angle: { value: 0.0 },
    beatShake: { value: 0.0 },
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
    uniform float amount;
    uniform float angle;
    uniform float beatShake;
    varying vec2 vUv;

    void main() {
      float effAmount = amount * (1.0 + beatShake * 2.0);
      vec2 dir = vec2(cos(angle), sin(angle)) * effAmount;

      float r = texture2D(tDiffuse, vUv + dir).r;
      vec4 gCol = texture2D(tDiffuse, vUv);
      float b = texture2D(tDiffuse, vUv - dir).b;

      gl_FragColor = vec4(r, gCol.g, b, gCol.a);
    }
  `,
};
