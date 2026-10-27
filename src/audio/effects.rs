use serde::{Deserialize, Serialize};
use std::f32::consts::PI;

/// Configuration for non-destructive audio DSP effects chain.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AudioEffectConfig {
    /// Playback speed and pitch scaling factor (1.0 = normal, 0.85 = slowed, 1.25 = nightcore).
    pub speed: f32,
    /// Bass boost gain in dB at 120 Hz (0.0 = off, up to +18.0 dB).
    pub bass_boost_db: f32,
    /// Reverb wet mix (0.0 dry to 1.0 wet).
    pub reverb_wet: f32,
    /// Reverb room size (0.0 to 1.0).
    pub reverb_room_size: f32,
    /// Delay time in milliseconds (0.0 = off, e.g. 250.0 ms).
    pub delay_time_ms: f32,
    /// Delay feedback gain (0.0 to 0.85).
    pub delay_feedback: f32,
    /// Delay wet mix (0.0 to 1.0).
    pub delay_wet: f32,
    /// Enable 8D rotating auto-panner.
    pub enable_8d: bool,
    /// 8D rotation speed in Hz (e.g. 0.15 Hz).
    pub eight_d_speed_hz: f32,
}

impl Default for AudioEffectConfig {
    fn default() -> Self {
        Self {
            speed: 1.0,
            bass_boost_db: 0.0,
            reverb_wet: 0.0,
            reverb_room_size: 0.7,
            delay_time_ms: 0.0,
            delay_feedback: 0.0,
            delay_wet: 0.0,
            enable_8d: false,
            eight_d_speed_hz: 0.15,
        }
    }
}

impl AudioEffectConfig {
    /// Slowed + Reverb preset (speed: 0.85, reverb_wet: 0.35, room_size: 0.85).
    pub fn slowed_reverb() -> Self {
        Self {
            speed: 0.85,
            reverb_wet: 0.35,
            reverb_room_size: 0.85,
            ..Default::default()
        }
    }

    /// Nightcore / Sped-up preset (speed: 1.25).
    pub fn nightcore() -> Self {
        Self {
            speed: 1.25,
            ..Default::default()
        }
    }

    pub fn sanitize(&mut self) {
        if self.speed.is_nan() || self.speed.is_infinite() || self.speed <= 0.0 {
            self.speed = 1.0;
        }
        self.speed = self.speed.clamp(0.1, 4.0);

        if self.bass_boost_db.is_nan() || self.bass_boost_db.is_infinite() {
            self.bass_boost_db = 0.0;
        }
        self.bass_boost_db = self.bass_boost_db.clamp(0.0, 18.0);

        if self.reverb_wet.is_nan() || self.reverb_wet.is_infinite() {
            self.reverb_wet = 0.0;
        }
        self.reverb_wet = self.reverb_wet.clamp(0.0, 1.0);

        if self.reverb_room_size.is_nan() || self.reverb_room_size.is_infinite() {
            self.reverb_room_size = 0.7;
        }
        self.reverb_room_size = self.reverb_room_size.clamp(0.0, 1.0);

        if self.delay_wet.is_nan() || self.delay_wet.is_infinite() {
            self.delay_wet = 0.0;
        }
        self.delay_wet = self.delay_wet.clamp(0.0, 1.0);

        if self.delay_feedback.is_nan() || self.delay_feedback.is_infinite() {
            self.delay_feedback = 0.0;
        }
        self.delay_feedback = self.delay_feedback.clamp(0.0, 0.85);

        if self.delay_time_ms.is_nan()
            || self.delay_time_ms.is_infinite()
            || self.delay_time_ms < 0.0
        {
            self.delay_time_ms = 0.0;
        }

        if self.eight_d_speed_hz.is_nan()
            || self.eight_d_speed_hz.is_infinite()
            || self.eight_d_speed_hz <= 0.0
        {
            self.eight_d_speed_hz = 0.15;
        }
    }

    /// Bass Boost preset with specified dB gain.
    pub fn bass_boosted(db: f32) -> Self {
        Self {
            bass_boost_db: db,
            ..Default::default()
        }
    }
}

// Comb Filter for Freeverb
struct CombFilter {
    buffer: Vec<f32>,
    pos: usize,
    store: f32,
}

impl CombFilter {
    fn new(delay_len: usize) -> Self {
        Self {
            buffer: vec![0.0; delay_len.max(1)],
            pos: 0,
            store: 0.0,
        }
    }

