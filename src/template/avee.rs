use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

use crate::scene::binding::{AudioBinding, BindingSource, BindingTarget, MappingCurve};

#[derive(Debug, thiserror::Error)]
pub enum AveeImportError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("ZIP error: {0}")]
    Zip(#[from] zip::result::ZipError),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Invalid format: {0}")]
    InvalidFormat(String),

    #[error("Path traversal detected: {0}")]
    PathTraversal(String),
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct RawProp {
    #[serde(default)]
    pub v: Option<Value>,

    #[serde(default)]
    pub t: Option<String>,

    #[serde(default)]
    pub o: Option<i32>,

    #[serde(default)]
    pub tag: Option<String>,

    #[serde(default)]
    pub children: BTreeMap<String, RawProp>,
}

#[derive(Deserialize)]
struct RawPropEnvelope {
    #[serde(default)]
    pub v: Option<Value>,

    #[serde(default)]
    pub t: Option<String>,

    #[serde(default)]
    pub o: Option<i32>,

    #[serde(default)]
    pub tag: Option<String>,

    #[serde(default)]
    pub children: BTreeMap<String, RawProp>,

    #[serde(flatten)]
    pub extra: BTreeMap<String, RawProp>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum RawPropHelper {
    Envelope(RawPropEnvelope),
    Primitive(Value),
}

impl<'de> Deserialize<'de> for RawProp {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let helper = RawPropHelper::deserialize(deserializer)?;
        Ok(match helper {
            RawPropHelper::Envelope(mut env) => {
                for (k, v) in env.extra {
                    env.children.entry(k).or_insert(v);
                }
                RawProp {
                    v: env.v,
                    t: env.t,
                    o: env.o,
                    tag: env.tag,
                    children: env.children,
                }
            }
            RawPropHelper::Primitive(val) => {
                let v = if val.is_null() { None } else { Some(val) };
                RawProp {
                    v,
                    t: None,
                    o: None,
                    tag: None,
                    children: BTreeMap::new(),
                }
            }
        })
    }
}

#[derive(Deserialize)]
#[serde(untagged)]
enum CompositionsHelper {
    Seq(Vec<RawProp>),
    One(RawProp),
}

fn deserialize_compositions<'de, D>(deserializer: D) -> Result<Vec<RawProp>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let opt = Option::<CompositionsHelper>::deserialize(deserializer)?;
    Ok(match opt {
        Some(CompositionsHelper::Seq(vec)) => vec,
        Some(CompositionsHelper::One(prop)) => vec![prop],
        None => Vec::new(),
    })
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AveeRoot {
    #[serde(default)]
    pub ver: Option<Value>,

    #[serde(default)]
    pub root: Option<RawProp>,

    #[serde(default, deserialize_with = "deserialize_compositions")]
    pub compositions: Vec<RawProp>,

    #[serde(flatten)]
    pub extra: BTreeMap<String, RawProp>,
}

impl RawProp {
    pub fn as_f32(&self) -> Option<f32> {
        if let Some(ref val) = self.v {
            match val {
                Value::Number(n) => n.as_f64().map(|f| f as f32),
                Value::String(s) => s.parse::<f32>().ok(),
                Value::Array(arr) => arr.first().and_then(|v| match v {
                    Value::Number(n) => n.as_f64().map(|f| f as f32),
                    Value::String(s) => s.parse::<f32>().ok(),
                    _ => None,
                }),
                _ => None,
            }
        } else {
            None
        }
    }

    pub fn as_f32_or(&self, default: f32) -> f32 {
        self.as_f32().unwrap_or(default)
    }

    pub fn as_f32_tuple2(&self) -> Option<[f32; 2]> {
        if let Some(ref val) = self.v {
            match val {
                Value::Array(arr) => {
                    if arr.len() >= 2 {
                        let x = arr[0]
                            .as_f64()
                            .or_else(|| arr[0].as_str().and_then(|s| s.parse().ok()))
                            .unwrap_or(0.0) as f32;
                        let y = arr[1]
                            .as_f64()
                            .or_else(|| arr[1].as_str().and_then(|s| s.parse().ok()))
                            .unwrap_or(0.0) as f32;
                        return Some([x, y]);
                    } else if arr.len() == 1 {
                        let x = arr[0]
                            .as_f64()
                            .or_else(|| arr[0].as_str().and_then(|s| s.parse().ok()))
                            .unwrap_or(0.0) as f32;
                        return Some([x, x]);
                    }
                }
                Value::Number(n) => {
                    let v = n.as_f64().unwrap_or(0.0) as f32;
                    return Some([v, v]);
                }
                _ => {}
            }
        }
        None
    }

    pub fn as_f32_tuple2_or(&self, default: [f32; 2]) -> [f32; 2] {
        self.as_f32_tuple2().unwrap_or(default)
    }

    pub fn as_i32_or(&self, default: i32) -> i32 {
        if let Some(ref val) = self.v {
            match val {
                Value::Number(n) => n.as_i64().map(|i| i as i32).unwrap_or(default),
                Value::String(s) => s.parse::<i32>().unwrap_or(default),
                _ => default,
            }
        } else {
            default
        }
    }

    pub fn as_bool_or(&self, default: bool) -> bool {
        if let Some(ref val) = self.v {
            match val {
                Value::Bool(b) => *b,
                Value::Number(n) => n.as_i64().map(|i| i != 0).unwrap_or(default),
                Value::String(s) => match s.to_lowercase().as_str() {
                    "true" | "1" => true,
                    "false" | "0" => false,
                    _ => default,
                },
                _ => default,
            }
        } else {
            default
        }
    }

    pub fn as_str(&self) -> Option<String> {
        if let Some(ref val) = self.v {
            match val {
                Value::String(s) => Some(s.clone()),
                Value::Number(n) => Some(n.to_string()),
                _ => None,
            }
        } else {
            None
        }
    }

    pub fn as_color(&self) -> [f32; 4] {
        if let Some(ref val) = self.v {
            match val {
                Value::Number(n) => {
                    let val_i = n.as_i64().unwrap_or(0);
                    let val_u = val_i as u32;
                    let a = ((val_u >> 24) & 0xFF) as f32 / 255.0;
                    let r = ((val_u >> 16) & 0xFF) as f32 / 255.0;
                    let g = ((val_u >> 8) & 0xFF) as f32 / 255.0;
                    let b = (val_u & 0xFF) as f32 / 255.0;
                    return [r, g, b, a];
                }
                Value::Array(arr) => {
                    let floats: Vec<f32> = arr
                        .iter()
                        .filter_map(|v| match v {
                            Value::Number(n) => n.as_f64().map(|f| f as f32),
                            Value::String(s) => s.parse::<f32>().ok(),
                            _ => None,
                        })
                        .collect();

                    if floats.len() >= 4 {
                        let is_255 = floats.iter().any(|&f| f > 1.0);
                        let norm = |f: f32| if is_255 { f / 255.0 } else { f };
                        return [
                            norm(floats[0]),
                            norm(floats[1]),
                            norm(floats[2]),
                            norm(floats[3]),
                        ];
                    } else if floats.len() == 3 {
                        let is_255 = floats.iter().any(|&f| f > 1.0);
                        let norm = |f: f32| if is_255 { f / 255.0 } else { f };
                        return [norm(floats[0]), norm(floats[1]), norm(floats[2]), 1.0];
                    }
                }
                Value::String(s) => {
                    let clean = s.trim_start_matches('#');
                    if clean.len() == 8 {
                        if let Ok(val_u) = u32::from_str_radix(clean, 16) {
                            let a = ((val_u >> 24) & 0xFF) as f32 / 255.0;
                            let r = ((val_u >> 16) & 0xFF) as f32 / 255.0;
                            let g = ((val_u >> 8) & 0xFF) as f32 / 255.0;
                            let b = (val_u & 0xFF) as f32 / 255.0;
                            return [r, g, b, a];
                        }
                    } else if clean.len() == 6 {
                        if let Ok(val_u) = u32::from_str_radix(clean, 16) {
                            let r = ((val_u >> 16) & 0xFF) as f32 / 255.0;
                            let g = ((val_u >> 8) & 0xFF) as f32 / 255.0;
                            let b = (val_u & 0xFF) as f32 / 255.0;
                            return [r, g, b, 1.0];
                        }
                    }
                }
                _ => {}
            }
        }
        [1.0, 1.0, 1.0, 1.0]
    }

    pub fn find_child_measure(&self) -> Option<(&String, &RawProp)> {
        for (key, child) in &self.children {
            if key == "_child"
                || key.starts_with("_child")
                || child.t.as_deref() == Some("_child")
                || child
                    .tag
                    .as_deref()
                    .map(|t| t.contains("measure"))
                    .unwrap_or(false)
            {
                return Some((key, child));
            }
        }
        None
    }

    pub fn extract_audio_binding(&self, target: BindingTarget) -> Option<AudioBinding> {
        let (_, child) = self.find_child_measure()?;

        let measure_what = child
            .children
            .get("measureWhat")
            .and_then(|p| p.as_str())
            .or_else(|| child.as_str())
            .unwrap_or_else(|| "Bass".to_string());

        let source = match measure_what.as_str() {
            "Beat" | "BeatRandomShake" | "ConstantShake" => BindingSource::Beat,
            "Bass" => BindingSource::Bass,
            "Mid" => BindingSource::Mid,
            "High" => BindingSource::High,
            "RMS" | "Rms" => BindingSource::Rms,
            _ => BindingSource::Bass,
        };

        let amount_a = child
            .children
            .get("A")
            .or_else(|| child.children.get("amountA"))
            .or_else(|| child.children.get("lower"))
            .and_then(|p| p.as_f32())
            .unwrap_or(1.0);

        let amount_b = child
            .children
            .get("B")
            .or_else(|| child.children.get("amountB"))
            .or_else(|| child.children.get("upper"))
            .and_then(|p| p.as_f32())
            .unwrap_or(1.3);

        Some(AudioBinding {
            source,
            target,
            curve: MappingCurve::Linear,
            output_range: [amount_a, amount_b],
        })
    }
}

pub struct AveeConverter {
    pub compositions: BTreeMap<usize, RawProp>,
    pub post_effects: Vec<crate::scene::postfx::PostEffect>,
    pub extracted_assets: Vec<String>,
}

impl AveeConverter {
    pub fn new(root: AveeRoot) -> Self {
        let mut compositions = BTreeMap::new();

        // 1. Gather compositions from root.compositions vector
        for (idx, comp) in root.compositions.into_iter().enumerate() {
            compositions.insert(idx, comp);
        }

        // 2. Gather compositions from root.extra or root.root.children
        let mut check_prop_map = |map: &BTreeMap<String, RawProp>| {
            for (key, prop) in map {
                if key.starts_with("composition:") {
                    if let Ok(idx) = key.trim_start_matches("composition:").parse::<usize>() {
                        compositions.entry(idx).or_insert_with(|| prop.clone());
                    }
                } else if prop.t.as_deref() == Some("composition")
                    || prop.tag.as_deref() == Some("composition")
                {
                    if let Some(o) = prop.o {
                        compositions
                            .entry(o as usize)
                            .or_insert_with(|| prop.clone());
                    }
                }
            }
        };

        check_prop_map(&root.extra);
        if let Some(ref root_prop) = root.root {
            check_prop_map(&root_prop.children);
        }

        // If composition 0 is not found, fallback to root_prop or first available in extra
        if let std::collections::btree_map::Entry::Vacant(e) = compositions.entry(0) {
            if let Some(root_prop) = root.root {
                e.insert(root_prop);
            } else {
                let fallback = RawProp {
                    children: root.extra,
                    ..Default::default()
                };
                e.insert(fallback);
            }
        }

        Self {
            compositions,
            post_effects: Vec::new(),
            extracted_assets: Vec::new(),
        }
    }

    pub fn convert_root(
        mut self,
    ) -> (
        crate::scene::node::SceneNode,
        Vec<crate::scene::postfx::PostEffect>,
    ) {
        let root_comp = self.compositions.get(&0).cloned().unwrap_or_default();
        let root_node = self.map_prop_to_node("root", &root_comp, 0);
        (root_node, self.post_effects)
    }

    fn map_prop_to_node(
        &mut self,
        name: &str,
        prop: &RawProp,
        depth: usize,
    ) -> crate::scene::node::SceneNode {
        // Prevent infinite recursion in cyclical composition references
        if depth > 16 {
            return crate::scene::node::SceneNode {
                id: name.to_string(),
                node_type: crate::scene::node::NodeType::Unsupported {
                    raw: "Max composition depth exceeded".to_string(),
                },
                transform: crate::scene::transform::Transform::default(),
                bindings: vec![],
            };
        }

        // Extract transform
        let position = prop
            .children
            .get("position")
            .map(|p| p.as_f32_tuple2_or([0.0, 0.0]))
            .unwrap_or([0.0, 0.0]);
        let scale = prop
            .children
            .get("scale")
            .map(|p| p.as_f32_tuple2_or([1.0, 1.0]))
            .unwrap_or([1.0, 1.0]);
        let rotation = prop
            .children
            .get("rotation")
            .map(|p| p.as_f32_or(0.0))
            .unwrap_or(0.0);
        let opacity = prop
            .children
            .get("alpha")
            .or_else(|| prop.children.get("opacity"))
            .map(|p| p.as_f32_or(1.0))
            .unwrap_or(1.0);

        let transform = crate::scene::transform::Transform {
            position,
            scale,
            rotation,
            opacity,
        };

        // Extract bindings
        let mut bindings = Vec::new();
        if let Some(p) = prop.children.get("scale") {
            if let Some(b) = p.extract_audio_binding(BindingTarget::ScaleUniform) {
                bindings.push(b);
            }
        }
        if let Some(p) = prop.children.get("position") {
            if let Some(b) = p.extract_audio_binding(BindingTarget::CameraShakeIntensity) {
                bindings.push(b);
            }
        }
        if let Some(p) = prop.children.get("rotation") {
            if let Some(b) = p.extract_audio_binding(BindingTarget::Rotation) {
                bindings.push(b);
            }
        }
        if let Some(p) = prop
            .children
            .get("alpha")
            .or_else(|| prop.children.get("opacity"))
        {
            if let Some(b) = p.extract_audio_binding(BindingTarget::Opacity) {
                bindings.push(b);
            }
        }
        if let Some(p) = prop
            .children
            .get("barHeight")
            .or_else(|| prop.children.get("height"))
        {
            if let Some(b) = p.extract_audio_binding(BindingTarget::BarHeight) {
                bindings.push(b);
            }
        }

        // Identify node tag / type
        let tag_type = prop
            .tag
            .clone()
            .or_else(|| prop.t.clone())
            .unwrap_or_else(|| name.to_string());

        // Check composition index references
        let comp_idx = prop
            .children
            .get("sourceCompositionIndex")
            .map(|p| p.as_i32_or(-1))
            .filter(|&idx| idx >= 0)
            .map(|idx| idx as usize)
            .or_else(|| {
                if name.starts_with("composition:") {
                    name.trim_start_matches("composition:")
                        .parse::<usize>()
                        .ok()
                } else {
                    None
                }
            });

        if let Some(idx) = comp_idx {
            if let Some(target_comp) = self.compositions.get(&idx).cloned() {
                let mut children = Vec::new();
                for (c_name, c_prop) in &target_comp.children {
                    children.push(self.map_prop_to_node(c_name, c_prop, depth + 1));
                }
                return crate::scene::node::SceneNode {
                    id: name.to_string(),
                    node_type: crate::scene::node::NodeType::Group { children },
                    transform,
                    bindings,
                };
            }
        }

        // Node mappings
        if tag_type.contains("AudioProvider") {
            // Populates audio provider / frequency bounds or returns a group with children
            let mut children = Vec::new();
            for (c_name, c_prop) in &prop.children {
                if c_name != "position"
                    && c_name != "scale"
                    && c_name != "rotation"
                    && c_name != "alpha"
                {
                    children.push(self.map_prop_to_node(c_name, c_prop, depth + 1));
                }
            }
            return crate::scene::node::SceneNode {
                id: name.to_string(),
                node_type: crate::scene::node::NodeType::Group { children },
                transform,
                bindings,
            };
        } else if tag_type.contains("Bars") || tag_type.contains("Spectrum") {
            let count = prop
                .children
                .get("barCount")
                .or_else(|| prop.children.get("count"))
                .map(|p| p.as_i32_or(64) as usize)
                .unwrap_or(64);
            let width = prop
                .children
                .get("barWidth")
                .or_else(|| prop.children.get("width"))
                .map(|p| p.as_f32_or(2.0))
                .unwrap_or(2.0);
            let shape_path = prop
                .children
                .get("shapePath")
                .or_else(|| prop.children.get("path"))
                .and_then(|p| p.as_str())
                .unwrap_or_default();

            let is_radial = shape_path.contains("Circle")
                || shape_path.contains("Radial")
                || shape_path.contains("circle");
            let inner_radius = if is_radial {
                prop.children
                    .get("radius")
                    .or_else(|| prop.children.get("innerRadius"))
                    .map(|p| p.as_f32_or(10.0))
                    .unwrap_or(10.0)
            } else {
                0.0
            };

            let color_start = prop
                .children
                .get("colorStart")
                .or_else(|| prop.children.get("color"))
                .map(|p| p.as_color())
                .unwrap_or([0.1, 0.8, 1.0, 1.0]);
            let color_end = prop
                .children
                .get("colorEnd")
                .or_else(|| prop.children.get("color"))
                .map(|p| p.as_color())
                .unwrap_or([1.0, 0.2, 0.8, 1.0]);

            return crate::scene::node::SceneNode {
                id: name.to_string(),
                node_type: crate::scene::node::NodeType::Bars {
                    count,
                    inner_radius,
                    width,
                    is_radial,
                    color_start,
                    color_end,
                },
                transform,
                bindings,
            };
        } else if tag_type.contains("Image") || tag_type.contains("Texture") {
            let raw_path = prop
                .children
                .get("image")
                .or_else(|| prop.children.get("path"))
                .or_else(|| prop.children.get("src"))
                .and_then(|p| p.as_str())
                .unwrap_or_else(|| "image.png".to_string());

            let clean_path = raw_path.trim_start_matches("local:").to_string();
            self.extracted_assets.push(clean_path.clone());

            return crate::scene::node::SceneNode {
                id: name.to_string(),
                node_type: crate::scene::node::NodeType::Image {
                    asset_id: clean_path,
                },
                transform,
                bindings,
            };
        } else if tag_type.contains("RgbSplitEffect") {
            let amount = prop
                .children
                .get("amount")
                .or_else(|| prop.children.get("splitAmount"))
                .map(|p| p.as_f32_or(0.02))
                .unwrap_or(0.02);
            let angle = prop
                .children
                .get("angle")
                .map(|p| p.as_f32_or(0.0))
                .unwrap_or(0.0);

            self.post_effects
                .push(crate::scene::postfx::PostEffect::ChromaticAberration { amount, angle });

            return crate::scene::node::SceneNode {
                id: name.to_string(),
                node_type: crate::scene::node::NodeType::Group { children: vec![] },
                transform,
                bindings,
            };
        } else if tag_type.contains("MotionBlurEffect") {
            let decay = prop
                .children
                .get("decay")
                .or_else(|| prop.children.get("amount"))
                .map(|p| p.as_f32_or(0.8))
                .unwrap_or(0.8);

            self.post_effects
                .push(crate::scene::postfx::PostEffect::MotionTrails { decay });

            return crate::scene::node::SceneNode {
                id: name.to_string(),
                node_type: crate::scene::node::NodeType::Group { children: vec![] },
                transform,
                bindings,
            };
        } else if tag_type.contains("BlurEffect") {
            self.post_effects
                .push(crate::scene::postfx::PostEffect::Bloom {
                    threshold: 0.5,
                    intensity: 1.0,
                    radius: 5.0,
                });

            return crate::scene::node::SceneNode {
                id: name.to_string(),
                node_type: crate::scene::node::NodeType::Group { children: vec![] },
                transform,
                bindings,
            };
        } else if tag_type.contains("Text") {
            let text = prop
                .children
                .get("text")
                .and_then(|p| p.as_str())
                .unwrap_or_else(|| "Text".to_string());
            let size = prop
                .children
                .get("size")
                .map(|p| p.as_f32_or(24.0))
                .unwrap_or(24.0);

            return crate::scene::node::SceneNode {
                id: name.to_string(),
                node_type: crate::scene::node::NodeType::Text {
                    text,
                    font_asset_id: None,
                    size,
                },
                transform,
                bindings,
            };
        } else if tag_type.contains("Particles") {
            return crate::scene::node::SceneNode {
                id: name.to_string(),
                node_type: crate::scene::node::NodeType::Particles {
                    rate: 10.0,
                    max_count: 100,
                    lifetime: [1.0, 3.0],
                    speed: [1.0, 5.0],
                },
                transform,
                bindings,
            };
        }

        // If prop has child elements, treat as Group or Unsupported
        let mut children = Vec::new();
        for (c_name, c_prop) in &prop.children {
            if c_name != "position"
                && c_name != "scale"
                && c_name != "rotation"
                && c_name != "alpha"
                && c_name != "opacity"
                && c_name != "barCount"
                && c_name != "barWidth"
                && c_name != "shapePath"
                && c_name != "colorStart"
                && c_name != "colorEnd"
                && c_name != "image"
                && c_name != "path"
                && c_name != "src"
                && c_name != "amount"
                && c_name != "splitAmount"
                && c_name != "decay"
                && c_name != "angle"
                && c_name != "_child"
                && !c_name.starts_with("_child")
            {
                children.push(self.map_prop_to_node(c_name, c_prop, depth + 1));
            }
        }

        if !children.is_empty() {
            crate::scene::node::SceneNode {
                id: name.to_string(),
                node_type: crate::scene::node::NodeType::Group { children },
                transform,
                bindings,
            }
        } else {
            // Unmapped node -> NodeType::Unsupported
            crate::scene::node::SceneNode {
                id: name.to_string(),
                node_type: crate::scene::node::NodeType::Unsupported {
                    raw: format!("{:?}", prop),
                },
                transform,
                bindings,
            }
        }
    }
}

use std::io::{Read, Seek};
use std::path::Path;

pub fn import_viz<P: AsRef<Path>>(path: P) -> Result<crate::template::Template, AveeImportError> {
    let file = std::fs::File::open(path)?;
    import_viz_from_reader(file)
}

pub fn import_viz_from_reader<R: Read + Seek>(
    reader: R,
) -> Result<crate::template::Template, AveeImportError> {
    let mut archive = zip::ZipArchive::new(reader)?;

    let mut scene_json_str = None;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let name = file.name().to_string();

        // Path traversal security check
        if name.contains("..")
            || name.starts_with('/')
            || name.starts_with('\\')
            || name.contains(":\\")
        {
            return Err(AveeImportError::PathTraversal(format!(
                "Security violation: path traversal detected in ZIP entry '{}'",
                name
            )));
        }

        if name.eq_ignore_ascii_case("scene.json") || name.ends_with("/scene.json") {
            let mut content = String::new();
            file.read_to_string(&mut content)?;
            scene_json_str = Some(content);
        }
    }

    let scene_str = scene_json_str.ok_or_else(|| {
        AveeImportError::InvalidFormat("Missing scene.json inside .viz archive".to_string())
    })?;

    let avee_root: AveeRoot = serde_json::from_str(&scene_str)?;

    let converter = AveeConverter::new(avee_root);
    let (root_node, post_effects) = converter.convert_root();

    Ok(crate::template::Template {
        schema_version: "openviz/1".to_string(),
        name: "Imported Avee Template".to_string(),
        author: "Avee Importer".to_string(),
        canvas_aspect: "16:9".to_string(),
        clear_color: [0.05, 0.05, 0.08, 1.0],
        root: root_node,
        post_effects,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    #[test]
    fn test_raw_prop_helpers() {
        let json_data = serde_json::json!({
            "v": [10.5, 20.5],
            "t": "f2"
        });
        let prop: RawProp = serde_json::from_value(json_data).unwrap();
        assert_eq!(prop.as_f32_tuple2(), Some([10.5, 20.5]));
        assert_eq!(prop.as_f32(), Some(10.5));

        let int_prop: RawProp = serde_json::from_value(serde_json::json!({
            "v": 42,
            "t": "i"
        }))
        .unwrap();
        assert_eq!(int_prop.as_i32_or(0), 42);

        let bool_prop: RawProp = serde_json::from_value(serde_json::json!({
            "v": true,
            "t": "b"
        }))
        .unwrap();
        assert_eq!(bool_prop.as_bool_or(false), true);
    }

    #[test]
    fn test_crgba_color_extraction() {
        // ARGB u32 integer: 0xFFFF0000 -> Red = 1.0, Green = 0.0, Blue = 0.0, Alpha = 1.0
        let argb_prop: RawProp = serde_json::from_value(serde_json::json!({
            "v": 4294901760u64,
            "t": "crgba"
        }))
        .unwrap();
        let color = argb_prop.as_color();
        assert!((color[0] - 1.0).abs() < 1e-4); // Red
        assert!((color[1] - 0.0).abs() < 1e-4); // Green
        assert!((color[2] - 0.0).abs() < 1e-4); // Blue
        assert!((color[3] - 1.0).abs() < 1e-4); // Alpha

        // Hex string #00FF00FF -> Red = 0.0, Green = 1.0, Blue = 0.0, Alpha = 1.0
        let hex_prop: RawProp = serde_json::from_value(serde_json::json!({
            "v": "#FF00FF00",
            "t": "crgba"
        }))
        .unwrap();
        let hex_color = hex_prop.as_color();
        assert!((hex_color[3] - 1.0).abs() < 1e-4);
        assert!((hex_color[1] - 1.0).abs() < 1e-4);

        // Array [0.0, 0.5, 1.0, 0.8]
        let arr_prop: RawProp = serde_json::from_value(serde_json::json!({
            "v": [0.0, 0.5, 1.0, 0.8],
            "t": "crgba"
        }))
        .unwrap();
        assert_eq!(arr_prop.as_color(), [0.0, 0.5, 1.0, 0.8]);
    }

    #[test]
    fn test_audio_measure_child_binding() {
        let json_data = serde_json::json!({
            "v": 1.0,
            "t": "mvarf",
            "children": {
                "_child": {
                    "t": "_child",
                    "v": "Beat",
                    "children": {
                        "measureWhat": { "v": "Beat", "t": "s" },
                        "A": { "v": 1.0, "t": "f" },
                        "B": { "v": 1.5, "t": "f" }
                    }
                }
            }
        });

        let prop: RawProp = serde_json::from_value(json_data).unwrap();
        let binding = prop
            .extract_audio_binding(BindingTarget::ScaleUniform)
            .expect("Expected audio binding");

        assert_eq!(binding.source, BindingSource::Beat);
        assert_eq!(binding.target, BindingTarget::ScaleUniform);
        assert_eq!(binding.output_range, [1.0, 1.5]);
    }

    #[test]
    fn test_path_traversal_security() {
        let mut buffer = Vec::new();
        {
            let mut zip = ZipWriter::new(Cursor::new(&mut buffer));
            let options = SimpleFileOptions::default();

            // Malicious entry with ../
            zip.start_file("../evil.txt", options).unwrap();
            zip.write_all(b"malicious content").unwrap();
            zip.finish().unwrap();
        }

        let result = import_viz_from_reader(Cursor::new(buffer));
        assert!(result.is_err());
        match result.unwrap_err() {
            AveeImportError::PathTraversal(msg) => {
                assert!(msg.contains("path traversal"));
            }
            err => panic!("Expected PathTraversal error, got {:?}", err),
        }
    }

    #[test]
    fn test_full_viz_synthetic_import() {
        let scene_json = serde_json::json!({
            "ver": 2,
            "root": {
                "t": "root",
                "children": {
                    "radial_spectrum": {
                        "tag": "Bars",
                        "t": "Bars",
                        "children": {
                            "barCount": { "v": 32, "t": "i" },
                            "barWidth": { "v": 4.0, "t": "f" },
                            "shapePath": { "v": "Circle", "t": "s" },
                            "radius": { "v": 15.0, "t": "f" },
                            "colorStart": { "v": 4294901760u64, "t": "crgba" },
                            "scale": {
                                "v": [1.0, 1.0],
                                "t": "f2",
                                "children": {
                                    "_child": {
                                        "children": {
                                            "measureWhat": { "v": "Bass", "t": "s" },
                                            "A": { "v": 1.0, "t": "f" },
                                            "B": { "v": 2.0, "t": "f" }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    "logo": {
                        "tag": "Image",
                        "t": "Image",
                        "children": {
                            "image": { "v": "local:logo_art.png", "t": "s" }
                        }
                    },
                    "rgb_effect": {
                        "tag": "RgbSplitEffect",
                        "t": "RgbSplitEffect",
                        "children": {
                            "splitAmount": { "v": 0.05, "t": "f" }
                        }
                    }
                }
            }
        });

        let mut buffer = Vec::new();
        {
            let mut zip = ZipWriter::new(Cursor::new(&mut buffer));
            let options = SimpleFileOptions::default();

            zip.start_file("scene.json", options).unwrap();
            zip.write_all(scene_json.to_string().as_bytes()).unwrap();

            zip.start_file("logo_art.png", options).unwrap();
            zip.write_all(b"fake image bytes").unwrap();

            zip.finish().unwrap();
        }

        let template =
            import_viz_from_reader(Cursor::new(buffer)).expect("Failed to import viz template");

        assert_eq!(template.name, "Imported Avee Template");
        assert_eq!(template.post_effects.len(), 1);
        assert_eq!(
            template.post_effects[0],
            crate::scene::postfx::PostEffect::ChromaticAberration {
                amount: 0.05,
                angle: 0.0
            }
        );

        if let crate::scene::node::NodeType::Group { ref children } = template.root.node_type {
            assert_eq!(children.len(), 3);

            // Check Bars node
            let bars_node = children
                .iter()
                .find(|n| n.id == "radial_spectrum")
                .expect("Missing radial_spectrum node");
            if let crate::scene::node::NodeType::Bars {
                count,
                is_radial,
                inner_radius,
                width,
                color_start,
                ..
            } = bars_node.node_type
            {
                assert_eq!(count, 32);
                assert!(is_radial);
                assert_eq!(inner_radius, 15.0);
                assert_eq!(width, 4.0);
                assert!((color_start[0] - 1.0).abs() < 1e-4);
            } else {
                panic!("Expected Bars node");
            }

            assert_eq!(bars_node.bindings.len(), 1);
            assert_eq!(bars_node.bindings[0].source, BindingSource::Bass);
            assert_eq!(bars_node.bindings[0].output_range, [1.0, 2.0]);

            // Check Image node
            let img_node = children
                .iter()
                .find(|n| n.id == "logo")
                .expect("Missing logo node");
            if let crate::scene::node::NodeType::Image { ref asset_id } = img_node.node_type {
                assert_eq!(asset_id, "logo_art.png");
            } else {
                panic!("Expected Image node");
            }
        } else {
            panic!("Expected root group node");
        }
    }

    #[test]
    fn test_resilient_raw_prop_primitives() {
        // Integer 0 primitive
        let int_prop: RawProp = serde_json::from_str("0").unwrap();
        assert_eq!(int_prop.as_i32_or(-1), 0);
        assert_eq!(int_prop.as_f32(), Some(0.0));
        assert_eq!(int_prop.as_bool_or(true), false);

        // String primitive
        let str_prop: RawProp = serde_json::from_str(r#""hello""#).unwrap();
        assert_eq!(str_prop.as_str(), Some("hello".to_string()));

        // Boolean primitive
        let bool_prop: RawProp = serde_json::from_str("true").unwrap();
        assert_eq!(bool_prop.as_bool_or(false), true);

        // Array primitive
        let arr_prop: RawProp = serde_json::from_str("[10.0, 20.0]").unwrap();
        assert_eq!(arr_prop.as_f32_tuple2(), Some([10.0, 20.0]));

        // Object with inline scalar fields
        let inline_obj: RawProp =
            serde_json::from_str(r#"{"t": "Bars", "barCount": 128, "customFlag": true}"#).unwrap();
        assert_eq!(inline_obj.t.as_deref(), Some("Bars"));
        assert_eq!(
            inline_obj.children.get("barCount").unwrap().as_i32_or(0),
            128
        );
        assert_eq!(
            inline_obj
                .children
                .get("customFlag")
                .unwrap()
                .as_bool_or(false),
            true
        );
    }

    #[test]
    fn test_import_viz_resilient_scene_with_scalars_and_primitives() {
        let scene_json = serde_json::json!({
            "ver": 2,
            "compositions": 0, // Integer instead of array
            "root": {
                "t": "root",
                "children": {
                    "bar_element": {
                        "tag": "Bars",
                        "t": "Bars",
                        "barCount": 64, // Primitive integer key directly on object
                        "barWidth": 3.0,
                        "unhandledScalar": 0, // Primitive integer 0 that previously caused serde crash
                        "unhandledBool": false,
                        "unhandledString": "metadata"
                    }
                }
            }
        });

        let mut buffer = Vec::new();
        {
            let mut zip = ZipWriter::new(Cursor::new(&mut buffer));
            let options = SimpleFileOptions::default();

            zip.start_file("scene.json", options).unwrap();
            zip.write_all(scene_json.to_string().as_bytes()).unwrap();
            zip.finish().unwrap();
        }

        let template = import_viz_from_reader(Cursor::new(buffer))
            .expect("import_viz must succeed even with primitive properties and raw scalars");

        assert_eq!(template.name, "Imported Avee Template");
    }
}
