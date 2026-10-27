import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { OpenVizTemplate, OpenVizNode, FrequencyData, AudioBinding } from '../types';

export class VisualizerScene {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
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

    const aspect = canvas.clientWidth / canvas.clientHeight || 16 / 9;
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);
    this.camera.position.set(0, 0, 100);

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
      // Ignore if clicking gizmo handle directly
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

      // Deselect if background clicked
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

  public loadTemplate(template: OpenVizTemplate) {
    this.template = template;

    // Clear old meshes
    this.nodeMeshMap.forEach((mesh) => {
      this.scene.remove(mesh);
    });
    this.nodeMeshMap.clear();

    // Set clear color
    const [r, g, b, a] = template.clearColor;
    this.renderer.setClearColor(new THREE.Color(r, g, b), a);

    // Build scene graph nodes
    for (const node of template.nodes) {
      const mesh = this.createNodeMesh(node, template);
      mesh.userData.nodeId = node.id;

      mesh.position.set(node.transform.position[0], node.transform.position[1], 0);
      mesh.scale.set(node.transform.scale[0], node.transform.scale[1], 1);
      mesh.rotation.z = node.transform.rotation;

      this.nodeMeshMap.set(node.id, mesh);
      this.scene.add(mesh);
    }

    this.render();
  }

  private createNodeMesh(node: OpenVizNode, template: OpenVizTemplate): THREE.Object3D {
    const group = new THREE.Group();

    if (node.type === 'Bars' && node.barsData) {
      const barsGroup = this.createSpectrumBarsGroup(node.barsData);
      group.add(barsGroup);
    } else if (node.type === 'Image' && node.imageData) {
      const planeMesh = this.createImagePlane(node.imageData, template);
      group.add(planeMesh);
    } else if (node.type === 'Text' && node.textData) {
      const textSprite = this.createTextSprite(node.textData.text, node.textData.size);
      group.add(textSprite);
    } else {
      // Default fallback geometry plane
      const geom = new THREE.PlaneGeometry(20, 20);
      const mat = new THREE.MeshBasicMaterial({ color: 0x6366f1, wireframe: true });
      group.add(new THREE.Mesh(geom, mat));
    }

    return group;
  }

  private createSpectrumBarsGroup(barsData: any): THREE.Group {
    const group = new THREE.Group();
    const count = barsData.count || 64;
    const isRadial = barsData.isRadial ?? true;
    const innerRadius = barsData.innerRadius ?? 15;
    const barWidth = barsData.width ?? 1.5;

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
      // Translate origin to bottom of bar for easy scaling outward
      geom.translate(0, 0.5, 0);

      const mat = new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
      });

      const barMesh = new THREE.Mesh(geom, mat);

      if (isRadial) {
        const angle = (i / count) * Math.PI * 2;
        barMesh.position.x = Math.cos(angle) * innerRadius;
        barMesh.position.y = Math.sin(angle) * innerRadius;
        barMesh.rotation.z = angle - Math.PI / 2;
      } else {
        const totalWidth = count * (barWidth + 0.5);
        barMesh.position.x = -totalWidth / 2 + i * (barWidth + 0.5);
        barMesh.position.y = 0;
      }

      barMesh.userData.barIndex = i;
      group.add(barMesh);
    }

    group.userData.isBarsGroup = true;
    group.userData.barsData = barsData;
    return group;
  }

  private createImagePlane(imageData: any, template: OpenVizTemplate): THREE.Mesh {
    const assetUrl = imageData.url || (template.assets && template.assets[imageData.assetId]);
    const geom = new THREE.PlaneGeometry(30, 30);

    let mat: THREE.MeshBasicMaterial;
    if (assetUrl) {
      const texture = new THREE.TextureLoader().load(assetUrl, (tex) => {
        tex.needsUpdate = true;
        this.render();
      });
      mat = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        side: THREE.DoubleSide,
      });
    } else {
      mat = new THREE.MeshBasicMaterial({
        color: 0x888888,
        wireframe: true,
        side: THREE.DoubleSide,
      });
    }

    return new THREE.Mesh(geom, mat);
  }

  private createTextSprite(text: string, fontSize = 24): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.font = `Bold ${fontSize * 2}px sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 256, 64);
    }

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(40, 10, 1);
    return sprite;
  }

  public updateAudioReactivity(audioData: FrequencyData) {
    if (!this.template) return;

    for (const node of this.template.nodes) {
      const mesh = this.nodeMeshMap.get(node.id);
      if (!mesh) continue;

      // Update Spectrum Bars heights
      if (node.type === 'Bars') {
        const barsGroup = mesh.children[0] as THREE.Group;
        if (barsGroup && barsGroup.children) {
          barsGroup.children.forEach((barObj, idx) => {
            const freqVal = audioData.spectrum[idx % audioData.spectrum.length] || 0;
            const barHeight = Math.max(1.0, freqVal * 35.0);
            barObj.scale.y = barHeight;
          });
        }
      }

      // Apply audio bindings
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
    this.camera.aspect = width / height || 16 / 9;
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
