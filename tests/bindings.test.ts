import { describe, expect, it } from 'vitest';
import { computeAnimatedState, fnv1a, mulberry32 } from '../src/render/bindings';
import { FrequencyData, OpenVizNode } from '../src/types';

describe('bindings pure calculations', () => {
  const dummyAudio: FrequencyData = {
    bass: 0.5,
    mid: 0.4,
    high: 0.3,
    beat: 0.8,
    rms: 0.6,
    spectrum: new Float32Array([0.2, 0.4, 0.6, 0.8]), // mean = 0.5
  };

  const createNode = (bindings: OpenVizNode['bindings']): OpenVizNode => ({
    id: 'test_node_1',
    name: 'Test Node',
    type: 'Image',
    transform: { position: [100, 200], scale: [1, 1], rotation: 0, opacity: 1 },
    bindings,
  });

  it('maps outputRange correctly for all sources', () => {
    const nodeBass = createNode([{ source: 'Bass', target: 'ScaleUniform', outputRange: [1, 2] }]);
    expect(computeAnimatedState(nodeBass, dummyAudio, 0).scaleMul).toBeCloseTo(1.5); // 1 + 0.5*(2-1) = 1.5

    const nodeMid = createNode([{ source: 'Mid', target: 'ScaleUniform', outputRange: [0, 10] }]);
    expect(computeAnimatedState(nodeMid, dummyAudio, 0).scaleMul).toBeCloseTo(4); // 0 + 0.4*10 = 4

    const nodeHigh = createNode([{ source: 'High', target: 'ScaleUniform', outputRange: [10, 20] }]);
    expect(computeAnimatedState(nodeHigh, dummyAudio, 0).scaleMul).toBeCloseTo(13); // 10 + 0.3*10 = 13

    const nodeBeat = createNode([{ source: 'Beat', target: 'ScaleUniform', outputRange: [0, 1] }]);
    expect(computeAnimatedState(nodeBeat, dummyAudio, 0).scaleMul).toBeCloseTo(0.8);

    const nodeRms = createNode([{ source: 'Rms', target: 'ScaleUniform', outputRange: [0, 1] }]);
    expect(computeAnimatedState(nodeRms, dummyAudio, 0).scaleMul).toBeCloseTo(0.6);

    const nodeSpectrum = createNode([{ source: 'Spectrum', target: 'ScaleUniform', outputRange: [0, 2] }]);
    expect(computeAnimatedState(nodeSpectrum, dummyAudio, 0).scaleMul).toBeCloseTo(1.0); // mean(0.2,0.4,0.6,0.8)=0.5 -> 0.5*2 = 1.0
  });

  it('combines multiple bindings (multiply for Scale/Opacity/BarHeight, add for Rotation/Position/CameraShake)', () => {
    const node = createNode([
      { source: 'Bass', target: 'ScaleUniform', outputRange: [1, 2] }, // 1.5
      { source: 'Mid', target: 'ScaleUniform', outputRange: [1, 3] }, // 1 + 0.4*2 = 1.8 -> scaleMul = 1.5 * 1.8 = 2.7
      { source: 'Bass', target: 'Opacity', outputRange: [0.5, 1.0] }, // 0.75
      { source: 'Mid', target: 'Opacity', outputRange: [0.5, 1.5] }, // 0.5 + 0.4*1 = 0.9 -> opacityMul = 0.75 * 0.9 = 0.675
      { source: 'Bass', target: 'BarHeight', outputRange: [1, 2] }, // 1.5
      { source: 'Mid', target: 'BarHeight', outputRange: [2, 4] }, // 2.8 -> barHeightMul = 1.5 * 2.8 = 4.2
      { source: 'Bass', target: 'Rotation', outputRange: [0, 1] }, // 0.5 rad
      { source: 'Mid', target: 'Rotation', outputRange: [0, 2] }, // 0.8 rad -> rotAdd = 1.3 rad
    ]);

    const state = computeAnimatedState(node, dummyAudio, 0);
    expect(state.scaleMul).toBeCloseTo(2.7);
    expect(state.opacityMul).toBeCloseTo(0.675);
    expect(state.barHeightMul).toBeCloseTo(4.2);
    expect(state.rotAdd).toBeCloseTo(1.3);
  });

  it('produces active non-default values for BarHeight, Opacity, and CameraShakeIntensity', () => {
    const node = createNode([
      { source: 'Bass', target: 'BarHeight', outputRange: [1, 5] },
      { source: 'Mid', target: 'Opacity', outputRange: [0.2, 0.8] },
      { source: 'High', target: 'CameraShakeIntensity', outputRange: [0, 10] },
    ]);

    const state = computeAnimatedState(node, dummyAudio, 1.0);
    expect(state.barHeightMul).toBeCloseTo(3.0);
    expect(state.opacityMul).toBeCloseTo(0.44);
    expect(Math.hypot(state.sceneShake[0], state.sceneShake[1])).toBeGreaterThan(0);
  });

  it('guarantees Mulberry32 shake determinism', () => {
    const nodeA = createNode([{ source: 'Bass', target: 'Position', outputRange: [0, 20] }]);
    const nodeB = createNode([{ source: 'Bass', target: 'Position', outputRange: [0, 20] }]);
    nodeB.id = 'test_node_2';

    // Same node + same frame -> identical shake
    const state1 = computeAnimatedState(nodeA, dummyAudio, 1.5);
    const state2 = computeAnimatedState(nodeA, dummyAudio, 1.5);
    expect(state1.shake).toEqual(state2.shake);
    expect(state1.sceneShake).toEqual(state2.sceneShake);

    // Different frame -> different shake
    const state3 = computeAnimatedState(nodeA, dummyAudio, 2.0);
    expect(state1.shake).not.toEqual(state3.shake);

    // Different node -> different shake
    const state4 = computeAnimatedState(nodeB, dummyAudio, 1.5);
    expect(state1.shake).not.toEqual(state4.shake);
  });
});
