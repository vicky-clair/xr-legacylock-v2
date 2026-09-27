// 阅读器进程测试：从公开双份额样本恢复明文，检查输出并确认已有文件不会被覆盖。
use std::{fs, process::Command};

#[test]
fn recovery_exports_plaintext_and_refuses_overwrite() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../reference/legacy/tests/fixtures");
    let output = std::env::temp_dir().join(format!(
        "legacylock-reader-test-{}-{}.json",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let invoke = || {
        Command::new(env!("CARGO_BIN_EXE_vault-reader"))
            .arg("recovery")
            .arg(root.join("v3-vault.json"))
            .arg(root.join("v3-primary.json"))
            .arg(root.join("v3-secondary.json"))
            .arg(&output)
            .output()
            .unwrap()
    };
    let first = invoke();
    assert!(
        first.status.success(),
        "{}",
        String::from_utf8_lossy(&first.stderr)
    );
    assert!(String::from_utf8_lossy(&first.stderr).contains("PLAINTEXT"));
    let bytes = fs::read(&output).unwrap();
    let data: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert!(data["items"].is_array());
    let second = invoke();
    assert!(!second.status.success());
    assert!(String::from_utf8_lossy(&second.stderr).contains("OUTPUT_EXISTS_OR_UNAVAILABLE"));
    assert_eq!(fs::read(&output).unwrap(), bytes);
    fs::remove_file(output).unwrap();
}
