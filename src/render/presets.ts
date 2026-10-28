/**
 * Visualizer Presets adapted from vetted permissive open-source visualizers:
 * - vis.js (Monstercat Equalizer logic): MIT License, Copyright (c) 2015 caseif (https://github.com/caseif/vis.js)
 * - musicvid.org (Circular spectrum & particle effects): MIT License, Copyright (c) Alex Vestin (https://github.com/AlexVestin/musicvid.org)
 */

import { OpenVizTemplate } from '../types';

export function getMonstercatPreset(): OpenVizTemplate {
  return {
    schemaVersion: 'openviz/1',
    name: 'Monstercat Equalizer',
    author: 'OpenViz (vis.js adapted)',
    canvasAspect: '16:9',
    clearColor: [0.03, 0.03, 0.06, 1.0],
    postEffects: [
      { type: 'Bloom', threshold: 0.4, intensity: 1.2 },
      { type: 'ChromaticAberration', amount: 0.015 },
    ],
    nodes: [
      {
        id: 'monstercat_bg',
        name: 'Dark Background',
        type: 'Image',
        transform: { position: [0, 0], scale: [1, 1], rotation: 0, opacity: 1 },
        bindings: [{ source: 'Bass', target: 'ScaleUniform', outputRange: [1.0, 1.03] }],
        imageData: {
          assetId: 'monstercat_bg_art',
          url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          fit: 'cover',
        },
      },
      {
        id: 'monstercat_bars',
        name: 'Monstercat Spectrum Bars',
        type: 'Bars',
        transform: { position: [0, -150], scale: [1.1, 1.0], rotation: 0, opacity: 1 },
        bindings: [{ source: 'Bass', target: 'BarHeight', outputRange: [0.1, 1.2] }],
        barsData: {
          count: 64,
          innerRadius: 0,
          width: 8,
          isRadial: false,
          colorStart: [1.0, 1.0, 1.0, 1.0],
          colorEnd: [0.39, 0.4, 0.95, 1.0],
        },
      },
      {
        id: 'monstercat_title',
        name: 'Track Title',
        type: 'Text',
        transform: { position: [0, 250], scale: [1, 1], rotation: 0, opacity: 1 },
        bindings: [{ source: 'Beat', target: 'ScaleUniform', outputRange: [1.0, 1.06] }],
        textData: {
          text: 'MONSTERCAT EQUALIZER - OPENVIZ',
          size: 32,
          color: '#ffffff',
        },
      },
    ],
  };
}

export function getRadialPulsePreset(): OpenVizTemplate {
  return {
    schemaVersion: 'openviz/1',
    name: 'Radial Pulse Ring',
    author: 'OpenViz (musicvid.org adapted)',
    canvasAspect: '16:9',
    clearColor: [0.05, 0.02, 0.08, 1.0],
    postEffects: [
      { type: 'Bloom', threshold: 0.3, intensity: 1.5 },
      { type: 'ChromaticAberration', amount: 0.025 },
    ],
    nodes: [
      {
        id: 'radial_bg',
        name: 'Background Art',
        type: 'Image',
        transform: { position: [0, 0], scale: [1, 1], rotation: 0, opacity: 1 },
        bindings: [{ source: 'Bass', target: 'ScaleUniform', outputRange: [1.0, 1.05] }],
        imageData: {
          assetId: 'radial_bg_art',
          url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          fit: 'cover',
        },
      },
      {
        id: 'radial_ring',
        name: 'Radial Spectrum Ring',
        type: 'Bars',
        transform: { position: [0, 0], scale: [1, 1], rotation: 0, opacity: 1 },
        bindings: [{ source: 'Bass', target: 'ScaleUniform', outputRange: [1.0, 1.15] }],
        barsData: {
          count: 96,
          innerRadius: 260,
          width: 5,
          isRadial: true,
          colorStart: [0.0, 0.94, 1.0, 1.0],
          colorEnd: [1.0, 0.0, 0.63, 1.0],
        },
      },
      {
        id: 'radial_title',
        name: 'Center Label',
        type: 'Text',
        transform: { position: [0, 0], scale: [1, 1], rotation: 0, opacity: 1 },
        bindings: [{ source: 'Beat', target: 'ScaleUniform', outputRange: [1.0, 1.1] }],
        textData: {
          text: 'RADIAL PULSE',
          size: 36,
          color: '#00f0ff',
        },
      },
    ],
  };
}

export function getLofiChillPreset(): OpenVizTemplate {
  return {
    schemaVersion: 'openviz/1',
    name: 'Lo-Fi Chill Horizontal',
    author: 'OpenViz',
    canvasAspect: '16:9',
    clearColor: [0.08, 0.06, 0.08, 1.0],
    postEffects: [
      { type: 'Bloom', threshold: 0.6, intensity: 0.8 },
      { type: 'ChromaticAberration', amount: 0.01 },
    ],
    nodes: [
      {
        id: 'lofi_bg',
        name: 'Vintage Wallpaper',
        type: 'Image',
        transform: { position: [0, 0], scale: [1, 1], rotation: 0, opacity: 1 },
        bindings: [{ source: 'Bass', target: 'ScaleUniform', outputRange: [1.0, 1.02] }],
        imageData: {
          assetId: 'lofi_bg_art',
          url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          fit: 'cover',
        },
      },
      {
        id: 'lofi_bars',
        name: 'Subtle Horizontal Line',
        type: 'Bars',
        transform: { position: [0, -320], scale: [1, 0.8], rotation: 0, opacity: 0.85 },
        bindings: [{ source: 'Mid', target: 'BarHeight', outputRange: [0.1, 0.8] }],
        barsData: {
          count: 48,
          innerRadius: 0,
          width: 10,
          isRadial: false,
          colorStart: [1.0, 0.8, 0.6, 1.0],
          colorEnd: [0.8, 0.4, 0.7, 1.0],
        },
      },
      {
        id: 'lofi_title',
        name: 'Chill Vibes Text',
        type: 'Text',
        transform: { position: [0, 100], scale: [1, 1], rotation: 0, opacity: 1 },
        bindings: [],
        textData: {
          text: 'LO-FI CHILL - OPENVIZ 2.0',
          size: 26,
          color: '#ffe4e1',
        },
      },
    ],
  };
}
