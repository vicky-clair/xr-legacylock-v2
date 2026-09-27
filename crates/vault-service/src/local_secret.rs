// 操作系统密钥封装接口：Windows 使用当前用户 DPAPI；不使用机器级共享解密。
// 未实现的平台显式返回不可用；明文结果使用 Zeroizing，Windows 分配内存使用 LocalFree 释放。
use vault_core::{Error, Result};
use zeroize::Zeroizing;
pub trait LocalSecretStore: Send + Sync {
    fn available(&self) -> bool;
    fn seal(&self, plain: &[u8]) -> Result<Vec<u8>>;
    fn unseal(&self, cipher: &[u8]) -> Result<Zeroizing<Vec<u8>>>;
}
pub struct PlatformSecretStore;
#[cfg(windows)]
impl LocalSecretStore for PlatformSecretStore {
    fn available(&self) -> bool {
        true
    }
    fn seal(&self, plain: &[u8]) -> Result<Vec<u8>> {
        protect(plain, true).map(|v| v.to_vec())
    }
    fn unseal(&self, cipher: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
        protect(cipher, false)
    }
}
#[cfg(windows)]
// 调用当前用户 DPAPI，并在复制返回值后清零、释放系统分配的缓冲区。
fn protect(bytes: &[u8], encrypt: bool) -> Result<Zeroizing<Vec<u8>>> {
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
        },
    };
    if bytes.len() > 65536 {
        return Err(Error("LOCAL_KEY_UNAVAILABLE"));
    }
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len() as u32,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    // SAFETY: 输入的 cbData 字节可读；DPAPI 分配输出，下面复制后按对应分配器释放。
    let ok = unsafe {
        if encrypt {
            CryptProtectData(
                &input,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
    };
    if ok == 0 {
        return Err(Error("LOCAL_KEY_UNAVAILABLE"));
    }
    // SAFETY: 成功的 DPAPI 调用提供 cbData 字节；LocalFree 与其分配器匹配。
    unsafe {
        let result = Zeroizing::new(
            std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec(),
        );
        std::ptr::write_bytes(output.pbData, 0, output.cbData as usize);
        LocalFree(output.pbData as _);
        Ok(result)
    }
}
#[cfg(not(windows))]
impl LocalSecretStore for PlatformSecretStore {
    fn available(&self) -> bool {
        false
    }
    fn seal(&self, _: &[u8]) -> Result<Vec<u8>> {
        Err(Error("LOCAL_KEY_UNAVAILABLE"))
    }
    fn unseal(&self, _: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
        Err(Error("LOCAL_KEY_UNAVAILABLE"))
    }
}
