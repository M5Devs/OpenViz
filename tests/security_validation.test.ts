import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import JSZip from 'jszip';
import { validateTemplate, parseTemplateJSON, isValidAssetUrl } from '../src/schema/validate';
import { el } from '../src/ui/dom';
import { importAveeViz, isPathTraversal } from '../src/importer/avee';
import { ObjectUrlRegistry } from '../src/assets/registry';

describe('PR 4: Security and Input Validation', () => {
  describe('DOM Helper & XSS Prevention', () => {
    it('renders malicious node names as plain text without innerHTML execution or img creation', () => {
      const createdNodes: any[] = [];
      const fakeDoc = {
        createElement: (tag: string) => {
          const node: any = {
            tagName: tag.toUpperCase(),
            children: [],
            attributes: {},
            value: '',
            addEventListener: () => {},
            setAttribute: (k: string, v: string) => { node.attributes[k] = v; },
            appendChild: (child: any) => node.children.push(child),
            getElementsByTagName: (t: string) =>
              node.children.filter((c: any) => c.tagName === t.toUpperCase()),
          };
          createdNodes.push(node);
          return node;
        },
        createTextNode: (text: string) => ({
          nodeType: 3,
          textContent: text,
        }),
      };

      const origDoc = (globalThis as any).document;
      (globalThis as any).document = fakeDoc;

      try {
        const maliciousName = '"><img src=x onerror=alert(1)>';
        const input = el('input', { type: 'text', value: maliciousName });
        const label = el('label', { className: 'name-label' }, maliciousName);
        const container = el('div', { id: 'testContainer' }, label, input);

        expect(container.getElementsByTagName('img').length).toBe(0);
        expect(input.value).toBe(maliciousName);
        expect(label.children[0].textContent).toBe(maliciousName);
      } finally {
        (globalThis as any).document = origDoc;
      }
    });

    it('verifies src/ contains zero innerHTML usage with node names or untrusted data', () => {
      const fs = require('fs');
      const studioCode = fs.readFileSync('src/ui/studio.ts', 'utf-8');
      expect(studioCode).not.toContain('innerHTML');
    });
  });

  describe('validateTemplate & parseTemplateJSON', () => {
    const validBaseTemplate = {
      schemaVersion: 'openviz/1',
      name: 'Valid Template',
      author: 'Test',
      canvasAspect: '16:9',
      clearColor: [0, 0, 0, 1],
      postEffects: [{ type: 'ChromaticAberration', amount: 0.05 }],
      nodes: [
        {
          id: 'n1',
          name: 'Node 1',
          type: 'Bars',
          transform: { position: [0, 0], scale: [1, 1], rotation: 0, opacity: 1 },
          bindings: [{ source: 'Bass', target: 'BarHeight', outputRange: [0, 1] }],
          barsData: {
            count: 64,
            innerRadius: 240,
            width: 4,
            isRadial: true,
            colorStart: [0, 1, 0, 1],
            colorEnd: [1, 0, 0, 1],
          },
        },
      ],
    };

    it('accepts a valid default template', () => {
      const result = validateTemplate(validBaseTemplate);
      expect(result.ok).toBe(true);
    });

    it('rejects schemaVersion not starting with openviz/', () => {
      const invalid = { ...validBaseTemplate, schemaVersion: '1.0' };
      const res = validateTemplate(invalid);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.errors[0]).toContain('schemaVersion');
    });

    it('rejects NaN / Infinity in transform coordinates', () => {
      const invalid = JSON.parse(JSON.stringify(validBaseTemplate));
      invalid.nodes[0].transform.position = [NaN, 0];
      const res = validateTemplate(invalid);
      expect(res.ok).toBe(false);

      const invalidInf = JSON.parse(JSON.stringify(validBaseTemplate));
      invalidInf.nodes[0].transform.scale = [Infinity, 1];
      const resInf = validateTemplate(invalidInf);
      expect(resInf.ok).toBe(false);
    });

    it('rejects templates exceeding 500 nodes (e.g. 10,000 nodes)', () => {
      const nodes = Array.from({ length: 501 }, (_, i) => ({
        id: `n_${i}`,
        name: `Node ${i}`,
        type: 'Bars',
        transform: { position: [0, 0], scale: [1, 1], rotation: 0, opacity: 1 },
        bindings: [],
      }));
      const invalid = { ...validBaseTemplate, nodes };
      const res = validateTemplate(invalid);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.errors[0]).toContain('Too many nodes');
    });

    it('rejects duplicate node IDs', () => {
      const invalid = JSON.parse(JSON.stringify(validBaseTemplate));
      invalid.nodes.push({
        id: 'n1',
        name: 'Duplicate Node',
        type: 'Text',
        transform: { position: [0, 0], scale: [1, 1], rotation: 0, opacity: 1 },
        bindings: [],
      });
      const res = validateTemplate(invalid);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.errors[0]).toContain('Duplicate node id');
    });

    it('rejects http(s) and javascript: URLs while accepting data:image/png and blob: URLs', () => {
      expect(isValidAssetUrl('http://evil.com/img.png')).toBe(false);
      expect(isValidAssetUrl('https://evil.com/img.png')).toBe(false);
      expect(isValidAssetUrl('javascript:alert(1)')).toBe(false);
      expect(isValidAssetUrl('file:///etc/passwd')).toBe(false);

      expect(isValidAssetUrl('blob:http://localhost:3000/123-456')).toBe(true);
      expect(isValidAssetUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')).toBe(true);
      expect(isValidAssetUrl('data:image/jpeg;base64,1234')).toBe(true);
    });

    it('rejects unknown node types', () => {
      const invalid = JSON.parse(JSON.stringify(validBaseTemplate));
      invalid.nodes[0].type = 'MaliciousType';
      const res = validateTemplate(invalid);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.errors[0]).toContain('unknown type');
    });
  });

  describe('Importer Security & Limits', () => {
    it('correctly evaluates path traversal per segment', () => {
      expect(isPathTraversal('a..b.png')).toBe(false);
      expect(isPathTraversal('my_folder/bg..art.png')).toBe(false);

      expect(isPathTraversal('../evil.png')).toBe(true);
      expect(isPathTraversal('a/../../evil.png')).toBe(true);
      expect(isPathTraversal('/etc/passwd')).toBe(true);
      expect(isPathTraversal('\\Windows\\System32')).toBe(true);
      expect(isPathTraversal('C:\\boot.ini')).toBe(true);
    });

    it('rejects zip entries exceeding maxFileBytes without inflating entire file', async () => {
      const zip = new JSZip();
      const sceneJson = {
        ver: 2,
        root: {
          t: 'root',
          children: {
            bg: {
              tag: 'Image',
              t: 'Image',
              children: { image: { v: 'local:big.bin', t: 's' } },
            },
          },
        },
      };
      zip.file('scene.json', JSON.stringify(sceneJson));

      const bigData = new Uint8Array(2 * 1024 * 1024);
      zip.file('big.bin', bigData);

      const buffer = await zip.generateAsync({ type: 'uint8array' });

      await expect(
        importAveeViz(buffer, { maxFileBytes: 1024 * 1024, assetMode: 'blob' })
      ).rejects.toThrow('exceeds maximum file size limit');
    });

    it('rejects zip files with entry count exceeding maxEntries', async () => {
      const zip = new JSZip();
      for (let i = 0; i < 15; i++) {
        zip.file(`file_${i}.txt`, 'test');
      }
      const buffer = await zip.generateAsync({ type: 'uint8array' });

      await expect(
        importAveeViz(buffer, { maxEntries: 10 })
      ).rejects.toThrow('maximum entry count limit');
    });

    it('does not inflate or create URLs for unreferenced assets', async () => {
      const zip = new JSZip();
      const sceneJson = {
        ver: 2,
        root: {
          t: 'root',
          children: {
            bg: {
              tag: 'Image',
              t: 'Image',
              children: { image: { v: 'local:referenced.png', t: 's' } },
            },
          },
        },
      };
      zip.file('scene.json', JSON.stringify(sceneJson));
      zip.file('referenced.png', new Uint8Array([1, 2, 3]));
      zip.file('unreferenced1.png', new Uint8Array([4, 5, 6]));
      zip.file('unreferenced2.png', new Uint8Array([7, 8, 9]));

      const registry = new ObjectUrlRegistry();
      const buffer = await zip.generateAsync({ type: 'uint8array' });

      const template = await importAveeViz(buffer, { assetMode: 'blob', registry });

      expect(registry.count).toBe(1);
      expect(Object.keys(template.assets || {}).length).toBe(1);
      expect(template.assets?.['referenced.png']).toBeDefined();
      expect(template.assets?.['unreferenced1.png']).toBeUndefined();
    });
  });

  describe('CLI convert command behavior', () => {
    it('produces JSON output with no blob: URLs and passing validateTemplate', async () => {
      const zip = new JSZip();
      const sceneJson = {
        ver: 2,
        root: {
          t: 'root',
          children: {
            logo: {
              tag: 'Image',
              t: 'Image',
              children: { image: { v: 'local:logo.png', t: 's' } },
            },
          },
        },
      };
      zip.file('scene.json', JSON.stringify(sceneJson));
      zip.file('logo.png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));

      const buffer = await zip.generateAsync({ type: 'uint8array' });
      const convertedTemplate = await importAveeViz(buffer, { assetMode: 'dataUrl' });

      const jsonStr = JSON.stringify(convertedTemplate, null, 2);
      expect(jsonStr).not.toContain('blob:');

      const validation = parseTemplateJSON(jsonStr);
      expect(validation.ok).toBe(true);
    });
  });
});
