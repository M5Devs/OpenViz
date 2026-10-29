import * as THREE from 'three';

export const RgbSplitShader = {
  uniforms: {
    tDiffuse: { value: null },
    u_redOffset: { value: new THREE.Vector2(0.005, 0.0) },
    u_blueOffset: { value: new THREE.Vector2(-0.005, 0.0) },
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
    uniform vec2 u_redOffset;
    uniform vec2 u_blueOffset;
    uniform float amount;
    uniform float angle;
    uniform float beatShake;
    varying vec2 vUv;

    void main() {
      float effAmount = amount * (1.0 + beatShake * 2.0);
      vec2 dir = vec2(cos(angle), sin(angle)) * effAmount;
      vec2 redOff = u_redOffset + dir;
      vec2 blueOff = u_blueOffset - dir;

      float r = texture2D(tDiffuse, vUv + redOff).r;
      vec4 gCol = texture2D(tDiffuse, vUv);
      float b = texture2D(tDiffuse, vUv + blueOff).b;

      gl_FragColor = vec4(r, gCol.g, b, gCol.a);
    }
  `,
};
