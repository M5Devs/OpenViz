import { describe, it, expect } from 'vitest';
import { detectTextDirection, FONT_STACK } from '../src/render/text';

describe('Phase 5: Text Rendering & RTL Support', () => {
  it('detects RTL for Hebrew and Arabic text strings', () => {
    expect(detectTextDirection('مرحبا بكم في OpenViz')).toBe('rtl');
    expect(detectTextDirection('שלום עולם')).toBe('rtl');
    expect(detectTextDirection('OpenViz 2.0')).toBe('ltr');
    expect(detectTextDirection('12345 Hello')).toBe('ltr');
  });

  it('provides expected fallback font stack without network dependency', () => {
    expect(FONT_STACK).toContain('Noto Sans Arabic');
    expect(FONT_STACK).toContain('Segoe UI');
    expect(FONT_STACK).toContain('sans-serif');
  });
});
