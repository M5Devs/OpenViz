import * as Mp4Muxer from 'mp4-muxer';
import { VisualizerScene } from '../render/scene';
import { ExportOptions, ExportProgress, FrequencyData } from '../types';

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

  for (let frame = 0; frame < totalFrames; frame++) {
    if (encoderError) {
      throw encoderError;
    }

    const timeInSeconds = frame / fps;
    const timestampUs = Math.round(timeInSeconds * 1_000_000);

    // Compute audio frequency data at timeInSeconds
    const freqData = calculateFrequencyDataAtTime(audioBuffer, timeInSeconds);

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

function calculateFrequencyDataAtTime(audioBuffer: AudioBuffer | null, timeInSeconds: number): FrequencyData {
  const binCount = 64;
  const spectrum = new Float32Array(binCount);

  if (audioBuffer) {
    const pcmData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const startSample = Math.floor(timeInSeconds * sampleRate);
    const windowSize = 2048;

    let bassSum = 0;
    let midSum = 0;
    let highSum = 0;
    let totalRms = 0;

    for (let i = 0; i < binCount; i++) {
      const idx = startSample + i * Math.floor(windowSize / binCount);
      const sample = idx < pcmData.length ? Math.abs(pcmData[idx]) : 0;
      spectrum[i] = Math.min(1.0, sample * 2.5);

      if (i < 10) bassSum += spectrum[i];
      else if (i < 35) midSum += spectrum[i];
      else highSum += spectrum[i];

      totalRms += sample * sample;
    }

    const bass = Math.min(1.0, (bassSum / 10) * 1.5);
    const mid = Math.min(1.0, midSum / 25);
    const high = Math.min(1.0, highSum / 29);
    const rms = Math.min(1.0, Math.sqrt(totalRms / binCount));
    const beat = bass > 0.6 ? bass * 1.3 : bass * 0.7;

    return { bass, mid, high, beat, rms, spectrum };
  }

  // Fallback synthetic wave if audioBuffer is not provided
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
