export const BlurShader = {
  uniforms: {
    tDiffuse: { value: null },
    direction: { value: [1.0, 0.0] },
    blurRadius: { value: 1.0 },
    blurMultiplier: { value: 1.0 },
    texelSize: { value: [1 / 1920, 1 / 1080] },
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
    uniform vec2 direction;
    uniform float blurRadius;
    uniform float blurMultiplier;
    uniform vec2 texelSize;
    varying vec2 vUv;

    void main() {
      vec2 off = direction * texelSize * blurRadius;
      vec4 sum = texture2D(tDiffuse, vUv) * 0.227027;

      sum += texture2D(tDiffuse, vUv + off * 1.0) * 0.194594;
      sum += texture2D(tDiffuse, vUv - off * 1.0) * 0.194594;

      sum += texture2D(tDiffuse, vUv + off * 2.0) * 0.121622;
      sum += texture2D(tDiffuse, vUv - off * 2.0) * 0.121622;

      sum += texture2D(tDiffuse, vUv + off * 3.0) * 0.054054;
      sum += texture2D(tDiffuse, vUv - off * 3.0) * 0.054054;

      sum += texture2D(tDiffuse, vUv + off * 4.0) * 0.016216;
      sum += texture2D(tDiffuse, vUv - off * 4.0) * 0.016216;

      gl_FragColor = sum * blurMultiplier;
    }
  `,
};
