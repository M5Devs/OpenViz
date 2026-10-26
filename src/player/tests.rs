use crate::player::{AudioPlayer, PlaybackState, PlayerError};

fn generate_synthetic_wav(sample_rate: u32, channels: u16, duration_secs: f32) -> Vec<u8> {
    let bits_per_sample: u16 = 16;
    let num_samples_per_channel = (sample_rate as f32 * duration_secs) as usize;
    let data_size = num_samples_per_channel * channels as usize * (bits_per_sample as usize / 8);
    let chunk_size = 36 + data_size;
    let byte_rate = sample_rate * channels as u32 * (bits_per_sample as u32 / 8);
    let block_align = channels * (bits_per_sample / 8);

    let mut buf = Vec::with_capacity(44 + data_size);
    // RIFF header
    buf.extend_from_slice(b"RIFF");
    buf.extend_from_slice(&(chunk_size as u32).to_le_bytes());
    buf.extend_from_slice(b"WAVE");

    // fmt subchunk
    buf.extend_from_slice(b"fmt ");
    buf.extend_from_slice(&16u32.to_le_bytes());
    buf.extend_from_slice(&1u16.to_le_bytes());
    buf.extend_from_slice(&channels.to_le_bytes());
    buf.extend_from_slice(&sample_rate.to_le_bytes());
    buf.extend_from_slice(&byte_rate.to_le_bytes());
    buf.extend_from_slice(&block_align.to_le_bytes());
    buf.extend_from_slice(&bits_per_sample.to_le_bytes());

    // data subchunk
    buf.extend_from_slice(b"data");
    buf.extend_from_slice(&(data_size as u32).to_le_bytes());

    let freq = 100.0; // 100 Hz tone
    for i in 0..num_samples_per_channel {
        let t = i as f32 / sample_rate as f32;
        let sample_val = (2.0 * std::f32::consts::PI * freq * t).sin();
        let sample_i16 = (sample_val * 20000.0) as i16;
        for _ in 0..channels {
            buf.extend_from_slice(&sample_i16.to_le_bytes());
        }
    }

    buf
}

#[test]
fn test_decode_synthetic_wav() {
    let wav_data = generate_synthetic_wav(44100, 2, 2.0);
    let mut player = AudioPlayer::new();

    assert_eq!(player.get_duration(), 0.0);
    player
        .load_from_bytes(wav_data, Some("wav"))
        .expect("Failed to load synthetic WAV");

    let duration = player.get_duration();
    assert!(
        (duration - 2.0).abs() < 0.05,
        "Expected duration close to 2.0s, got {}",
        duration
    );
    assert_eq!(player.get_position(), 0.0);
    assert_eq!(player.get_state(), PlaybackState::Stopped);
}

#[test]
fn test_playback_state_transitions() {
    let wav_data = generate_synthetic_wav(44100, 2, 2.0);
    let mut player = AudioPlayer::new();

    // Cannot play without track
    assert!(player.play().is_err());

    player
        .load_from_bytes(wav_data, Some("wav"))
        .expect("Failed to load WAV");
    assert_eq!(player.get_state(), PlaybackState::Stopped);
    assert!(!player.is_playing());

    // Transition to Playing
    player.play().expect("Failed to play");
    assert_eq!(player.get_state(), PlaybackState::Playing);
    assert!(player.is_playing());

    // Transition to Paused
    player.pause();
    assert_eq!(player.get_state(), PlaybackState::Paused);
    assert!(!player.is_playing());

    // Transition back to Playing
    player.play().expect("Failed to play");
    assert_eq!(player.get_state(), PlaybackState::Playing);

    // Transition to Stopped
    player.stop();
    assert_eq!(player.get_state(), PlaybackState::Stopped);
    assert!(!player.is_playing());
    assert_eq!(player.get_position(), 0.0);
}

#[test]
fn test_seek_updates_atomic_cursor() {
    let wav_data = generate_synthetic_wav(44100, 2, 2.0);
    let mut player = AudioPlayer::new();

    // Cannot seek without track
    assert!(player.seek(1.0).is_err());

    player
        .load_from_bytes(wav_data, Some("wav"))
        .expect("Failed to load WAV");

    // Seek to 1.0s
    player.seek(1.0).expect("Failed to seek to 1.0s");
    let pos = player.get_position();
    assert!(
        (pos - 1.0).abs() < 0.01,
        "Expected position close to 1.0s, got {}",
        pos
    );

    // Out of bounds seek
    assert!(matches!(
        player.seek(-0.5),
        Err(PlayerError::InvalidSeekPosition(_))
    ));
    assert!(matches!(
        player.seek(3.0),
        Err(PlayerError::InvalidSeekPosition(_))
    ));
}

#[test]
fn test_get_live_features_without_panics() {
    let wav_data = generate_synthetic_wav(44100, 2, 2.0);
    let mut player = AudioPlayer::new();

    player
        .load_from_bytes(wav_data, Some("wav"))
        .expect("Failed to load WAV");

    player.set_volume(0.8);
    player.play().expect("Failed to play");

    // Call get_live_features multiple times
    for _ in 0..5 {
        let features = player.get_live_features();
        assert!(!features.raw_spectrum.is_empty());
        assert!(features.bass >= 0.0 && features.bass <= 1.0);
        assert!(features.mid >= 0.0 && features.mid <= 1.0);
        assert!(features.high >= 0.0 && features.high <= 1.0);
    }
}
