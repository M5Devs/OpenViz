import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { importAveeViz } from '../src/importer/avee';

describe('Phase 5: Image Scale Unit Mismatch', () => {
  it('imports non-wallpaper image with rawScale 1.0 as multiplier scale [1.0, 1.0] rather than pixel scale [350, 350]', async () => {
    const zip = new JSZip();
    const sceneJson = {
      ver: 2,
      root: {
        t: 'root',
        children: {
          logo: {
            tag: 'Image',
            t: 'Image',
            _name: 'Logo Image',
            children: {
              image: { v: 'local:logo.png', t: 's' },
              scale: { v: [1.0, 1.0], t: 'f2' },
            },
          },
        },
      },
    };
    zip.file('scene.json', JSON.stringify(sceneJson));
    zip.file('logo.png', new Uint8Array([1, 2, 3]));

    const buffer = await zip.generateAsync({ type: 'uint8array' });
    const template = await importAveeViz(buffer, { assetMode: 'dataUrl' });

    const logoNode = template.nodes.find((n) => n.name === 'Logo Image');
    expect(logoNode).toBeDefined();
    expect(logoNode?.transform.scale).toEqual([1.0, 1.0]);
  });
});
