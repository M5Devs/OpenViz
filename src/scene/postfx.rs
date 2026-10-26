use serde::{Deserialize, Serialize};

use crate::scene::binding::{AudioBinding, BindingTarget};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum PostEffect {
    Bloom {
        threshold: f32,
        intensity: f32,
        radius: f32,
    },
    ChromaticAberration {
        amount: f32,
        angle: f32,
    },
    CameraShake {
        intensity: f32,
        speed: f32,
    },
    MotionTrails {
        decay: f32,
    },
    Vignette {
        intensity: f32,
        roundness: f32,
    },
}

impl PostEffect {
    pub fn apply_binding(
        &mut self,
        binding: &AudioBinding,
        features: &crate::audio::AudioFeatures,
    ) {
        let val = binding.evaluate(features);
        match (self, &binding.target) {
            (PostEffect::Bloom { intensity, .. }, BindingTarget::BloomIntensity) => {
                *intensity = val;
            }
            (PostEffect::Bloom { threshold, .. }, BindingTarget::BloomThreshold) => {
                *threshold = val;
            }
            (PostEffect::Bloom { radius, .. }, BindingTarget::BloomRadius) => {
                *radius = val;
            }
            (
                PostEffect::ChromaticAberration { amount, .. },
                BindingTarget::ChromaticAberrationAmount,
            ) => {
                *amount = val;
            }
            (
                PostEffect::ChromaticAberration { angle, .. },
                BindingTarget::ChromaticAberrationAngle,
            ) => {
                *angle = val;
            }
            (PostEffect::CameraShake { intensity, .. }, BindingTarget::CameraShakeIntensity) => {
                *intensity = val;
            }
            (PostEffect::CameraShake { speed, .. }, BindingTarget::CameraShakeSpeed) => {
                *speed = val;
            }
            (PostEffect::MotionTrails { decay }, BindingTarget::MotionTrailsDecay) => {
                *decay = val;
            }
            (PostEffect::Vignette { intensity, .. }, BindingTarget::VignetteIntensity) => {
                *intensity = val;
            }
            (PostEffect::Vignette { roundness, .. }, BindingTarget::VignetteRoundness) => {
                *roundness = val;
            }
            _ => {}
        }
    }

    pub fn apply_bindings(
        &mut self,
        bindings: &[AudioBinding],
        features: &crate::audio::AudioFeatures,
    ) {
        for binding in bindings {
            self.apply_binding(binding, features);
        }
    }
}
