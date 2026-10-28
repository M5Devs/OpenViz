/**
 * Camera Shake Math adapted from Seriously.js:
 * MIT License, Copyright (c) Brian Chirls (https://github.com/brianchirls/Seriously.js)
 */

export interface CameraShakeOptions {
  intensity?: number;
  frequency?: number;
}

export class CameraShakeEffect {
  public intensity: number;
  public frequency: number;

  constructor(options: CameraShakeOptions = {}) {
    this.intensity = options.intensity ?? 0.05;
    this.frequency = options.frequency ?? 10.0;
  }

  public getOffset(timeSeconds: number, bassIntensity: number): [number, number] {
    const activeIntensity = this.intensity * bassIntensity;
    const offsetX = Math.sin(timeSeconds * this.frequency * 1.3) * activeIntensity * 20.0;
    const offsetY = Math.cos(timeSeconds * this.frequency * 1.7) * activeIntensity * 20.0;
    return [offsetX, offsetY];
  }
}
