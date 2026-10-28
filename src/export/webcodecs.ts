import * as Mp4Muxer from 'mp4-muxer';
import { SpectrumAnalyzer } from '../audio/analysis';
import { parseAspect, VisualizerScene } from '../render/scene';
import { FrequencyData } from '../types';
import { computeExportSize, pickAvcLevel } from './avc';

export interface WebCodecsExportOptions {
  width?: number;
  height?: number;
  fps?: number;
  bitrate?: number;
  videoBitrate?: number;
  audioBitrate?: number;
}

export interface WebCodecsExportProgress {
  phase: 'rendering' | 'finalizing';
  frame: number;
  totalFrames: number;
  percent: number;
}

export interface ExportResultInfo {
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioCodec: 'aac' | 'opus' | null;
  hardwareAccelerated: boolean | null;
  estimatedBytes: number;
}

export interface ExportResult {
  blob: Blob;
  info: ExportResultInfo;
}

/**
 * Downmixes an AudioBuffer to a mono Float32Array.
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
  options?: WebCodecsExportOptions,
  onProgress?: (progress: WebCodecsExportProgress) => void,
  signal?: AbortSignal
): Promise<ExportResult> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    throw new Error('Video export needs a Chromium-based browser with WebCodecs support.');
  }

  const reqHeight = options?.height ?? 1080;
  const fps = options?.fps ?? 60;

  const defaultVideoBitrate =
    reqHeight <= 720
      ? 6_000_000
      : reqHeight <= 1080
      ? 12_000_000
      : reqHeight <= 1440
      ? 24_000_000
      : 60_000_000;

  const videoBitrate = options?.videoBitrate ?? options?.bitrate ?? defaultVideoBitrate;
  const audioBitrate = options?.audioBitrate ?? 192_000;

  const templateAspect = parseAspect((scene as any)['template']?.canvasAspect);
  const { width, height } = computeExportSize(reqHeight, templateAspect);

  const duration = audioBuffer ? audioBuffer.duration : durationInSeconds;
  const totalFrames = Math.max(1, Math.floor(duration * fps));

  const estimatedBytes = ((videoBitrate + audioBitrate) * duration) / 8;
  if (estimatedBytes > 1.5 * 1024 * 1024 * 1024) {
    throw new Error(
      `Estimated export size (${(estimatedBytes / (1024 * 1024 * 1024)).toFixed(
        2
      )} GB) exceeds the 1.5 GB in-memory limit. Please select a lower resolution, frame rate, or bitrate.`
    );
  }

  const levelNum = pickAvcLevel(width, height, fps);
  const levelHex = levelNum.toString(16).padStart(2, '0').toUpperCase();

  const candidateConfigs: VideoEncoderConfig[] = [
    {
      codec: `avc1.6400${levelHex}`,
      width,
      height,
      bitrate: videoBitrate,
      framerate: fps,
      hardwareAcceleration: 'prefer-hardware',
    },
    {
      codec: `avc1.6400${levelHex}`,
      width,
      height,
      bitrate: videoBitrate,
      framerate: fps,
      hardwareAcceleration: 'prefer-software',
    },
    {
      codec: `avc1.4d00${levelHex}`,
      width,
      height,
      bitrate: videoBitrate,
      framerate: fps,
      hardwareAcceleration: 'prefer-software',
    },
  ];

  let selectedVideoConfig: VideoEncoderConfig | null = null;
  let hardwareAccelerated: boolean | null = null;

  for (const config of candidateConfigs) {
    try {
      const res = await VideoEncoder.isConfigSupported(config);
      if (res.supported) {
        selectedVideoConfig = config;
        const resHw = (res as any).hardwareAcceleration;
        if (resHw === 'prefer-hardware') {
          hardwareAccelerated = true;
        } else if (resHw === 'prefer-software') {
          hardwareAccelerated = false;
        } else {
          hardwareAccelerated = config.hardwareAcceleration === 'prefer-hardware';
        }
        break;
      }
    } catch (e) {
      // Continue to next candidate
    }
  }

  if (!selectedVideoConfig) {
    throw new Error(
      `No supported VideoEncoder configuration found for ${width}x${height}@${fps}fps. Please select a lower resolution or frame rate.`
    );
  }

  let audioCodec: 'aac' | 'opus' | null = null;
  let audioCodecString = '';
  let channels = 0;
  let sampleRate = 0;

  if (audioBuffer && typeof AudioEncoder !== 'undefined') {
    channels = Math.min(audioBuffer.numberOfChannels, 2);
    sampleRate = audioBuffer.sampleRate;

    const aacConfig: AudioEncoderConfig = {
      codec: 'mp4a.40.2',
      sampleRate,
      numberOfChannels: channels,
      bitrate: audioBitrate,
    };

    let aacOk = false;
    try {
      const res = await AudioEncoder.isConfigSupported(aacConfig);
      aacOk = !!res.supported;
    } catch (e) {
      aacOk = false;
    }

    if (aacOk) {
      audioCodec = 'aac';
      audioCodecString = 'mp4a.40.2';
    } else {
      const opusConfig: AudioEncoderConfig = {
        codec: 'opus',
        sampleRate,
        numberOfChannels: channels,
        bitrate: audioBitrate,
      };
      let opusOk = false;
      try {
        const res = await AudioEncoder.isConfigSupported(opusConfig);
        opusOk = !!res.supported;
      } catch (e) {
        opusOk = false;
      }
      if (opusOk) {
        audioCodec = 'opus';
        audioCodecString = 'opus';
      }
    }
  }

  const muxerOptions: Mp4Muxer.MuxerOptions<Mp4Muxer.ArrayBufferTarget> = {
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: {
      codec: 'avc',
      width,
      height,
    },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'strict',
  };

  if (audioCodec) {
    muxerOptions.audio = {
      codec: audioCodec,
      numberOfChannels: channels,
      sampleRate,
    };
  }

  const muxer = new Mp4Muxer.Muxer(muxerOptions);

  let encoderError: Error | null = null;

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, meta);
    },
    error: (err) => {
      encoderError = err instanceof Error ? err : new Error(String(err));
    },
  });
  videoEncoder.configure(selectedVideoConfig);

  let audioEncoder: AudioEncoder | null = null;
  if (audioCodec) {
    audioEncoder = new AudioEncoder({
      output: (chunk, meta) => {
        muxer.addAudioChunk(chunk, meta);
      },
      error: (err) => {
        encoderError = err instanceof Error ? err : new Error(String(err));
      },
    });
    audioEncoder.configure({
      codec: audioCodecString,
      sampleRate,
      numberOfChannels: channels,
      bitrate: audioBitrate,
    });
  }

  const waitForBackpressure = async (encoder: VideoEncoder | AudioEncoder) => {
    while (encoder.encodeQueueSize > 8) {
      if (signal?.aborted) {
        throw new DOMException('Export cancelled', 'AbortError');
      }
      if (encoderError) {
        throw encoderError;
      }
      await new Promise<void>((resolve) => {
        let tid: any;
        const onDequeue = () => {
          clearTimeout(tid);
          resolve();
        };
        tid = setTimeout(onDequeue, 4);
        encoder.addEventListener('dequeue', onDequeue, { once: true });
      });
    }
  };

  const AUDIO_CHUNK_SIZE = 4096;
  let audioSampleOffset = 0;
  const totalAudioSamples = audioBuffer ? audioBuffer.length : 0;

  const feedAudioUpTo = (targetTimeSeconds: number) => {
    if (!audioEncoder || !audioBuffer || typeof AudioData === 'undefined') return;

    const targetSample = Math.min(totalAudioSamples, Math.floor(targetTimeSeconds * sampleRate));

    while (audioSampleOffset < targetSample && audioSampleOffset < totalAudioSamples) {
      if (encoderError) throw encoderError;

      const chunkSize = Math.min(AUDIO_CHUNK_SIZE, totalAudioSamples - audioSampleOffset);
      const pcmData = new Float32Array(channels * chunkSize);

      for (let c = 0; c < channels; c++) {
        const chData = audioBuffer.getChannelData(c);
        pcmData.set(chData.subarray(audioSampleOffset, audioSampleOffset + chunkSize), c * chunkSize);
      }

      const timestampUs = Math.round((audioSampleOffset * 1_000_000) / sampleRate);

      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate,
        numberOfFrames: chunkSize,
        numberOfChannels: channels,
        timestamp: timestampUs,
        data: pcmData,
      });

      audioEncoder.encode(audioData);
      audioData.close();

      audioSampleOffset += chunkSize;
    }
  };

  scene.beginExport(width, height);

  try {
    const fftSize = 4096;
    const analyzerSampleRate = audioBuffer ? audioBuffer.sampleRate : 44100;
    const monoPcm = audioBuffer ? downmixAudioBufferToMono(audioBuffer) : null;
    const analyzer = new SpectrumAnalyzer({
      sampleRate: analyzerSampleRate,
      fftSize,
      bands: 64,
      frameRate: fps,
    });

    const frameSamples = new Float32Array(fftSize);

    for (let frame = 0; frame < totalFrames; frame++) {
      if (signal?.aborted) {
        throw new DOMException('Export cancelled', 'AbortError');
      }
      if (encoderError) {
        throw encoderError;
      }

      const timeInSeconds = frame / fps;

      if (audioEncoder) {
        feedAudioUpTo(timeInSeconds + 0.5);
        await waitForBackpressure(audioEncoder);
      }

      let freqData: FrequencyData;
      if (monoPcm) {
        const endSample = Math.floor(timeInSeconds * analyzerSampleRate);
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
        freqData = getSyntheticFrequencyData(timeInSeconds);
      }

      scene.updateAudioReactivity(freqData, timeInSeconds);
      scene.render();

      const canvas = scene.renderer.domElement;
      const timestampUs = Math.round((frame * 1_000_000) / fps);
      const durationUs = Math.round(1_000_000 / fps);

      const videoFrame = new VideoFrame(canvas, {
        timestamp: timestampUs,
        duration: durationUs,
      });

      const isKeyframe = frame % (fps * 2) === 0;

      await waitForBackpressure(videoEncoder);
      videoEncoder.encode(videoFrame, { keyFrame: isKeyframe });
      videoFrame.close();

      if (onProgress) {
        onProgress({
          phase: 'rendering',
          frame: frame + 1,
          totalFrames,
          percent: Math.round(((frame + 1) / totalFrames) * 100),
        });
      }

      if (frame % 10 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    if (audioEncoder) {
      feedAudioUpTo(duration + 1.0);
      await waitForBackpressure(audioEncoder);
    }

    if (signal?.aborted) {
      throw new DOMException('Export cancelled', 'AbortError');
    }
    if (encoderError) {
      throw encoderError;
    }

    if (onProgress) {
      onProgress({
        phase: 'finalizing',
        frame: totalFrames,
        totalFrames,
        percent: 100,
      });
    }

    await videoEncoder.flush();
    if (audioEncoder) {
      await audioEncoder.flush();
    }

    muxer.finalize();

    const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
    return {
      blob,
      info: {
        width,
        height,
        fps,
        videoCodec: selectedVideoConfig.codec,
        audioCodec,
        hardwareAccelerated,
        estimatedBytes,
      },
    };
  } finally {
    if (videoEncoder && videoEncoder.state !== 'closed') {
      videoEncoder.close();
    }
    if (audioEncoder && audioEncoder.state !== 'closed') {
      audioEncoder.close();
    }
    scene.endExport();
  }
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
