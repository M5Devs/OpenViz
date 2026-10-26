pub mod decoder;
pub mod error;

#[cfg(test)]
mod tests;

use crate::audio::{AudioAnalyzer, AudioFeatures};
use crate::player::decoder::{decode_file, decode_media_stream, DecodedTrack};
use crate::player::error::PlayerError;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use ringbuf::traits::{Consumer, Producer, Split};
use ringbuf::{HeapCons, HeapProd, HeapRb};
use std::path::Path;
use std::sync::atomic::{AtomicU32, AtomicU8, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Instant;
use symphonia::core::io::{MediaSourceStream, MediaSourceStreamOptions};
use symphonia::core::probe::Hint;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlaybackState {
    Stopped = 0,
    Playing = 1,
    Paused = 2,
}

impl From<u8> for PlaybackState {
    fn from(val: u8) -> Self {
        match val {
            1 => PlaybackState::Playing,
            2 => PlaybackState::Paused,
            _ => PlaybackState::Stopped,
        }
    }
}

pub struct AudioPlayer {
    state: Arc<AtomicU8>,
    track: Option<DecodedTrack>,
    track_samples: Arc<Vec<f32>>,
    cursor: Arc<AtomicUsize>,
    volume: Arc<AtomicU32>,
    stream: Option<cpal::Stream>,
    analyzer: AudioAnalyzer,
    consumer: HeapCons<f32>,
    last_feature_update: Option<Instant>,
}

impl Default for AudioPlayer {
    fn default() -> Self {
        Self::new()
    }
}

impl AudioPlayer {
    pub fn new() -> Self {
        let rb = HeapRb::<f32>::new(32768);
        let (_prod, cons) = rb.split();

        Self {
            state: Arc::new(AtomicU8::new(PlaybackState::Stopped as u8)),
            track: None,
            track_samples: Arc::new(Vec::new()),
            cursor: Arc::new(AtomicUsize::new(0)),
            volume: Arc::new(AtomicU32::new(1.0f32.to_bits())),
            stream: None,
            analyzer: AudioAnalyzer::new(44100, 2048),
            consumer: cons,
            last_feature_update: None,
        }
    }

    pub fn load_file<P: AsRef<Path>>(&mut self, path: P) -> Result<(), PlayerError> {
        let track = decode_file(path)?;
        self.set_track(track)?;
        Ok(())
    }

    pub fn load_from_bytes(
        &mut self,
        bytes: Vec<u8>,
        hint: Option<&str>,
    ) -> Result<(), PlayerError> {
        let mss = MediaSourceStream::new(
            Box::new(std::io::Cursor::new(bytes)),
            MediaSourceStreamOptions::default(),
        );
        let mut sym_hint = Hint::new();
        if let Some(h) = hint {
            sym_hint.with_extension(h);
        }
        let track = decode_media_stream(mss, sym_hint)?;
        self.set_track(track)?;
        Ok(())
    }

    fn set_track(&mut self, track: DecodedTrack) -> Result<(), PlayerError> {
        self.stop();

        let sample_rate = track.sample_rate;
        let samples = Arc::new(track.samples.clone());

        self.track = Some(track);
        self.track_samples = samples;
        self.cursor.store(0, Ordering::Relaxed);
        self.analyzer = AudioAnalyzer::new(sample_rate, 2048);

        // Reset ring buffer
        let rb = HeapRb::<f32>::new(32768);
        let (prod, cons) = rb.split();
        self.consumer = cons;

        // Try building output stream
        self.stream = self.build_stream(prod).ok();

        Ok(())
    }

    fn build_stream(&self, mut producer: HeapProd<f32>) -> Result<cpal::Stream, PlayerError> {
        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or(PlayerError::DeviceNotFound)?;
        let config = device.default_output_config()?;

        let state = Arc::clone(&self.state);
        let cursor = Arc::clone(&self.cursor);
        let volume = Arc::clone(&self.volume);
        let samples = Arc::clone(&self.track_samples);

        let err_fn = |err| eprintln!("Audio output stream error: {}", err);

        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => device.build_output_stream(
                &config.into(),
                move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                    let cur_state = state.load(Ordering::Relaxed);
                    let mut cur_cursor = cursor.load(Ordering::Relaxed);
                    let vol = f32::from_bits(volume.load(Ordering::Relaxed));

                    if cur_state == PlaybackState::Playing as u8 {
                        for sample in data.iter_mut() {
                            if cur_cursor < samples.len() {
                                let s = samples[cur_cursor];
                                cur_cursor += 1;
                                *sample = s * vol;
                                let _ = producer.try_push(s);
                            } else {
                                *sample = 0.0;
                            }
                        }
                        cursor.store(cur_cursor, Ordering::Relaxed);
                    } else {
                        for sample in data.iter_mut() {
                            *sample = 0.0;
                        }
                    }
                },
                err_fn,
                None,
            )?,
            cpal::SampleFormat::I16 => device.build_output_stream(
                &config.into(),
                move |data: &mut [i16], _: &cpal::OutputCallbackInfo| {
                    let cur_state = state.load(Ordering::Relaxed);
                    let mut cur_cursor = cursor.load(Ordering::Relaxed);
                    let vol = f32::from_bits(volume.load(Ordering::Relaxed));

                    if cur_state == PlaybackState::Playing as u8 {
                        for sample in data.iter_mut() {
                            if cur_cursor < samples.len() {
                                let s = samples[cur_cursor];
                                cur_cursor += 1;
                                *sample = (s * vol * i16::MAX as f32) as i16;
                                let _ = producer.try_push(s);
                            } else {
                                *sample = 0;
                            }
                        }
                        cursor.store(cur_cursor, Ordering::Relaxed);
                    } else {
                        for sample in data.iter_mut() {
                            *sample = 0;
                        }
                    }
                },
                err_fn,
                None,
            )?,
            cpal::SampleFormat::U16 => device.build_output_stream(
                &config.into(),
                move |data: &mut [u16], _: &cpal::OutputCallbackInfo| {
                    let cur_state = state.load(Ordering::Relaxed);
                    let mut cur_cursor = cursor.load(Ordering::Relaxed);
                    let vol = f32::from_bits(volume.load(Ordering::Relaxed));

                    if cur_state == PlaybackState::Playing as u8 {
                        for sample in data.iter_mut() {
                            if cur_cursor < samples.len() {
                                let s = samples[cur_cursor];
                                cur_cursor += 1;
                                *sample = ((s * vol * 0.5 + 0.5) * u16::MAX as f32) as u16;
                                let _ = producer.try_push(s);
                            } else {
                                *sample = u16::MAX / 2;
                            }
                        }
                        cursor.store(cur_cursor, Ordering::Relaxed);
                    } else {
                        for sample in data.iter_mut() {
                            *sample = u16::MAX / 2;
                        }
                    }
                },
                err_fn,
                None,
            )?,
            fmt => return Err(PlayerError::UnsupportedFormat(format!("{:?}", fmt))),
        };

        Ok(stream)
    }

    pub fn play(&mut self) -> Result<(), PlayerError> {
        if self.track.is_none() {
            return Err(PlayerError::TrackNotLoaded);
        }

        self.state
            .store(PlaybackState::Playing as u8, Ordering::Relaxed);

        if let Some(ref stream) = self.stream {
            stream.play()?;
        }

        Ok(())
    }

    pub fn pause(&mut self) {
        self.state
            .store(PlaybackState::Paused as u8, Ordering::Relaxed);
        if let Some(ref stream) = self.stream {
            let _ = stream.pause();
        }
    }

    pub fn stop(&mut self) {
        self.state
            .store(PlaybackState::Stopped as u8, Ordering::Relaxed);
        self.cursor.store(0, Ordering::Relaxed);
        if let Some(ref stream) = self.stream {
            let _ = stream.pause();
        }
    }

    pub fn seek(&mut self, seconds: f64) -> Result<(), PlayerError> {
        let track = self.track.as_ref().ok_or(PlayerError::TrackNotLoaded)?;

        if seconds < 0.0 || seconds > track.duration_seconds {
            return Err(PlayerError::InvalidSeekPosition(seconds));
        }

        let target_sample = (seconds * track.sample_rate as f64 * track.channels as f64) as usize;
        let aligned_sample = (target_sample / track.channels) * track.channels;
        let clamped_sample = aligned_sample.min(track.samples.len());

        self.cursor.store(clamped_sample, Ordering::Relaxed);

        Ok(())
    }

    pub fn get_position(&self) -> f64 {
        let track = match self.track.as_ref() {
            Some(t) => t,
            None => return 0.0,
        };

        let pos_samples = self.cursor.load(Ordering::Relaxed);
        if track.sample_rate == 0 || track.channels == 0 {
            return 0.0;
        }

        (pos_samples / track.channels) as f64 / track.sample_rate as f64
    }

    pub fn get_duration(&self) -> f64 {
        self.track.as_ref().map_or(0.0, |t| t.duration_seconds)
    }

    pub fn is_playing(&self) -> bool {
        self.state.load(Ordering::Relaxed) == PlaybackState::Playing as u8
    }

    pub fn get_state(&self) -> PlaybackState {
        PlaybackState::from(self.state.load(Ordering::Relaxed))
    }

    pub fn set_volume(&mut self, volume: f32) {
        let clamped = volume.clamp(0.0, 1.0);
        self.volume.store(clamped.to_bits(), Ordering::Relaxed);
    }

    pub fn get_live_features(&mut self) -> AudioFeatures {
        let now = Instant::now();
        let dt = match self.last_feature_update {
            Some(prev) => (now - prev).as_secs_f32(),
            None => 0.016,
        };
        self.last_feature_update = Some(now);

        let mut pcm_chunk = Vec::new();
        while let Some(sample) = self.consumer.try_pop() {
            pcm_chunk.push(sample);
        }

        // Fallback / simulation when stream callback has not fed ring buffer
        if pcm_chunk.is_empty() && self.is_playing() {
            if let Some(ref track) = self.track {
                let advance_samples =
                    (dt * track.sample_rate as f32 * track.channels as f32) as usize;
                let cur_cursor = self.cursor.load(Ordering::Relaxed);
                let end_cursor = (cur_cursor + advance_samples).min(track.samples.len());

                if cur_cursor < end_cursor {
                    pcm_chunk.extend_from_slice(&track.samples[cur_cursor..end_cursor]);
                    self.cursor.store(end_cursor, Ordering::Relaxed);
                }

                if end_cursor >= track.samples.len() {
                    self.stop();
                }
            }
        }

        self.analyzer.process_chunk(&pcm_chunk, dt)
    }
}
