// 本机安全密钥记忆：将 DPAPI 密文与密库 ID、公钥及 owner 槽摘要绑定。
// 显式启用必须重新验证双凭据；凭据变化、记录失配或操作失败时不可继续使用旧记忆。
use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;
// 检查本机记忆记录结构和密文长度，拒绝损坏记录。
fn validate_record(v: &Value) -> Result<()> {
    if v.as_object().is_some_and(|m| m.len() == 5)
        && v["format"] == 1
        && v["id"].is_string()
        && v["signingPublicKey"].is_string()
        && v["ownerHash"].is_string()
        && v["cipher"].as_str().is_some_and(|s| s.len() < 65536)
    {
        Ok(())
    } else {
        Err(Error("LOCAL_KEY_UNAVAILABLE"))
    }
}
// 对 owner 槽规范化后取摘要；换凭据会使旧绑定失效。
fn binding(v: &Value) -> String {
    format!("{:x}", Sha256::digest(canonical_js(&v["owner"]).as_bytes()))
}
impl Service {
    // 使用新版独立记忆文件，不读取旧 Electron 的本机密钥文件。
    fn remembered_path(&self) -> PathBuf {
        self.file.with_file_name("local-key-tauri-v1.json")
    }
    // 仅报告平台能力和记录存在性；存在并不保证之后能成功解密。
    pub fn local_unlock_status(&self) -> Value {
        json!({"available":self.local_secret.available(),"remembered":self.remembered_path().exists()})
    }
    // 删除本机记忆、上一版和专属临时文件，不碰密库或 USB。
    pub(crate) fn forget_secret(&self) -> Result<()> {
        let path = self.remembered_path();
        let mut paths = storage::owned_temporaries(&path)?;
        paths.extend([path.clone(), suffix(&path, ".previous")]);
        for p in paths {
            storage::safe_path(&p)?;
            match fs::remove_file(p) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => return Err(Error("LOCAL_KEY_UNAVAILABLE")),
            }
        }
        Ok(())
    }
    // 启用前重新验证双凭据，并校验 DPAPI 往返；写入或撤权失败时清理记忆。
    pub fn set_remembered_secret(
        &self,
        enabled: bool,
        password: &str,
        secret: &str,
        epoch: u64,
    ) -> Result<Value> {
        let _q = self.serial(epoch)?;
        let s = self.owner(epoch)?;
        if !enabled {
            self.forget_secret()?;
            return Ok(json!({"localUnlock":self.local_unlock_status()}));
        }
        if !self.local_secret.available() {
            return Err(Error("LOCAL_KEY_UNAVAILABLE"));
        }
        let _checked = vault_core::unlock_owner(s.envelope().clone(), password, secret)?;
        self.guard(epoch)?;
        let cipher = self.local_secret.seal(secret.as_bytes())?;
        let decoded = self.local_secret.unseal(&cipher)?;
        if decoded.as_slice() != secret.as_bytes() {
            return Err(Error("LOCAL_KEY_UNAVAILABLE"));
        }
        let envelope = s.envelope();
        let record = json!({"format":1,"id":envelope["id"],"signingPublicKey":envelope["signingPublicKey"],"ownerHash":binding(envelope),"cipher":STANDARD.encode(cipher)});
        let path = self.remembered_path();
        let old = match read(&path) {
            Ok(v) => Some(v),
            Err(Error("NOT_FOUND")) => None,
            Err(_) => return Err(Error("LOCAL_KEY_UNAVAILABLE")),
        };
        let result = storage::write_checked(
            &path,
            &record,
            old.as_ref(),
            &|| self.guard(epoch),
            &|_| Ok(()),
            validate_record,
        );
        let result = result.and_then(|_| self.guard(epoch));
        if result.is_err() {
            let _ = self.forget_secret();
        }
        result?;
        Ok(json!({"localUnlock":self.local_unlock_status()}))
    }
    // 在锁定状态下复核记录绑定，以 DPAPI 取回安全密钥，再结合用户密码解锁。
    pub fn unlock_local(&self, password: &str, epoch: u64) -> Result<Value> {
        let _q = self.serial(epoch)?;
        if mutex(&self.session)?
            .as_ref()
            .is_some_and(|a| a.epoch == epoch)
        {
            return Err(Error("OWNER_REQUIRED"));
        }
        let envelope = read_envelope(&self.file)?;
        let record = read(&self.remembered_path()).map_err(|_| Error("LOCAL_KEY_UNAVAILABLE"))?;
        validate_record(&record)?;
        if record["id"] != envelope["id"]
            || record["signingPublicKey"] != envelope["signingPublicKey"]
            || record["ownerHash"] != binding(&envelope)
        {
            return Err(Error("LOCAL_KEY_UNAVAILABLE"));
        }
        let cipher = STANDARD
            .decode(
                record["cipher"]
                    .as_str()
                    .ok_or(Error("LOCAL_KEY_UNAVAILABLE"))?,
            )
            .map_err(|_| Error("LOCAL_KEY_UNAVAILABLE"))?;
        let bytes = self.local_secret.unseal(&cipher)?;
        let secret = Zeroizing::new(
            String::from_utf8(bytes.to_vec()).map_err(|_| Error("LOCAL_KEY_UNAVAILABLE"))?,
        );
        let s = vault_core::unlock_owner(envelope, password, &secret)?;
        self.grant(s, self.file.clone(), epoch)
    }
}
