// 宿主任务调度：单个阻塞工作槽、锁定广播与剪贴板清理。耗时操作移出 UI 线程，退出前等待已接受的任务结束。
use serde_json::Value;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicU64, Ordering},
};
use tauri::{Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use vault_core::{Error, Result};
use vault_service::Service;
use zeroize::Zeroizing;

pub struct Backend {
    pub service: Arc<Service>,
    pub busy: Arc<AtomicBool>,
    pub clipboard: Mutex<Option<(u64, Zeroizing<String>)>>,
    pub clipboard_sequence: AtomicU64,
}
impl Backend {
    // 同步撤权、广播清空界面，并清理仍属于本应用的剪贴板内容。
    pub fn lock(&self, app: &tauri::AppHandle) {
        self.service.lock();
        let _ = app.emit("secure:locked", ());
        self.clear_clipboard(app);
    }
    // 锁定时尝试清理本应用最后复制的内容。
    pub fn clear_clipboard(&self, app: &tauri::AppHandle) {
        self.clear_clipboard_if(app, None);
    }
    // 定时任务必须匹配复制序号且当前内容未被其他程序替换，才可清空。
    pub fn clear_clipboard_if(&self, app: &tauri::AppHandle, sequence: Option<u64>) {
        if let Ok(mut saved) = self.clipboard.lock() {
            if sequence.is_some_and(|seq| saved.as_ref().is_none_or(|(old, _)| seq != *old)) {
                return;
            }
            if let Some((_, value)) = saved.take()
                && app.clipboard().read_text().ok().as_deref() == Some(value.as_str())
            {
                let _ = app.clipboard().clear();
            }
        }
    }
}
struct Permit(Arc<AtomicBool>);
impl Drop for Permit {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
// 用 RAII 工作许可串行执行阻塞任务；退出或 epoch 变化后拒绝旧结果。
pub async fn run<F>(app: tauri::AppHandle, work: F) -> std::result::Result<Value, String>
where
    F: FnOnce(&Service, u64) -> Result<Value> + Send + 'static,
{
    let state = app.state::<Backend>();
    let service = state.service.clone();
    let busy = state.busy.clone();
    if busy
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("TRY_LATER".into());
    }
    let epoch = service.epoch();
    let permit = Permit(busy);
    if app
        .state::<crate::lifecycle::Lifecycle>()
        .exiting
        .load(Ordering::SeqCst)
    {
        return Err("LOCKED".into());
    }
    let notify = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| work(&service, epoch)));
        let result = match result {
            Ok(result) => result,
            Err(_) => {
                service.lock();
                Err(Error("SERVICE_FAILED"))
            }
        };
        if result.as_ref().is_err_and(|e| e.0 == "COMMIT_UNCERTAIN") {
            service.lock();
        }
        // 先释放工作槽再广播锁定，允许界面收到事件后立即刷新状态。
        drop(permit);
        if service.epoch() != epoch {
            let _ = notify.emit("secure:locked", ());
            notify.state::<Backend>().clear_clipboard(&notify);
            return Err(result
                .err()
                .map_or_else(|| "LOCKED".to_owned(), |e| e.0.to_owned()));
        }
        result.map_err(|e| e.0.to_owned())
    })
    .await
    .map_err(|_| "SERVICE_FAILED".to_owned())?
}
