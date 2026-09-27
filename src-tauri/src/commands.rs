// 具名 IPC 命令适配层：检查主窗口来源，包装敏感输入，再调用服务。
// 文件只能由 Rust 原生对话框选择；取消返回 canceled，不当作保存成功。进度仅报告阶段，不传送秘密。
use crate::{
    backend::{Backend, run},
    main_window,
};
use serde_json::{Value, json};
use tauri::{AppHandle, Manager, WebviewWindow, ipc::Channel};
use tauri_plugin_dialog::DialogExt;
use vault_core::Error;
use zeroize::Zeroizing;
type Reply = Result<Value, String>;
#[derive(Clone, serde::Serialize)]
pub struct Progress {
    stage: &'static str,
}
// 向本次调用的 Channel 发送阶段；订阅端关闭不改变业务结果。
fn report(channel: &Channel<Progress>, stage: &'static str) {
    let _ = channel.send(Progress { stage });
}
#[tauri::command]
// 原生多选文件后交给附件服务，前端不能指定任意文件路径。
pub async fn import_attachments(
    window: WebviewWindow,
    app: AppHandle,
    progress: Channel<Progress>,
) -> Reply {
    main_window(&window)?;
    let chooser = app.clone();
    run(app, move |s, e| {
        report(&progress, "choosing");
        s.assert_owner(e)?;
        let Some(files) = chooser.dialog().file().blocking_pick_files() else {
            return Ok(json!({"canceled":true}));
        };
        let paths = files
            .into_iter()
            .map(|f| f.into_path().map_err(|_| Error("UNSAFE_MEDIA_PATH")))
            .collect::<vault_core::Result<Vec<_>>>()?;
        report(&progress, "processing");
        s.import_attachments(&paths, e)
    })
    .await
}
#[tauri::command]
// 读取当前授权下的单条详情。
pub async fn get_item(window: WebviewWindow, app: AppHandle, id: String) -> Reply {
    main_window(&window)?;
    run(app, move |s, e| s.get_item(&id, e)).await
}
#[tauri::command]
// 返回匹配资产 ID，避免为搜索传输全部明文资产。
pub async fn search_items(window: WebviewWindow, app: AppHandle, query: String) -> Reply {
    main_window(&window)?;
    run(app, move |s, e| s.search_items(&query, e)).await
}
#[tauri::command]
// 原生选择明文输出位置，返回后再次核对锁定代次。
pub async fn export_attachment(
    window: WebviewWindow,
    app: AppHandle,
    progress: Channel<Progress>,
    item_id: String,
    attachment_id: String,
) -> Reply {
    main_window(&window)?;
    let chooser = app.clone();
    run(app, move |s, e| {
        report(&progress, "choosing");
        let (name, _) = s.attachment(&item_id, &attachment_id, e)?;
        let Some(file) = chooser
            .dialog()
            .file()
            .set_title("导出未加密附件 / Export unencrypted attachment")
            .set_file_name(name)
            .blocking_save_file()
        else {
            return Ok(json!({"canceled":true}));
        };
        s.guard(e)?;
        report(&progress, "processing");
        s.export_attachment(
            &file.into_path().map_err(|_| Error("UNSAFE_MEDIA_PATH"))?,
            &item_id,
            &attachment_id,
            e,
        )
    })
    .await
}
#[tauri::command]
// 报告实际扫描阶段并返回短期介质令牌。
pub async fn scan(window: WebviewWindow, app: AppHandle, progress: Channel<Progress>) -> Reply {
    main_window(&window)?;
    run(app, move |s, _| {
        report(&progress, "scanning");
        s.scan()
    })
    .await
}
#[tauri::command]
// 把双盘令牌和可清零凭据交给恢复服务执行重配。
pub async fn provision(
    window: WebviewWindow,
    app: AppHandle,
    progress: Channel<Progress>,
    primary: String,
    secondary: String,
    password: String,
    secret: String,
) -> Reply {
    main_window(&window)?;
    let p = Zeroizing::new(password);
    let k = Zeroizing::new(secret);
    run(app, move |s, e| {
        report(&progress, "processing");
        s.provision(&primary, &secondary, &p, &k, e)
    })
    .await
}
#[tauri::command]
// 只传入主盘令牌，保持副盘与日常同步解耦。
pub async fn sync(
    window: WebviewWindow,
    app: AppHandle,
    progress: Channel<Progress>,
    primary: String,
) -> Reply {
    main_window(&window)?;
    run(app, move |s, e| {
        report(&progress, "processing");
        s.sync(&primary, e)
    })
    .await
}
#[tauri::command]
// 原生选择加密备份后与两盘令牌一起验证只读恢复。
pub async fn recover(
    window: WebviewWindow,
    app: AppHandle,
    progress: Channel<Progress>,
    primary: String,
    secondary: String,
) -> Reply {
    main_window(&window)?;
    let chooser = app.clone();
    run(app, move |s, e| {
        report(&progress, "choosing");
        let Some(file) = chooser
            .dialog()
            .file()
            .add_filter("LegacyLock", &["llvault", "json"])
            .blocking_pick_file()
        else {
            return Ok(json!({"canceled":true}));
        };
        s.guard(e)?;
        report(&progress, "processing");
        s.recover(
            &file.into_path().map_err(|_| Error("UNSAFE_MEDIA_PATH"))?,
            &primary,
            &secondary,
            e,
        )
    })
    .await
}
#[tauri::command]
// 只收集密码，安全密钥由本机受保护记录提供。
pub async fn unlock_local(window: WebviewWindow, app: AppHandle, password: String) -> Reply {
    main_window(&window)?;
    let p = Zeroizing::new(password);
    run(app, move |s, e| s.unlock_local(&p, e)).await
}
#[tauri::command]
// 把可选双凭据包装为可清零字符串；具体启用条件由服务检查。
pub async fn set_remembered_secret(
    window: WebviewWindow,
    app: AppHandle,
    enabled: bool,
    password: Option<String>,
    secret: Option<String>,
) -> Reply {
    main_window(&window)?;
    let p = Zeroizing::new(password.unwrap_or_default());
    let k = Zeroizing::new(secret.unwrap_or_default());
    run(app, move |s, e| s.set_remembered_secret(enabled, &p, &k, e)).await
}
#[tauri::command]
// 创建密库的双凭据入口，实际存在性检查由服务执行。
pub async fn initialize(
    window: WebviewWindow,
    app: AppHandle,
    password: String,
    secret: String,
) -> Reply {
    main_window(&window)?;
    let p = Zeroizing::new(password);
    let k = Zeroizing::new(secret);
    run(app, move |s, e| s.initialize(&p, &k, e)).await
}
#[tauri::command]
// 解锁或接管入口，不能通过 IPC 指定角色。
pub async fn unlock(
    window: WebviewWindow,
    app: AppHandle,
    password: String,
    secret: String,
) -> Reply {
    main_window(&window)?;
    let p = Zeroizing::new(password);
    let k = Zeroizing::new(secret);
    run(app, move |s, e| s.unlock(&p, &k, e)).await
}
#[tauri::command]
// 将不可信资产 JSON 交给服务校验，前端时间戳不具有权威性。
pub async fn save_item(window: WebviewWindow, app: AppHandle, item: Value) -> Reply {
    main_window(&window)?;
    run(app, move |s, e| s.save_item(item, e)).await
}
#[tauri::command]
// 按 ID 请求服务事务删除。
pub async fn delete_item(window: WebviewWindow, app: AppHandle, id: String) -> Reply {
    main_window(&window)?;
    run(app, move |s, e| s.delete_item(&id, e)).await
}
#[tauri::command]
// 更新加密设置，依赖服务端所有者能力检查。
pub async fn settings(window: WebviewWindow, app: AppHandle, settings: Value) -> Reply {
    main_window(&window)?;
    run(app, move |s, e| s.settings(settings, e)).await
}
#[tauri::command]
// 更新本机外观偏好，依赖服务端白名单校验。
pub async fn set_preferences(window: WebviewWindow, app: AppHandle, preferences: Value) -> Reply {
    main_window(&window)?;
    run(app, move |s, e| s.set_preferences(preferences, e)).await
}
#[tauri::command]
// 核对磁盘与活动会话的一致性。
pub async fn health(window: WebviewWindow, app: AppHandle) -> Reply {
    main_window(&window)?;
    run(app, move |s, e| s.health(e)).await
}
#[tauri::command]
// 以可清零字符串持有新旧双凭据，避免长期保存在宿主状态。
pub async fn credentials(
    window: WebviewWindow,
    app: AppHandle,
    password: String,
    secret: String,
    new_password: String,
    new_secret: String,
) -> Reply {
    main_window(&window)?;
    let p = Zeroizing::new(password);
    let k = Zeroizing::new(secret);
    let np = Zeroizing::new(new_password);
    let nk = Zeroizing::new(new_secret);
    run(app, move |s, e| s.credentials(&p, &k, &np, &nk, e)).await
}
#[tauri::command]
// 原生选择完整备份，交给服务验证身份、版本和双凭据。
pub async fn import_owner(
    window: WebviewWindow,
    app: AppHandle,
    progress: Channel<Progress>,
    password: String,
    secret: String,
) -> Reply {
    main_window(&window)?;
    let chooser = app.clone();
    let p = Zeroizing::new(password);
    let k = Zeroizing::new(secret);
    run(app, move |s, e| {
        report(&progress, "choosing");
        let Some(file) = chooser
            .dialog()
            .file()
            .add_filter("LegacyLock", &["llvault", "json"])
            .blocking_pick_file()
        else {
            return Ok(json!({"canceled":true}));
        };
        s.guard(e)?;
        let path = file.into_path().map_err(|_| Error("UNSAFE_MEDIA_PATH"))?;
        report(&progress, "processing");
        s.import_owner(&path, &p, &k, e)
    })
    .await
}
#[tauri::command]
// 先确认所有者，再选择来源并合并；不覆盖本机恢复配置。
pub async fn import_data(
    window: WebviewWindow,
    app: AppHandle,
    progress: Channel<Progress>,
    password: String,
    secret: String,
) -> Reply {
    main_window(&window)?;
    let chooser = app.clone();
    let p = Zeroizing::new(password);
    let k = Zeroizing::new(secret);
    run(app, move |s, e| {
        report(&progress, "choosing");
        s.assert_owner(e)?;
        let Some(file) = chooser
            .dialog()
            .file()
            .add_filter("LegacyLock", &["llvault", "json"])
            .blocking_pick_file()
        else {
            return Ok(json!({"canceled":true}));
        };
        s.guard(e)?;
        let path = file.into_path().map_err(|_| Error("UNSAFE_MEDIA_PATH"))?;
        report(&progress, "processing");
        s.import_data(&path, &p, &k, e)
    })
    .await
}
#[tauri::command]
// 原生选择加密导出目标，取消选择直接返回 canceled。
pub async fn export(
    window: WebviewWindow,
    app: AppHandle,
    progress: Channel<Progress>,
    password: String,
    secret: String,
) -> Reply {
    main_window(&window)?;
    let chooser = app.clone();
    let p = Zeroizing::new(password);
    let k = Zeroizing::new(secret);
    run(app, move |s, e| {
        report(&progress, "choosing");
        s.assert_owner(e)?;
        let Some(file) = chooser
            .dialog()
            .file()
            .set_file_name("LegacyLock-information.llvault")
            .add_filter("LegacyLock", &["llvault"])
            .blocking_save_file()
        else {
            return Ok(json!({"canceled":true}));
        };
        s.guard(e)?;
        let path = file.into_path().map_err(|_| Error("UNSAFE_MEDIA_PATH"))?;
        report(&progress, "processing");
        s.export(&path, &p, &k, e)
    })
    .await
}
#[tauri::command]
// 申请绑定当前密库版本的一次性删除挑战。
pub async fn prepare_destroy(
    window: WebviewWindow,
    app: AppHandle,
    password: String,
    secret: String,
) -> Reply {
    main_window(&window)?;
    let p = Zeroizing::new(password);
    let k = Zeroizing::new(secret);
    run(app, move |s, e| s.prepare_destroy(&p, &k, e)).await
}
#[tauri::command]
// 提交挑战和确认文字；服务只删除本机专属文件。
pub async fn destroy(
    window: WebviewWindow,
    app: AppHandle,
    token: String,
    confirmation: String,
) -> Reply {
    main_window(&window)?;
    run(app, move |s, e| s.destroy(&token, &confirmation, e)).await
}
#[tauri::command]
// 复制后建立序号绑定的三十秒清理任务；锁定也会触发清理。
pub fn copy(window: WebviewWindow, app: AppHandle, text: String) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    main_window(&window)?;
    let state = app.state::<Backend>();
    let epoch = state.service.epoch();
    state.service.assert_unlocked(epoch).map_err(|e| e.0)?;
    if text.len() > vault_core::MAX_BYTES {
        return Err("INVALID_SIZE".into());
    }
    let value = Zeroizing::new(text);
    let mut saved = state.clipboard.lock().map_err(|_| "SERVICE_FAILED")?;
    state.service.guard(epoch).map_err(|e| e.0)?;
    app.clipboard()
        .write_text(value.as_str())
        .map_err(|_| "CLIPBOARD_UNAVAILABLE")?;
    let sequence = state
        .clipboard_sequence
        .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    *saved = Some((sequence, value));
    drop(saved);
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(30));
        app.state::<Backend>()
            .clear_clipboard_if(&app, Some(sequence));
    });
    Ok(())
}