    fn process(&mut self, input: f32, feedback: f32, damp: f32) -> f32 {
        let output = self.buffer[self.pos];
        self.store = output * (1.0 - damp) + self.store * damp;
        self.buffer[self.pos] = input + self.store * feedback;
        self.pos = (self.pos + 1) % self.buffer.len();
        output
    }
}

// All-Pass Filter for Freeverb
struct AllPassFilter {
    buffer: Vec<f32>,
    pos: usize,
}

impl AllPassFilter {
    fn new(delay_len: usize) -> Self {
        Self {
            buffer: vec![0.0; delay_len.max(1)],
            pos: 0,
        }
    }

    fn process(&mut self, input: f32) -> f32 {
        let buf_out = self.buffer[self.pos];
        let output = -input + buf_out;
        self.buffer[self.pos] = input + buf_out * 0.5;
        self.pos = (self.pos + 1) % self.buffer.len();
        output
    }
}

struct FreeverbChannel {
    combs: Vec<CombFilter>,
    allpasses: Vec<AllPassFilter>,
}

impl FreeverbChannel {
    fn new(comb_delays: &[usize], allpass_delays: &[usize]) -> Self {
        Self {
            combs: comb_delays.iter().map(|&d| CombFilter::new(d)).collect(),
            allpasses: allpass_delays
                .iter()
                .map(|&d| AllPassFilter::new(d))
                .collect(),
        }
    }

    fn process(&mut self, input: f32, room_size: f32) -> f32 {
        let feedback = (room_size * 0.28 + 0.70).clamp(0.0, 0.98);
        let damp = 0.2;
        let mut out = 0.0;
        for comb in &mut self.combs {
            out += comb.process(input, feedback, damp);
        }
        for ap in &mut self.allpasses {
            out = ap.process(out);
        }
        out
    }
}

