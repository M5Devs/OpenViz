struct Particle {
  position: vec2<f32>,
  velocity: vec2<f32>,
  life: f32,
  size: f32,
};

struct AudioParams {
  bass: f32,
  beat: f32,
  deltaTime: f32,
  padding: f32,
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> audio: AudioParams;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let index = global_id.x;
  if (index >= arrayLength(&particles)) {
    return;
  }

  var p = particles[index];
  p.life -= audio.deltaTime;

  if (p.life <= 0.0) {
    p.life = 1.0;
    p.position = vec2<f32>(0.0, 0.0);
    let angle = f32(index) * 0.1;
    p.velocity = vec2<f32>(cos(angle), sin(angle)) * (50.0 + audio.bass * 100.0);
  } else {
    p.position += p.velocity * audio.deltaTime;
    if (audio.beat > 0.5) {
      p.velocity *= 1.2;
    }
  }

  particles[index] = p;
}
