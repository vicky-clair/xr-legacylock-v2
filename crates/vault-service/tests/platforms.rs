// 平台服务回归：测试记忆密钥、附件、模拟介质和恢复流程；模拟设备通过不代表真实双 USB 已验收。
use serde_json::json;
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use vault_core::{Error, Result};
use vault_service::{
    Service,
    local_secret::PlatformSecretStore,
    media::{Drive, MediaProvider, location},
    storage::{self, DurableWriter},
};
const PASSWORD: &str = "Golden fixture password!";
fn secret() -> String {
    format!("LL3-{}", "1".repeat(64))
}
fn fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../reference/legacy/tests/fixtures/v3-vault.json")
}
#[derive(Clone)]
struct Devices(Arc<Mutex<Vec<Drive>>>);
impl MediaProvider for Devices {
    fn scan(&self) -> Result<Vec<Drive>> {
        Ok(self.0.lock().unwrap().clone())
    }
}
fn setup() -> (tempfile::TempDir, Service, Devices) {
    let dir = tempfile::tempdir().unwrap();
    let devices = Devices(Arc::new(Mutex::new(
        (0..2)
            .map(|i| {
                let root = dir.path().join(format!("usb{i}"));
                std::fs::create_dir(&root).unwrap();
                Drive {
                    root,
                    physical: format!("physical-{i}"),
                    label: format!("test-{i}"),
                    size: 10000000,
                }
            })
            .collect(),
    )));
    let service = Service::with_platforms(
        &dir.path().join("local"),
        Arc::new(DurableWriter),
        Arc::new(PlatformSecretStore),
        Box::new(devices.clone()),
    )
    .unwrap();
    service
        .import_owner(&fixture(), PASSWORD, &secret(), service.epoch())
        .unwrap();
    (dir, service, devices)
}
fn tokens(service: &Service) -> (String, String) {
    let rows = service.scan().unwrap();
    (
        rows[0]["token"].as_str().unwrap().into(),
        rows[1]["token"].as_str().unwrap().into(),
    )
}
#[test]
fn same_physical_partition_and_stale_tokens_are_rejected() {
    let (_dir, s, devices) = setup();
    devices.0.lock().unwrap()[1].physical = "physical-0".into();
    let (a, b) = tokens(&s);
    assert_eq!(
        s.provision(&a, &b, PASSWORD, &secret(), s.epoch()),
        Err(Error("TWO_PHYSICAL_DRIVES_REQUIRED"))
    );
    s.scan().unwrap();
    assert_eq!(s.sync(&a, s.epoch()), Err(Error("USB_NOT_PRESENT")));
}
#[test]
fn usb_provision_primary_only_sync_and_removal_revoke_heir() {
    let (dir, s, devices) = setup();
    let (a, b) = tokens(&s);
    s.provision(&a, &b, PASSWORD, &secret(), s.epoch()).unwrap();
    let envelope = storage::read_envelope(&dir.path().join("local/vault-v3.llvault")).unwrap();
    let pair = devices.0.lock().unwrap().clone();
    let primary = location(&pair[0], &envelope).unwrap();
    let secondary = location(&pair[1], &envelope).unwrap();
    let before = std::fs::read(secondary.join("secondary.llkey")).unwrap();
    assert!(!secondary.join("vault.llvault").exists());
    s.save_item(
        json!({"id":"changed","title":"new","category":"note","createdAt":0,"updatedAt":0}),
        s.epoch(),
    )
    .unwrap();
    devices.0.lock().unwrap().pop();
    s.sync(&a, s.epoch()).unwrap();
    assert_eq!(
        before,
        std::fs::read(secondary.join("secondary.llkey")).unwrap()
    );
    *devices.0.lock().unwrap() = pair;
    s.lock();
    let (a, b) = tokens(&s);
    let view = s
        .recover(&primary.join("vault.llvault"), &a, &b, s.epoch())
        .unwrap();
    assert_eq!(view["view"]["role"], "HEIR");
    assert_eq!(view["view"]["items"][0]["id"], "changed");
    assert_eq!(
        s.unlock_local(PASSWORD, s.epoch()),
        Err(Error("OWNER_REQUIRED"))
    );
    assert_eq!(
        s.initialize(PASSWORD, &secret(), s.epoch()),
        Err(Error("OWNER_REQUIRED"))
    );
    assert_eq!(
        s.credentials(PASSWORD, &secret(), PASSWORD, &secret(), s.epoch()),
        Err(Error("OWNER_REQUIRED"))
    );
    devices.0.lock().unwrap().pop();
    assert!(!s.check_recovery_devices());
    assert_eq!(s.assert_unlocked(s.epoch()), Err(Error("LOCKED")));
}
#[cfg(windows)]
#[test]
fn dpapi_memory_is_encrypted_survives_restart_and_credential_change_invalidates() {
    let (dir, s, _) = setup();
    assert_eq!(s.local_unlock_status()["remembered"], false);
    assert!(
        s.set_remembered_secret(true, "wrong password", &secret(), s.epoch())
            .is_err()
    );
    s.set_remembered_secret(true, PASSWORD, &secret(), s.epoch())
        .unwrap();
    let record = dir.path().join("local/local-key-tauri-v1.json");
    assert!(
        !std::fs::read_to_string(&record)
            .unwrap()
            .contains(&secret())
    );
    drop(s);
    let s = Service::open(&dir.path().join("local")).unwrap();
    assert!(s.unlock_local("wrong password", s.epoch()).is_err());
    s.unlock_local(PASSWORD, s.epoch()).unwrap();
    let new_secret = format!("LL3-{}", "2".repeat(64));
    s.credentials(
        PASSWORD,
        &secret(),
        "New fixture password!",
        &new_secret,
        s.epoch(),
    )
    .unwrap();
    assert!(!record.exists());
    s.lock();
    assert!(s.unlock_local("New fixture password!", s.epoch()).is_err());
    s.unlock("New fixture password!", &new_secret, s.epoch())
        .unwrap();
}
#[cfg(windows)]
#[test]
fn damaged_memory_allows_manual_unlock_and_disable() {
    let (dir, s, _) = setup();
    s.set_remembered_secret(true, PASSWORD, &secret(), s.epoch())
        .unwrap();
    std::fs::write(dir.path().join("local/local-key-tauri-v1.json"), b"broken").unwrap();
    s.lock();
    assert_eq!(
        s.unlock_local(PASSWORD, s.epoch()),
        Err(Error("LOCAL_KEY_UNAVAILABLE"))
    );
    s.unlock(PASSWORD, &secret(), s.epoch()).unwrap();
    s.set_remembered_secret(false, "", "", s.epoch()).unwrap();
    assert_eq!(s.local_unlock_status()["remembered"], false);
}
#[test]
fn destroy_token_is_single_use_revision_bound_and_external_backup_survives() {
    let (dir, s, _) = setup();
    let external = dir.path().join("keep.llvault");
    s.export(&external, PASSWORD, &secret(), s.epoch()).unwrap();
    let challenge = s.prepare_destroy(PASSWORD, &secret(), s.epoch()).unwrap();
    let token = challenge["token"].as_str().unwrap();
    assert_eq!(
        s.destroy(token, "wrong", s.epoch()),
        Err(Error("CONFIRMATION_REQUIRED"))
    );
    assert_eq!(
        s.destroy(token, "DELETE", s.epoch()),
        Err(Error("CONFIRMATION_REQUIRED"))
    );
    let challenge = s.prepare_destroy(PASSWORD, &secret(), s.epoch()).unwrap();
    s.settings(
        json!({"autoLockMinutes":5,"heirName":"","heirNotes":""}),
        s.epoch(),
    )
    .unwrap();
    assert_eq!(
        s.destroy(challenge["token"].as_str().unwrap(), "DELETE", s.epoch()),
        Err(Error("CONFIRMATION_REQUIRED"))
    );
    let challenge = s.prepare_destroy(PASSWORD, &secret(), s.epoch()).unwrap();
    s.destroy(challenge["token"].as_str().unwrap(), "DELETE", s.epoch())
        .unwrap();
    assert_eq!(s.status().unwrap()["exists"], false);
    assert!(external.exists());
    assert!(!dir.path().join("local/vault-v3.llvault.previous").exists());
}
#[test]
fn attachment_export_is_exact_and_never_overwrites() {
    let (dir, s, _) = setup();
    let item = json!({"id":"attachment","title":"test","category":"document","createdAt":0,"updatedAt":0,"attachments":[{"id":"a","name":"bytes.bin","size":4,"type":"application/octet-stream","data":"data:application/octet-stream;base64,AAH+/w==","uploadedAt":0}]});
    s.save_item(item, s.epoch()).unwrap();
    let out = dir.path().join("bytes.bin");
    s.export_attachment(&out, "attachment", "a", s.epoch())
        .unwrap();
    assert_eq!(std::fs::read(&out).unwrap(), [0, 1, 254, 255]);
    assert_eq!(
        s.export_attachment(&out, "attachment", "a", s.epoch()),
        Err(Error("OUTPUT_EXISTS_OR_UNAVAILABLE"))
    );
    s.lock();
    assert_eq!(
        s.export_attachment(&dir.path().join("locked.bin"), "attachment", "a", s.epoch()),
        Err(Error("LOCKED"))
    );
}

