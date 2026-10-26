fn load_template(path: &std::path::Path) -> Result<Template, Box<dyn std::error::Error>> {
    let is_viz = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.eq_ignore_ascii_case("viz"))
        .unwrap_or(false);

    if is_viz {
        let template = openviz_core::template::import_viz(path)?;
        Ok(template)
    } else {
        let json_str = std::fs::read_to_string(path)?;
        let template = Template::from_json(&json_str)?;
        Ok(template)
    }
}

use clap::{Args, Parser, Subcommand};
use indicatif::{ProgressBar, ProgressStyle};
use openviz_core::audio::AudioAnalyzer;
use openviz_core::player::decoder::decode_file;
use openviz_core::render::OffscreenRenderer;
use openviz_core::scene::binding::{AudioBinding, BindingSource, BindingTarget, MappingCurve};
use openviz_core::scene::node::{NodeType, SceneNode};
use openviz_core::scene::postfx::PostEffect;
use openviz_core::scene::transform::Transform;
use openviz_core::template::Template;
use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

#[derive(Parser, Debug)]
#[command(name = "openviz", author, version, about = "OpenViz CLI & Video Export Pipeline", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Export an offline video using template and audio
    Export(ExportArgs),
    /// Generate a default video template file (.ovz)
    GenerateTemplate(GenerateTemplateArgs),
    /// Print metadata and summary for template or audio file
    Info(InfoArgs),
}

#[derive(Args, Debug)]
struct ExportArgs {
    /// Path to audio file (MP3, WAV, FLAC)
    #[arg(short = 'a', long)]
    audio: PathBuf,

    /// Path to template JSON (.ovz)
    #[arg(short = 't', long)]
    template: PathBuf,

    /// Output MP4 file path
    #[arg(short = 'o', long, default_value = "output.mp4")]
    output: PathBuf,

    /// Video width
    #[arg(long, default_value_t = 1920)]
    width: u32,

    /// Video height
    #[arg(long, default_value_t = 1080)]
    height: u32,

    /// Frame rate
    #[arg(long, default_value_t = 60)]
    fps: u32,

    /// Video bitrate
    #[arg(long, default_value = "12M")]
    bitrate: String,
}

#[derive(Args, Debug)]
struct GenerateTemplateArgs {
    /// Output template file path
    #[arg(short = 'o', long, default_value = "demo.ovz")]
    output: PathBuf,
}

#[derive(Args, Debug)]
struct InfoArgs {
    /// Path to template file
    #[arg(long)]
    template: Option<PathBuf>,

    /// Path to audio file
    #[arg(long)]
    audio: Option<PathBuf>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();

    match cli.command {
        Commands::GenerateTemplate(args) => run_generate_template(args)?,
        Commands::Info(args) => run_info(args)?,
        Commands::Export(args) => run_export(args)?,
    }

    Ok(())
}

fn run_generate_template(args: GenerateTemplateArgs) -> Result<(), Box<dyn std::error::Error>> {
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

    let template = Template {
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
    };

    let json_data = template.to_json()?;
    let mut file = File::create(&args.output)?;
    file.write_all(json_data.as_bytes())?;

    println!("Successfully generated template: {}", args.output.display());
    Ok(())
}

fn count_nodes(node: &SceneNode) -> (usize, usize) {
    let mut nodes = 1;
    let mut layers = 0;

    if let NodeType::Group { ref children } = node.node_type {
        layers += children.len();
        for child in children {
            let (c_nodes, c_layers) = count_nodes(child);
            nodes += c_nodes;
            layers += c_layers;
        }
    }

    (nodes, layers)
}

fn run_info(args: InfoArgs) -> Result<(), Box<dyn std::error::Error>> {
    if args.template.is_none() && args.audio.is_none() {
        eprintln!("Error: Please specify at least --template <PATH> or --audio <PATH>");
        std::process::exit(1);
    }

    if let Some(ref template_path) = args.template {
        let template = load_template(template_path)?;

        let (total_nodes, layers) = count_nodes(&template.root);

        println!("=== Template Info ===");
        println!("File: {}", template_path.display());
        println!("Name: {}", template.name);
        println!("Author: {}", template.author);
        println!("Schema Version: {}", template.schema_version);
        println!("Canvas Aspect Ratio: {}", template.canvas_aspect);
        println!("Total Nodes: {}", total_nodes);
        println!("Total Layers/Children: {}", layers);
        println!("Post Effects Count: {}", template.post_effects.len());
        for (i, effect) in template.post_effects.iter().enumerate() {
            println!("  Effect #{}: {:?}", i + 1, effect);
        }
    }

    if let Some(ref audio_path) = args.audio {
        let track = decode_file(audio_path)?;

        println!("\n=== Audio Metadata ===");
        println!("File: {}", audio_path.display());
        println!("Duration: {:.2}s", track.duration_seconds);
        println!("Sample Rate: {} Hz", track.sample_rate);
        println!("Channels: {}", track.channels);
        println!("Total Samples: {}", track.samples.len());
    }

    Ok(())
}

