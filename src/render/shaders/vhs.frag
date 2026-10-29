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
