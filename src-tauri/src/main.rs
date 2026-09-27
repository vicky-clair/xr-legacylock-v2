// Tauri 宿主入口：注册命令、插件、独立数据目录和安全事件；启动时不自动解锁。
// 命令集合需与 build.rs、主窗口 capability 和前端 commandSpecs 同步。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use serde::Deserialize;
use serde_json::Value;
use tauri::Manager;
mod backend;
mod commands;
mod lifecycle;
mod system_events;
use backend::Backend;
// 限制命令来源为 main 窗口；与 capability 授权共同构成 IPC 边界。
fn main_window(window: &tauri::WebviewWindow) -> Result<(), &'static str> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("UNTRUSTED_SENDER")
    }
}
#[tauri::command]
// 通过工作槽读取公开密库状态，不返回资产。
async fn status(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<Value, String> {
    main_window(&window)?;
    backend::run(app, |s, _| s.status()).await
}
#[tauri::command]
// 读取显示偏好，允许锁定界面恢复主题和语言。
fn preferences(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<Value, &'static str> {
    main_window(&window)?;
    app.state::<Backend>()
        .service
        .preferences()
        .map_err(|e| e.0)
}
#[tauri::command]
// 查询本机记忆入口状态，不在此处解密安全密钥。
fn local_unlock_status(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Value, &'static str> {
    main_window(&window)?;
    Ok(app.state::<Backend>().service.local_unlock_status())
}
#[tauri::command]
// 从 Rust 系统随机源生成 LL3 密钥，不复用资产密码生成器。
fn new_secret(window: tauri::WebviewWindow) -> Result<String, &'static str> {
    main_window(&window)?;
    Ok(vault_core::new_secret())
}
#[tauri::command]
// 直接撤权，不等待耗时任务工作槽。
fn lock(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), &'static str> {
    main_window(&window)?;
    app.state::<Backend>().lock(&app);
    Ok(())
}
#[tauri::command]
// 刷新自动锁定计时，不授予或恢复会话。
fn activity(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), &'static str> {
    main_window(&window)?;
    app.state::<Backend>().service.activity();
    Ok(())
}
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum Language {
    Zh,
    En,
    Ja,
}
#[tauri::command]
// 同步原生菜单语言；锁定或继承模式也可临时切换显示。
fn view_language(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    language: Language,
) -> Result<(), &'static str> {
    main_window(&window)?;
    lifecycle::set_language(
        &app,
        match language {
            Language::Zh => 0,
            Language::En => 1,
            Language::Ja => 2,
        },
    );
    Ok(())
}
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum WindowAction {
    Minimize,
    Maximize,
    Close,
    Quit,
    Tray,
}
#[tauri::command]
// 枚举限制窗口动作，关闭和退出必须经过生命周期处理。
fn window_control(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    action: WindowAction,
) -> Result<(), &'static str> {
    main_window(&window)?;
    let result = match action {
        WindowAction::Minimize => window.minimize(),
        WindowAction::Maximize => {
            if window.is_maximized().map_err(|_| "OPERATION_FAILED")? {
                window.unmaximize()
            } else {
                window.maximize()
            }
        }
        WindowAction::Close => {
            lifecycle::close(&app);
            return Ok(());
        }
        WindowAction::Quit => {
            lifecycle::exit(&app);
            return Ok(());
        }
        WindowAction::Tray => return lifecycle::hide(&app),
    };
    result.map_err(|_| "OPERATION_FAILED")
}
// 安装单实例保护并创建主窗口，随后接受受限命令。
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                lifecycle::close(window.app_handle());
            }
        })
        .setup(|app| {
            let service =
                std::sync::Arc::new(vault_service::Service::open(&app.path().app_data_dir()?)?);
            app.manage(Backend {
                service,
                busy: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
                clipboard: std::sync::Mutex::new(None),
                clipboard_sequence: std::sync::atomic::AtomicU64::new(0),
            });
            lifecycle::install(app.handle());
            let devices = app.handle().clone();
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(5));
                    if !devices.state::<Backend>().service.check_recovery_devices() {
                        devices.state::<Backend>().lock(&devices);
                    }
                }
            });
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(1));
                    if handle.state::<Backend>().service.idle_expired() {
                        handle.state::<Backend>().lock(&handle);
                    }
                }
            });
            let window =
                tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                    .on_navigation(|url| {
                        let local = url.scheme() == "tauri" && url.host_str() == Some("localhost")
                            || matches!(url.scheme(), "http" | "https")
                                && url.host_str() == Some("tauri.localhost");
                        local
                            || cfg!(debug_assertions)
                                && url.scheme() == "http"
                                && url.host_str() == Some("127.0.0.1")
                                && url.port() == Some(1420)
                    })
                    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                    .build()?;
            system_events::install(&window)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::export_attachment,
            commands::import_attachments,
            commands::get_item,
            commands::search_items,
            commands::scan,
            commands::provision,
            commands::sync,
            commands::recover,
            status,
            preferences,
            local_unlock_status,
            new_secret,
            lock,
            activity,
            view_language,
            window_control,
            commands::initialize,
            commands::unlock,
            commands::save_item,
            commands::delete_item,
            commands::settings,
            commands::set_preferences,
            commands::health,
            commands::credentials,
            commands::import_owner,
            commands::import_data,
            commands::export,
            commands::prepare_destroy,
            commands::destroy,
            commands::copy,
            commands::unlock_local,
            commands::set_remembered_secret
        ])
        .run(tauri::generate_context!())
        .expect("Desktop host failed");
}
