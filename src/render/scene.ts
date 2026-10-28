import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { FrequencyData, OpenVizNode, OpenVizTemplate } from '../types';
import { computeAnimatedState } from './bindings';

export function parseAspect(aspectStr?: string): number {
  if (!aspectStr) return 16 / 9;
  const parts = aspectStr.split(':').map((s) => parseFloat(s.trim()));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1]) && parts[1] !== 0) {
    return parts[0] / parts[1];
  }
  return 16 / 9;
}

export function disposeObject3D(obj: THREE.Object3D) {
  obj.traverse((child: THREE.Object3D) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    if (mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((m) => {
        const matWithMap = m as THREE.Material & { map?: THREE.Texture };
        if (matWithMap.map) {
          matWithMap.map.dispose();
        }
        m.dispose();
      });
    }
    if ((child as THREE.InstancedMesh).isInstancedMesh) {
      const inst = child as THREE.InstancedMesh;
      if (inst.dispose) {
        inst.dispose();
      }
    }
  });
}

export interface NodeRenderEntry {
  node: OpenVizNode;
  baseGroup: THREE.Group;
  animGroup: THREE.Group;
  barsInstancedMesh?: THREE.InstancedMesh;
  barsData?: {
    count: number;
    isRadial: boolean;
    innerRadius: number;
    barWidth: number;
  };
  materials: THREE.Material[];
}

export class VisualizerScene {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  public renderer: THREE.WebGLRenderer;
  private transformControls: TransformControls | null = null;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();

  private contentRoot: THREE.Group;
  private guideRect: THREE.LineLoop;

  private template: OpenVizTemplate | null = null;
  private nodeEntries = new Map<string, NodeRenderEntry>();
  private selectedNodeId: string | null = null;
  private onSelectCallback: ((nodeId: string | null) => void) | null = null;

  private logicalAspect = 16 / 9;
  private dummyObj = new THREE.Object3D();
  private clearColorObj = new THREE.Color();

  constructor(container: HTMLElement) {
    this.container = container;

    this.scene = new THREE.Scene();

    // Logical canvas frustum initialization
    this.camera = new THREE.OrthographicCamera(-960, 960, 540, -540, 0.1, 2000);
    this.camera.position.z = 1000;

    // preserveDrawingBuffer: false
    // Note: Phase 3 must create the VideoFrame synchronously right after render() with no await in between.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    if (container && container.appendChild) {
      this.renderer.setSize(container.clientWidth || 1920, container.clientHeight || 1080, false);
      container.appendChild(this.renderer.domElement);
    }

    this.contentRoot = new THREE.Group();
    this.scene.add(this.contentRoot);

