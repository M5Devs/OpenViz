use crate::player::error::PlayerError;
use std::fs::File;
use std::path::Path;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::{MediaSourceStream, MediaSourceStreamOptions};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

#[derive(Clone, Debug)]
pub struct DecodedTrack {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub channels: usize,
    pub duration_seconds: f64,
}

pub fn decode_file<P: AsRef<Path>>(path: P) -> Result<DecodedTrack, PlayerError> {
    let path_ref = path.as_ref();
    let file = File::open(path_ref)?;
    let mss = MediaSourceStream::new(Box::new(file), MediaSourceStreamOptions::default());

    let mut hint = Hint::new();
    if let Some(ext) = path_ref.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    decode_media_stream(mss, hint)
}

pub fn decode_media_stream(
    mss: MediaSourceStream,
    hint: Hint,
) -> Result<DecodedTrack, PlayerError> {
    let format_opts = FormatOptions::default();
    let metadata_opts = MetadataOptions::default();
    let decoder_opts = DecoderOptions::default();

    let probed =
        symphonia::default::get_probe().format(&hint, mss, &format_opts, &metadata_opts)?;
    let mut format = probed.format;

    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL)
        .ok_or(PlayerError::NoAudioTrack)?;

    let track_id = track.id;
    let sample_rate = track.codec_params.sample_rate.unwrap_or(44100);
    let channels = track.codec_params.channels.map_or(2, |c| c.count());

    let mut decoder = symphonia::default::get_codecs().make(&track.codec_params, &decoder_opts)?;

    let mut samples: Vec<f32> = Vec::new();
    let mut sample_buf: Option<SampleBuffer<f32>> = None;

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(symphonia::core::errors::Error::IoError(err))
                if err.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(symphonia::core::errors::Error::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(err) => return Err(PlayerError::Decoder(err)),
        };

        if packet.track_id() != track_id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(audio_buf) => {
                if sample_buf.is_none() {
                    let spec = *audio_buf.spec();
                    let duration = audio_buf.capacity() as u64;
                    sample_buf = Some(SampleBuffer::<f32>::new(duration, spec));
                }

                if let Some(ref mut sb) = sample_buf {
                    sb.copy_interleaved_ref(audio_buf);
                    samples.extend_from_slice(sb.samples());
                }
            }
            Err(symphonia::core::errors::Error::DecodeError(_)) => {
                // Ignore non-fatal decode error and continue decoding subsequent packets
                continue;
            }
            Err(err) => return Err(PlayerError::Decoder(err)),
        }
    }

    let duration_seconds = if sample_rate > 0 && channels > 0 {
        (samples.len() / channels) as f64 / sample_rate as f64
    } else {
        0.0
    };

    Ok(DecodedTrack {
        samples,
        sample_rate,
        channels,
        duration_seconds,
    })
}
