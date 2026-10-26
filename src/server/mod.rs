pub mod routes;

use axum::{
    extract::DefaultBodyLimit,
    routing::{get, post},
    Router,
};
use std::net::SocketAddr;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;

pub fn create_router() -> Router {
    Router::new()
        .route("/", get(routes::handle_index))
        .route("/api/health", get(routes::handle_health))
        .route(
            "/api/templates/default",
            get(routes::handle_default_template),
        )
        .route("/api/templates/import-viz", post(routes::handle_import_viz))
        .route("/api/upload", post(routes::handle_upload))
        .route("/api/export", post(routes::handle_export))
        .nest_service("/uploads", ServeDir::new("static/uploads"))
        .nest_service("/downloads", ServeDir::new("static/downloads"))
        .layer(DefaultBodyLimit::max(100 * 1024 * 1024))
        .layer(CorsLayer::permissive())
}

pub async fn run_server(
    host: &str,
    port: u16,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let app = create_router();
    let addr: SocketAddr = format!("{}:{}", host, port).parse()?;

    // Create static directories if they don't exist
    let _ = std::fs::create_dir_all("static/uploads");
    let _ = std::fs::create_dir_all("static/downloads");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!("🚀 OpenViz Studio running at http://localhost:{}", port);
    axum::serve(listener, app).await?;
    Ok(())
}