#[test]
fn native_attachment_import_checks_limits_and_summary_search_does_not_expose_secrets() {
    let (dir, s, _) = setup();
    let file = dir.path().join("input.bin");
    std::fs::write(&file, [0, 128, 255]).unwrap();
    let attachments = s
        .import_attachments(std::slice::from_ref(&file), s.epoch())
        .unwrap()["attachments"]
        .clone();
    let view=s.save_item(json!({"id":"native","title":"title","category":"document","createdAt":0,"updatedAt":0,"password":"synthetic secret","notes":"find this note","attachments":attachments}),s.epoch()).unwrap();
    let summary = &view["items"][0];
    assert!(summary.get("password").is_none());
    assert!(summary.get("notes").is_none());
    assert!(summary.get("attachments").is_none());
    assert_eq!(
        s.search_items("THIS NOTE", s.epoch()).unwrap(),
        json!(["native"])
    );
    assert_eq!(
        s.attachment("native", attachments[0]["id"].as_str().unwrap(), s.epoch())
            .unwrap()
            .1
            .as_slice(),
        [0, 128, 255]
    );
    std::fs::File::create(&file)
        .unwrap()
        .set_len(2 * 1024 * 1024 + 1)
        .unwrap();
    assert_eq!(
        s.import_attachments(&[file], s.epoch()),
        Err(Error("INVALID_ITEMS"))
    );
    s.lock();
    assert_eq!(s.get_item("native", s.epoch()), Err(Error("LOCKED")));
    assert_eq!(s.search_items("", s.epoch()), Err(Error("LOCKED")));
}

