// 服务微基准：临时合成 100、1000、10000 项资产并重复采样；不测桌面启动、WebView 内存或真实 USB。
use serde_json::{Value, json};
use std::{fs, time::Instant};
use vault_service::Service;
fn measure(f: impl Fn()) -> Value {
    let mut values = Vec::new();
    for _ in 0..20 {
        let t = Instant::now();
        f();
        values.push(t.elapsed().as_secs_f64() * 1000.0);
    }
    let mut sorted = values.clone();
    sorted.sort_by(f64::total_cmp);
    json!({"samplesMs":values,"p50Ms":sorted[9],"p95Ms":sorted[18]})
}
fn main() {
    let mut runs = Vec::new();
    for count in [100, 1000, 10000] {
        let dir = tempfile::tempdir().unwrap();
        let password = "Public synthetic benchmark password";
        let secret = format!("LL3-{}", "7".repeat(64));
        let items:Vec<Value>=(0..count).map(|i|json!({"id":format!("item-{i}"),"title":format!("Synthetic asset {i}"),"category":"note","notes":format!("Synthetic searchable note {i}"),"password":"public synthetic","createdAt":0,"updatedAt":0})).collect();
        let session = vault_core::create(password, &secret, json!(items)).unwrap();
        fs::write(
            dir.path().join("vault-v3.llvault"),
            vault_core::canonical_js(session.envelope()),
        )
        .unwrap();
        drop(session);
        let service = Service::open(dir.path()).unwrap();
        let unlock = measure(|| {
            service.lock();
            service.unlock(password, &secret, service.epoch()).unwrap();
        });
        let detail = measure(|| {
            service
                .get_item(&format!("item-{}", count - 1), service.epoch())
                .unwrap();
        });
        let search = measure(|| {
            service
                .search_items("searchable note 99", service.epoch())
                .unwrap();
        });
        let save = measure(|| {
            service
                .settings(
                    json!({"autoLockMinutes":15,"heirName":"","heirNotes":"benchmark"}),
                    service.epoch(),
                )
                .unwrap();
        });
        runs.push(json!({"items":count,"unlock":unlock,"detail":detail,"search":search,"saveSettings":save}));
    }
    println!("{}",serde_json::to_string_pretty(&json!({"scope":"Rust service only; excludes WebView, UI, cold start and process-tree memory","samplesPerOperation":20,"runs":runs})).unwrap());
}
