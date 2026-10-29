import { FrequencyData } from '../types';
import { SpectrumAnalyzer } from './analysis';
import { AveeClassicAnalyzer } from './avee_classic';

export interface AudioAnalyzer {
  analyze(samples: Float32Array): FrequencyData;
  reset(): void;
}

export function createAnalyzer(
  mode: 'openviz' | 'avee-classic' = 'openviz',
  sampleRate: number,
  frameRate: number = 60
): AudioAnalyzer {
  if (mode === 'avee-classic') {
    return new AveeClassicAnalyzer({
      sampleRate,
      frameRate,
    });
  }
  return new SpectrumAnalyzer({
    sampleRate,
    fftSize: 4096,
    bands: 64,
    frameRate,
  });
}
