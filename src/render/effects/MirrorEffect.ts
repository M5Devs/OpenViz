export const MirrorShader = {
  uniforms: {
    tDiffuse: { value: null },
    mode: { value: 0 },
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
    uniform int mode;
    varying vec2 vUv;

    void main() {
      vec2 uv = vUv;

      if (mode == 0) {
        if (uv.x > 0.5) uv.x = 1.0 - uv.x;
      } else if (mode == 1) {
        if (uv.y > 0.5) uv.y = 1.0 - uv.y;
      } else if (mode == 2) {
        if (uv.x > 0.5) uv.x = 1.0 - uv.x;
        if (uv.y > 0.5) uv.y = 1.0 - uv.y;
      }

      gl_FragColor = texture2D(tDiffuse, uv);
    }
  `,
};
