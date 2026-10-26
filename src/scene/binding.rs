use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum BindingSource {
    Bass,
    Mid,
    High,
    Beat,
    Rms,
    SpectrumBin(usize),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum BindingTarget {
    ScaleUniform,
    ScaleX,
    ScaleY,
    Rotation,
    Opacity,
    BarHeight,
    EmitBurst,
    BloomThreshold,
    BloomIntensity,
    BloomRadius,
    ChromaticAberrationAmount,
    ChromaticAberrationAngle,
    CameraShakeIntensity,
    CameraShakeSpeed,
    MotionTrailsDecay,
    VignetteIntensity,
    VignetteRoundness,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum MappingCurve {
    Linear,
    Pow(f32),
    SmoothStep,
    EaseOut,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AudioBinding {
    pub source: BindingSource,
    pub target: BindingTarget,
    pub curve: MappingCurve,
    pub output_range: [f32; 2],
}

impl AudioBinding {
    pub fn evaluate(&self, features: &crate::audio::AudioFeatures) -> f32 {
        let raw_val = match &self.source {
            BindingSource::Bass => features.bass,
            BindingSource::Mid => features.mid,
            BindingSource::High => features.high,
            BindingSource::Beat => {
                if features.beat {
                    1.0
                } else {
                    0.0
                }
            }
            BindingSource::Rms => {
                if features.raw_spectrum.is_empty() {
                    0.0
                } else {
                    let sum_sq: f32 = features.raw_spectrum.iter().map(|&x| x * x).sum();
                    (sum_sq / features.raw_spectrum.len() as f32).sqrt()
                }
            }
            BindingSource::SpectrumBin(idx) => {
                features.raw_spectrum.get(*idx).copied().unwrap_or(0.0)
            }
        };

        let t = raw_val.clamp(0.0, 1.0);

        let mapped_t = match self.curve {
            MappingCurve::Linear => t,
            MappingCurve::Pow(p) => t.powf(p),
            MappingCurve::SmoothStep => t * t * (3.0 - 2.0 * t),
            MappingCurve::EaseOut => 1.0 - (1.0 - t) * (1.0 - t),
        };

        self.output_range[0] + mapped_t * (self.output_range[1] - self.output_range[0])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::AudioFeatures;

    #[test]
    fn test_evaluate_bass_linear_and_smoothstep() {
        let features = AudioFeatures {
            bass: 0.5,
            mid: 0.0,
            high: 0.0,
            raw_spectrum: vec![],
            beat: false,
        };

        let linear_binding = AudioBinding {
            source: BindingSource::Bass,
            target: BindingTarget::ScaleUniform,
            curve: MappingCurve::Linear,
            output_range: [1.0, 2.0],
        };

        let smoothstep_binding = AudioBinding {
            source: BindingSource::Bass,
            target: BindingTarget::ScaleUniform,
            curve: MappingCurve::SmoothStep,
            output_range: [1.0, 2.0],
        };

        let val_linear = linear_binding.evaluate(&features);
        let val_smoothstep = smoothstep_binding.evaluate(&features);

        assert!(
            (val_linear - 1.5).abs() < 1e-5,
            "Expected 1.5, got {}",
            val_linear
        );
        assert!(
            (val_smoothstep - 1.5).abs() < 1e-5,
            "Expected 1.5, got {}",
            val_smoothstep
        );

        // Test smoothstep at t = 0.25
        let features_quarter = AudioFeatures {
            bass: 0.25,
            mid: 0.0,
            high: 0.0,
            raw_spectrum: vec![],
            beat: false,
        };
        let val_smoothstep_quarter = smoothstep_binding.evaluate(&features_quarter);
        // t = 0.25 -> 0.25 * 0.25 * (3.0 - 0.5) = 0.0625 * 2.5 = 0.15625
        // output_range [1.0, 2.0] -> 1.0 + 0.15625 = 1.15625
        assert!(
            (val_smoothstep_quarter - 1.15625).abs() < 1e-5,
            "Expected 1.15625, got {}",
            val_smoothstep_quarter
        );
    }

    #[test]
    fn test_evaluate_other_curves_and_sources() {
        let features = AudioFeatures {
            bass: 0.5,
            mid: 0.8,
            high: 0.3,
            raw_spectrum: vec![0.6, 0.8],
            beat: true,
        };

        // Pow(2.0) with bass = 0.5 -> 0.25 -> range [0.0, 10.0] => 2.5
        let pow_binding = AudioBinding {
            source: BindingSource::Bass,
            target: BindingTarget::Opacity,
            curve: MappingCurve::Pow(2.0),
            output_range: [0.0, 10.0],
        };
        assert!((pow_binding.evaluate(&features) - 2.5).abs() < 1e-5);

        // EaseOut with bass = 0.5 -> 1 - (0.5)^2 = 0.75 -> range [0.0, 10.0] => 7.5
        let easeout_binding = AudioBinding {
            source: BindingSource::Bass,
            target: BindingTarget::Rotation,
            curve: MappingCurve::EaseOut,
            output_range: [0.0, 10.0],
        };
        assert!((easeout_binding.evaluate(&features) - 7.5).abs() < 1e-5);

        // Beat source with beat = true -> t = 1.0 -> range [0.0, 5.0] => 5.0
        let beat_binding = AudioBinding {
            source: BindingSource::Beat,
            target: BindingTarget::EmitBurst,
            curve: MappingCurve::Linear,
            output_range: [0.0, 5.0],
        };
        assert!((beat_binding.evaluate(&features) - 5.0).abs() < 1e-5);

        // SpectrumBin(1) -> raw_spectrum[1] = 0.8 -> range [0.0, 1.0] => 0.8
        let bin_binding = AudioBinding {
            source: BindingSource::SpectrumBin(1),
            target: BindingTarget::BarHeight,
            curve: MappingCurve::Linear,
            output_range: [0.0, 1.0],
        };
        assert!((bin_binding.evaluate(&features) - 0.8).abs() < 1e-5);

        // Rms -> sqrt((0.6^2 + 0.8^2) / 2) = sqrt((0.36 + 0.64) / 2) = sqrt(0.5) ≈ 0.70710678
        let rms_binding = AudioBinding {
            source: BindingSource::Rms,
            target: BindingTarget::ScaleX,
            curve: MappingCurve::Linear,
            output_range: [0.0, 1.0],
        };
        let expected_rms = (0.5f32).sqrt();
        assert!((rms_binding.evaluate(&features) - expected_rms).abs() < 1e-5);
    }
}