fn run_export(args: ExportArgs) -> Result<(), Box<dyn std::error::Error>> {
    // 1. Load and decode audio
    let track = decode_file(&args.audio)?;

    // 2. Load template (supports .ovz JSON and .viz Avee packages)
    let template = load_template(&args.template)?;

    // 3. Calculate total frames
    let fps = args.fps.max(1);
    let total_frames = (track.duration_seconds * fps as f64).ceil() as usize;

    // 4. Check FFmpeg availability
    let ffmpeg_check = Command::new("ffmpeg").arg("-version").output();
    if ffmpeg_check.is_err() || !ffmpeg_check.as_ref().unwrap().status.success() {
        eprintln!("Error: FFmpeg is not available on your system PATH.");
        eprintln!("Please install FFmpeg to use the offline video export feature.");
        std::process::exit(1);
    }

    // 5. Spawn ffmpeg subprocess
    let mut ffmpeg_cmd = Command::new("ffmpeg");
    ffmpeg_cmd
        .arg("-y")
        .arg("-f")
        .arg("rawvideo")
        .arg("-pix_fmt")
        .arg("rgba")
        .arg("-s")
        .arg(format!("{}x{}", args.width, args.height))
        .arg("-r")
        .arg(fps.to_string())
        .arg("-i")
        .arg("-")
        .arg("-i")
        .arg(&args.audio)
        .arg("-c:v")
        .arg("libx264")
        .arg("-preset")
        .arg("medium")
        .arg("-crf")
        .arg("18")
        .arg("-b:v")
        .arg(&args.bitrate)
        .arg("-pix_fmt")
        .arg("yuv420p")
        .arg("-c:a")
        .arg("aac")
        .arg("-b:a")
        .arg("320k")
        .arg("-shortest")
        .arg(&args.output)
        .stdin(Stdio::piped())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    let mut ffmpeg_proc = ffmpeg_cmd.spawn()?;
    let mut ffmpeg_stdin = ffmpeg_proc
        .stdin
        .take()
        .ok_or("Failed to open stdin for FFmpeg subprocess")?;

    // 6. Initialize renderer and analyzer
    let mut renderer = OffscreenRenderer::new(args.width, args.height)?;
    let mut analyzer = AudioAnalyzer::new(track.sample_rate, 2048);

    // 7. Setup progress bar
    let pb = ProgressBar::new(total_frames as u64);
    pb.set_style(
        ProgressStyle::default_bar()
            .template("{spinner:.green} [{elapsed_precise}] [{bar:40.cyan/blue}] {pos}/{len} frames ({fps} fps, ETA: {eta})")?
            .progress_chars("#>-"),
    );

    let window_size = 2048usize;
    let sample_rate = track.sample_rate as f64;
    let channels = track.channels.max(1);
    let dt = 1.0 / fps as f32;

    // 8. Offline video render loop
    for frame in 0..total_frames {
        let t = frame as f64 / fps as f64;
        let center_sample = (t * sample_rate) as usize;
        let start_sample = center_sample.saturating_sub(window_size / 2);
        let end_sample = (start_sample + window_size).min(track.samples.len() / channels);

        // Extract PCM window (convert interleaved to mono if multi-channel)
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

        // Pad if window is shorter than 2048
        if window.len() < window_size {
            window.resize(window_size, 0.0);
        }

        let features = analyzer.process_chunk(&window, dt);

        let mut scene = template.root.clone();
        scene.apply_bindings(&features);

        renderer.render_frame(&scene, &features)?;
        let pixels = renderer.capture_pixels()?;

        ffmpeg_stdin.write_all(&pixels)?;
        pb.inc(1);
    }

    drop(ffmpeg_stdin);

    let status = ffmpeg_proc.wait()?;
    pb.finish_with_message("Export complete");

    if !status.success() {
        return Err(format!("FFmpeg process exited with status: {}", status).into());
    }

    let metadata = std::fs::metadata(&args.output)?;
    println!(
        "Successfully exported video to '{}' ({:.2} MB)",
        args.output.display(),
        metadata.len() as f64 / (1024.0 * 1024.0)
    );

    Ok(())
}