    // Canvas bounds guide rectangle
    const guideGeom = new THREE.BufferGeometry();
    guideGeom.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [-960, -540, 0, 960, -540, 0, 960, 540, 0, -960, 540, 0],
        3
      )
    );
    const guideMat = new THREE.LineBasicMaterial({ color: 0x4f46e5, transparent: true, opacity: 0.5 });
    this.guideRect = new THREE.LineLoop(guideGeom, guideMat);
    this.scene.add(this.guideRect);

    this.setupTransformControls();
    this.setupPointerEvents();
  }

  private setupTransformControls() {
    if (typeof document === 'undefined' || !this.renderer.domElement) return;
    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setMode('translate');
    this.transformControls.setSize(0.75);

    // TransformControls attaches ONLY to baseGroup.
    // objectChange copies baseGroup -> node.transform. Nothing animated is ever read back.
    this.transformControls.addEventListener('objectChange', () => {
      if (!this.selectedNodeId) return;
      const entry = this.nodeEntries.get(this.selectedNodeId);
      if (entry) {
        entry.node.transform.position = [entry.baseGroup.position.x, entry.baseGroup.position.y];
        entry.node.transform.scale = [entry.baseGroup.scale.x, entry.baseGroup.scale.y];
        entry.node.transform.rotation = entry.baseGroup.rotation.z;
      }
    });

    const helper = this.getTransformControlsHelper();
    if (helper) {
      this.scene.add(helper);
    }
  }

  private getTransformControlsHelper(): THREE.Object3D | null {
    if (!this.transformControls) return null;
    const tc = this.transformControls as any;
    if (typeof tc.getHelper === 'function') {
      return tc.getHelper();
    }
    return tc;
  }

  private setupPointerEvents() {
    if (!this.renderer.domElement || !this.renderer.domElement.addEventListener) return;
    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      if (this.transformControls && this.transformControls.dragging) return;

      const rect = this.renderer.domElement.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      this.raycaster.setFromCamera(this.mouse, this.camera);
      const objects = Array.from(this.nodeEntries.values()).map((entry) => entry.baseGroup);
      const intersects = this.raycaster.intersectObjects(objects, true);

      if (intersects.length > 0) {
        let hitObj: THREE.Object3D | null = intersects[0].object;
        while (hitObj && !hitObj.userData.nodeId && hitObj.parent) {
          hitObj = hitObj.parent;
        }

        if (hitObj && hitObj.userData.nodeId) {
          this.selectNode(hitObj.userData.nodeId);
          return;
        }
      }

      this.selectNode(null);
    });
  }

  public setOnSelectCallback(cb: (nodeId: string | null) => void) {
    this.onSelectCallback = cb;
  }

  public selectNode(nodeId: string | null) {
    this.selectedNodeId = nodeId;
    if (nodeId && this.nodeEntries.has(nodeId)) {
      const entry = this.nodeEntries.get(nodeId)!;
      this.transformControls?.attach(entry.baseGroup);
    } else {
      this.transformControls?.detach();
    }

    if (this.onSelectCallback) {
      this.onSelectCallback(nodeId);
    }
  }

  public setGizmoVisible(visible: boolean) {
    if (this.transformControls) {
      const helper = this.getTransformControlsHelper();
      if (!visible) {
        this.transformControls.detach();
        this.transformControls.enabled = false;
        if (helper) helper.visible = false;
      } else {
        this.transformControls.enabled = true;
        if (helper) helper.visible = true;
        if (this.selectedNodeId && this.nodeEntries.has(this.selectedNodeId)) {
          this.transformControls.attach(this.nodeEntries.get(this.selectedNodeId)!.baseGroup);
        }
      }
    }
    this.guideRect.visible = visible;
  }

  public loadTemplate(template: OpenVizTemplate) {
    this.template = template;
    this.logicalAspect = parseAspect(template.canvasAspect);

    // Rebuild canvas guide rectangle
    const lw = 1080 * this.logicalAspect;
    const lh = 1080;
    const halfW = lw / 2;
    const halfH = lh / 2;
    this.guideRect.geometry.dispose();
    const guideGeom = new THREE.BufferGeometry();
    guideGeom.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [-halfW, -halfH, 0, halfW, -halfH, 0, halfW, halfH, 0, -halfW, halfH, 0],
        3
      )
    );
    this.guideRect.geometry = guideGeom;

    // Clear existing nodes and dispose resources
    this.nodeEntries.forEach((entry) => {
      this.contentRoot.remove(entry.baseGroup);
      disposeObject3D(entry.baseGroup);
    });
    this.nodeEntries.clear();
    this.selectedNodeId = null;
    this.transformControls?.detach();

    // Color management for clearColor
    const [r, g, b, a] = template.clearColor || [0, 0, 0, 1];
    this.clearColorObj.setRGB(r, g, b, THREE.SRGBColorSpace);
    this.renderer.setClearColor(this.clearColorObj, a);

    // Build nodes
    for (let i = 0; i < template.nodes.length; i++) {
      this.buildAndAddNode(template.nodes[i], i);
    }

    this.resize(this.container?.clientWidth || 1920, this.container?.clientHeight || 1080);
    this.render();
  }

  // Layer order = index in template.nodes (renderOrder = index * 10 so children can be offset).
  // Note: nodes[0] is the bottom layer.
  private buildAndAddNode(node: OpenVizNode, index: number): NodeRenderEntry {
    const renderOrder = index * 10;

    const baseGroup = new THREE.Group();
    baseGroup.userData.nodeId = node.id;
    baseGroup.position.set(node.transform.position[0], node.transform.position[1], 0);
    baseGroup.scale.set(node.transform.scale[0], node.transform.scale[1], 1);
    baseGroup.rotation.z = node.transform.rotation;

    const animGroup = new THREE.Group();
    baseGroup.add(animGroup);

    const materials: THREE.Material[] = [];
    let barsInstancedMesh: THREE.InstancedMesh | undefined;
    let barsData: NodeRenderEntry['barsData'];

    if (node.type === 'Bars' && node.barsData) {
      const barsResult = this.createBarsNode(node.barsData, renderOrder);
      animGroup.add(barsResult.group);
      barsInstancedMesh = barsResult.instancedMesh;
      materials.push(barsResult.material);
      barsData = {
        count: node.barsData.count || 64,
        isRadial: node.barsData.isRadial ?? true,
        innerRadius: node.barsData.innerRadius > 0 ? node.barsData.innerRadius : 240,
        barWidth: node.barsData.width > 0 ? node.barsData.width : 4,
      };
    } else if (node.type === 'Image' && node.imageData) {
      const nameLower = (node.name || '').toLowerCase();
      const isWallpaper =
        nameLower.includes('background') ||
        nameLower.includes('wallpaper') ||
        nameLower.includes('bg') ||
        (node.transform.scale[0] >= 1000 && node.transform.scale[1] >= 500);

      const imageMesh = this.createImageMesh(node.imageData, isWallpaper, renderOrder);
      animGroup.add(imageMesh);
      materials.push(imageMesh.material as THREE.Material);
    } else if (node.type === 'Text' && node.textData) {
      const textSprite = this.createTextSprite(node.textData.text, node.textData.size, renderOrder);
      animGroup.add(textSprite);
      materials.push(textSprite.material);
    } else {
      const fallbackMesh = this.createFallbackMesh(renderOrder);
      animGroup.add(fallbackMesh);
      materials.push(fallbackMesh.material as THREE.Material);
    }

    baseGroup.renderOrder = renderOrder;
    baseGroup.traverse((child) => {
      child.renderOrder = renderOrder;
    });

    this.contentRoot.add(baseGroup);

    const entry: NodeRenderEntry = {
      node,
      baseGroup,
      animGroup,
      barsInstancedMesh,
      barsData,
      materials,
    };

    baseGroup.userData.materials = materials;
    this.nodeEntries.set(node.id, entry);
    return entry;
  }

  private resetDummyObj() {
    this.dummyObj.position.set(0, 0, 0);
    this.dummyObj.rotation.set(0, 0, 0);
    this.dummyObj.scale.set(1, 1, 1);
    this.dummyObj.updateMatrix();
  }

  private createBarsNode(
    barsData: NonNullable<OpenVizNode['barsData']>,
    renderOrder: number
  ) {
    const group = new THREE.Group();
    const count = barsData.count || 64;
    const isRadial = barsData.isRadial ?? true;

    let innerRadius = barsData.innerRadius ?? 240;
    if (innerRadius <= 0) innerRadius = 240;

    let barWidth = barsData.width ?? 4;
    if (barWidth <= 0) barWidth = 4;

    const cStart = new THREE.Color();
    if (barsData.colorStart) {
      cStart.setRGB(barsData.colorStart[0], barsData.colorStart[1], barsData.colorStart[2], THREE.SRGBColorSpace);
    } else {
      cStart.setRGB(0, 0.94, 1, THREE.SRGBColorSpace);
    }

    const cEnd = new THREE.Color();
    if (barsData.colorEnd) {
      cEnd.setRGB(barsData.colorEnd[0], barsData.colorEnd[1], barsData.colorEnd[2], THREE.SRGBColorSpace);
    } else {
      cEnd.setRGB(1, 0, 0.63, THREE.SRGBColorSpace);
    }

    const geom = new THREE.PlaneGeometry(barWidth, 1);
    geom.translate(0, 0.5, 0);

    const mat = new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });

    const instancedMesh = new THREE.InstancedMesh(geom, mat, count);
    instancedMesh.renderOrder = renderOrder;

    const tmpColor = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) : 0;
      tmpColor.copy(cStart).lerp(cEnd, t);
      instancedMesh.setColorAt(i, tmpColor);

      this.resetDummyObj();
      if (isRadial) {
        const angle = (i / count) * Math.PI * 2;
        this.dummyObj.position.x = Math.cos(angle) * innerRadius;
        this.dummyObj.position.y = Math.sin(angle) * innerRadius;
        this.dummyObj.rotation.z = angle - Math.PI / 2;
      } else {
        const totalWidth = 1400;
        this.dummyObj.position.x = -totalWidth / 2 + (i + 0.5) * (totalWidth / count);
        this.dummyObj.position.y = 0;
      }
      this.dummyObj.scale.set(1, 1, 1);
      this.dummyObj.updateMatrix();
      instancedMesh.setMatrixAt(i, this.dummyObj.matrix);
    }
    if (instancedMesh.instanceColor) {
      instancedMesh.instanceColor.needsUpdate = true;
    }
    instancedMesh.instanceMatrix.needsUpdate = true;

    group.add(instancedMesh);

    // Invisible hit proxy for selection
    let proxyWidth = 1400;
    let proxyHeight = 600;
    if (isRadial) {
      proxyWidth = proxyHeight = (innerRadius + 300) * 2;
    }
    const proxyGeom = new THREE.PlaneGeometry(proxyWidth, proxyHeight);
    const proxyMat = new THREE.MeshBasicMaterial({
      visible: false,
      depthTest: false,
      depthWrite: false,
    });
    const hitProxy = new THREE.Mesh(proxyGeom, proxyMat);
    hitProxy.renderOrder = renderOrder;
    group.add(hitProxy);

    return { group, instancedMesh, material: mat };
  }

  private createImageMesh(imageData: any, isWallpaper: boolean, renderOrder: number): THREE.Mesh {
    const assetUrl = imageData.url || (this.template?.assets && this.template.assets[imageData.assetId]);
    const width = isWallpaper ? 1920 : 360;
    const height = isWallpaper ? 1080 : 360;
    const geom = new THREE.PlaneGeometry(width, height);

    let mat: THREE.MeshBasicMaterial;
    if (assetUrl) {
      const texture = new THREE.TextureLoader().load(assetUrl, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        this.render();
      });
      texture.colorSpace = THREE.SRGBColorSpace;
      mat = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
    } else {
      mat = new THREE.MeshBasicMaterial({
        color: 0x888888,
        wireframe: true,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
    }

    const mesh = new THREE.Mesh(geom, mat);
    mesh.renderOrder = renderOrder;
    return mesh;
  }

  private createTextSprite(text: string, fontSize = 24, renderOrder: number): THREE.Sprite {
    if (typeof document === 'undefined') {
      // Node/test fallback
      const spriteMat = new THREE.SpriteMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.renderOrder = renderOrder;
      return sprite;
    }

    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.font = `Bold ${fontSize * 2}px sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 512, 128);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(400, 100, 1);
    sprite.renderOrder = renderOrder;
    return sprite;
  }

  private createFallbackMesh(renderOrder: number): THREE.Mesh {
    const geom = new THREE.PlaneGeometry(360, 360);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x6366f1,
      wireframe: true,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.renderOrder = renderOrder;
    return mesh;
  }

  public addNode(node: OpenVizNode) {
    if (!this.template) {
      this.template = {
        schemaVersion: '1.0',
        name: 'Untitled',
        author: '',
        canvasAspect: '16:9',
        clearColor: [0, 0, 0, 1],
        nodes: [],
        postEffects: [],
      };
    }
    if (!this.template.nodes.includes(node)) {
      this.template.nodes.push(node);
    }
    const index = this.template.nodes.indexOf(node);
    this.buildAndAddNode(node, index);
    this.render();
  }

  public updateNode(nodeId: string) {
    if (!this.template) return;
    const index = this.template.nodes.findIndex((n) => n.id === nodeId);
    if (index === -1) return;

    const existing = this.nodeEntries.get(nodeId);
    if (existing) {
      this.contentRoot.remove(existing.baseGroup);
      disposeObject3D(existing.baseGroup);
      this.nodeEntries.delete(nodeId);
    }

    const isSelected = this.selectedNodeId === nodeId;
    const updatedNode = this.template.nodes[index];
    this.buildAndAddNode(updatedNode, index);

    if (isSelected) {
      const entry = this.nodeEntries.get(nodeId);
      if (entry && this.transformControls) {
        this.transformControls.attach(entry.baseGroup);
      }
    }
    this.render();
  }

  public removeNode(nodeId: string) {
    if (!this.template) return;
    const index = this.template.nodes.findIndex((n) => n.id === nodeId);
    if (index !== -1) {
      this.template.nodes.splice(index, 1);
    }

    const existing = this.nodeEntries.get(nodeId);
    if (existing) {
      if (this.selectedNodeId === nodeId) {
        this.transformControls?.detach();
        this.selectedNodeId = null;
        if (this.onSelectCallback) this.onSelectCallback(null);
      }
      this.contentRoot.remove(existing.baseGroup);
      disposeObject3D(existing.baseGroup);
      this.nodeEntries.delete(nodeId);
    }
    this.render();
  }

  public updateAudioReactivity(audio: FrequencyData, timeSeconds = 0) {
    if (!this.template) return;

    let totalSceneShakeX = 0;
    let totalSceneShakeY = 0;

    for (const entry of this.nodeEntries.values()) {
      const state = computeAnimatedState(entry.node, audio, timeSeconds);

      // Apply animGroup audio-driven local offsets
      entry.animGroup.scale.set(state.scaleMul, state.scaleMul, 1);
      entry.animGroup.rotation.z = state.rotAdd;
      entry.animGroup.position.set(state.shake[0], state.shake[1], 0);

      totalSceneShakeX += state.sceneShake[0];
      totalSceneShakeY += state.sceneShake[1];

      // Effective opacity = node.transform.opacity * opacity binding
      const effectiveOpacity = Math.max(0, Math.min(1, entry.node.transform.opacity * state.opacityMul));
      for (const mat of entry.materials) {
        mat.opacity = effectiveOpacity;
      }

      // Bars update via linear interpolation across audio.spectrum
      if (entry.barsInstancedMesh && entry.barsData && audio.spectrum && audio.spectrum.length > 0) {
        const { count, isRadial, innerRadius } = entry.barsData;
        const spectrum = audio.spectrum;
        const specLen = spectrum.length;

        for (let i = 0; i < count; i++) {
          const specIdx = (count > 1 ? i / (count - 1) : 0) * (specLen - 1);
          const i0 = Math.floor(specIdx);
          const i1 = Math.min(i0 + 1, specLen - 1);
          const frac = specIdx - i0;
          const bandVal = spectrum[i0] * (1 - frac) + spectrum[i1] * frac;

          const heightPx = Math.max(1.0, bandVal * 250.0 * state.barHeightMul);

          this.resetDummyObj();
          if (isRadial) {
            const angle = (i / count) * Math.PI * 2;
            this.dummyObj.position.x = Math.cos(angle) * innerRadius;
            this.dummyObj.position.y = Math.sin(angle) * innerRadius;
            this.dummyObj.rotation.z = angle - Math.PI / 2;
          } else {
            const totalWidth = 1400;
            this.dummyObj.position.x = -totalWidth / 2 + (i + 0.5) * (totalWidth / count);
            this.dummyObj.position.y = 0;
          }
          this.dummyObj.scale.set(1, heightPx, 1);
          this.dummyObj.updateMatrix();
          entry.barsInstancedMesh.setMatrixAt(i, this.dummyObj.matrix);
        }
        entry.barsInstancedMesh.instanceMatrix.needsUpdate = true;
      }
    }

    // Apply sceneShake to contentRoot
    this.contentRoot.position.set(totalSceneShakeX, totalSceneShakeY, 0);

    this.render();
  }

  public resize(width: number, height: number) {
    const lw = 1080 * this.logicalAspect;
    const lh = 1080;
    const containerAspect = height > 0 ? width / height : 16 / 9;
    const la = this.logicalAspect;

    let fw = lw;
    let fh = lh;

    if (containerAspect >= la) {
      fh = lh;
      fw = fh * containerAspect;
    } else {
      fw = lw;
      fh = fw / containerAspect;
    }

    this.camera.left = -fw / 2;
    this.camera.right = fw / 2;
    this.camera.top = fh / 2;
    this.camera.bottom = -fh / 2;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height, false);
    this.render();
  }

  public render() {
    this.renderer.render(this.scene, this.camera);
  }

  public dispose() {
    this.nodeEntries.forEach((entry) => {
      this.contentRoot.remove(entry.baseGroup);
      disposeObject3D(entry.baseGroup);
    });
    this.nodeEntries.clear();

    this.scene.remove(this.guideRect);
    disposeObject3D(this.guideRect);

    this.renderer.dispose();
    this.transformControls?.dispose();
  }
}
