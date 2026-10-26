use thiserror::Error;

#[derive(Error, Debug)]
pub enum PlayerError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Audio decoder error: {0}")]
    Decoder(#[from] symphonia::core::errors::Error),

    #[error("No audio track found in media source")]
    NoAudioTrack,

    #[error("Unsupported audio format: {0}")]
    UnsupportedFormat(String),

    #[error("Audio device not found")]
    DeviceNotFound,

    #[error("CPAL build stream error: {0}")]
    CpalBuildStream(#[from] cpal::BuildStreamError),

    #[error("CPAL play stream error: {0}")]
    CpalPlayStream(#[from] cpal::PlayStreamError),

    #[error("CPAL pause stream error: {0}")]
    CpalPauseStream(#[from] cpal::PauseStreamError),

    #[error("CPAL default stream config error: {0}")]
    CpalDefaultStreamConfig(#[from] cpal::DefaultStreamConfigError),

    #[error("CPAL devices error: {0}")]
    CpalDevices(#[from] cpal::DevicesError),

    #[error("No audio track loaded")]
    TrackNotLoaded,

    #[error("Invalid seek position: {0}s")]
    InvalidSeekPosition(f64),
}
