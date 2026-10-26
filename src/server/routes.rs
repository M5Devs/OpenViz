use axum::{extract::Multipart, http::StatusCode, response::Html, Json};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::audio::effects::{process_audio_buffer, AudioEffectConfig};
use crate::audio::AudioAnalyzer;
use crate::player::decoder::decode_file;
use crate::render::OffscreenRenderer;
use crate::scene::binding::{AudioBinding, BindingSource, BindingTarget, MappingCurve};
use crate::scene::node::{NodeType, SceneNode};
use crate::scene::postfx::PostEffect;
use crate::scene::transform::Transform;
use crate::template::Template;

const INDEX_HTML: &str = include_str!("static/index.html");

#[derive(Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
}

#[derive(Deserialize, Debug)]
pub struct ExportEffects {
    #[serde(default)]
    pub slowed: bool,
    #[serde(default)]
    pub nightcore: bool,
    #[serde(default)]
    pub bass_boost_db: Option<f32>,
    #[serde(default)]
    pub reverb: Option<f32>,
    #[serde(default)]
    pub eight_d: bool,
}

#[derive(Deserialize, Debug)]
pub struct ExportRequest {
    pub audio_path: String,
    pub template: Template,
    #[serde(default)]
    pub effects: Option<ExportEffects>,
    #[serde(default = "default_width")]
    pub width: u32,
    #[serde(default = "default_height")]
    pub height: u32,
    #[serde(default = "default_fps")]
    pub fps: u32,
}

fn default_width() -> u32 {
    1920
}
fn default_height() -> u32 {
    1080
}
fn default_fps() -> u32 {
    60
}

#[derive(Serialize)]
pub struct ExportResponse {
    pub download_url: String,
}

#[derive(Serialize)]
pub struct UploadResponse {
    pub file_path: String,
    pub filename: String,
}

pub async fn handle_index() -> Html<&'static str> {
    Html(INDEX_HTML)
}

pub async fn handle_health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
        version: "0.1.0".to_string(),
    })
}

pub fn default_template() -> Template {
    let bg_node = SceneNode {
        id: "bg_quad".to_string(),
        node_type: NodeType::Image {
            asset_id: "dark_bg.png".to_string(),
        },
        transform: Transform {
            position: [0.0, 0.0],
            scale: [2.0, 2.0],
            rotation: 0.0,
            opacity: 1.0,
        },
        bindings: vec![],
    };

    let bars_node = SceneNode {
        id: "radial_bars".to_string(),
        node_type: NodeType::Bars {
            count: 64,
            inner_radius: 10.0,
            width: 2.0,
            is_radial: true,
            color_start: [0.1, 0.8, 1.0, 1.0],
            color_end: [1.0, 0.2, 0.8, 1.0],
        },
        transform: Transform::default(),
        bindings: vec![AudioBinding {
            source: BindingSource::Bass,
            target: BindingTarget::BarHeight,
            curve: MappingCurve::Linear,
            output_range: [0.5, 2.5],
        }],
    };

    let logo_node = SceneNode {
        id: "center_logo".to_string(),
        node_type: NodeType::Image {
            asset_id: "logo_placeholder.png".to_string(),
        },
        transform: Transform::default(),
        bindings: vec![AudioBinding {
            source: BindingSource::Bass,
            target: BindingTarget::ScaleUniform,
            curve: MappingCurve::Linear,
            output_range: [1.0, 1.3],
        }],
    };

    let root = SceneNode {
        id: "root".to_string(),
        node_type: NodeType::Group {
            children: vec![bg_node, bars_node, logo_node],
        },
        transform: Transform::default(),
        bindings: vec![],
    };

    Template {
        schema_version: "openviz/1".to_string(),
        name: "Default Spectrum".to_string(),
        author: "OpenViz".to_string(),
        canvas_aspect: "16:9".to_string(),
        clear_color: [0.05, 0.05, 0.08, 1.0],
        root,
        post_effects: vec![PostEffect::Bloom {
            threshold: 0.7,
            intensity: 1.5,
            radius: 5.0,
        }],
    }
}

pub async fn handle_default_template() -> Json<Template> {
    Json(default_template())
}

pub async fn handle_import_viz(
    mut multipart: Multipart,
) -> Result<Json<Template>, (StatusCode, String)> {
    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("").to_string();
        let file_name = field.file_name().unwrap_or("upload.viz").to_string();

        if name == "file" || file_name.ends_with(".viz") {
            let bytes = field.bytes().await.map_err(|e| {
                (
                    StatusCode::BAD_REQUEST,
                    format!("Failed to read upload stream: {}", e),
                )
            })?;

            let cursor = std::io::Cursor::new(bytes);
            let template = crate::template::avee::import_viz_from_reader(cursor).map_err(|e| {
                (
                    StatusCode::UNPROCESSABLE_ENTITY,
                    format!("Failed to parse .viz archive: {}", e),
                )
            })?;

            return Ok(Json(template));
        }
    }

    Err((
        StatusCode::BAD_REQUEST,
        "No file uploaded in multipart request".to_string(),
    ))
}

