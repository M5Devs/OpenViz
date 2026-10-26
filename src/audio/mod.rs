pub mod effects;
#[cfg(test)]
mod effects_tests;

use rustfft::{num_complex::Complex, Fft, FftPlanner};
use serde::Serialize;
use std::sync::Arc;

#[derive(Clone, Debug, Serialize)]
pub struct AudioFeatures {
    pub bass: f32,              // Normalized [0.0, 1.0]
    pub mid: f32,               // Normalized [0.0, 1.0]
    pub high: f32,              // Normalized [0.0, 1.0]
    pub raw_spectrum: Vec<f32>, // Magnitude spectrum for visualizer bars
    pub beat: bool,             // Onset / beat trigger
}

pub struct AudioAnalyzer {
    sample_rate: u32,
    fft_size: usize,
    fft: Arc<dyn Fft<f32>>,
    hann_window: Vec<f32>,
    pcm_buffer: Vec<f32>,
    fft_complex_buf: Vec<Complex<f32>>,
    fft_scratch_buf: Vec<Complex<f32>>,
    prev_spectrum: Vec<f32>,
    attack_ms: f32,
    release_ms: f32,
    smoothed_bass: f32,
    smoothed_mid: f32,
    smoothed_high: f32,
    peak_bass: f32,
    peak_mid: f32,
    peak_high: f32,
    flux_avg: f32,
    flux_dev: f32,
}

