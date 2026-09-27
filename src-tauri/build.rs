// 构建时生成具名命令权限定义；这里只声明命令，实际授权由 capabilities/main.json 决定。
// 生成 allow/deny 命令权限清单，新增命令必须同步宿主注册和主窗口授权。
fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "export_attachment",
            "import_attachments",
            "get_item",
            "search_items",
            "scan",
            "provision",
            "sync",
            "recover",
            "status",
            "preferences",
            "local_unlock_status",
            "new_secret",
            "lock",
            "activity",
            "view_language",
            "window_control",
            "initialize",
            "unlock",
            "save_item",
            "delete_item",
            "settings",
            "set_preferences",
            "unlock_local",
            "set_remembered_secret",
            "health",
            "credentials",
            "import_owner",
            "import_data",
            "export",
            "prepare_destroy",
            "destroy",
            "copy",
        ]),
    ))
    .expect("Tauri manifest build failed");
}
