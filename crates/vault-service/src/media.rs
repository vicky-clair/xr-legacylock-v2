// USB 枚举与令牌解析：Windows 固定系统命令只读扫描，前端提交短期 token 而非任意路径。
// 盘符与物理身份在使用时重新核对；这是介质存在性检查，不是硬件防克隆认证。
use crate::storage::{random_token, safe_path};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};
use vault_core::{Error, Result};
#[derive(Clone, Debug, PartialEq)]
pub struct Drive {
    pub root: PathBuf,
    pub physical: String,
    pub label: String,
    pub size: u64,
}
pub trait MediaProvider: Send + Sync {
    // 扫描实际设备；平台实现只读枚举，Media 实现把结果转换成新令牌。
    fn scan(&self) -> Result<Vec<Drive>>;
}
pub struct PlatformMedia;
#[cfg(windows)]
impl MediaProvider for PlatformMedia {
    // 扫描实际设备；平台实现只读枚举，Media 实现把结果转换成新令牌。
    fn scan(&self) -> Result<Vec<Drive>> {
        use base64::{Engine, engine::general_purpose::STANDARD};
        use std::{
            io::Read,
            os::windows::process::CommandExt,
            process::{Command, Stdio},
        };
        // 脚本为固定常量，不拼接前端参数；排除系统盘和启动盘，仅枚举 USB。
        const SCRIPT: &str = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new(); $result=@(Get-Disk | Where-Object { $_.BusType -eq 'USB' -and -not $_.IsBoot -and -not $_.IsSystem } | ForEach-Object { $disk=$_; Get-Partition -DiskNumber $disk.Number | Where-Object DriveLetter | ForEach-Object { $v=$_ | Get-Volume; [pscustomobject]@{ root=([string]$_.DriveLetter+':\\'); physical=([string]$disk.Number+':'+[string]$disk.UniqueId); label=[string]$v.FileSystemLabel; size=$v.Size } } }); ConvertTo-Json -InputObject $result -Compress";
        let encoded = STANDARD.encode(
            SCRIPT
                .encode_utf16()
                .flat_map(u16::to_le_bytes)
                .collect::<Vec<_>>(),
        );
        let system = std::env::var_os("SystemRoot")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("C:\\Windows"));
        if !system.is_absolute() {
            return Err(Error("UNSUPPORTED_PLATFORM"));
        }
        let mut child = Command::new(system.join("System32/WindowsPowerShell/v1.0/powershell.exe"))
            .args(["-NoProfile", "-NonInteractive", "-EncodedCommand", &encoded])
            .creation_flags(0x08000000)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| Error("USB_SCAN_FAILED"))?;
        let output = child.stdout.take().ok_or(Error("USB_SCAN_FAILED"))?;
        let reader = std::thread::spawn(move || {
            let mut bytes = Vec::new();
            output
                .take(2 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)
                .map(|_| bytes)
        });
        let started = Instant::now();
        let status = loop {
            if let Some(s) = child.try_wait().map_err(|_| Error("USB_SCAN_FAILED"))? {
                break s;
            }
            if started.elapsed() > Duration::from_secs(15) {
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                return Err(Error("USB_SCAN_TIMEOUT"));
            }
            std::thread::sleep(Duration::from_millis(50));
        };
        let bytes = reader
            .join()
            .map_err(|_| Error("USB_SCAN_FAILED"))?
            .map_err(|_| Error("USB_SCAN_FAILED"))?;
        if !status.success() || bytes.len() > 2 * 1024 * 1024 {
            return Err(Error("USB_SCAN_FAILED"));
        }
        let text = std::str::from_utf8(&bytes)
            .map_err(|_| Error("USB_SCAN_FAILED"))?
            .trim_start_matches('\u{feff}');
        let rows: Value = serde_json::from_str(text).map_err(|_| Error("USB_SCAN_FAILED"))?;
        rows.as_array()
            .ok_or(Error("USB_SCAN_FAILED"))?
            .iter()
            .map(|r| {
                let root = PathBuf::from(r["root"].as_str().ok_or(Error("USB_SCAN_FAILED"))?);
                let physical = r["physical"]
                    .as_str()
                    .ok_or(Error("USB_SCAN_FAILED"))?
                    .to_owned();
                if !root.is_absolute() || physical.is_empty() {
                    return Err(Error("USB_SCAN_FAILED"));
                }
                Ok(Drive {
                    root,
                    physical,
                    label: r["label"].as_str().unwrap_or("").to_owned(),
                    size: r["size"].as_u64().unwrap_or(0),
                })
            })
            .collect()
    }
}
#[cfg(not(windows))]
impl MediaProvider for PlatformMedia {
    // 扫描实际设备；平台实现只读枚举，Media 实现把结果转换成新令牌。
    fn scan(&self) -> Result<Vec<Drive>> {
        Err(Error("UNSUPPORTED_PLATFORM"))
    }
}
pub struct Media {
    provider: Box<dyn MediaProvider>,
    tokens: Mutex<Vec<(String, Drive, Instant)>>,
}
impl Default for Media {
    fn default() -> Self {
        Self::new(Box::new(PlatformMedia))
    }
}
impl Media {
    // 注入设备扫描器，便于实际 Windows 枚举与测试替身共用业务逻辑。
    pub fn new(provider: Box<dyn MediaProvider>) -> Self {
        Self {
            provider,
            tokens: Mutex::new(Vec::new()),
        }
    }
    // 扫描实际设备；平台实现只读枚举，Media 实现把结果转换成新令牌。
    pub fn scan(&self) -> Result<Value> {
        let drives = self.provider.scan()?;
        let mut tokens = self.tokens.lock().map_err(|_| Error("SERVICE_FAILED"))?;
        tokens.clear();
        for d in drives {
            tokens.push((random_token(), d, Instant::now()));
        }
        Ok(Value::Array(
            tokens
                .iter()
                .map(|(t, d, _)| json!({"token":t,"root":d.root,"label":d.label,"size":d.size}))
                .collect(),
        ))
    }
    // 令牌有效期为五分钟，解析后重新扫描核对介质仍在原位置。
    pub fn resolve(&self, token: &str) -> Result<Drive> {
        let drive = {
            let tokens = self.tokens.lock().map_err(|_| Error("SERVICE_FAILED"))?;
            tokens
                .iter()
                .find(|(t, _, at)| t == token && at.elapsed() < Duration::from_secs(300))
                .map(|(_, d, _)| d.clone())
                .ok_or(Error("USB_NOT_PRESENT"))?
        };
        self.present(std::slice::from_ref(&drive))?;
        Ok(drive)
    }
    // 主副盘必须具有不同物理身份，两个盘符不一定代表两块盘。
    pub fn pair(&self, a: &str, b: &str) -> Result<[Drive; 2]> {
        let a = self.resolve(a)?;
        let b = self.resolve(b)?;
        if a.physical == b.physical {
            return Err(Error("TWO_PHYSICAL_DRIVES_REQUIRED"));
        }
        Ok([a, b])
    }
    // 同时匹配根路径和物理身份，拒绝同盘符已被其他设备占用的情况。
    pub fn present(&self, expected: &[Drive]) -> Result<()> {
        let current = self.provider.scan()?;
        if expected.iter().all(|d| {
            current
                .iter()
                .any(|c| c.root == d.root && c.physical == d.physical)
        }) {
            Ok(())
        } else {
            Err(Error("USB_NOT_PRESENT"))
        }
    }
}
// 从经验证的密库 ID 与恢复代次构造固定 USB 布局，拒绝路径跳转。
pub fn location(drive: &Drive, envelope: &Value) -> Result<PathBuf> {
    let id = envelope["id"].as_str().ok_or(Error("INVALID_FORMAT"))?;
    if id.len() != 36 || !id.bytes().all(|c| c.is_ascii_hexdigit() || c == b'-') {
        return Err(Error("INVALID_FORMAT"));
    }
    let generation = envelope["recovery"]["generation"]
        .as_u64()
        .ok_or(Error("NO_RECOVERY"))?;
    let path = drive
        .root
        .join("LegacyLock")
        .join(id)
        .join(generation.to_string());
    safe_path(&path)?;
    Ok(path)
}
// 创建目录前后检查路径，避免写入链接目标。
pub fn create_location(path: &Path) -> Result<()> {
    safe_path(path)?;
    std::fs::create_dir_all(path).map_err(|_| Error("WRITE_FAILED"))?;
    safe_path(path)
}
