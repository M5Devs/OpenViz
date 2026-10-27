import * as Mp4Muxer from 'mp4-muxer';
import { SpectrumAnalyzer } from '../audio/analysis';
import { VisualizerScene } from '../render/scene';
import { ExportOptions, ExportProgress, FrequencyData } from '../types';

/**
 * Downmixes an AudioBuffer to mono Float32Array.
 */
export function downmixAudioBufferToMono(audioBuffer: AudioBuffer): Float32Array {
  const numChannels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const mono = new Float32Array(length);

  if (numChannels === 1) {
    mono.set(audioBuffer.getChannelData(0));
  } else {
    for (let c = 0; c < numChannels; c++) {
      const channelData = audioBuffer.getChannelData(c);
      for (let i = 0; i < length; i++) {
        mono[i] += channelData[i];
      }
    }
    const invChannels = 1 / numChannels;
    for (let i = 0; i < length; i++) {
      mono[i] *= invChannels;
    }
  }

  return mono;
}

export async function exportVideo(
  scene: VisualizerScene,
  audioBuffer: AudioBuffer | null,
  durationInSeconds: number,
  options: ExportOptions = { width: 1920, height: 1080, fps: 60, bitrate: 12_000_000 },
  onProgress?: (progress: ExportProgress) => void
): Promise<Blob> {
  const { width, height, fps, bitrate } = options;
  const totalFrames = Math.max(1, Math.floor(durationInSeconds * fps));

  // Configure MP4 Muxer
  const muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: {
      codec: 'avc',
      width,
      height,
    },
    fastStart: 'in-memory',
  });

  // Configure WebCodecs VideoEncoder
  let encoderError: Error | null = null;

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, meta);
    },
    error: (err) => {
      console.error('VideoEncoder error:', err);
      encoderError = err;
    },
  });

  videoEncoder.configure({
    codec: 'avc1.640028', // H.264 High Profile Level 4.0
    width,
    height,
    bitrate,
    framerate: fps,
    hardwareAcceleration: 'prefer-hardware',
  });

  // Temporarily resize scene renderer for export
  scene.resize(width, height);

  const canvas = scene.renderer.domElement;

  const fftSize = 4096;
  const sampleRate = audioBuffer ? audioBuffer.sampleRate : 44100;

  const monoPcm = audioBuffer ? downmixAudioBufferToMono(audioBuffer) : null;
  const analyzer = new SpectrumAnalyzer({
    sampleRate,
    fftSize,
    bands: 64,
    frameRate: fps,
  });

  const frameSamples = new Float32Array(fftSize);

  for (let frame = 0; frame < totalFrames; frame++) {
    if (encoderError) {
      throw encoderError;
    }

    const timeInSeconds = frame / fps;
    const timestampUs = Math.round(timeInSeconds * 1_000_000);

    let freqData: FrequencyData;

    if (monoPcm) {
      const endSample = Math.floor(timeInSeconds * sampleRate);
      const startSample = endSample - fftSize;

      frameSamples.fill(0);
      for (let s = 0; s < fftSize; s++) {
        const pcmIdx = startSample + s;
        if (pcmIdx >= 0 && pcmIdx < monoPcm.length) {
          frameSamples[s] = monoPcm[pcmIdx];
        }
      }
      freqData = analyzer.analyze(frameSamples);
    } else {
      // Fallback synthetic wave only if audioBuffer is null
      freqData = getSyntheticFrequencyData(timeInSeconds);
    }

    // Update scene reactivity and render
    scene.updateAudioReactivity(freqData);
    scene.render();

    // Create VideoFrame from WebGL canvas
    const videoFrame = new VideoFrame(canvas, {
      timestamp: timestampUs,
      duration: Math.round((1 / fps) * 1_000_000),
    });

    const isKeyframe = frame % (fps * 2) === 0;
    videoEncoder.encode(videoFrame, { keyFrame: isKeyframe });
    videoFrame.close();

    if (onProgress) {
      onProgress({
        frame: frame + 1,
        totalFrames,
        percent: Math.round(((frame + 1) / totalFrames) * 100),
      });
    }

    // Yield macro-task every 10 frames to keep browser responsive
    if (frame % 10 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  await videoEncoder.flush();
  muxer.finalize();

  const buffer = muxer.target.buffer;
  return new Blob([buffer], { type: 'video/mp4' });
}

function getSyntheticFrequencyData(timeInSeconds: number): FrequencyData {
  const binCount = 64;
  const spectrum = new Float32Array(binCount);
  for (let i = 0; i < binCount; i++) {
    spectrum[i] = Math.abs(Math.sin(timeInSeconds * 4 + i * 0.1)) * 0.8;
  }
  const bass = Math.abs(Math.sin(timeInSeconds * 6)) * 0.9;
  return {
    bass,
    mid: bass * 0.7,
    high: bass * 0.5,
    beat: bass * 1.1,
    rms: bass * 0.8,
    spectrum,
  };
}
