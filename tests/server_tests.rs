use axum::{
    body::Body,
    http::{header, Request, StatusCode},
};
use openviz_core::server::create_router;
use tower::ServiceExt;

#[tokio::test]
async fn test_get_index_returns_200_html() {
    let app = create_router();

    let response = app
        .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let content_type = response.headers().get(header::CONTENT_TYPE).unwrap();
    assert!(content_type.to_str().unwrap().contains("text/html"));

    let body_bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let body_str = String::from_utf8(body_bytes.to_vec()).unwrap();
    assert!(body_str.contains("OpenViz Pro Studio"));
}

#[tokio::test]
async fn test_get_health_returns_200_json() {
    let app = create_router();

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let content_type = response.headers().get(header::CONTENT_TYPE).unwrap();
    assert!(content_type.to_str().unwrap().contains("application/json"));

    let body_bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["status"], "ok");
    assert_eq!(json["version"], "0.1.0");
}

#[tokio::test]
async fn test_get_default_template_returns_200_json() {
    let app = create_router();

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/templates/default")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let template: openviz_core::template::Template = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(template.name, "Default Spectrum");
    assert_eq!(template.author, "OpenViz");
}

#[tokio::test]
async fn test_post_upload_returns_200_json() {
    let app = create_router();

    let boundary = "------------------------1234567890";
    let body = format!(
        "--{}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"test.mp3\"\r\nContent-Type: audio/mpeg\r\n\r\nFake MP3 Data\r\n--{}--\r\n",
        boundary, boundary
    );

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/upload")
                .header(
                    header::CONTENT_TYPE,
                    format!("multipart/form-data; boundary={}", boundary),
                )
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
    assert!(json["file_path"]
        .as_str()
        .unwrap()
        .starts_with("static/uploads/"));
    assert_eq!(json["filename"], "test.mp3");
}

#[tokio::test]
async fn test_studio_export_request_deserialization_and_template_schema() {
    let studio_payload_json = serde_json::json!({
        "audio_path": "static/uploads/test.mp3",
        "template": {
            "schema_version": "openviz/1",
            "name": "Studio Spectrum",
            "author": "OpenViz Studio User",
            "canvas_aspect": "16:9",
            "clear_color": [0.05, 0.05, 0.08, 1.0],
            "root": {
                "id": "root",
                "node_type": {
                    "type": "Group",
                    "children": [
                        {
                            "id": "radial_bars_1",
                            "node_type": {
                                "type": "Bars",
                                "count": 64,
                                "inner_radius": 0.25,
                                "width": 0.015,
                                "is_radial": true,
                                "color_start": [0.1, 0.8, 1.0, 1.0],
                                "color_end": [1.0, 0.2, 0.8, 1.0]
                            },
                            "transform": {
                                "position": [0.0, 0.0],
                                "scale": [1.0, 1.0],
                                "rotation": 0.0,
                                "opacity": 1.0
                            },
                            "bindings": [
                                {
                                    "source": "Bass",
                                    "target": "BarHeight",
                                    "curve": "Linear",
                                    "output_range": [0.5, 2.5]
                                }
                            ]
                        },
                        {
                            "id": "center_logo_1",
                            "node_type": {
                                "type": "Image",
                                "asset_id": "logo.png"
                            },
                            "transform": {
                                "position": [0.0, 0.0],
                                "scale": [1.0, 1.0],
                                "rotation": 0.0,
                                "opacity": 1.0
                            },
                            "bindings": [
                                {
                                    "source": "Bass",
                                    "target": "ScaleUniform",
                                    "curve": "Linear",
                                    "output_range": [1.0, 1.3]
                                }
                            ]
                        }
                    ]
                },
                "transform": {
                    "position": [0.0, 0.0],
                    "scale": [1.0, 1.0],
                    "rotation": 0.0,
                    "opacity": 1.0
                },
                "bindings": []
            },
            "post_effects": [
                {
                    "type": "Bloom",
                    "threshold": 0.7,
                    "intensity": 1.5,
                    "radius": 5.0
                }
            ]
        },
        "effects": {
            "slowed": true,
            "nightcore": false,
            "bass_boost_db": 6.5,
            "reverb": 0.4,
            "eight_d": true
        },
        "width": 1920,
        "height": 1080,
        "fps": 60
    });

    let json_str = studio_payload_json.to_string();
    let export_req: openviz_core::server::routes::ExportRequest =
        serde_json::from_str(&json_str).expect("Failed to deserialize Studio ExportRequest");

    assert_eq!(export_req.audio_path, "static/uploads/test.mp3");
    assert_eq!(export_req.template.name, "Studio Spectrum");
    assert_eq!(export_req.width, 1920);
    assert_eq!(export_req.height, 1080);
    assert_eq!(export_req.fps, 60);

    let fx = export_req.effects.expect("Effects expected");
    assert!(fx.slowed);
    assert!(!fx.nightcore);
    assert_eq!(fx.bass_boost_db, Some(6.5));
    assert_eq!(fx.reverb, Some(0.4));
    assert!(fx.eight_d);

    if let openviz_core::scene::node::NodeType::Group { ref children } =
        export_req.template.root.node_type
    {
        assert_eq!(children.len(), 2);
        if let openviz_core::scene::node::NodeType::Bars {
            inner_radius,
            width,
            ..
        } = children[0].node_type
        {
            assert_eq!(inner_radius, 0.25);
            assert_eq!(width, 0.015);
        } else {
            panic!("Expected Bars node for first child");
        }
    } else {
        panic!("Expected Group node for root");
    }
}

#[tokio::test]
async fn test_post_upload_large_file_over_2mb() {
    let app = create_router();

    let boundary = "------------------------1234567890";
    let header_part = format!(
        "--{}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"large.mp3\"\r\nContent-Type: audio/mpeg\r\n\r\n",
        boundary
    );
    let footer_part = format!("\r\n--{}--\r\n", boundary);

    // Create a 2.5MB payload (exceeding Axum's default 2MB limit)
    let padding_size = 2_500_000;
    let mut body_bytes = Vec::with_capacity(header_part.len() + padding_size + footer_part.len());
    body_bytes.extend_from_slice(header_part.as_bytes());
    body_bytes.resize(header_part.len() + padding_size, b'A');
    body_bytes.extend_from_slice(footer_part.as_bytes());

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/upload")
                .header(
                    header::CONTENT_TYPE,
                    format!("multipart/form-data; boundary={}", boundary),
                )
                .body(Body::from(body_bytes))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let response_body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&response_body).unwrap();
    assert_eq!(json["filename"], "large.mp3");
}