#[test]
fn abandoned_generation_is_preserved_and_retry_uses_next_generation() {
    let (dir, s, devices) = setup();
    let mut envelope = storage::read_envelope(&dir.path().join("local/vault-v3.llvault")).unwrap();
    let next = envelope["recovery"]["generation"].as_u64().unwrap() + 1;
    envelope["recovery"]["generation"] = json!(next);
    let abandoned = location(&devices.0.lock().unwrap()[0], &envelope).unwrap();
    std::fs::create_dir_all(&abandoned).unwrap();
    std::fs::write(abandoned.join("keep.txt"), b"keep").unwrap();
    let (a, b) = tokens(&s);
    s.provision(&a, &b, PASSWORD, &secret(), s.epoch()).unwrap();
    assert_eq!(
        storage::read_envelope(&dir.path().join("local/vault-v3.llvault")).unwrap()["recovery"]["generation"],
        next + 1
    );
    assert_eq!(std::fs::read(abandoned.join("keep.txt")).unwrap(), b"keep");
}

#[test]
fn disabling_remembered_key_does_not_require_available_os_store() {
    struct Unavailable;
    impl vault_service::local_secret::LocalSecretStore for Unavailable {
        fn available(&self) -> bool {
            false
        }
        fn seal(&self, _: &[u8]) -> Result<Vec<u8>> {
            Err(Error("LOCAL_KEY_UNAVAILABLE"))
        }
        fn unseal(&self, _: &[u8]) -> Result<zeroize::Zeroizing<Vec<u8>>> {
            Err(Error("LOCAL_KEY_UNAVAILABLE"))
        }
    }
    let (dir, s, devices) = setup();
    drop(s);
    let s = Service::with_platforms(
        &dir.path().join("local"),
        Arc::new(DurableWriter),
        Arc::new(Unavailable),
        Box::new(devices),
    )
    .unwrap();
    s.unlock(PASSWORD, &secret(), s.epoch()).unwrap();
    let record = dir.path().join("local/local-key-tauri-v1.json");
    std::fs::write(&record, b"unavailable system cipher").unwrap();
    assert_eq!(
        s.set_remembered_secret(true, PASSWORD, &secret(), s.epoch()),
        Err(Error("LOCAL_KEY_UNAVAILABLE"))
    );
    s.set_remembered_secret(false, "", "", s.epoch()).unwrap();
    assert!(!record.exists());
}