/// Process PCM sample buffer in-memory through the DSP effects chain.
/// Returns (processed_pcm, effective_sample_rate).
pub fn process_audio_buffer(
    samples: &[f32],
    sample_rate: u32,
    channels: usize,
    config: &AudioEffectConfig,
) -> (Vec<f32>, u32) {
    if samples.is_empty() || channels == 0 || sample_rate == 0 {
        return (Vec::new(), sample_rate);
    }

    let mut config = config.clone();
    config.sanitize();
    let config = &config;

    // 1. Resampling (Speed / Pitch scaling)
    let current_samples = if (config.speed - 1.0).abs() > 1e-4 && config.speed > 0.0 {
        let num_frames = samples.len() / channels;
        let new_num_frames = (num_frames as f64 / config.speed as f64).round() as usize;
        let mut resampled = Vec::with_capacity(new_num_frames * channels);

        for i in 0..new_num_frames {
            let pos = i as f64 * config.speed as f64;
            let idx = pos.floor() as usize;
            let frac = (pos - idx as f64) as f32;

            for c in 0..channels {
                let sample_curr = if idx < num_frames {
                    samples[idx * channels + c]
                } else {
                    0.0
                };
                let sample_next = if idx + 1 < num_frames {
                    samples[(idx + 1) * channels + c]
                } else {
                    sample_curr
                };

                let val = sample_curr * (1.0 - frac) + sample_next * frac;
                resampled.push(val);
            }
        }
        resampled
    } else {
        samples.to_vec()
    };

    let total_frames = current_samples.len() / channels;
    let mut out_samples = current_samples;

    // 2. Bass Boost (Low-Shelf Biquad Filter at 120 Hz + Soft Saturation)
    if config.bass_boost_db > 1e-4 {
        let f0 = 120.0f32;
        let fs = sample_rate as f32;
        let a = 10.0f32.powf(config.bass_boost_db / 40.0);
        let w0 = 2.0 * PI * f0 / fs;
        let cos_w0 = w0.cos();
        let sin_w0 = w0.sin();
        let alpha = sin_w0 / (2.0f32).sqrt();

        let b0 = a * ((a + 1.0) - (a - 1.0) * cos_w0 + 2.0 * a.sqrt() * alpha);
        let b1 = 2.0 * a * ((a - 1.0) - (a + 1.0) * cos_w0);
        let b2 = a * ((a + 1.0) - (a - 1.0) * cos_w0 - 2.0 * a.sqrt() * alpha);
        let a0 = (a + 1.0) + (a - 1.0) * cos_w0 + 2.0 * a.sqrt() * alpha;
        let a1 = -2.0 * ((a - 1.0) + (a + 1.0) * cos_w0);
        let a2 = (a + 1.0) + (a - 1.0) * cos_w0 - 2.0 * a.sqrt() * alpha;

        let b0 = b0 / a0;
        let b1 = b1 / a0;
        let b2 = b2 / a0;
        let a1 = a1 / a0;
        let a2 = a2 / a0;

        let mut w1 = vec![0.0f32; channels];
        let mut w2 = vec![0.0f32; channels];

        for i in 0..total_frames {
            for (c, (w1_c, w2_c)) in w1.iter_mut().zip(w2.iter_mut()).enumerate().take(channels) {
                let idx = i * channels + c;
                let x = out_samples[idx];
                let w = x - a1 * (*w1_c) - a2 * (*w2_c);
                let y = b0 * w + b1 * (*w1_c) + b2 * (*w2_c);
                *w2_c = *w1_c;
                *w1_c = w;
                out_samples[idx] = y.tanh();
            }
        }
    }

    // 3. Stereo Freeverb Engine
    if config.reverb_wet > 1e-4 {
        let scale_delay = |orig: usize| -> usize {
            ((orig as f64 * sample_rate as f64 / 44100.0).round() as usize).max(1)
        };

        let comb_l_delays = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map(scale_delay);
        let comb_r_delays = [1139, 1211, 1300, 1379, 1445, 1514, 1580, 1640].map(scale_delay);
        let ap_l_delays = [556, 441, 341, 225].map(scale_delay);
        let ap_r_delays = [579, 464, 364, 248].map(scale_delay);

        let mut freeverb_channels: Vec<FreeverbChannel> = (0..channels)
            .map(|c| {
                if c % 2 == 0 {
                    FreeverbChannel::new(&comb_l_delays, &ap_l_delays)
                } else {
                    FreeverbChannel::new(&comb_r_delays, &ap_r_delays)
                }
            })
            .collect();

        for i in 0..total_frames {
            for (c, fv_chan) in freeverb_channels.iter_mut().enumerate().take(channels) {
                let idx = i * channels + c;
                let dry = out_samples[idx];
                let wet_sample = fv_chan.process(dry, config.reverb_room_size);
                out_samples[idx] =
                    dry * (1.0 - config.reverb_wet) + wet_sample * config.reverb_wet * 0.2;
            }
        }
    }

    // 4. Stereo Echo / Delay
    if config.delay_wet > 1e-4 && config.delay_time_ms > 0.0 {
        let delay_samples = ((config.delay_time_ms / 1000.0) * sample_rate as f32).round() as usize;
        if delay_samples > 0 {
            let feedback = config.delay_feedback.clamp(0.0, 0.85);
            let wet = config.delay_wet.clamp(0.0, 1.0);

            let mut delay_bufs = vec![vec![0.0f32; delay_samples]; channels];
            let mut pos = 0usize;

            for i in 0..total_frames {
                if channels >= 2 {
                    let l_idx = i * channels;
                    let r_idx = i * channels + 1;
                    let l_in = out_samples[l_idx];
                    let r_in = out_samples[r_idx];

                    let l_delayed = delay_bufs[0][pos];
                    let r_delayed = delay_bufs[1][pos];

                    let cross_l = l_delayed * 0.7 + r_delayed * 0.3;
                    let cross_r = r_delayed * 0.7 + l_delayed * 0.3;

                    delay_bufs[0][pos] = l_in + cross_l * feedback;
                    delay_bufs[1][pos] = r_in + cross_r * feedback;

                    out_samples[l_idx] = l_in * (1.0 - wet) + l_delayed * wet;
                    out_samples[r_idx] = r_in * (1.0 - wet) + r_delayed * wet;
                } else {
                    for (c, delay_buf) in delay_bufs.iter_mut().enumerate().take(channels) {
                        let idx = i * channels + c;
                        let in_val = out_samples[idx];
                        let delayed = delay_buf[pos];
                        delay_buf[pos] = in_val + delayed * feedback;
                        out_samples[idx] = in_val * (1.0 - wet) + delayed * wet;
                    }
                }
                pos = (pos + 1) % delay_samples;
            }
        }
    }

    // 5. 8D Auto-Panner
    if config.enable_8d && channels >= 2 {
        let fs = sample_rate as f32;
        for i in 0..total_frames {
            let t = i as f32 / fs;
            let pan = (2.0 * PI * config.eight_d_speed_hz * t).sin();
            let angle = pan * (PI / 4.0);
            let l_gain = (angle + std::f32::consts::FRAC_PI_4).cos().abs().min(1.0);
            let r_gain = (angle + std::f32::consts::FRAC_PI_4).sin().abs().min(1.0);

            let l_idx = i * channels;
            let r_idx = i * channels + 1;

            out_samples[l_idx] *= l_gain;
            out_samples[r_idx] *= r_gain;
        }
    }

    (out_samples, sample_rate)
}
