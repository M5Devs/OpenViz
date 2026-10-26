use super::effects::{process_audio_buffer, AudioEffectConfig};
use std::f32::consts::PI;

#[test]
fn test_bass_boost_amplification() {
    let sample_rate = 44100;
    let channels = 2;
    let num_samples = 44100;

    // Low frequency signal: 60 Hz sine wave
    let low_freq_samples: Vec<f32> = (0..num_samples)
        .flat_map(|i| {
            let val = 0.1 * (2.0 * PI * 60.0 * i as f32 / sample_rate as f32).sin();
            vec![val, val]
        })
        .collect();

    // High frequency signal: 5000 Hz sine wave
    let high_freq_samples: Vec<f32> = (0..num_samples)
        .flat_map(|i| {
            let val = 0.1 * (2.0 * PI * 5000.0 * i as f32 / sample_rate as f32).sin();
            vec![val, val]
        })
        .collect();

    let config_off = AudioEffectConfig::default();
    let config_boost = AudioEffectConfig::bass_boosted(12.0);

    let (out_low_off, _) =
        process_audio_buffer(&low_freq_samples, sample_rate, channels, &config_off);
    let (out_low_boost, _) =
        process_audio_buffer(&low_freq_samples, sample_rate, channels, &config_boost);

    let (out_high_off, _) =
        process_audio_buffer(&high_freq_samples, sample_rate, channels, &config_off);
    let (out_high_boost, _) =
        process_audio_buffer(&high_freq_samples, sample_rate, channels, &config_boost);

    let rms = |s: &[f32]| (s.iter().map(|&x| x * x).sum::<f32>() / s.len() as f32).sqrt();

    let low_ratio = rms(&out_low_boost) / rms(&out_low_off);
    let high_ratio = rms(&out_high_boost) / rms(&out_high_off);

    assert!(
        low_ratio > high_ratio * 1.5,
        "Expected low frequency gain ratio ({}) to be significantly higher than high frequency gain ratio ({})",
        low_ratio,
        high_ratio
    );
}

#[test]
fn test_speed_half_doubles_length() {
    let sample_rate = 44100;
    let channels = 2;
    let num_frames = 1000;
    let input_samples = vec![0.5f32; num_frames * channels];

    let mut config = AudioEffectConfig::default();
    config.speed = 0.5;

    let (out_samples, _) = process_audio_buffer(&input_samples, sample_rate, channels, &config);

    let expected_frames = num_frames * 2;
    let expected_samples = expected_frames * channels;

    assert_eq!(
        out_samples.len(),
        expected_samples,
        "Expected {} samples for speed=0.5, got {}",
        expected_samples,
        out_samples.len()
    );
}

#[test]
fn test_freeverb_tail_impulse() {
    let sample_rate = 44100;
    let channels = 2;
    let total_frames = 44100; // 1 second buffer
    let mut input_samples = vec![0.0f32; total_frames * channels];

    // Single impulse sample at frame 0
    input_samples[0] = 1.0;
    input_samples[1] = 1.0;

    let mut config = AudioEffectConfig::default();
    config.reverb_wet = 1.0;
    config.reverb_room_size = 0.85;

    let (out_samples, _) = process_audio_buffer(&input_samples, sample_rate, channels, &config);

    // Check samples far after impulse (e.g., frame 5000 to 10000) for reverb tail energy
    let tail_energy: f32 = out_samples[5000 * channels..10000 * channels]
        .iter()
        .map(|&x| x.abs())
        .sum();

    assert!(
        tail_energy > 0.01,
        "Expected significant reverb tail energy from single impulse, got {}",
        tail_energy
    );
}

#[test]
fn test_8d_panning_differential() {
    let sample_rate = 44100;
    let channels = 2;
    let num_frames = 44100; // 1 second
    let input_samples = vec![1.0f32; num_frames * channels];

    let mut config = AudioEffectConfig::default();
    config.enable_8d = true;
    config.eight_d_speed_hz = 1.0; // 1 cycle per second

    let (out_samples, _) = process_audio_buffer(&input_samples, sample_rate, channels, &config);

    // Sample at t = 0.25s (where sin(2*pi*1.0*0.25) = 1.0, pan is max right)
    let frame_idx = (sample_rate as f32 * 0.25) as usize;
    let l_val = out_samples[frame_idx * channels].abs();
    let r_val = out_samples[frame_idx * channels + 1].abs();

    assert!(
        (r_val - l_val).abs() > 0.5,
        "Expected 8D panning to produce strong amplitude differential between L ({}) and R ({})",
        l_val,
        r_val
    );
}
