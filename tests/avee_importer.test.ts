import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
  parseRawProp,
  getF32,
  getF32Tuple2,
  getI32,
  getBool,
  getString,
  getColorRGBA,
  extractAudioBinding,
  importAveeViz,
} from '../src/importer/avee';

describe('Avee Importer RawProp Helpers', () => {
  it('parses raw prop primitives and tuples correctly', () => {
    const prop = parseRawProp({ v: [10.5, 20.5], t: 'f2' });
    expect(getF32Tuple2(prop)).toEqual([10.5, 20.5]);
    expect(getF32(prop)).toBe(10.5);

    const intProp = parseRawProp({ v: 42, t: 'i' });
    expect(getI32(intProp)).toBe(42);

    const boolProp = parseRawProp({ v: true, t: 'b' });
    expect(getBool(boolProp)).toBe(true);

    const strProp = parseRawProp({ v: 'hello', t: 's' });
    expect(getString(strProp)).toBe('hello');
  });

  it('extracts colors accurately from ARGB uint32, hex string, and arrays', () => {
    // ARGB uint32 0xFFFF0000 -> Red=1, Green=0, Blue=0, Alpha=1
    const argbProp = parseRawProp({ v: 4294901760, t: 'crgba' });
    const c1 = getColorRGBA(argbProp);
    expect(c1[0]).toBeCloseTo(1.0);
    expect(c1[1]).toBeCloseTo(0.0);
    expect(c1[2]).toBeCloseTo(0.0);
    expect(c1[3]).toBeCloseTo(1.0);

    // Hex string #FF00FF00
    const hexProp = parseRawProp({ v: '#FF00FF00', t: 'crgba' });
    const c2 = getColorRGBA(hexProp);
    expect(c2[1]).toBeCloseTo(1.0);

    // Float array
    const arrProp = parseRawProp({ v: [0.0, 0.5, 1.0, 0.8], t: 'crgba' });
    expect(getColorRGBA(arrProp)).toEqual([0.0, 0.5, 1.0, 0.8]);
  });

  it('extracts audio reactivity bindings from measure child node', () => {
    const prop = parseRawProp({
      v: 1.0,
      t: 'mvarf',
      children: {
        _child: {
          t: '_child',
          v: 'Beat',
          children: {
            measureWhat: { v: 'Beat', t: 's' },
            A: { v: 1.0, t: 'f' },
            B: { v: 1.5, t: 'f' },
          },
        },
      },
    });

    const binding = extractAudioBinding(prop, 'ScaleUniform');
    expect(binding).not.toBeNull();
    expect(binding?.source).toBe('Beat');
    expect(binding?.target).toBe('ScaleUniform');
    expect(binding?.outputRange).toEqual([1.0, 1.5]);
  });

  it('detects and rejects path traversal attempts in zip archives', async () => {
    const zip = new JSZip();
    zip.file('../evil.txt', 'malicious content');
    const zipBuffer = await zip.generateAsync({ type: 'uint8array' });

    await expect(importAveeViz(zipBuffer)).rejects.toThrow('path traversal detected');
  });

  it('imports a complete synthetic Avee .viz template archive', async () => {
    const sceneJson = {
      ver: 2,
      root: {
        t: 'root',
        children: {
          radial_spectrum: {
            tag: 'Bars',
            t: 'Bars',
            children: {
              barCount: { v: 32, t: 'i' },
              barWidth: { v: 4.0, t: 'f' },
              shapePath: { v: 'Circle', t: 's' },
              radius: { v: 15.0, t: 'f' },
              colorStart: { v: 4294901760, t: 'crgba' },
              scale: {
                v: [1.0, 1.0],
                t: 'f2',
                children: {
                  _child: {
                    children: {
                      measureWhat: { v: 'Bass', t: 's' },
                      A: { v: 1.0, t: 'f' },
                      B: { v: 2.0, t: 'f' },
                    },
                  },
                },
              },
            },
          },
          logo: {
            tag: 'Image',
            t: 'Image',
            children: {
              image: { v: 'local:logo_art.png', t: 's' },
            },
          },
          rgb_effect: {
            tag: 'RgbSplitEffect',
            t: 'RgbSplitEffect',
            children: {
              splitAmount: { v: 0.05, t: 'f' },
            },
          },
        },
      },
    };

    const zip = new JSZip();
    zip.file('scene.json', JSON.stringify(sceneJson));
    zip.file('logo_art.png', new Uint8Array([1, 2, 3, 4]));

    const zipBuffer = await zip.generateAsync({ type: 'uint8array' });
    const template = await importAveeViz(zipBuffer);

    expect(template.schemaVersion).toBe('openviz/1');
    expect(template.nodes.length).toBe(2);

    const barsNode = template.nodes.find((n) => n.id === 'radial_spectrum');
    expect(barsNode).toBeDefined();
    expect(barsNode?.type).toBe('Bars');
    expect(barsNode?.barsData?.count).toBe(32);
    expect(barsNode?.barsData?.isRadial).toBe(true);
    expect(barsNode?.barsData?.innerRadius).toBe(15.0);
    expect(barsNode?.bindings.length).toBe(1);
    expect(barsNode?.bindings[0].source).toBe('Bass');

    const imageNode = template.nodes.find((n) => n.id === 'logo');
    expect(imageNode).toBeDefined();
    expect(imageNode?.type).toBe('Image');
    expect(imageNode?.imageData?.assetId).toBe('logo_art.png');

    expect(template.postEffects.length).toBe(1);
    expect(template.postEffects[0].type).toBe('ChromaticAberration');
    expect(template.postEffects[0].amount).toBe(0.05);
  });
});
