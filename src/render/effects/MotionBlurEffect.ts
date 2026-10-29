import passVert from '../shaders/passthrough.vert?raw';
import motionBlurFrag from '../shaders/motion_blur.frag?raw';

export const MotionBlurShader = {
  uniforms: {
    tDiffuse: { value: null },
    decay: { value: 0.8 },
  },
  vertexShader: passVert,
  fragmentShader: motionBlurFrag,
};
