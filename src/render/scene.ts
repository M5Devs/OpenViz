import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { OpenVizTemplate, OpenVizNode, FrequencyData, AudioBinding } from '../types';

const VIEW_WIDTH = 1920;
const VIEW_HEIGHT = 1080;

export class VisualizerScene {
  public scene: THREE.Scene;
  public camera: THREE.OrthographicCamera;
  public renderer: THREE.WebGLRenderer;
  public transformControls: TransformControls | null = null;

  private canvas: HTMLCanvasElement;
  private nodeMeshMap: Map<string, THREE.Object3D> = new Map();
  private template: OpenVizTemplate | null = null;
  private selectedNodeId: string | null = null;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();

  private onSelectCallback?: (nodeId: string | null) => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();

    this.camera = new THREE.OrthographicCamera(
      -VIEW_WIDTH / 2,
      VIEW_WIDTH / 2,
      VIEW_HEIGHT / 2,
      -VIEW_HEIGHT / 2,
      -1000,
      1000
    );
    this.camera.position.set(0, 0, 100);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.setupTransformControls();
    this.setupInteractivity();
  }

  private setupTransformControls() {
    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.size = 0.75;
    this.transformControls.showZ = false;
    this.scene.add(this.transformControls);

    this.transformControls.addEventListener('change', () => {
      this.render();
    });

    this.transformControls.addEventListener('objectChange', () => {
      if (!this.selectedNodeId || !this.template) return;
      const mesh = this.nodeMeshMap.get(this.selectedNodeId);
      if (!mesh) return;

      const node = this.template.nodes.find((n) => n.id === this.selectedNodeId);
      if (node) {
        node.transform.position = [mesh.position.x, mesh.position.y];
        node.transform.scale = [mesh.scale.x, mesh.scale.y];
        node.transform.rotation = mesh.rotation.z;
      }
    });
  }

  private setupInteractivity() {
    this.canvas.addEventListener('pointerdown', (event: PointerEvent) => {
      if (this.transformControls?.dragging) return;

      const rect = this.canvas.getBoundingClientRect();
      this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      this.raycaster.setFromCamera(this.mouse, this.camera);
      const objects = Array.from(this.nodeMeshMap.values());
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
    if (nodeId && this.nodeMeshMap.has(nodeId)) {
      const mesh = this.nodeMeshMap.get(nodeId)!;
      this.transformControls?.attach(mesh);
    } else {
      this.transformControls?.detach();
    }

    if (this.onSelectCallback) {
      this.onSelectCallback(nodeId);
    }
  }

  private getLayerIndex(node: OpenVizNode, index: number): number {
    const nameLower = (node.name || '').toLowerCase();
    if (nameLower.includes('background') || nameLower.includes('wallpaper') || nameLower.includes('bg')) {
      return 0;
    }
    if (node.type === 'Bars') return 10 + index;
    if (node.type === 'Image') return 20 + index;
    if (node.type === 'Text') return 30 + index;
    return 40 + index;
  }

  private setMeshRenderOrder(object: THREE.Object3D, renderOrder: number) {
    object.renderOrder = renderOrder;
    object.traverse((child) => {
      child.renderOrder = renderOrder;
    });
  }

  public loadTemplate(template: OpenVizTemplate) {
    this.template = template;

    this.nodeMeshMap.forEach((mesh) => {
      this.scene.remove(mesh);
    });
    this.nodeMeshMap.clear();

    const [r, g, b, a] = template.clearColor;
    this.renderer.setClearColor(new THREE.Color(r, g, b), a);

    for (let i = 0; i < template.nodes.length; i++) {
      const node = template.nodes[i];
      const layerIndex = this.getLayerIndex(node, i);
      const mesh = this.createNodeMesh(node, template, layerIndex);
      mesh.userData.nodeId = node.id;

      mesh.position.set(node.transform.position[0], node.transform.position[1], 0);
      mesh.scale.set(node.transform.scale[0], node.transform.scale[1], 1);
      mesh.rotation.z = node.transform.rotation;

      this.setMeshRenderOrder(mesh, layerIndex);

      this.nodeMeshMap.set(node.id, mesh);
      this.scene.add(mesh);
    }

    this.render();
  }

  private createNodeMesh(node: OpenVizNode, template: OpenVizTemplate, layerIndex: number): THREE.Object3D {
    const group = new THREE.Group();

    if (node.type === 'Bars' && node.barsData) {
      const barsGroup = this.createSpectrumBarsGroup(node.barsData, layerIndex);
      group.add(barsGroup);
    } else if (node.type === 'Image' && node.imageData) {
      const nameLower = (node.name || '').toLowerCase();
      const isWallpaper =
        nameLower.includes('background') ||
        nameLower.includes('wallpaper') ||
        nameLower.includes('bg') ||
        (node.transform.scale[0] >= 1000 && node.transform.scale[1] >= 500);

      const planeMesh = this.createImagePlane(node.imageData, template, isWallpaper, layerIndex);
      group.add(planeMesh);
    } else if (node.type === 'Text' && node.textData) {
      const textSprite = this.createTextSprite(node.textData.text, node.textData.size, layerIndex);
      group.add(textSprite);
    } else {
      const geom = new THREE.PlaneGeometry(360, 360);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x6366f1,
        wireframe: true,
        depthTest: false,
        depthWrite: false,
        transparent: true,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.renderOrder = layerIndex;
      group.add(mesh);
    }

    return group;
  }

  private createSpectrumBarsGroup(barsData: any, layerIndex: number): THREE.Group {
    const group = new THREE.Group();
    const count = barsData.count || 64;
    const isRadial = barsData.isRadial ?? true;

    let innerRadius = barsData.innerRadius ?? 240;
    if (innerRadius < 2.0 && innerRadius > 0) {
      innerRadius = 240;
    } else if (innerRadius <= 0) {
      innerRadius = 240;
    }

    let barWidth = barsData.width ?? 4;
    if (barWidth <= 1.0) {
      barWidth = 4;
    }

    const cStart = barsData.colorStart
      ? new THREE.Color(barsData.colorStart[0], barsData.colorStart[1], barsData.colorStart[2])
      : new THREE.Color(0x00f0ff);
    const cEnd = barsData.colorEnd
      ? new THREE.Color(barsData.colorEnd[0], barsData.colorEnd[1], barsData.colorEnd[2])
      : new THREE.Color(0xff00a0);

    for (let i = 0; i < count; i++) {
      const t = i / count;
      const color = cStart.clone().lerp(cEnd, t);

      const geom = new THREE.PlaneGeometry(barWidth, 1);
      geom.translate(0, 0.5, 0);

      const mat = new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
        transparent: true,
      });

      const barMesh = new THREE.Mesh(geom, mat);
      barMesh.renderOrder = layerIndex;

      if (isRadial) {
        const angle = (i / count) * Math.PI * 2;
        barMesh.position.x = Math.cos(angle) * innerRadius;
        barMesh.position.y = Math.sin(angle) * innerRadius;
        barMesh.rotation.z = angle - Math.PI / 2;
      } else {
        const totalWidth = 1400;
        barMesh.position.x = -totalWidth / 2 + (i + 0.5) * (totalWidth / count);
        barMesh.position.y = 0;
      }

      barMesh.userData.barIndex = i;
      group.add(barMesh);
    }

    group.userData.isBarsGroup = true;
    group.userData.barsData = barsData;
    return group;
  }

  private createImagePlane(
    imageData: any,
    template: OpenVizTemplate,
    isWallpaper: boolean,
    layerIndex: number
  ): THREE.Mesh {
    const assetUrl = imageData.url || (template.assets && template.assets[imageData.assetId]);
    const width = isWallpaper ? 1920 : 360;
    const height = isWallpaper ? 1080 : 360;
    const geom = new THREE.PlaneGeometry(width, height);

    let mat: THREE.MeshBasicMaterial;
    if (assetUrl) {
      const texture = new THREE.TextureLoader().load(assetUrl, (tex) => {
        tex.needsUpdate = true;
        this.render();
      });
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
    mesh.renderOrder = layerIndex;
    return mesh;
  }

  private createTextSprite(text: string, fontSize = 24, layerIndex: number): THREE.Sprite {
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
    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(400, 100, 1);
    sprite.renderOrder = layerIndex;
    return sprite;
  }

  public updateAudioReactivity(audioData: FrequencyData) {
    if (!this.template) return;

    for (const node of this.template.nodes) {
      const mesh = this.nodeMeshMap.get(node.id);
      if (!mesh) continue;

      if (node.type === 'Bars') {
        const barsGroup = mesh.children[0] as THREE.Group;
        if (barsGroup && barsGroup.children) {
          barsGroup.children.forEach((barObj, idx) => {
            const freqVal = audioData.spectrum[idx % audioData.spectrum.length] || 0;
            const barHeight = Math.max(1.0, freqVal * 250.0);
            barObj.scale.y = barHeight;
          });
        }
      }

      for (const binding of node.bindings) {
        let sourceVal = 0;
        if (binding.source === 'Bass') sourceVal = audioData.bass;
        else if (binding.source === 'Mid') sourceVal = audioData.mid;
        else if (binding.source === 'High') sourceVal = audioData.high;
        else if (binding.source === 'Beat') sourceVal = audioData.beat;
        else if (binding.source === 'Rms') sourceVal = audioData.rms;

        const [minOut, maxOut] = binding.outputRange;
        const mappedVal = minOut + sourceVal * (maxOut - minOut);

        if (binding.target === 'ScaleUniform') {
          const baseScale = node.transform.scale;
          mesh.scale.set(baseScale[0] * mappedVal, baseScale[1] * mappedVal, 1);
        } else if (binding.target === 'Rotation') {
          mesh.rotation.z = node.transform.rotation + mappedVal;
        } else if (binding.target === 'Position') {
          const shakeX = (Math.random() - 0.5) * mappedVal * 2;
          const shakeY = (Math.random() - 0.5) * mappedVal * 2;
          mesh.position.set(node.transform.position[0] + shakeX, node.transform.position[1] + shakeY, 0);
        }
      }
    }

    this.render();
  }

  public resize(width: number, height: number) {
    this.camera.left = -VIEW_WIDTH / 2;
    this.camera.right = VIEW_WIDTH / 2;
    this.camera.top = VIEW_HEIGHT / 2;
    this.camera.bottom = -VIEW_HEIGHT / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.render();
  }

  public render() {
    this.renderer.render(this.scene, this.camera);
  }

  public dispose() {
    this.renderer.dispose();
    this.transformControls?.dispose();
  }
}
