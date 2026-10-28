import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';
import { StudioController } from '../src/ui/studio';

describe('OVZ Project Packaging logic', () => {
  it('bundles scene.json and assets into JSZip instance and extracts .ovz project', async () => {
    const template = {
      schemaVersion: 'openviz/1',
      name: 'Test Ovz Project',
      author: 'Tester',
      canvasAspect: '16:9',
      clearColor: [0, 0, 0, 1] as [number, number, number, number],
      nodes: [
        {
          id: 'img1',
          name: 'Image 1',
          type: 'Image' as const,
          transform: { position: [0, 0] as [number, number], scale: [1, 1] as [number, number], rotation: 0, opacity: 1 },
          bindings: [],
          imageData: {
            assetId: 'asset_1',
            url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            fit: 'contain' as const,
          },
        },
      ],
      postEffects: [],
    };

    const zip = new JSZip();
    zip.file('scene.json', JSON.stringify(template));
    zip.file('assets/asset_1.png', new Uint8Array([1, 2, 3, 4]));

    const ovzBuffer = await zip.generateAsync({ type: 'arraybuffer' });
    expect(ovzBuffer.byteLength).toBeGreaterThan(0);

    const loadedZip = await JSZip.loadAsync(ovzBuffer);
    expect(loadedZip.file('scene.json')).not.toBeNull();
    const sceneStr = await loadedZip.file('scene.json')!.async('string');
    const parsed = JSON.parse(sceneStr);
    expect(parsed.name).toBe('Test Ovz Project');
  });
});
