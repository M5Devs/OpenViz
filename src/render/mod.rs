pub mod context;
pub mod error;
pub mod pipeline;
#[cfg(test)]
mod tests;

pub use context::GpuContext;
pub use error::RenderError;
pub use pipeline::{Uniforms, Vertex2D};

use crate::audio::AudioFeatures;
use crate::scene::node::{NodeType, SceneNode};
use std::sync::Arc;
use wgpu::util::DeviceExt;

pub struct OffscreenRenderer {
    width: u32,
    height: u32,
    gpu_context: Arc<GpuContext>,
    render_pipeline: wgpu::RenderPipeline,
    bind_group_layout: wgpu::BindGroupLayout,
    render_target: wgpu::Texture,
    render_target_view: wgpu::TextureView,
    staging_buffer: wgpu::Buffer,
    unpadded_bytes_per_row: u32,
    padded_bytes_per_row: u32,
}

struct BarParams {
    count: usize,
    inner_radius: f32,
    width: f32,
    is_radial: bool,
    color_start: [f32; 4],
    color_end: [f32; 4],
}

impl OffscreenRenderer {
    pub fn new(width: u32, height: u32) -> Result<Self, RenderError> {
        if width == 0 || height == 0 {
            return Err(RenderError::InvalidDimensions(width, height));
        }

        let gpu_context = pollster::block_on(GpuContext::init_headless())?;
        let gpu_context = Arc::new(gpu_context);

        let bind_group_layout =
            gpu_context
                .device
                .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                    label: Some("Uniform Bind Group Layout"),
                    entries: &[wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        count: None,
                    }],
                });

        let render_pipeline = pipeline::create_render_pipeline(
            &gpu_context.device,
            &bind_group_layout,
            wgpu::TextureFormat::Rgba8UnormSrgb,
        );

        let (
            render_target,
            render_target_view,
            staging_buffer,
            unpadded_bytes_per_row,
            padded_bytes_per_row,
        ) = Self::create_buffers(&gpu_context.device, width, height);

        Ok(Self {
            width,
            height,
            gpu_context,
            render_pipeline,
            bind_group_layout,
            render_target,
            render_target_view,
            staging_buffer,
            unpadded_bytes_per_row,
            padded_bytes_per_row,
        })
    }

    fn create_buffers(
        device: &wgpu::Device,
        width: u32,
        height: u32,
    ) -> (wgpu::Texture, wgpu::TextureView, wgpu::Buffer, u32, u32) {
        let texture_desc = wgpu::TextureDescriptor {
            label: Some("Offscreen Render Target"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        };
        let render_target = device.create_texture(&texture_desc);
        let render_target_view = render_target.create_view(&wgpu::TextureViewDescriptor::default());

        let unpadded_bytes_per_row = width * 4;
        let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT; // 256
        let padded_bytes_per_row_padding = (align - unpadded_bytes_per_row % align) % align;
        let padded_bytes_per_row = unpadded_bytes_per_row + padded_bytes_per_row_padding;

        let buffer_size = (padded_bytes_per_row * height) as wgpu::BufferAddress;
        let staging_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Offscreen Staging Buffer"),
            size: buffer_size,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });

        (
            render_target,
            render_target_view,
            staging_buffer,
            unpadded_bytes_per_row,
            padded_bytes_per_row,
        )
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        if width == 0 || height == 0 || (width == self.width && height == self.height) {
            return;
        }
        self.width = width;
        self.height = height;

        let (
            render_target,
            render_target_view,
            staging_buffer,
            unpadded_bytes_per_row,
            padded_bytes_per_row,
        ) = Self::create_buffers(&self.gpu_context.device, width, height);

        self.render_target = render_target;
        self.render_target_view = render_target_view;
        self.staging_buffer = staging_buffer;
        self.unpadded_bytes_per_row = unpadded_bytes_per_row;
        self.padded_bytes_per_row = padded_bytes_per_row;
    }

    pub fn render_frame(
        &mut self,
        scene: &crate::scene::node::SceneNode,
        features: &AudioFeatures,
        clear_color: [f32; 4],
    ) -> Result<(), RenderError> {
        let mut encoder =
            self.gpu_context
                .device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("Render Frame Encoder"),
                });

        {
            let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Render Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &self.render_target_view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: clear_color[0] as f64,
                            g: clear_color[1] as f64,
                            b: clear_color[2] as f64,
                            a: clear_color[3] as f64,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });

            render_pass.set_pipeline(&self.render_pipeline);

            // Apply audio bindings recursively to a cloned scene node before drawing
            let mut animated_scene = scene.clone();
            animated_scene.apply_bindings(features);

            let parent_matrix = [
                [1.0, 0.0, 0.0, 0.0],
                [0.0, 1.0, 0.0, 0.0],
                [0.0, 0.0, 1.0, 0.0],
                [0.0, 0.0, 0.0, 1.0],
            ];

            self.render_node(
                &mut render_pass,
                &animated_scene,
                features,
                &parent_matrix,
                1.0,
            );
        }

        self.gpu_context.queue.submit(Some(encoder.finish()));
        Ok(())
    }

    fn render_node(
        &self,
        render_pass: &mut wgpu::RenderPass,
        node: &SceneNode,
        features: &AudioFeatures,
        parent_matrix: &[[f32; 4]; 4],
        parent_opacity: f32,
    ) {
        let combined_opacity = parent_opacity * node.transform.opacity;
        let local_matrix = self.compute_node_matrix(node);
        let world_matrix = multiply_mat4(parent_matrix, &local_matrix);

        match &node.node_type {
            NodeType::Group { children } => {
                for child in children {
                    self.render_node(
                        render_pass,
                        child,
                        features,
                        &world_matrix,
                        combined_opacity,
                    );
                }
            }
            NodeType::Bars {
                count,
                inner_radius,
                width,
                is_radial,
                color_start,
                color_end,
            } => {
                let bar_params = BarParams {
                    count: *count,
                    inner_radius: *inner_radius,
                    width: *width,
                    is_radial: *is_radial,
                    color_start: *color_start,
                    color_end: *color_end,
                };
                self.draw_bars(
                    render_pass,
                    &bar_params,
                    features,
                    &world_matrix,
                    combined_opacity,
                );
            }
            _ => {
                // Default quad for Image / Text / Particles / Generic nodes
                self.draw_quad(
                    render_pass,
                    [1.0, 1.0, 1.0, 1.0],
                    [1.0, 1.0, 1.0, 1.0],
                    0,
                    &world_matrix,
                    combined_opacity,
                );
            }
        }
    }

    fn compute_node_matrix(&self, node: &SceneNode) -> [[f32; 4]; 4] {
        let pos = node.transform.position;
        let scale = node.transform.scale;
        let rot = node.transform.rotation;

        let cos = rot.cos();
        let sin = rot.sin();

        // 2D Affine transformation matrix in column-major 4x4 layout
        [
            [scale[0] * cos, scale[0] * sin, 0.0, 0.0],
            [-scale[1] * sin, scale[1] * cos, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [pos[0], pos[1], 0.0, 1.0],
        ]
    }

    fn draw_bars(
        &self,
        render_pass: &mut wgpu::RenderPass,
        bar_params: &BarParams,
        features: &AudioFeatures,
        world_matrix: &[[f32; 4]; 4],
        opacity: f32,
    ) {
        if bar_params.count == 0 {
            return;
        }

        let spectrum = &features.raw_spectrum;

        if bar_params.is_radial {
            for i in 0..bar_params.count {
                let magnitude = if i < spectrum.len() { spectrum[i] } else { 0.0 };

                let height = (magnitude * 1.5).clamp(0.02, 1.0);
                let angle = (i as f32 / bar_params.count as f32) * 2.0 * std::f32::consts::PI;
                let r_mid = bar_params.inner_radius + height / 2.0;
                let center_x = angle.cos() * r_mid;
                let center_y = angle.sin() * r_mid;
                let rot_angle = angle - std::f32::consts::FRAC_PI_2;

                let cos_rot = rot_angle.cos();
                let sin_rot = rot_angle.sin();

                let bar_width = bar_params.width;
                let bar_height = height;

                let bar_local_matrix = [
                    [bar_width * cos_rot, bar_width * sin_rot, 0.0, 0.0],
                    [-bar_height * sin_rot, bar_height * cos_rot, 0.0, 0.0],
                    [0.0, 0.0, 1.0, 0.0],
                    [center_x, center_y, 0.0, 1.0],
                ];

                let final_matrix = multiply_mat4(world_matrix, &bar_local_matrix);

                self.draw_quad(
                    render_pass,
                    bar_params.color_start,
                    bar_params.color_end,
                    1, // Linear gradient
                    &final_matrix,
                    opacity,
                );
            }
        } else {
            let total_width = 1.8f32; // Fit nicely within clip space
            let step = total_width / bar_params.count as f32;

            for i in 0..bar_params.count {
                let magnitude = if i < spectrum.len() { spectrum[i] } else { 0.0 };

                let height = (magnitude * 1.5).clamp(0.02, 1.0);
                let x_pos = -total_width / 2.0 + i as f32 * step + step / 2.0;
                let y_pos = 0.0;

                let bar_local_matrix = [
                    [bar_params.width.max(step * 0.8), 0.0, 0.0, 0.0],
                    [0.0, height, 0.0, 0.0],
                    [0.0, 0.0, 1.0, 0.0],
                    [x_pos, y_pos, 0.0, 1.0],
                ];

                let final_matrix = multiply_mat4(world_matrix, &bar_local_matrix);

                self.draw_quad(
                    render_pass,
                    bar_params.color_start,
                    bar_params.color_end,
                    1, // Linear gradient
                    &final_matrix,
                    opacity,
                );
            }
        }
    }

    fn draw_quad(
        &self,
        render_pass: &mut wgpu::RenderPass,
        color_start: [f32; 4],
        color_end: [f32; 4],
        fill_type: u32,
        transform: &[[f32; 4]; 4],
        opacity: f32,
    ) {
        let vertices = [
            Vertex2D {
                position: [-0.5, -0.5],
                color: [1.0, 1.0, 1.0, 1.0],
                uv: [0.0, 0.0],
            },
            Vertex2D {
                position: [0.5, -0.5],
                color: [1.0, 1.0, 1.0, 1.0],
                uv: [1.0, 0.0],
            },
            Vertex2D {
                position: [0.5, 0.5],
                color: [1.0, 1.0, 1.0, 1.0],
                uv: [1.0, 1.0],
            },
            Vertex2D {
                position: [-0.5, -0.5],
                color: [1.0, 1.0, 1.0, 1.0],
                uv: [0.0, 0.0],
            },
            Vertex2D {
                position: [0.5, 0.5],
                color: [1.0, 1.0, 1.0, 1.0],
                uv: [1.0, 1.0],
            },
            Vertex2D {
                position: [-0.5, 0.5],
                color: [1.0, 1.0, 1.0, 1.0],
                uv: [0.0, 1.0],
            },
        ];

        let vertex_buffer =
            self.gpu_context
                .device
                .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("Quad Vertex Buffer"),
                    contents: bytemuck::cast_slice(&vertices),
                    usage: wgpu::BufferUsages::VERTEX,
                });

        let aspect_ratio = self.width as f32 / self.height as f32;

        let uniforms = Uniforms {
            transform: *transform,
            color_start,
            color_end,
            fill_type,
            aspect_ratio,
            opacity,
            _padding: 0,
        };

        let uniform_buffer =
            self.gpu_context
                .device
                .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("Uniform Buffer"),
                    contents: bytemuck::bytes_of(&uniforms),
                    usage: wgpu::BufferUsages::UNIFORM,
                });

        let bind_group = self
            .gpu_context
            .device
            .create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("Render Bind Group"),
                layout: &self.bind_group_layout,
                entries: &[wgpu::BindGroupEntry {
                    binding: 0,
                    resource: uniform_buffer.as_entire_binding(),
                }],
            });

        render_pass.set_bind_group(0, &bind_group, &[]);
        render_pass.set_vertex_buffer(0, vertex_buffer.slice(..));
        render_pass.draw(0..6, 0..1);
    }

    pub fn capture_pixels(&self) -> Result<Vec<u8>, RenderError> {
        let mut encoder =
            self.gpu_context
                .device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("Capture Pixels Encoder"),
                });

        encoder.copy_texture_to_buffer(
            wgpu::ImageCopyTexture {
                texture: &self.render_target,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::ImageCopyBuffer {
                buffer: &self.staging_buffer,
                layout: wgpu::ImageDataLayout {
                    offset: 0,
                    bytes_per_row: Some(self.padded_bytes_per_row),
                    rows_per_image: Some(self.height),
                },
            },
            wgpu::Extent3d {
                width: self.width,
                height: self.height,
                depth_or_array_layers: 1,
            },
        );

        self.gpu_context.queue.submit(Some(encoder.finish()));

        let buffer_slice = self.staging_buffer.slice(..);
        let (sender, receiver) = std::sync::mpsc::channel();

        buffer_slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = sender.send(result);
        });

        self.gpu_context.device.poll(wgpu::Maintain::Wait);

        receiver
            .recv()
            .map_err(|e| RenderError::CaptureFailed(e.to_string()))?
            .map_err(RenderError::BufferAsync)?;

        let padded_data = buffer_slice.get_mapped_range();
        let mut unpadded_bytes = Vec::with_capacity((self.width * self.height * 4) as usize);

        for chunk in padded_data.chunks_exact(self.padded_bytes_per_row as usize) {
            unpadded_bytes.extend_from_slice(&chunk[..self.unpadded_bytes_per_row as usize]);
        }

        drop(padded_data);
        self.staging_buffer.unmap();

        Ok(unpadded_bytes)
    }
}

fn multiply_mat4(a: &[[f32; 4]; 4], b: &[[f32; 4]; 4]) -> [[f32; 4]; 4] {
    let mut result = [[0.0f32; 4]; 4];
    for col in 0..4 {
        for row in 0..4 {
            result[col][row] = a[0][row] * b[col][0]
                + a[1][row] * b[col][1]
                + a[2][row] * b[col][2]
                + a[3][row] * b[col][3];
        }
    }
    result
}
