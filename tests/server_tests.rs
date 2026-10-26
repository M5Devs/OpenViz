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
