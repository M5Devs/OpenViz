use super::*;
use crate::audio::AudioFeatures;
use crate::scene::node::{NodeType, SceneNode};
use crate::scene::transform::Transform;

#[test]
fn test_headless_offscreen_renderer_lifecycle() {
    let renderer_result = OffscreenRenderer::new(64, 64);
    let mut renderer = match renderer_result {
        Ok(r) => r,
        Err(RenderError::NoAdapterFound) => {
            eprintln!("Skipping headless test: No suitable GPU adapter found in environment.");
            return;
        }
        Err(e) => panic!("Failed to initialize OffscreenRenderer: {:?}", e),
    };

    let dummy_scene = SceneNode {
        id: "root".to_string(),
        node_type: NodeType::Bars {
            count: 4,
            inner_radius: 0.0,
            width: 0.1,
            is_radial: false,
            color_start: [1.0, 0.0, 0.0, 1.0],
            color_end: [0.0, 1.0, 0.0, 1.0],
        },
        transform: Transform::default(),
        bindings: vec![],
    };

    let features = AudioFeatures {
        bass: 0.8,
        mid: 0.5,
        high: 0.2,
        raw_spectrum: vec![0.5, 0.6, 0.7, 0.8],
        beat: true,
    };

    renderer
        .render_frame(&dummy_scene, &features, [0.05, 0.05, 0.08, 1.0])
        .expect("render_frame failed");

    let pixels = renderer.capture_pixels().expect("capture_pixels failed");

    assert_eq!(
        pixels.len(),
        64 * 64 * 4,
        "Captured pixels buffer size must equal width * height * 4"
    );
}

#[test]
fn test_offscreen_renderer_resize() {
    let renderer_result = OffscreenRenderer::new(32, 32);
    let mut renderer = match renderer_result {
        Ok(r) => r,
        Err(RenderError::NoAdapterFound) => return,
        Err(e) => panic!("Failed to initialize OffscreenRenderer: {:?}", e),
    };

    renderer.resize(128, 128);

    let dummy_scene = SceneNode {
        id: "root".to_string(),
        node_type: NodeType::Group { children: vec![] },
        transform: Transform::default(),
        bindings: vec![],
    };

    let features = AudioFeatures {
        bass: 0.0,
        mid: 0.0,
        high: 0.0,
        raw_spectrum: vec![],
        beat: false,
    };

    renderer
        .render_frame(&dummy_scene, &features, [0.05, 0.05, 0.08, 1.0])
        .expect("render_frame failed");

    let pixels = renderer.capture_pixels().expect("capture_pixels failed");

    assert_eq!(
        pixels.len(),
        128 * 128 * 4,
        "Captured pixels buffer size after resize must equal new width * height * 4"
    );
}

#[test]
fn test_invalid_dimensions() {
    assert!(OffscreenRenderer::new(0, 100).is_err());
    assert!(OffscreenRenderer::new(100, 0).is_err());
}
