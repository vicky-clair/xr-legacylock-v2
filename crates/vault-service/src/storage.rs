// 受约束文件访问和原子发布：同目录临时写入、同步、读回验证、保存 previous、替换并再次验证。
// 替换开始后的失败返回 COMMIT_UNCERTAIN；调用方必须撤销会话并重新读取磁盘，不能假设回滚成功。
use rand::RngCore;
use serde_json::Value;
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use vault_core::{Error, MAX_BYTES, Result, canonical_js, parse, validate_envelope};

// 逐级拒绝符号链接和 Windows 重解析点；并不代替系统访问权限控制。
pub fn safe_path(path: &Path) -> Result<()> {
    for part in path.ancestors() {
        match fs::symlink_metadata(part) {
            Ok(m) => {
                if m.file_type().is_symlink() {
                    return Err(Error("UNSAFE_MEDIA_PATH"));
                }
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    if m.file_attributes() & 0x400 != 0 {
                        return Err(Error("UNSAFE_MEDIA_PATH"));
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(Error("READ_FAILED")),
        }
    }
    Ok(())
}
// 限制读取长度并比较前后字节数，避免把变化中的文件当作稳定输入。
pub fn read(path: &Path) -> Result<Value> {
    safe_path(path)?;
    let f = File::open(path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            Error("NOT_FOUND")
        } else {
            Error("READ_FAILED")
        }
    })?;
    let m = f.metadata().map_err(|_| Error("READ_FAILED"))?;
    if !m.is_file() || m.len() > MAX_BYTES as u64 {
        return Err(Error("INVALID_SIZE"));
    }
    let mut bytes = Vec::new();
    f.take((MAX_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| Error("READ_FAILED"))?;
    if bytes.len() as u64 != m.len() {
        return Err(Error("FILE_CHANGED"));
    }
    parse(&bytes)
}
// 读取 JSON 后验证封套结构及签名。
pub fn read_envelope(path: &Path) -> Result<Value> {
    let v = read(path)?;
    validate_envelope(&v)?;
    Ok(v)
}
// 在完整文件名末尾追加后缀，避免替换原扩展名。
pub fn suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut p = path.as_os_str().to_os_string();
    p.push(suffix);
    p.into()
}
// 生成随机令牌或临时文件名后缀，不使用可预测时间戳。
pub fn random_token() -> String {
    let mut bytes = [0; 24];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
// 只枚举当前文件的固定前缀和 48 位十六进制临时后缀，不递归删除目录。
pub fn owned_temporaries(path: &Path) -> Result<Vec<PathBuf>> {
    let parent = path.parent().ok_or(Error("UNSAFE_MEDIA_PATH"))?;
    safe_path(parent)?;
    let name = path
        .file_name()
        .ok_or(Error("UNSAFE_MEDIA_PATH"))?
        .to_string_lossy();
    let prefixes = [format!("{name}.tmp-"), format!("{name}.previous.tmp-")];
    let mut paths = Vec::new();
    for entry in fs::read_dir(parent).map_err(|_| Error("READ_FAILED"))? {
        let entry = entry.map_err(|_| Error("READ_FAILED"))?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if prefixes.iter().any(|p| {
            name.strip_prefix(p)
                .is_some_and(|s| s.len() == 48 && s.bytes().all(|c| c.is_ascii_hexdigit()))
        }) {
            paths.push(entry.path());
        }
    }
    Ok(paths)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stage {
    BeforeWrite,
    AfterWrite,
    AfterSync,
    AfterReadback,
    BeforeReplace,
    AfterReplace,
    AfterVerify,
}
pub trait AtomicVaultWriter: Send + Sync {
    fn write(
        &self,
        path: &Path,
        value: &Value,
        expected: Option<&Value>,
        guard: &dyn Fn() -> Result<()>,
    ) -> Result<()>;
}
pub struct DurableWriter;
impl AtomicVaultWriter for DurableWriter {
    fn write(
        &self,
        path: &Path,
        value: &Value,
        expected: Option<&Value>,
        guard: &dyn Fn() -> Result<()>,
    ) -> Result<()> {
        write_checked(path, value, expected, guard, &|_| Ok(()), validate_envelope)
    }
}
struct Temp(PathBuf);
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
// 在目标同目录以 create_new 创建临时文件，写完同步，再交给调用方验证。
fn temporary(path: &Path, body: &[u8], fault: &dyn Fn(Stage) -> Result<()>) -> Result<Temp> {
    let temp = Temp(suffix(path, &format!(".tmp-{}", random_token())));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut f = options.open(&temp.0).map_err(|_| Error("WRITE_FAILED"))?;
    f.write_all(body).map_err(|_| Error("WRITE_FAILED"))?;
    fault(Stage::AfterWrite)?;
    f.sync_all().map_err(|_| Error("WRITE_FAILED"))?;
    fault(Stage::AfterSync)?;
    Ok(temp)
}
/// 完整字节同步并验证后才发布导出文件。
/// 不替换用户选择位置中已经存在的文件。
// 导出只发布新文件：同步、逐字节读回、检查会话，再执行禁止覆盖的发布操作。
pub fn export_new(path: &Path, bytes: &[u8], guard: &dyn Fn() -> Result<()>) -> Result<()> {
    safe_path(path)?;
    guard()?;
    if path.exists() {
        return Err(Error("OUTPUT_EXISTS_OR_UNAVAILABLE"));
    }
    let temp = temporary(path, bytes, &|_| Ok(()))?;
    let check = zeroize::Zeroizing::new(fs::read(&temp.0).map_err(|_| Error("READ_FAILED"))?);
    if check.as_slice() != bytes {
        return Err(Error("WRITE_VERIFICATION_FAILED"));
    }
    guard()?;
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{MOVEFILE_WRITE_THROUGH, MoveFileExW};
        let from: Vec<u16> = temp.0.as_os_str().encode_wide().chain(Some(0)).collect();
        let to: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        // SAFETY: 两个缓冲区以 NUL 结尾且在调用期间有效；没有设置覆盖标志。
        if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), MOVEFILE_WRITE_THROUGH) } == 0 {
            return Err(Error("OUTPUT_EXISTS_OR_UNAVAILABLE"));
        }
    }
    #[cfg(not(windows))]
    {
        fs::hard_link(&temp.0, path).map_err(|_| Error("OUTPUT_EXISTS_OR_UNAVAILABLE"))?;
        File::open(path.parent().ok_or(Error("UNSAFE_MEDIA_PATH"))?)
            .and_then(|f| f.sync_all())
            .map_err(|_| Error("COMMIT_UNCERTAIN"))?;
    }
    guard()
}
// 以 expected 做磁盘并发检查，先保留上一完整版本，再进入不可假定回滚的替换阶段。
pub fn write_checked(
    path: &Path,
    value: &Value,
    expected: Option<&Value>,
    guard: &dyn Fn() -> Result<()>,
    fault: &dyn Fn(Stage) -> Result<()>,
    verify: fn(&Value) -> Result<()>,
) -> Result<()> {
    safe_path(path)?;
    let backup = suffix(path, ".previous");
    safe_path(&backup)?;
    verify(value)?;
    let body = canonical_js(value);
    if body.len() > MAX_BYTES {
        return Err(Error("INVALID_SIZE"));
    }
    guard()?;
    fault(Stage::BeforeWrite)?;
    let temp = temporary(path, body.as_bytes(), fault)?;
    let check = read(&temp.0)?;
    verify(&check)?;
    if canonical_js(&check) != body {
        return Err(Error("WRITE_VERIFICATION_FAILED"));
    }
    fault(Stage::AfterReadback)?;
    match read(path) {
        Ok(old) => {
            if expected.is_none_or(|e| canonical_js(e) != canonical_js(&old)) {
                return Err(Error("LOCAL_VAULT_CHANGED"));
            }
            verify(&old)?;
            let previous = temporary(&backup, canonical_js(&old).as_bytes(), &|_| Ok(()))?;
            replace(&previous.0, &backup).map_err(|_| Error("WRITE_FAILED"))?;
        }
        Err(Error("NOT_FOUND")) if expected.is_none() => {}
        Err(Error("NOT_FOUND")) => return Err(Error("LOCAL_VAULT_CHANGED")),
        Err(e) => return Err(e),
    }
    fault(Stage::BeforeReplace)?;
    guard()?;
    // 从这里开始结果可能不确定，调用方必须撤销会话。
    let final_result = (|| {
        replace(&temp.0, path).map_err(|_| Error("WRITE_FAILED"))?;
        fault(Stage::AfterReplace)?;
        #[cfg(unix)]
        File::open(path.parent().ok_or(Error("UNSAFE_MEDIA_PATH"))?)
            .and_then(|f| f.sync_all())
            .map_err(|_| Error("WRITE_FAILED"))?;
        let saved = read(path)?;
        verify(&saved)?;
        if canonical_js(&saved) != body {
            return Err(Error("WRITE_VERIFICATION_FAILED"));
        }
        fault(Stage::AfterVerify)?;
        Ok(())
    })();
    final_result.map_err(|_: Error| Error("COMMIT_UNCERTAIN"))?;
    guard()
}
#[cfg(windows)]
// 执行平台原子替换；Windows 同时请求替换已有文件和写穿，非 Windows 使用 rename。
fn replace(source: &Path, target: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };
    let from: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    // SAFETY: 两个以 NUL 结尾的缓冲区在同步系统调用期间始终有效。
    if unsafe {
        MoveFileExW(
            from.as_ptr(),
            to.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    } == 0
    {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}
#[cfg(not(windows))]
// 执行平台原子替换；Windows 同时请求替换已有文件和写穿，非 Windows 使用 rename。
fn replace(source: &Path, target: &Path) -> std::io::Result<()> {
    fs::rename(source, target)
}
