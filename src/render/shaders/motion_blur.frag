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
