// Windows 锁屏、挂起和会话结束通知：在原生窗口回调中撤销密库会话。
// 非 Windows 分支仅允许宿主启动，不表示已实现对应系统事件适配。
#[cfg(windows)]
pub fn install(window: &tauri::WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::Manager;
    use windows_sys::Win32::{Foundation::*, System::RemoteDesktop::*, UI::Shell::*};
    unsafe extern "system" fn callback(
        hwnd: HWND,
        msg: u32,
        wp: WPARAM,
        lp: LPARAM,
        id: usize,
        data: usize,
    ) -> LRESULT {
        // Box 由窗口子类回调持有，直到 WM_NCDESTROY 时释放。
        let app = unsafe { &*(data as *const tauri::AppHandle) };
        // 消息对应 WTS_SESSION_LOCK、PBT_APMSUSPEND 和 WM_QUERYENDSESSION，均立即撤权。
        if ((msg == 0x02b1 && wp == 7) || (msg == 0x0218 && wp == 4) || msg == 0x0011)
            && let Some(state) = app.try_state::<crate::backend::Backend>()
        {
            state.lock(app);
        }
        if msg == 0x0082 {
            unsafe {
                WTSUnRegisterSessionNotification(hwnd);
                RemoveWindowSubclass(hwnd, Some(callback), id);
                drop(Box::from_raw(data as *mut tauri::AppHandle));
            }
        }
        unsafe { DefSubclassProc(hwnd, msg, wp, lp) }
    }
    let hwnd = window.hwnd()?.0;
    let context = Box::into_raw(Box::new(window.app_handle().clone()));
    // 安装在主 UI 线程执行，HWND 在 WM_NCDESTROY 前保持有效。
    unsafe {
        if SetWindowSubclass(hwnd, Some(callback), 0x4c4c, context as usize) == 0 {
            drop(Box::from_raw(context));
            return Err("Could not register secure window lifecycle".into());
        }
        if WTSRegisterSessionNotification(hwnd, 0) == 0 {
            RemoveWindowSubclass(hwnd, Some(callback), 0x4c4c);
            drop(Box::from_raw(context));
            return Err("Could not register session lock notifications".into());
        }
    }
    Ok(())
}
#[cfg(not(windows))]
pub fn install(_: &tauri::WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}
