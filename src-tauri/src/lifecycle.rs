// 桌面生命周期：托盘、显示语言、关闭选择和退出协调。没有托盘时保持窗口可见，防止应用隐藏后无法找回。
use crate::backend::Backend;
use std::sync::{
    Mutex,
    atomic::{AtomicBool, AtomicU8, Ordering},
};
use tauri::{
    Manager,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogResult};

#[derive(Default)]
pub struct Lifecycle {
    tray: AtomicBool,
    closing: AtomicBool,
    pub exiting: AtomicBool,
    language: AtomicU8,
    menu_items: Mutex<Option<[MenuItem<tauri::Wry>; 3]>>,
}

// 更新原生菜单显示语言，不自行持久化偏好。
pub fn set_language(app: &tauri::AppHandle, language: u8) {
    let state = app.state::<Lifecycle>();
    state.language.store(language, Ordering::Relaxed);
    if let Ok(items) = state.menu_items.lock()
        && let Some(items) = items.as_ref()
    {
        let labels = match language {
            1 => ["Open LegacyLock", "Lock", "Quit"],
            2 => ["LegacyLock を開く", "ロック", "終了"],
            _ => ["打开 LegacyLock", "锁定", "退出"],
        };
        for (item, label) in items.iter().zip(labels) {
            let _ = item.set_text(label);
        }
    }
}

// 安装托盘并记录可用状态；失败时不允许隐藏主窗口。
pub fn install(app: &tauri::AppHandle) {
    app.manage(Lifecycle::default());
    // 托盘不可用时保留窗口，不能留下无法重新打开的隐藏应用。
    let installed = (|| -> tauri::Result<()> {
        let open = MenuItem::with_id(app, "open", "打开 LegacyLock", true, None::<&str>)?;
        let lock = MenuItem::with_id(app, "lock", "锁定", true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&open, &lock, &quit])?;
        *app.state::<Lifecycle>()
            .menu_items
            .lock()
            .expect("Menu state") = Some([open, lock, quit]);
        TrayIconBuilder::with_id("main-tray")
            .icon(tauri::image::Image::from_bytes(include_bytes!(
                "../icons/icon.png"
            ))?)
            .tooltip("LegacyLock")
            .menu(&menu)
            .on_menu_event(|app, event| match event.id.as_ref() {
                "open" => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.unminimize();
                        let _ = w.set_focus();
                    }
                }
                "lock" => app.state::<Backend>().lock(app),
                "quit" => exit(app),
                _ => {}
            })
            .build(app)?;
        Ok(())
    })()
    .is_ok();
    app.state::<Lifecycle>()
        .tray
        .store(installed, Ordering::SeqCst);
}

// 只有托盘可用才先锁定再隐藏，避免留下一份不可访问的后台会话。
pub fn hide(app: &tauri::AppHandle) -> Result<(), &'static str> {
    if !app.state::<Lifecycle>().tray.load(Ordering::SeqCst) {
        return Err("TRAY_UNAVAILABLE");
    }
    app.state::<Backend>().lock(app);
    app.get_webview_window("main")
        .ok_or("OPERATION_FAILED")?
        .hide()
        .map_err(|_| "OPERATION_FAILED")
}

// 只启动一次退出流程：立即锁定，等待工作槽释放，然后终止进程。
pub fn exit(app: &tauri::AppHandle) {
    if app
        .state::<Lifecycle>()
        .exiting
        .swap(true, Ordering::SeqCst)
    {
        return;
    }
    app.state::<Backend>().lock(app);
    let handle = app.clone();
    std::thread::spawn(move || {
        // 正常退出必须等待正在进行的原子替换结束。
        while handle.state::<Backend>().busy.load(Ordering::SeqCst) {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        handle.exit(0);
    });
}

// 用防重入标志保护三选项关闭对话框；偏好仅调整选项顺序。
pub fn close(app: &tauri::AppHandle) {
    if app
        .state::<Lifecycle>()
        .closing
        .swap(true, Ordering::SeqCst)
    {
        return;
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        let language = handle.state::<Lifecycle>().language.load(Ordering::Relaxed);
        let (message, hide_label, exit_label, cancel_label, unavailable) = match language {
            1 => (
                "Choose how to close. Hiding to the tray locks the vault.",
                "Hide to tray",
                "Quit application",
                "Cancel",
                "The system tray is unavailable. The window will stay open.",
            ),
            2 => (
                "終了方法を選択してください。トレイに隠すと保管庫がロックされます。",
                "トレイに隠す",
                "アプリを終了",
                "キャンセル",
                "トレイを利用できないため、ウィンドウを開いたままにします。",
            ),
            _ => (
                "请选择关闭方式。最小化到托盘会立即锁定保险库。",
                "最小化到托盘",
                "退出应用",
                "取消",
                "系统托盘不可用，窗口将保持打开。",
            ),
        };
        let prefer_tray = handle
            .state::<Backend>()
            .service
            .preferences()
            .ok()
            .is_some_and(|p| p["closeToTray"] == true);
        let (first, second) = if prefer_tray {
            (hide_label, exit_label)
        } else {
            (exit_label, hide_label)
        };
        let answer = handle
            .dialog()
            .message(message)
            .title("LegacyLock")
            .buttons(MessageDialogButtons::YesNoCancelCustom(
                first.into(),
                second.into(),
                cancel_label.into(),
            ))
            .blocking_show_with_result();
        let choice = match &answer {
            MessageDialogResult::Yes => first,
            MessageDialogResult::No => second,
            MessageDialogResult::Custom(s) => s.as_str(),
            _ => cancel_label,
        };
        match choice {
            s if s == hide_label => {
                if hide(&handle).is_err() {
                    handle.dialog().message(unavailable).blocking_show();
                }
            }
            s if s == exit_label => exit(&handle),
            _ => {}
        }
        handle
            .state::<Lifecycle>()
            .closing
            .store(false, Ordering::SeqCst);
    });
}
