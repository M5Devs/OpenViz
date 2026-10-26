use serde::{Deserialize, Serialize};

use crate::scene::binding::{AudioBinding, BindingTarget};
use crate::scene::transform::Transform;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum NodeType {
    Group {
        children: Vec<SceneNode>,
    },
    Bars {
        count: usize,
        inner_radius: f32,
        width: f32,
        is_radial: bool,
        color_start: [f32; 4],
        color_end: [f32; 4],
    },
    Image {
        asset_id: String,
    },
    Particles {
        rate: f32,
        max_count: usize,
        lifetime: [f32; 2],
        speed: [f32; 2],
    },
    Text {
        text: String,
        font_asset_id: Option<String>,
        size: f32,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SceneNode {
    pub id: String,
    pub node_type: NodeType,
    pub transform: Transform,
    pub bindings: Vec<AudioBinding>,
}

impl SceneNode {
    pub fn apply_bindings(&mut self, features: &crate::audio::AudioFeatures) {
        for binding in &self.bindings {
            let val = binding.evaluate(features);
            match binding.target {
                BindingTarget::ScaleUniform => {
                    self.transform.scale = [val, val];
                }
                BindingTarget::ScaleX => {
                    self.transform.scale[0] = val;
                }
                BindingTarget::ScaleY => {
                    self.transform.scale[1] = val;
                }
                BindingTarget::Rotation => {
                    self.transform.rotation = val;
                }
                BindingTarget::Opacity => {
                    self.transform.opacity = val;
                }
                BindingTarget::BarHeight => {
                    self.transform.scale[1] = val;
                }
                BindingTarget::EmitBurst => {
                    if let NodeType::Particles { ref mut rate, .. } = self.node_type {
                        *rate = val;
                    }
                }
                _ => {}
            }
        }

        if let NodeType::Group { ref mut children } = self.node_type {
            for child in children {
                child.apply_bindings(features);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::AudioFeatures;
    use crate::scene::binding::{BindingSource, MappingCurve};

    #[test]
    fn test_apply_bindings_scale_uniform() {
        let mut node = SceneNode {
            id: "node1".to_string(),
            node_type: NodeType::Bars {
                count: 10,
                inner_radius: 5.0,
                width: 2.0,
                is_radial: false,
                color_start: [1.0, 0.0, 0.0, 1.0],
                color_end: [0.0, 1.0, 0.0, 1.0],
            },
            transform: Transform::default(),
            bindings: vec![AudioBinding {
                source: BindingSource::Bass,
                target: BindingTarget::ScaleUniform,
                curve: MappingCurve::Linear,
                output_range: [1.0, 2.0],
            }],
        };

        let features = AudioFeatures {
            bass: 0.5,
            mid: 0.0,
            high: 0.0,
            raw_spectrum: vec![],
            beat: false,
        };

        node.apply_bindings(&features);

        assert_eq!(node.transform.scale, [1.5, 1.5]);
    }

    #[test]
    fn test_apply_bindings_recursive_group() {
        let child = SceneNode {
            id: "child_img".to_string(),
            node_type: NodeType::Image {
                asset_id: "bg.png".to_string(),
            },
            transform: Transform::default(),
            bindings: vec![AudioBinding {
                source: BindingSource::Mid,
                target: BindingTarget::ScaleX,
                curve: MappingCurve::Linear,
                output_range: [0.0, 10.0],
            }],
        };

        let mut root = SceneNode {
            id: "root_group".to_string(),
            node_type: NodeType::Group {
                children: vec![child],
            },
            transform: Transform::default(),
            bindings: vec![],
        };

        let features = AudioFeatures {
            bass: 0.0,
            mid: 0.6,
            high: 0.0,
            raw_spectrum: vec![],
            beat: false,
        };

        root.apply_bindings(&features);

        if let NodeType::Group { children } = &root.node_type {
            assert_eq!(children[0].transform.scale[0], 6.0);
        } else {
            panic!("Expected Group node");
        }
    }
}
