use openviz_core::template::Template;
use std::fs;
use std::process::Command;

#[test]
fn test_cli_help() {
    let output = Command::new(env!("CARGO_BIN_EXE_openviz"))
        .arg("--help")
        .output()
        .expect("Failed to execute openviz binary");

    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("OpenViz CLI & Video Export Pipeline"));
    assert!(stdout.contains("export"));
    assert!(stdout.contains("generate-template"));
    assert!(stdout.contains("info"));
}

#[test]
fn test_generate_template_subcommand() {
    let temp_dir = std::env::temp_dir();
    let template_path = temp_dir.join("test_cli_generated.ovz");

    if template_path.exists() {
        let _ = fs::remove_file(&template_path);
    }

    let output = Command::new(env!("CARGO_BIN_EXE_openviz"))
        .arg("generate-template")
        .arg("--output")
        .arg(&template_path)
        .output()
        .expect("Failed to execute openviz generate-template");

    assert!(output.status.success(), "Command failed: {:?}", output);
    assert!(template_path.exists(), "Template file was not created");

    let json_content =
        fs::read_to_string(&template_path).expect("Failed to read created template file");
    assert!(!json_content.is_empty());

    let template = Template::from_json(&json_content);
    assert!(
        template.is_ok(),
        "Failed to deserialize template JSON: {:?}",
        template.err()
    );

    let template = template.unwrap();
    assert_eq!(template.name, "Default Spectrum");

    let _ = fs::remove_file(&template_path);
}

#[test]
fn test_info_subcommand_with_template() {
    let temp_dir = std::env::temp_dir();
    let template_path = temp_dir.join("test_info_generated.ovz");

    let gen_output = Command::new(env!("CARGO_BIN_EXE_openviz"))
        .arg("generate-template")
        .arg("-o")
        .arg(&template_path)
        .output()
        .expect("Failed to generate template");

    assert!(gen_output.status.success());

    let info_output = Command::new(env!("CARGO_BIN_EXE_openviz"))
        .arg("info")
        .arg("--template")
        .arg(&template_path)
        .output()
        .expect("Failed to run info command");

    assert!(info_output.status.success());
    let stdout = String::from_utf8_lossy(&info_output.stdout);
    assert!(stdout.contains("=== Template Info ==="));
    assert!(stdout.contains("Default Spectrum"));

    let _ = fs::remove_file(&template_path);
}
