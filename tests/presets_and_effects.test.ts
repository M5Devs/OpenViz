import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof THREE>('three');

  class MockWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }),
      style: {},
    };
    setPixelRatio = vi.fn();
    setSize = vi.fn();
    setClearColor = vi.fn();
    getClearColor = vi.fn((target: THREE.Color) => (target ? target.setRGB(0, 0, 0) : new actual.Color(0, 0, 0)));
    getClearAlpha = vi.fn().mockReturnValue(1);
    getViewport = vi.fn((target: THREE.Vector4) => (target ? target.set(0, 0, 1000, 1000) : new actual.Vector4(0, 0, 1000, 1000)));
    setScissor = vi.fn();
    setScissorTest = vi.fn();
    setViewport = vi.fn();
    render = vi.fn();
    dispose = vi.fn();
    getPixelRatio = vi.fn().mockReturnValue(1);
    getSize = vi.fn((target: THREE.Vector2) => (target ? target.set(1000, 1000) : new actual.Vector2(1000, 1000)));
    getDrawingBufferSize = vi.fn((target: THREE.Vector2) => (target ? target.set(1000, 1000) : new actual.Vector2(1000, 1000)));
    setRenderTarget = vi.fn();
    getRenderTarget = vi.fn().mockReturnValue(null);
    clear = vi.fn();
    capabilities = { isWebGL2: true };
    getContext = vi.fn();
  }

  class MockTextureLoader {
    load(_url: string, onLoad?: (tex: any) => void) {
      const dummyTex = new actual.Texture();
      dummyTex.image = { width: 100, height: 100 };
      if (onLoad) {
        onLoad(dummyTex);
      }
      return dummyTex;
    }
  }

  return {
    ...actual,
    WebGLRenderer: MockWebGLRenderer,
    TextureLoader: MockTextureLoader,
  };
});

import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { logSpace } from '../src/audio/analysis';
import { getMonstercatPreset, getRadialPulsePreset, getLofiChillPreset } from '../src/render/presets';
import { CameraShakeEffect } from '../src/render/effects/CameraShakeEffect';
import { RgbSplitShader } from '../src/render/effects/RgbSplitEffect';
import { BlurShader } from '../src/render/effects/BlurEffect';
import { MotionBlurShader } from '../src/render/effects/MotionBlurEffect';
import { MirrorShader } from '../src/render/effects/MirrorEffect';
import { FidelityFXCASShader } from '../src/render/effects/FidelityFXCASEffect';
import { VHSShader } from '../src/render/effects/VHSEffect';
import { VisualizerScene } from '../src/render/scene';

describe('Vetted Open-Source Presets and Effects', () => {
  it('computes logarithmic frequency spacing correctly with logSpace', () => {
    const minFreq = 20;
    const maxFreq = 20000;
    const total = 64;

    const f0 = logSpace(minFreq, maxFreq, 0, total, 0.0);
    const fMid = logSpace(minFreq, maxFreq, 32, total, 0.0);
    const fMax = logSpace(minFreq, maxFreq, 64, total, 0.0);

    expect(f0).toBeCloseTo(20);
    expect(fMid).toBeGreaterThan(20);
    expect(fMid).toBeLessThan(20000);
    expect(fMax).toBeCloseTo(20000);
  });

  it('generates Monstercat, Radial Pulse, and Lo-Fi Chill presets', () => {
    const monstercat = getMonstercatPreset();
    expect(monstercat.name).toBe('Monstercat Equalizer');
    expect(monstercat.nodes.length).toBeGreaterThan(0);

    const radial = getRadialPulsePreset();
    expect(radial.name).toBe('Radial Pulse Ring');
    expect(radial.nodes.some((n) => n.barsData?.isRadial)).toBe(true);

    const lofi = getLofiChillPreset();
    expect(lofi.name).toBe('Lo-Fi Chill Horizontal');
    expect(lofi.nodes.length).toBeGreaterThan(0);
  });

  it('calculates camera shake offset from time and bass intensity', () => {
    const shake = new CameraShakeEffect({ intensity: 0.1, frequency: 10 });
    const [dx, dy] = shake.getOffset(1.5, 1.0);
    expect(typeof dx).toBe('number');
    expect(typeof dy).toBe('number');
  });

  it('exports valid Three.js ShaderMaterial / ShaderPass definition objects', () => {
    const shaders = [
      { name: 'RgbSplitShader', shader: RgbSplitShader },
      { name: 'BlurShader', shader: BlurShader },
      { name: 'MotionBlurShader', shader: MotionBlurShader },
      { name: 'MirrorShader', shader: MirrorShader },
      { name: 'FidelityFXCASShader', shader: FidelityFXCASShader },
      { name: 'VHSShader', shader: VHSShader },
    ];

    for (const { name, shader } of shaders) {
      expect(shader, `${name} should exist`).toBeDefined();
      expect(shader.uniforms, `${name} uniforms should exist`).toBeDefined();
      expect(typeof shader.vertexShader, `${name} vertexShader should be string`).toBe('string');
      expect(typeof shader.fragmentShader, `${name} fragmentShader should be string`).toBe('string');
      expect(shader.vertexShader).toContain('projectionMatrix');
      expect(shader.fragmentShader).toContain('gl_FragColor');
    }

    expect(RgbSplitShader.uniforms.u_redOffset.value).toBeInstanceOf(THREE.Vector2);
    expect(RgbSplitShader.uniforms.u_blueOffset.value).toBeInstanceOf(THREE.Vector2);
    expect(BlurShader.uniforms.direction.value).toBeInstanceOf(THREE.Vector2);
    expect(BlurShader.uniforms.texelSize.value).toBeInstanceOf(THREE.Vector2);
  });

  it('can instantiate ShaderPass objects from post-effect shaders without errors', () => {
    const rgbPass = new ShaderPass(RgbSplitShader);
    expect(rgbPass.material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(rgbPass.uniforms.u_redOffset).toBeDefined();

    const blurPass = new ShaderPass(BlurShader);
    expect(blurPass.material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(blurPass.uniforms.blurRadius).toBeDefined();

    const motionPass = new ShaderPass(MotionBlurShader);
    expect(motionPass.material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(motionPass.uniforms.decay).toBeDefined();

    const mirrorPass = new ShaderPass(MirrorShader);
    expect(mirrorPass.material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(mirrorPass.uniforms.mode).toBeDefined();
  });

  it('configures EffectComposer passes when VisualizerScene loads template with postEffects', () => {
    const createMockContainer = () =>
      ({
        clientWidth: 1920,
        clientHeight: 1080,
        appendChild: vi.fn(),
      } as any);

    const scene = new VisualizerScene(createMockContainer());
    const monstercat = getMonstercatPreset();
    scene.loadTemplate(monstercat);

    // Monstercat has Bloom and ChromaticAberration -> 1 RenderPass + 2 postEffect passes = 3
    expect(scene.composer.passes.length).toBe(3);
  });
});
