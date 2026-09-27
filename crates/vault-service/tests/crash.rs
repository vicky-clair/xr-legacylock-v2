// 崩溃一致性测试：子进程在写入阶段直接退出，绕过析构清理；重启检查完整旧版或新版仍可读取。
use serde_json::json;
use std::{path::Path, process::Command};
use vault_service::{
    Service,
    storage::{self, Stage},
};
const PASSWORD: &str = "Golden fixture password!";
fn secret() -> String {
    format!("LL3-{}", "1".repeat(64))
}
#[test]
fn crash_worker() {
    let Some(directory) = std::env::var_os("LEGACYLOCK_TEST_CRASH_DIRECTORY") else {
        return;
    };
    let directory = Path::new(&directory);
    assert!(
        directory
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("legacylock-crash-")
    );
    let stage: usize = std::env::var("LEGACYLOCK_TEST_CRASH_STAGE")
        .unwrap()
        .parse()
        .unwrap();
    let file = directory.join("vault-v3.llvault");
    let before = storage::read_envelope(&file).unwrap();
    let mut session = vault_core::unlock_owner(before.clone(), PASSWORD, &secret()).unwrap();
    let mut data = session.data().clone();
    data["settings"]["heirName"] = json!("crash-test");
    session.update(data).unwrap();
    storage::write_checked(
        &file,
        session.envelope(),
        Some(&before),
        &|| Ok(()),
        &|at| {
            if at as usize == stage {
                std::process::exit(86);
            }
            Ok(())
        },
        vault_core::validate_envelope,
    )
    .unwrap();
    panic!("Fault stage was not reached");
}
#[test]
fn abrupt_process_exit_at_every_write_stage_preserves_readable_vault() {
    for stage in [
        Stage::BeforeWrite,
        Stage::AfterWrite,
        Stage::AfterSync,
        Stage::AfterReadback,
        Stage::BeforeReplace,
        Stage::AfterReplace,
        Stage::AfterVerify,
    ] {
        let dir = tempfile::Builder::new()
            .prefix("legacylock-crash-")
            .tempdir()
            .unwrap();
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../reference/legacy/tests/fixtures/v3-vault.json");
        std::fs::copy(fixture, dir.path().join("vault-v3.llvault")).unwrap();
        let result = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "crash_worker", "--nocapture"])
            .env("LEGACYLOCK_TEST_CRASH_DIRECTORY", dir.path())
            .env("LEGACYLOCK_TEST_CRASH_STAGE", (stage as usize).to_string())
            .output()
            .unwrap();
        assert_eq!(result.status.code(), Some(86), "stage {stage:?}");
        let service = Service::open(dir.path()).unwrap();
        assert!(service.assert_unlocked(service.epoch()).is_err());
        let view = service
            .unlock(PASSWORD, &secret(), service.epoch())
            .unwrap();
        if matches!(stage, Stage::AfterReplace | Stage::AfterVerify) {
            assert_eq!(view["settings"]["heirName"], "crash-test");
        } else {
            assert_ne!(view["settings"]["heirName"], "crash-test");
        }
    }
}
