struct Uniforms {
    transform: mat4x4<f32>,
    color_start: vec4<f32>,
    color_end: vec4<f32>,
    // fill_type: 0 = solid (color_start), 1 = linear gradient (vertically/UV y), 2 = radial gradient
    fill_type: u32,
    aspect_ratio: f32,
    opacity: f32,
    _padding: u32,
}

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;

struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) color: vec4<f32>,
    @location(2) uv: vec2<f32>,
}

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) uv: vec2<f32>,
}

@vertex
fn vs_main(model: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.uv = model.uv;
    out.color = model.color;

    // Position transformed by 4x4 matrix
    let pos4 = uniforms.transform * vec4<f32>(model.position, 0.0, 1.0);
    out.clip_position = pos4;
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    var base_color: vec4<f32>;

    if (uniforms.fill_type == 1u) {
        // Linear gradient along UV y-axis
        let t = clamp(in.uv.y, 0.0, 1.0);
        base_color = mix(uniforms.color_start, uniforms.color_end, t);
    } else if (uniforms.fill_type == 2u) {
        // Radial gradient from center (0.5, 0.5)
        let dist = length(in.uv - vec2<f32>(0.5, 0.5)) * 2.0;
        let t = clamp(dist, 0.0, 1.0);
        base_color = mix(uniforms.color_start, uniforms.color_end, t);
    } else {
        // Solid color: combine vertex color or color_start
        base_color = uniforms.color_start * in.color;
    }

    base_color.a = base_color.a * uniforms.opacity;
    return base_color;
}