pub async fn handle_upload(
    mut multipart: Multipart,
) -> Result<Json<UploadResponse>, (StatusCode, String)> {
    let upload_dir = PathBuf::from("static/uploads");
    if let Err(e) = std::fs::create_dir_all(&upload_dir) {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to create uploads dir: {}", e),
        ));
    }

    if let Ok(Some(field)) = multipart.next_field().await {
        let original_filename = field.file_name().unwrap_or("uploaded_file").to_string();
        let sanitized = sanitize_filename::sanitize(&original_filename);
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let target_filename = format!("{}_{}", timestamp, sanitized);
        let file_path = upload_dir.join(&target_filename);

        let bytes = field.bytes().await.map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                format!("Failed to read bytes: {}", e),
            )
        })?;

        std::fs::write(&file_path, &bytes).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to save file: {}", e),
            )
        })?;

        let relative_path = format!("static/uploads/{}", target_filename);
        return Ok(Json(UploadResponse {
            file_path: relative_path,
            filename: original_filename,
        }));
    }

    Err((
        StatusCode::BAD_REQUEST,
        "No file found in multipart upload".to_string(),
    ))
}

pub async fn handle_export(
    Json(req): Json<ExportRequest>,
) -> Result<Json<ExportResponse>, (StatusCode, String)> {
    let audio_path = PathBuf::from(&req.audio_path);
    if !audio_path.exists() {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("Audio file not found at path: {}", req.audio_path),
        ));
    }

    let downloads_dir = PathBuf::from("static/downloads");
    if let Err(e) = std::fs::create_dir_all(&downloads_dir) {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to create downloads directory: {}", e),
        ));
    }

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let out_filename = format!("openviz_export_{}.mp4", timestamp);
    let output_path = downloads_dir.join(&out_filename);

    tokio::task::spawn_blocking(move || {
        let mut track =
            decode_file(&audio_path).map_err(|e| format!("Failed to decode audio: {}", e))?;

        let mut effect_config = AudioEffectConfig::default();
        if let Some(ref fx) = req.effects {
            if fx.slowed {
                effect_config = AudioEffectConfig::slowed_reverb();
            }
            if fx.nightcore {
                effect_config = AudioEffectConfig::nightcore();
            }
            if let Some(db) = fx.bass_boost_db {
                effect_config.bass_boost_db = db;
            }
            if let Some(r) = fx.reverb {
                effect_config.reverb_wet = r;
            }
            if fx.eight_d {
                effect_config.enable_8d = true;
            }
        }

        let (processed_samples, effective_sample_rate) = process_audio_buffer(
            &track.samples,
            track.sample_rate,
            track.channels,
            &effect_config,
        );
        track.samples = processed_samples;
        track.sample_rate = effective_sample_rate;
        track.duration_seconds =
            track.samples.len() as f64 / (track.channels.max(1) as f64 * track.sample_rate as f64);

        let has_fx = req.effects.as_ref().is_some_and(|fx| {
            fx.slowed
                || fx.nightcore
                || fx.bass_boost_db.is_some()
                || fx.reverb.is_some()
                || fx.eight_d
        });

        let temp_wav_path = if has_fx {
            let tmp = std::env::temp_dir().join(format!("openviz_export_audio_{}.wav", timestamp));
            write_wav_helper(&tmp, &track.samples, track.sample_rate, track.channels)
                .map_err(|e| format!("Failed to write temp WAV audio: {}", e))?;
            Some(tmp)
        } else {
            None
        };

        let ffmpeg_audio_arg = temp_wav_path.as_ref().unwrap_or(&audio_path);

        let fps = req.fps.max(1);
        let total_frames = (track.duration_seconds * fps as f64).ceil() as usize;

        let mut ffmpeg_cmd = Command::new("ffmpeg");
        ffmpeg_cmd
            .arg("-y")
            .arg("-f")
            .arg("rawvideo")
            .arg("-pix_fmt")
            .arg("rgba")
            .arg("-s")
            .arg(format!("{}x{}", req.width, req.height))
            .arg("-r")
            .arg(fps.to_string())
            .arg("-i")
            .arg("-")
            .arg("-i")
            .arg(ffmpeg_audio_arg)
            .arg("-c:v")
            .arg("libx264")
            .arg("-preset")
            .arg("medium")
            .arg("-crf")
            .arg("18")
            .arg("-pix_fmt")
            .arg("yuv420p")
            .arg("-c:a")
            .arg("aac")
            .arg("-b:a")
            .arg("320k")
            .arg("-shortest")
            .arg(&output_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        let mut ffmpeg_proc = ffmpeg_cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn FFmpeg: {}", e))?;
        let mut ffmpeg_stdin = ffmpeg_proc
            .stdin
            .take()
            .ok_or_else(|| "Failed to open FFmpeg stdin".to_string())?;

        let mut renderer = OffscreenRenderer::new(req.width, req.height)
            .map_err(|e| format!("Failed to init renderer: {}", e))?;
        let mut analyzer = AudioAnalyzer::new(track.sample_rate, 2048);

        let window_size = 2048usize;
        let sample_rate = track.sample_rate as f64;
        let channels = track.channels.max(1);
        let dt = 1.0 / fps as f32;

        for frame in 0..total_frames {
            let t = frame as f64 / fps as f64;
            let center_sample = (t * sample_rate) as usize;
            let start_sample = center_sample.saturating_sub(window_size / 2);
            let end_sample = (start_sample + window_size).min(track.samples.len() / channels);

            let mut window = Vec::with_capacity(window_size);
            for s_idx in start_sample..end_sample {
                if channels == 1 {
                    window.push(track.samples[s_idx]);
                } else {
                    let mut sum = 0.0;
                    for c in 0..channels {
                        let idx = s_idx * channels + c;
                        if idx < track.samples.len() {
                            sum += track.samples[idx];
                        }
                    }
                    window.push(sum / channels as f32);
                }
            }

            if window.len() < window_size {
                window.resize(window_size, 0.0);
            }

            let features = analyzer.process_chunk(&window, dt);
            let mut scene = req.template.root.clone();
            scene.apply_bindings(&features);

            renderer
                .render_frame(&scene, &features)
                .map_err(|e| format!("Render frame error: {}", e))?;
            let pixels = renderer
                .capture_pixels()
                .map_err(|e| format!("Capture pixels error: {}", e))?;

            ffmpeg_stdin
                .write_all(&pixels)
                .map_err(|e| format!("Failed writing frame to FFmpeg: {}", e))?;
        }

        drop(ffmpeg_stdin);
        let status = ffmpeg_proc
            .wait()
            .map_err(|e| format!("FFmpeg wait failed: {}", e))?;

        if let Some(ref tmp_wav) = temp_wav_path {
            let _ = std::fs::remove_file(tmp_wav);
        }

        if !status.success() {
            return Err(format!("FFmpeg process failed with status: {}", status));
        }

        Ok(())
    })
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Export task panicked: {}", e),
        )
    })?
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    let download_url = format!("/downloads/{}", out_filename);
    Ok(Json(ExportResponse { download_url }))
}

