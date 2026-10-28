import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { importAveeViz, pick } from '../src/importer/avee';

describe('Phase 5: Wallpaper Detection and Falsy-Zero Bugs', () => {
  describe('pick helper', () => {
    it('returns the first non-null and non-undefined candidate including 0, false, and empty string', () => {
      expect(pick(undefined, null, 0, 100)).toBe(0);
      expect(pick(null, false, true)).toBe(false);
      expect(pick(undefined, '', 'fallback')).toBe('');
      expect(pick(null, undefined, undefined)).toBeUndefined();
    });
  });

  describe('Falsy Zero Handling in Avee Importer', () => {
    it('preserves alpha 0 as opacity 0 and rotation 0 as rotation 0', async () => {
      const zip = new JSZip();
      const sceneJson = {
        ver: 2,
        root: {
          t: 'root',
          children: {
            zero_node: {
              tag: 'Image',
              t: 'Image',
              _name: 'Hidden Element',
              children: {
                image: { v: 'local:icon.png', t: 's' },
                alpha: { v: 0.0, t: 'f' },
                rotation: { v: 0.0, t: 'f' },
              },
            },
          },
        },
      };
      zip.file('scene.json', JSON.stringify(sceneJson));
      zip.file('icon.png', new Uint8Array([1, 2, 3]));

      const buffer = await zip.generateAsync({ type: 'uint8array' });
      const template = await importAveeViz(buffer, { assetMode: 'dataUrl' });

      const node = template.nodes.find((n) => n.name === 'Hidden Element');
      expect(node).toBeDefined();
      expect(node?.transform.opacity).toBe(0.0);
      expect(node?.transform.rotation).toBe(0.0);
    });
  });

  describe('Wallpaper Name Detection', () => {
    it('only marks images as wallpaper when name matches wallpaper/background/bg regex', async () => {
      const zip = new JSZip();
      const sceneJson = {
        ver: 2,
        root: {
          t: 'root',
          children: {
            bg1: {
              tag: 'Image',
              t: 'Image',
              _name: 'Main Background',
              children: { image: { v: 'local:a.png', t: 's' } },
            },
            bg2: {
              tag: 'Image',
              t: 'Image',
              _name: 'my_wallpaper',
              children: { image: { v: 'local:b.png', t: 's' } },
            },
            bg3: {
              tag: 'Image',
              t: 'Image',
              _name: 'cool-bg-art',
              children: { image: { v: 'local:c.png', t: 's' } },
            },
            img_normal: {
              tag: 'Image',
              t: 'Image',
              _name: 'Foreground Badge',
              children: { image: { v: 'local:d.png', t: 's' }, scale: { v: [0.9, 0.9], t: 'f2' } },
            },
          },
        },
      };
      zip.file('scene.json', JSON.stringify(sceneJson));
      zip.file('a.png', new Uint8Array([1]));
      zip.file('b.png', new Uint8Array([2]));
      zip.file('c.png', new Uint8Array([3]));
      zip.file('d.png', new Uint8Array([4]));

      const buffer = await zip.generateAsync({ type: 'uint8array' });
      const template = await importAveeViz(buffer, { assetMode: 'dataUrl' });

      const bg1 = template.nodes.find((n) => n.name === 'Main Background');
      const bg2 = template.nodes.find((n) => n.name === 'my_wallpaper');
      const bg3 = template.nodes.find((n) => n.name === 'cool-bg-art');
      const normal = template.nodes.find((n) => n.name === 'Foreground Badge');

      expect(bg1?.imageData?.fit).toBe('cover');
      expect(bg2?.imageData?.fit).toBe('cover');
      expect(bg3?.imageData?.fit).toBe('cover');

      expect(normal?.imageData?.fit).toBe('contain');
      expect(normal?.transform.scale).toEqual([0.9, 0.9]);
    });
  });
});
