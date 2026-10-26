use thiserror::Error;

#[derive(Error, Debug)]
pub enum RenderError {
    #[error("Failed to find a suitable GPU adapter")]
    NoAdapterFound,

    #[error("Failed to request GPU device: {0}")]
    RequestDevice(#[from] wgpu::RequestDeviceError),

    #[error("Buffer mapping failed: {0}")]
    BufferAsync(#[from] wgpu::BufferAsyncError),

    #[error("Invalid canvas dimensions: {0}x{1}")]
    InvalidDimensions(u32, u32),

    #[error("Frame capture failed: {0}")]
    CaptureFailed(String),
}
