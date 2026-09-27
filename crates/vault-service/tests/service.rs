// 业务服务回归：临时目录内验证导入、修改、重启、权限、冲突及原子写入故障；不使用用户真实密库。
use serde_json::{Value, json};
use std::{
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
use vault_core::{Error, Result, canonical_js};
use vault_service::{
    Service,
    storage::{self, AtomicVaultWriter, Stage},
};
const PASSWORD: &str = "Golden fixture password!";
fn secret() -> String {
    format!("LL3-{}", "1".repeat(64))
}
fn fixture() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../reference/legacy/tests/fixtures/v3-vault.json")
}
fn imported(service: &Service) {
    service
        .import_owner(&fixture(), PASSWORD, &secret(), service.epoch())
        .unwrap();
}
fn item() -> Value {
    json!({"id":"test","title":"中文 😀","category":"note","createdAt":0,"updatedAt":0,"revision":999,"notes":"0"})
}

#[test]
fn import_edit_restart_export_preserve_data_and_require_both_factors() {
    let dir = tempfile::tempdir().unwrap();
    let service = Service::open(dir.path()).unwrap();
    imported(&service);
    let saved = service.save_item(item(), service.epoch()).unwrap();
    assert_eq!(saved["items"][0]["revision"], 1);
    let out = dir.path().join("export.llvault");
    assert_eq!(
        service.export(&out, "wrong password", &secret(), service.epoch()),
        Err(Error("AUTHENTICATION_FAILED"))
    );
    assert!(!out.exists());
    service
        .export(&out, PASSWORD, &secret(), service.epoch())
        .unwrap();
    assert!(dir.path().join("vault-v3.llvault.previous").exists());
    drop(service);
    let service = Service::open(dir.path()).unwrap();
    assert_eq!(
        service.save_item(item(), service.epoch()),
        Err(Error("LOCKED"))
    );
    let view = service
        .unlock(PASSWORD, &secret(), service.epoch())
        .unwrap();
    assert_eq!(view["items"], saved["items"]);
    let opened =
        vault_core::unlock_owner(storage::read_envelope(&out).unwrap(), PASSWORD, &secret())
            .unwrap();
    for summary in view["items"].as_array().unwrap() {
        let id = summary["id"].as_str().unwrap();
        assert_eq!(
            opened.data()["items"]
                .as_array()
                .unwrap()
                .iter()
                .find(|i| i["id"] == id)
                .unwrap(),
            &service.get_item(id, service.epoch()).unwrap()
        );
        assert!(summary.get("password").is_none());
        assert!(summary.get("attachments").is_none());
    }
}
#[test]
fn corrupted_vault_and_duplicate_process_never_initialize() {
    let dir = tempfile::tempdir().unwrap();
    let service = Service::open(dir.path()).unwrap();
    assert!(matches!(
        Service::open(dir.path()),
        Err(Error("VAULT_IN_USE"))
    ));
    std::fs::write(dir.path().join("vault-v3.llvault"), b"corrupted").unwrap();
    assert_eq!(service.status().unwrap()["damaged"], true);
    assert_eq!(
        service.initialize(PASSWORD, &secret(), service.epoch()),
        Err(Error("VAULT_EXISTS"))
    );
    assert_eq!(
        std::fs::read(dir.path().join("vault-v3.llvault")).unwrap(),
        b"corrupted"
    );
}
#[test]
fn heir_is_readonly_and_foreign_recovery_does_not_replace_local() {
    let dir = tempfile::tempdir().unwrap();
    let service = Service::open(dir.path()).unwrap();
    let root = fixture().parent().unwrap().to_owned();
    service
        .recover_from_files(
            &fixture(),
            &storage::read(&root.join("v3-primary.json")).unwrap(),
            &storage::read(&root.join("v3-secondary.json")).unwrap(),
            service.epoch(),
        )
        .unwrap();
    assert_eq!(
        service.save_item(item(), service.epoch()),
        Err(Error("OWNER_REQUIRED"))
    );
    assert!(!dir.path().join("vault-v3.llvault").exists());
    assert_eq!(
        service.set_preferences(json!({}), service.epoch()),
        Err(Error("OWNER_REQUIRED"))
    );
}
struct FaultWriter {
    stage: Stage,
    armed: AtomicBool,
}
impl AtomicVaultWriter for FaultWriter {
    fn write(
        &self,
        p: &Path,
        v: &Value,
        old: Option<&Value>,
        guard: &dyn Fn() -> Result<()>,
    ) -> Result<()> {
        storage::write_checked(
            p,
            v,
            old,
            guard,
            &|stage| {
                if self.armed.load(Ordering::SeqCst) && stage == self.stage {
                    Err(Error("INJECTED_FAILURE"))
                } else {
                    Ok(())
                }
            },
            vault_core::validate_envelope,
        )
    }
}
#[test]
fn every_commit_stage_keeps_complete_old_or_new_and_uncertain_result_locks() {
    for stage in [
        Stage::BeforeWrite,
        Stage::AfterWrite,
        Stage::AfterSync,
        Stage::AfterReadback,
        Stage::BeforeReplace,
        Stage::AfterReplace,
        Stage::AfterVerify,
    ] {
        let dir = tempfile::tempdir().unwrap();
        let writer = Arc::new(FaultWriter {
            stage,
            armed: AtomicBool::new(false),
        });
        let service = Service::with_writer(dir.path(), writer.clone()).unwrap();
        imported(&service);
        let path = dir.path().join("vault-v3.llvault");
        let before = storage::read_envelope(&path).unwrap();
        writer.armed.store(true, Ordering::SeqCst);
        assert!(service.save_item(item(), service.epoch()).is_err());
        let after = storage::read_envelope(&path).unwrap();
        if matches!(stage, Stage::AfterReplace | Stage::AfterVerify) {
            assert_eq!(
                service.save_item(item(), service.epoch()),
                Err(Error("LOCKED"))
            );
            assert_ne!(after["revision"], before["revision"]);
        } else {
            assert_eq!(canonical_js(&before), canonical_js(&after));
        }
    }
}
#[test]
fn lock_during_write_prevents_commit_and_session_resurrection() {
    struct BlockingWriter {
        started: std::sync::mpsc::Sender<()>,
        resume: std::sync::Mutex<std::sync::mpsc::Receiver<()>>,
    }
    impl AtomicVaultWriter for BlockingWriter {
        fn write(
            &self,
            p: &Path,
            v: &Value,
            old: Option<&Value>,
            guard: &dyn Fn() -> Result<()>,
        ) -> Result<()> {
            self.started.send(()).unwrap();
            self.resume.lock().unwrap().recv().unwrap();
            storage::DurableWriter.write(p, v, old, guard)
        }
    }
    let dir = tempfile::tempdir().unwrap();
    let (tx, rx) = std::sync::mpsc::channel();
    let (resume, wait) = std::sync::mpsc::channel();
    let service = Arc::new(
        Service::with_writer(
            dir.path(),
            Arc::new(BlockingWriter {
                started: tx,
                resume: std::sync::Mutex::new(wait),
            }),
        )
        .unwrap(),
    );
    let worker = service.clone();
    let epoch = worker.epoch();
    let thread =
        std::thread::spawn(move || worker.import_owner(&fixture(), PASSWORD, &secret(), epoch));
    rx.recv().unwrap();
    service.lock();
    resume.send(()).unwrap();
    assert_eq!(thread.join().unwrap(), Err(Error("LOCKED")));
    assert!(!dir.path().join("vault-v3.llvault").exists());
}
#[test]
fn merge_conflicts_preserve_local_settings_and_recovery() {
    let dir = tempfile::tempdir().unwrap();
    let service = Service::open(dir.path()).unwrap();
    imported(&service);
    let before = storage::read_envelope(&dir.path().join("vault-v3.llvault")).unwrap();
    service
        .settings(
            json!({"autoLockMinutes":5,"heirName":"local","heirNotes":"keep"}),
            service.epoch(),
        )
        .unwrap();
    let result = service
        .import_data(&fixture(), PASSWORD, &secret(), service.epoch())
        .unwrap();
    assert_eq!(result["imported"], 0);
    assert_eq!(result["view"]["settings"]["heirName"], "local");
    let after = storage::read_envelope(&dir.path().join("vault-v3.llvault")).unwrap();
    assert_eq!(before["id"], after["id"]);
    assert_eq!(before["recovery"], after["recovery"]);
}

