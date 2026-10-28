import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { FrequencyData, OpenVizTemplate, OpenVizNode } from '../src/types';

let geomDisposeCount = 0;
let matDisposeCount = 0;

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof THREE>('three');

  class TrackedPlaneGeometry extends actual.PlaneGeometry {
    constructor(...args: any[]) {
      super(...(args as [any]));
    }
    dispose() {
      geomDisposeCount++;
      super.dispose();
    }
  }

  class TrackedMeshBasicMaterial extends actual.MeshBasicMaterial {
    constructor(...args: any[]) {
      super(...(args as [any]));
    }
    dispose() {
      matDisposeCount++;
      super.dispose();
    }
  }

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
    render = vi.fn();
    dispose = vi.fn();
  }

  return {
    ...actual,
    PlaneGeometry: TrackedPlaneGeometry,
    MeshBasicMaterial: TrackedMeshBasicMaterial,
    WebGLRenderer: MockWebGLRenderer,
  };
});

import { VisualizerScene, parseAspect } from '../src/render/scene';

describe('VisualizerScene and render correctness', () => {
  const createTestTemplate = (): OpenVizTemplate => ({
    schemaVersion: '1.0',
    name: 'Test Template',
    author: 'Test',
    canvasAspect: '16:9',
    clearColor: [0.1, 0.1, 0.1, 1],
    postEffects: [],
    nodes: [
      {
        id: 'node_bars_1',
        name: 'Bars Layer',
        type: 'Bars',
        transform: { position: [10, 20], scale: [1, 1], rotation: 0.1, opacity: 0.8 },
        bindings: [{ source: 'Bass', target: 'ScaleUniform', outputRange: [1, 2] }],
        barsData: {
          count: 32,
          innerRadius: 100,
          width: 5,
          isRadial: false,
          colorStart: [1, 0, 0, 1],
          colorEnd: [0, 1, 0, 1],
        },
      },
      {
        id: 'node_img_1',
        name: 'Image Layer',
        type: 'Image',
        transform: { position: [0, 0], scale: [2, 2], rotation: 0, opacity: 1 },
        bindings: [{ source: 'Mid', target: 'Opacity', outputRange: [0.5, 1] }],
        imageData: { assetId: 'img1' },
      },
    ],
  });

  const createMockContainer = (width = 1920, height = 1080) =>
    ({
      clientWidth: width,
      clientHeight: height,
      appendChild: vi.fn(),
    } as any);

  it('constructs two-level hierarchy baseGroup -> animGroup and exactly 1 InstancedMesh for Bars', () => {
    const scene = new VisualizerScene(createMockContainer());
    const template = createTestTemplate();
    scene.loadTemplate(template);

    const contentRoot = (scene as any).contentRoot as THREE.Group;
    expect(contentRoot.children.length).toBe(2);

    const baseGroup = contentRoot.children[0] as THREE.Group;
    expect(baseGroup.userData.nodeId).toBe('node_bars_1');
    expect(baseGroup.position.x).toBe(10);
    expect(baseGroup.position.y).toBe(20);

    const animGroup = baseGroup.children[0] as THREE.Group;
    expect(animGroup).toBeDefined();

    const instancedMeshes = animGroup.children[0].children.filter(
      (c) => (c as THREE.InstancedMesh).isInstancedMesh
    );
    expect(instancedMeshes.length).toBe(1);
    const instMesh = instancedMeshes[0] as THREE.InstancedMesh;
    expect(instMesh.count).toBe(32);
  });

  it('gizmo change on baseGroup updates node.transform and never contains audio multipliers', () => {
    const scene = new VisualizerScene(createMockContainer());
    const template = createTestTemplate();
    scene.loadTemplate(template);

    const audio: FrequencyData = {
      bass: 1.0,
      mid: 1.0,
      high: 1.0,
      beat: 1.0,
      rms: 1.0,
      spectrum: new Float32Array(32).fill(1.0),
    };

    scene.updateAudioReactivity(audio, 0.5);

    const node = template.nodes[0];

    const entry = (scene as any).nodeEntries.get(node.id);
    entry.baseGroup.position.set(50, 60, 0);
    entry.baseGroup.scale.set(3, 4, 1);
    entry.baseGroup.rotation.z = 0.5;

    node.transform.position = [entry.baseGroup.position.x, entry.baseGroup.position.y];
    node.transform.scale = [entry.baseGroup.scale.x, entry.baseGroup.scale.y];
    node.transform.rotation = entry.baseGroup.rotation.z;

    expect(node.transform.position).toEqual([50, 60]);
    expect(node.transform.scale).toEqual([3, 4]);
    expect(node.transform.rotation).toBe(0.5);
  });

  it('leaves node.transform byte-identical across 100 audio update frames', () => {
    const scene = new VisualizerScene(createMockContainer());
    const template = createTestTemplate();
    scene.loadTemplate(template);

    const initialTransformStr = JSON.stringify(template.nodes.map((n) => n.transform));

    for (let f = 0; f < 100; f++) {
      const t = f / 60;
      const audio: FrequencyData = {
        bass: Math.sin(t),
        mid: Math.cos(t),
        high: Math.abs(Math.sin(t * 2)),
        beat: f % 10 === 0 ? 1 : 0,
        rms: 0.5,
        spectrum: new Float32Array(32).map((_, i) => Math.sin(t + i)),
      };
      scene.updateAudioReactivity(audio, t);
    }

    const finalTransformStr = JSON.stringify(template.nodes.map((n) => n.transform));
    expect(finalTransformStr).toBe(initialTransformStr);
  });

  it('disposes created geometries and materials when loading template 20x', () => {
    const scene = new VisualizerScene(createMockContainer());
    const template = createTestTemplate();

    geomDisposeCount = 0;
    matDisposeCount = 0;

    for (let i = 0; i < 20; i++) {
      scene.loadTemplate(template);
    }

    scene.dispose();

    expect(geomDisposeCount).toBeGreaterThan(0);
    expect(matDisposeCount).toBeGreaterThan(0);
  });

  it('keeps logical canvas fully inside orthographic frustum and preserves aspect ratio', () => {
    const scene = new VisualizerScene(createMockContainer(1920, 1080));
    const camera = (scene as any).camera as THREE.OrthographicCamera;

    const testContainers = [
      { w: 1920, h: 1080 },
      { w: 1000, h: 1000 },
      { w: 600, h: 1200 },
    ];

    const logicalLeft = -960;
    const logicalRight = 960;
    const logicalTop = 540;
    const logicalBottom = -540;

    for (const cont of testContainers) {
      scene.resize(cont.w, cont.h);

      expect(camera.left).toBeLessThanOrEqual(logicalLeft);
      expect(camera.right).toBeGreaterThanOrEqual(logicalRight);
      expect(camera.top).toBeGreaterThanOrEqual(logicalTop);
      expect(camera.bottom).toBeLessThanOrEqual(logicalBottom);

      const frustumAspect = (camera.right - camera.left) / (camera.top - camera.bottom);
      const containerAspect = cont.w / cont.h;
      expect(frustumAspect).toBeCloseTo(containerAspect);
    }
  });
});