fn write_wav_helper(
    path: &Path,
    samples: &[f32],
    sample_rate: u32,
    channels: usize,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut file = File::create(path)?;
    let channels = channels.max(1) as u16;
    let bits_per_sample = 16u16;
    let block_align = channels * (bits_per_sample / 8);
    let byte_rate = sample_rate * block_align as u32;
    let data_len = (samples.len() * 2) as u32;
    let file_len = 36 + data_len;

    file.write_all(b"RIFF")?;
    file.write_all(&file_len.to_le_bytes())?;
    file.write_all(b"WAVE")?;
    file.write_all(b"fmt ")?;
    file.write_all(&16u32.to_le_bytes())?;
    file.write_all(&1u16.to_le_bytes())?;
    file.write_all(&channels.to_le_bytes())?;
    file.write_all(&sample_rate.to_le_bytes())?;
    file.write_all(&byte_rate.to_le_bytes())?;
    file.write_all(&block_align.to_le_bytes())?;
    file.write_all(&bits_per_sample.to_le_bytes())?;
    file.write_all(b"data")?;
    file.write_all(&data_len.to_le_bytes())?;

    for &sample in samples {
        let val = (sample.clamp(-1.0, 1.0) * 32767.0) as i16;
        file.write_all(&val.to_le_bytes())?;
    }

    file.flush()?;
    Ok(())
}

mod sanitize_filename {
    pub fn sanitize(name: &str) -> String {
        name.chars()
            .map(|c| {
                if c.is_alphanumeric() || c == '.' || c == '-' || c == '_' {
                    c
                } else {
                    '_'
                }
            })
            .collect()
    }
}
