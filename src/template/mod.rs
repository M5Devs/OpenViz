use serde::{Deserialize, Serialize};

use crate::scene::node::SceneNode;
use crate::scene::postfx::PostEffect;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Template {
    pub schema_version: String,
    pub name: String,
    pub author: String,
    pub canvas_aspect: String,
    pub clear_color: [f32; 4],
    pub root: SceneNode,
    pub post_effects: Vec<PostEffect>,
}

impl Template {
    pub fn from_json(json_str: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json_str)
    }

    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string_pretty(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scene::binding::{AudioBinding, BindingSource, BindingTarget, MappingCurve};
    use crate::scene::node::NodeType;
    use crate::scene::transform::Transform;

    #[test]
    fn test_template_serialization_roundtrip() {
        let bars_node = SceneNode {
            id: "bars_1".to_string(),
            node_type: NodeType::Bars {
                count: 64,
                inner_radius: 10.0,
                width: 2.0,
                is_radial: true,
                color_start: [1.0, 0.0, 0.5, 1.0],
                color_end: [0.0, 0.5, 1.0, 1.0],
            },
            transform: Transform::default(),
            bindings: vec![AudioBinding {
                source: BindingSource::Bass,
                target: BindingTarget::BarHeight,
                curve: MappingCurve::Linear,
                output_range: [1.0, 3.0],
            }],
        };

        let image_node = SceneNode {
            id: "logo_img".to_string(),
            node_type: NodeType::Image {
                asset_id: "logo.png".to_string(),
            },
            transform: Transform {
                position: [0.0, 0.0],
                scale: [1.0, 1.0],
                rotation: 0.0,
                opacity: 0.9,
            },
            bindings: vec![AudioBinding {
                source: BindingSource::Beat,
                target: BindingTarget::ScaleUniform,
                curve: MappingCurve::EaseOut,
                output_range: [1.0, 1.2],
            }],
        };

        let root_node = SceneNode {
            id: "root_group".to_string(),
            node_type: NodeType::Group {
                children: vec![bars_node, image_node],
            },
            transform: Transform::default(),
            bindings: vec![],
        };

        let template = Template {
            schema_version: "openviz/1".to_string(),
            name: "Default Spectrum".to_string(),
            author: "OpenViz".to_string(),
            canvas_aspect: "16:9".to_string(),
            clear_color: [0.05, 0.05, 0.08, 1.0],
            root: root_node,
            post_effects: vec![
                PostEffect::Bloom {
                    threshold: 0.7,
                    intensity: 1.5,
                    radius: 5.0,
                },
                PostEffect::ChromaticAberration {
                    amount: 0.02,
                    angle: 0.0,
                },
                PostEffect::Vignette {
                    intensity: 0.3,
                    roundness: 0.8,
                },
            ],
        };

        let json_str = template.to_json().expect("Failed to serialize template");
        assert!(!json_str.is_empty());

        let deserialized: Template =
            Template::from_json(&json_str).expect("Failed to deserialize template");

        assert_eq!(template, deserialized);
    }
}