#[test]
fn conflicting_import_creates_copy_and_old_owner_import_cannot_roll_back() {
    let dir = tempfile::tempdir().unwrap();
    let service = Service::open(dir.path()).unwrap();
    imported(&service);
    let initial = service
        .unlock(PASSWORD, &secret(), service.epoch())
        .unwrap();
    let id = initial["items"][0]["id"].as_str().unwrap();
    let original = service.get_item(id, service.epoch()).unwrap();
    let mut changed = original.clone();
    changed["title"] = json!("local conflicting title");
    service.save_item(changed, service.epoch()).unwrap();
    let result = service
        .import_data(&fixture(), PASSWORD, &secret(), service.epoch())
        .unwrap();
    assert_eq!(result["imported"], 1);
    assert_eq!(
        service.get_item(id, service.epoch()).unwrap()["title"],
        "local conflicting title"
    );
    let copy = result["view"]["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["id"] != id)
        .unwrap();
    let mut copied = service
        .get_item(copy["id"].as_str().unwrap(), service.epoch())
        .unwrap();
    copied["id"] = original["id"].clone();
    assert_eq!(copied, original);
    assert_eq!(
        service.import_owner(&fixture(), PASSWORD, &secret(), service.epoch()),
        Err(Error("OLDER_BACKUP"))
    );
    let root = fixture().parent().unwrap().to_owned();
    let local = std::fs::read(dir.path().join("vault-v3.llvault")).unwrap();
    let old = service
        .recover_from_files(
            &fixture(),
            &storage::read(&root.join("v3-primary.json")).unwrap(),
            &storage::read(&root.join("v3-secondary.json")).unwrap(),
            service.epoch(),
        )
        .unwrap();
    assert_eq!(old["role"], "HEIR");
    assert_eq!(
        service.unlock(PASSWORD, &secret(), service.epoch()),
        Err(Error("OLDER_BACKUP"))
    );
    assert_eq!(
        local,
        std::fs::read(dir.path().join("vault-v3.llvault")).unwrap()
    );
}