impl AudioAnalyzer {
    pub fn new(sample_rate: u32, fft_size: usize) -> Self {
        let sample_rate = if sample_rate == 0 { 44100 } else { sample_rate };
        let fft_size = if fft_size == 0 { 2048 } else { fft_size };

        let mut planner = FftPlanner::<f32>::new();
        let fft = planner.plan_fft_forward(fft_size);
        let scratch_len = fft.get_inplace_scratch_len();

        let hann_window: Vec<f32> = (0..fft_size)
            .map(|i| 0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / fft_size as f32).cos()))
            .collect();

        let half_size = fft_size / 2;

        Self {
            sample_rate,
            fft_size,
            fft,
            hann_window,
            pcm_buffer: vec![0.0; fft_size],
            fft_complex_buf: vec![Complex::new(0.0, 0.0); fft_size],
            fft_scratch_buf: vec![Complex::new(0.0, 0.0); scratch_len],
            prev_spectrum: vec![0.0; half_size],
            attack_ms: 40.0,
            release_ms: 250.0,
            smoothed_bass: 0.0,
            smoothed_mid: 0.0,
            smoothed_high: 0.0,
            peak_bass: 0.01,
            peak_mid: 0.01,
            peak_high: 0.01,
            flux_avg: 0.0,
            flux_dev: 0.0,
        }
    }

    pub fn set_smoothing(&mut self, attack_ms: f32, release_ms: f32) {
        self.attack_ms = attack_ms;
        self.release_ms = release_ms;
    }

    pub fn process_chunk(&mut self, pcm_samples: &[f32], dt: f32) -> AudioFeatures {
        let dt = dt.max(0.0001);

        // Update sliding PCM buffer
        if pcm_samples.len() >= self.fft_size {
            let start = pcm_samples.len() - self.fft_size;
            self.pcm_buffer.copy_from_slice(&pcm_samples[start..]);
        } else if !pcm_samples.is_empty() {
            let shift = pcm_samples.len();
            self.pcm_buffer.drain(0..shift);
            self.pcm_buffer.extend_from_slice(pcm_samples);
        }

        // Apply Hann Window
        for i in 0..self.fft_size {
            let sample = self.pcm_buffer[i] * self.hann_window[i];
            self.fft_complex_buf[i] = Complex::new(sample, 0.0);
        }

        // Execute FFT
        self.fft
            .process_with_scratch(&mut self.fft_complex_buf, &mut self.fft_scratch_buf);

        // Normalized magnitude spectrum |X_k| / N for positive frequencies
        let half_size = self.fft_size / 2;
        let norm_factor = 1.0 / self.fft_size as f32;
        let raw_spectrum: Vec<f32> = self
            .fft_complex_buf
            .iter()
            .take(half_size)
            .map(|c| c.norm() * norm_factor)
            .collect();

        // Partition frequency bands RMS
        let bass_rms = self.compute_band_rms(&raw_spectrum, 20.0, 250.0);
        let mid_rms = self.compute_band_rms(&raw_spectrum, 250.0, 4000.0);
        let high_rms = self.compute_band_rms(&raw_spectrum, 4000.0, 16000.0);

        // Automatic Gain Control (AGC) & Logarithmic scaling
        let bass_norm = Self::apply_agc_log(bass_rms, &mut self.peak_bass, dt);
        let mid_norm = Self::apply_agc_log(mid_rms, &mut self.peak_mid, dt);
        let high_norm = Self::apply_agc_log(high_rms, &mut self.peak_high, dt);

        // Exponential smoothing
        self.smoothed_bass = self.smooth_value(bass_norm, self.smoothed_bass, dt);
        self.smoothed_mid = self.smooth_value(mid_norm, self.smoothed_mid, dt);
        self.smoothed_high = self.smooth_value(high_norm, self.smoothed_high, dt);

        // Onset / Beat Detection via Spectral Flux
        let mut flux = 0.0f32;
        for (curr, prev) in raw_spectrum.iter().zip(self.prev_spectrum.iter()) {
            let diff = curr - prev;
            if diff > 0.0 {
                flux += diff;
            }
        }
        self.prev_spectrum.copy_from_slice(&raw_spectrum);

        // Update flux statistics
        let alpha_flux = 0.1f32;
        self.flux_avg += alpha_flux * (flux - self.flux_avg);
        let flux_diff = (flux - self.flux_avg).abs();
        self.flux_dev += alpha_flux * (flux_diff - self.flux_dev);

        let threshold = self.flux_avg + 1.5 * self.flux_dev + 0.005;
        let beat = flux > threshold && flux > 0.002;

        AudioFeatures {
            bass: self.smoothed_bass,
            mid: self.smoothed_mid,
            high: self.smoothed_high,
            raw_spectrum,
            beat,
        }
    }

    fn compute_band_rms(&self, mag: &[f32], min_freq: f32, max_freq: f32) -> f32 {
        let bin_freq = self.sample_rate as f32 / self.fft_size as f32;
        let start_bin = ((min_freq / bin_freq).floor() as usize).min(mag.len().saturating_sub(1));
        let end_bin = ((max_freq / bin_freq).ceil() as usize).clamp(start_bin + 1, mag.len());

        let count = end_bin - start_bin;
        if count == 0 {
            return 0.0;
        }

        let sum_sq: f32 = mag[start_bin..end_bin].iter().map(|&m| m * m).sum();
        (sum_sq / count as f32).sqrt()
    }

    fn apply_agc_log(rms: f32, peak: &mut f32, dt: f32) -> f32 {
        let min_peak = 0.001f32;
        let tau_agc = 3.0f32; // Decay rate for peak tracker in seconds

        if rms > *peak {
            *peak = rms;
        } else {
            let decay = (-dt / tau_agc).exp();
            *peak = (*peak * decay).max(min_peak);
        }

        let current_peak = (*peak).max(min_peak);
        let norm_rms = (rms / current_peak).clamp(0.0, 1.0);

        // Logarithmic scaling: map [0, 1] -> [0, 1]
        let gamma = 9.0f32;
        ((1.0 + gamma * norm_rms).ln() / (1.0 + gamma).ln()).clamp(0.0, 1.0)
    }

    fn smooth_value(&self, current: f32, previous: f32, dt: f32) -> f32 {
        let tau = if current > previous {
            self.attack_ms / 1000.0
        } else {
            self.release_ms / 1000.0
        };

        if tau <= 0.0 {
            return current;
        }

        let alpha = 1.0 - (-dt / tau).exp();
        let alpha = alpha.clamp(0.0, 1.0);
        (previous + alpha * (current - previous)).clamp(0.0, 1.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sine_100hz_bass_dominant() {
        let sample_rate = 44100;
        let fft_size = 2048;
        let mut analyzer = AudioAnalyzer::new(sample_rate, fft_size);

        // Generate synthetic 100 Hz sine wave (Bass range 20-250 Hz)
        let freq = 100.0f32;
        let num_samples = fft_size * 2;
        let pcm: Vec<f32> = (0..num_samples)
            .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / sample_rate as f32).sin())
            .collect();

        // Process chunk multiple times to allow smoothing and AGC to stabilize
        let mut features = analyzer.process_chunk(&pcm[..fft_size], 0.02);
        for chunk in pcm.chunks(fft_size) {
            features = analyzer.process_chunk(chunk, 0.02);
        }

        assert!(
            features.bass > features.high,
            "Expected bass ({}) > high ({}) for 100 Hz sine wave",
            features.bass,
            features.high
        );
    }

    #[test]
    fn test_smoothing_attack_release() {
        let sample_rate = 44100;
        let fft_size = 2048;
        let mut analyzer = AudioAnalyzer::new(sample_rate, fft_size);
        analyzer.set_smoothing(40.0, 250.0);

        // Send silence first to establish zero base
        let silence = vec![0.0f32; fft_size];
        let f_init = analyzer.process_chunk(&silence, 0.02);
        assert_eq!(f_init.bass, 0.0);

        // Send a sudden full-amplitude signal chunk with short dt (5ms)
        let impulse: Vec<f32> = (0..fft_size)
            .map(|i| (2.0 * std::f32::consts::PI * 100.0 * i as f32 / sample_rate as f32).sin())
            .collect();

        let f_spike = analyzer.process_chunk(&impulse, 0.005);
        // With attack_ms = 40.0 and dt = 0.005 (5ms), alpha = 1 - exp(-0.005/0.04) ≈ 0.1175
        // So smoothed bass should be significantly dampened (less than 0.5)
        assert!(
            f_spike.bass < 0.5,
            "Expected smoothed bass to dampen sudden spike with dt=5ms, got {}",
            f_spike.bass
        );
    }
}
