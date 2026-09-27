// 双 USB 恢复流程：新代次两盘写入并验证后才提交本机配置；日常同步只访问主盘。
// 继承恢复仅建立只读会话，保留外部源文件，本机密库不会被自动替换。
use super::*;
impl Service {
    // 获取新一轮介质令牌，之前扫描得到的令牌随之失效。
    pub fn scan(&self) -> Result<Value> {
        self.media.scan()
    }
    // 仅对当前继承会话检查绑定设备；设备消失或枚举失败时撤权。
    pub fn check_recovery_devices(&self) -> bool {
        let pair = match self.recovery_drives.try_lock() {
            Ok(p) => p.clone(),
            Err(_) => return true,
        };
        let Some((epoch, pair)) = pair else {
            return true;
        };
        if self.epoch() != epoch {
            return true;
        }
        let heir = mutex(&self.session).ok().is_some_and(|s| {
            s.as_ref()
                .is_some_and(|a| a.epoch == epoch && !a.session.is_owner())
        });
        if !heir {
            return true;
        }
        if self.media.present(&pair).is_err() && self.epoch() == epoch {
            self.lock();
            false
        } else {
            true
        }
    }
    // 两块不同物理盘完成新份额和主备份验证后，最后提交本机恢复配置。
    pub fn provision(
        &self,
        primary: &str,
        secondary: &str,
        password: &str,
        secret: &str,
        epoch: u64,
    ) -> Result<Value> {
        let _q = self.serial(epoch)?;
        let mut s = self.owner(epoch)?;
        let expected = s.envelope().clone();
        let pair = self.media.pair(primary, secondary)?;
        let (mut a, mut b) = s.rotate_recovery(password, secret)?;
        self.guard(epoch)?;
        let mut dirs = [
            media::location(&pair[0], s.envelope())?,
            media::location(&pair[1], s.envelope())?,
        ];
        // 保留崩溃遗留的代次目录，在未占用的新代次重试。
        for _ in 0..64 {
            if dirs.iter().all(|p| !p.exists()) {
                break;
            }
            (a, b) = s.provision()?;
            dirs = [
                media::location(&pair[0], s.envelope())?,
                media::location(&pair[1], s.envelope())?,
            ];
        }
        if dirs.iter().any(|p| p.exists()) {
            return Err(Error("RECOVERY_DIRECTORY_EXISTS"));
        }
        for dir in &dirs {
            media::create_location(dir)?;
        }
        let guard = || {
            self.guard(epoch)?;
            self.media.present(&pair)
        };
        storage::write_checked(
            &dirs[0].join("primary.llkey"),
            &a,
            None,
            &guard,
            &|_| Ok(()),
            vault_core::validate_recovery_share,
        )?;
        storage::write_checked(
            &dirs[1].join("secondary.llkey"),
            &b,
            None,
            &guard,
            &|_| Ok(()),
            vault_core::validate_recovery_share,
        )?;
        let vault = dirs[0].join("vault.llvault");
        self.writer.write(&vault, s.envelope(), None, &guard)?;
        let ra = read(&dirs[0].join("primary.llkey"))?;
        let rb = read(&dirs[1].join("secondary.llkey"))?;
        let _checked = vault_core::unlock_recovery(read_envelope(&vault)?, &ra, &rb)?;
        guard()?;
        // 两盘的新代次均完整可读后，才更改本机 owner 槽和恢复配置。
        let view = self.commit(s, Some(&expected), epoch)?;
        Ok(json!({"view":view,"paths":[vault]}))
    }
    // 验证当前主份额后只更新主盘备份；不读取或改写副盘。
    pub fn sync(&self, primary: &str, epoch: u64) -> Result<Value> {
        let _q = self.serial(epoch)?;
        let s = self.owner(epoch)?;
        let drive = self.media.resolve(primary)?;
        let dir = media::location(&drive, s.envelope())?;
        vault_core::validate_primary(&read(&dir.join("primary.llkey"))?, s.envelope())?;
        let file = dir.join("vault.llvault");
        let old = match read_envelope(&file) {
            Ok(v) => Some(v),
            Err(Error("NOT_FOUND")) => None,
            Err(e) => return Err(e),
        };
        if let Some(old) = &old {
            if old["id"] != s.envelope()["id"]
                || old["signingPublicKey"] != s.envelope()["signingPublicKey"]
            {
                return Err(Error("WRONG_VAULT"));
            }
            if old["revision"].as_f64() > s.envelope()["revision"].as_f64() {
                return Err(Error("OLDER_BACKUP"));
            }
        }
        self.writer.write(&file, s.envelope(), old.as_ref(), &|| {
            self.guard(epoch)?;
            self.media.present(std::slice::from_ref(&drive))
        })?;
        self.guard(epoch)?;
        Ok(json!({"revision":s.envelope()["revision"],"paths":[file]}))
    }
    // 复核双盘和份额后建立绑定设备的只读会话，不提交本机文件。
    pub fn recover(
        &self,
        path: &Path,
        primary: &str,
        secondary: &str,
        epoch: u64,
    ) -> Result<Value> {
        let _q = self.serial(epoch)?;
        let pair = self.media.pair(primary, secondary)?;
        let envelope = read_envelope(path)?;
        let a = read(&media::location(&pair[0], &envelope)?.join("primary.llkey"))?;
        let b = read(&media::location(&pair[1], &envelope)?.join("secondary.llkey"))?;
        let session = vault_core::unlock_recovery(envelope, &a, &b)?;
        self.media.present(&pair)?;
        self.guard(epoch)?;
        let view = self.grant(session, path.to_owned(), epoch)?;
        *mutex(&self.recovery_drives)? = Some((epoch, pair));
        Ok(json!({"view":view}))
    }
}
