// 密库业务服务：持有进程文件锁、会话和事务写入器，向宿主提供受权限约束的操作。
// 每个长任务携带开始时的 epoch；锁定递增 epoch，使旧任务不能重新授权或返回旧秘密。
mod attachments;
pub mod local_secret;
pub mod media;
mod recovery;
mod remembered;
pub mod storage;
use fs2::FileExt;
use serde_json::{Value, json};
use std::{
    fs::{self, File, OpenOptions},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use storage::{AtomicVaultWriter, DurableWriter, random_token, read, read_envelope, suffix};
use vault_core::{Error, Result, Session, canonical_js};

struct Active {
    // 把会话和最初授权代次绑定；source 也可能是外部只读恢复文件。
    epoch: u64,
    session: Session,
    source: PathBuf,
}
struct Challenge {
    // 删除挑战不仅校验 token，还绑定代次、版本和有效期。
    token: String,
    epoch: u64,
    revision: Value,
    expires: Instant,
}
pub struct Service {
    media: media::Media,
    recovery_drives: Mutex<Option<(u64, [media::Drive; 2])>>,
    local_secret: Arc<dyn local_secret::LocalSecretStore>,
    file: PathBuf,
    preferences_file: PathBuf,
    _file_lock: File,
    // 进程锁、撤权代次、会话锁和业务操作锁分别解决不同层面的并发问题。
    epoch: Arc<AtomicU64>,
    session: Arc<Mutex<Option<Active>>>,
    cleanup_pending: Arc<AtomicBool>,
    operation: Mutex<()>,
    writer: Arc<dyn AtomicVaultWriter>,
    preferences: Mutex<Value>,
    preferences_warning: bool,
    challenge: Mutex<Option<Challenge>>,
    started: Instant,
    last_activity: AtomicU64,
}
// 把互斥锁中毒转换为服务失败，不继续使用未经确认的状态。
fn mutex<T>(m: &Mutex<T>) -> Result<std::sync::MutexGuard<'_, T>> {
    m.lock().map_err(|_| Error("SERVICE_FAILED"))
}
// 未配置时使用本地显示默认值；这不会创建或解锁密库。
fn defaults() -> Value {
    json!({"theme":"royal_violet","zoom":1,"subscriptionDemo":"trial","language":"zh","closeToTray":false})
}
// 只接受五个固定偏好字段和受支持选项。
pub fn validate_preferences(v: &Value) -> Result<()> {
    let valid = v.as_object().is_some_and(|m| m.len() == 5)
        && ["zh", "en", "ja"].iter().any(|x| v["language"] == *x)
        && v["closeToTray"].is_boolean()
        && [
            "royal_violet",
            "cyber_cyan",
            "obsidian_gold",
            "electric_magenta",
            "abyssal_navy",
        ]
        .iter()
        .any(|x| v["theme"] == *x)
        && v["zoom"]
            .as_f64()
            .is_some_and(|n| [0.85, 1.0, 1.15, 1.25].contains(&n))
        && ["trial", "expired", "monthly", "quarterly", "yearly"]
            .iter()
            .any(|x| v["subscriptionDemo"] == *x);
    if valid {
        Ok(())
    } else {
        Err(Error("INVALID_SETTINGS"))
    }
}
impl Service {
    // 核对会话存在且属于本次 epoch，供复制等只读操作使用。
    pub fn assert_unlocked(&self, epoch: u64) -> Result<()> {
        self.guard(epoch)?;
        let state = mutex(&self.session)?;
        if state.as_ref().is_some_and(|a| a.epoch == epoch) {
            Ok(())
        } else {
            Err(Error("LOCKED"))
        }
    }
    // 使用实际平台适配器及持久写入器打开独立数据目录。
    pub fn open(directory: &Path) -> Result<Self> {
        Self::with_writer(directory, Arc::new(DurableWriter))
    }
    // 允许测试替换写入器，以验证各个失败边界。
    pub fn with_writer(directory: &Path, writer: Arc<dyn AtomicVaultWriter>) -> Result<Self> {
        Self::with_platforms(
            directory,
            writer,
            Arc::new(local_secret::PlatformSecretStore),
            Box::new(media::PlatformMedia),
        )
    }
    // 获得进程排他文件锁并加载偏好；初始会话始终为空。
    pub fn with_platforms(
        directory: &Path,
        writer: Arc<dyn AtomicVaultWriter>,
        local_secret: Arc<dyn local_secret::LocalSecretStore>,
        media: Box<dyn media::MediaProvider>,
    ) -> Result<Self> {
        storage::safe_path(directory)?;
        fs::create_dir_all(directory).map_err(|_| Error("WRITE_FAILED"))?;
        let file = directory.join("vault-v3.llvault");
        let lock_path = directory.join("vault-v3.lock");
        storage::safe_path(&lock_path)?;
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let lock = options.open(lock_path).map_err(|_| Error("VAULT_IN_USE"))?;
        FileExt::try_lock_exclusive(&lock).map_err(|_| Error("VAULT_IN_USE"))?;
        let preferences_file = directory.join("appearance-v1.json");
        let loaded = read(&preferences_file).and_then(|p| {
            validate_preferences(&p)?;
            Ok(p)
        });
        let warning = loaded.as_ref().is_err_and(|e| *e != Error("NOT_FOUND"));
        Ok(Self {
            media: media::Media::new(media),
            recovery_drives: Mutex::new(None),
            local_secret,
            file,
            preferences_file,
            _file_lock: lock,
            epoch: Arc::new(AtomicU64::new(0)),
            session: Arc::new(Mutex::new(None)),
            cleanup_pending: Arc::new(AtomicBool::new(false)),
            operation: Mutex::new(()),
            writer,
            preferences: Mutex::new(loaded.unwrap_or_else(|_| defaults())),
            preferences_warning: warning,
            challenge: Mutex::new(None),
            started: Instant::now(),
            last_activity: AtomicU64::new(0),
        })
    }
    // 读取当前撤权代次，长任务在开始时保存此值。
    pub fn epoch(&self) -> u64 {
        self.epoch.load(Ordering::SeqCst)
    }
    // 代次不一致立即拒绝，防止锁定前任务重新写入或授权。
    pub fn guard(&self, epoch: u64) -> Result<()> {
        if self.epoch() == epoch {
            Ok(())
        } else {
            Err(Error("LOCKED"))
        }
    }
    // 先递增代次立即撤权，再清理旧会话；互斥锁被占用时安排一次延后清理。
    pub fn lock(&self) {
        self.epoch.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut s) = self.session.try_lock() {
            if s.as_ref().is_some_and(|a| a.epoch != self.epoch()) {
                *s = None;
            }
        } else if !self.cleanup_pending.swap(true, Ordering::SeqCst) {
            let session = self.session.clone();
            let epoch = self.epoch.clone();
            let pending = self.cleanup_pending.clone();
            std::thread::spawn(move || {
                // 前面已经立即撤权；等待正在读取的快照释放互斥锁后清理。
                // 延后清理不得误删之后新建的合法会话。
                let mut state = match session.lock() {
                    Ok(s) => s,
                    Err(poison) => poison.into_inner(),
                };
                if state
                    .as_ref()
                    .is_some_and(|a| a.epoch != epoch.load(Ordering::SeqCst))
                {
                    *state = None;
                }
                pending.store(false, Ordering::SeqCst);
            });
        }
        if let Ok(mut c) = self.challenge.try_lock() {
            *c = None;
        }
    }
    // 取得业务操作锁前后均核对代次；忙碌时返回 TRY_LATER。
    fn serial(&self, epoch: u64) -> Result<std::sync::MutexGuard<'_, ()>> {
        self.guard(epoch)?;
        let lock = self.operation.try_lock().map_err(|_| Error("TRY_LATER"))?;
        self.guard(epoch)?;
        Ok(lock)
    }
    // 记录单调时间上的活动点，避免系统时钟调整影响空闲判断。
    pub fn activity(&self) {
        self.last_activity
            .store(self.started.elapsed().as_secs(), Ordering::Relaxed);
    }
    // 根据当前密库设置判断空闲超时；会话快照繁忙时留待下一轮检查。
    pub fn idle_expired(&self) -> bool {
        let Ok(state) = self.session.try_lock() else {
            return false;
        };
        let Some(active) = state.as_ref() else {
            return false;
        };
        let mins = active.session.data()["settings"]["autoLockMinutes"]
            .as_u64()
            .unwrap_or(15);
        self.started
            .elapsed()
            .as_secs()
            .saturating_sub(self.last_activity.load(Ordering::Relaxed))
            >= mins * 60
    }
    // 返回非秘密的外观偏好副本，不需要解锁密库。
    pub fn preferences(&self) -> Result<Value> {
        Ok(mutex(&self.preferences)?.clone())
    }
    // 只报告磁盘存在性和公开封套状态；损坏文件不会被当作空库。
    pub fn status(&self) -> Result<Value> {
        match read_envelope(&self.file) {
            Ok(v) => Ok(
                json!({"exists":true,"role":"LOCKED","id":v["id"],"revision":v["revision"],"recovery":!v["recovery"].is_null(),"preferencesWarning":self.preferences_warning}),
            ),
            Err(Error("NOT_FOUND")) => {
                Ok(json!({"exists":false,"preferencesWarning":self.preferences_warning}))
            }
            Err(e) => Ok(
                json!({"exists":true,"damaged":true,"error":e.0,"preferencesWarning":self.preferences_warning}),
            ),
        }
    }
    // 仅返回资产列表摘要和设置，秘密字段通过详情接口按需读取。
    fn view_of(s: &Session) -> Value {
        let items: Vec<Value> = s.data()["items"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|i| {
                Value::Object(
                    [
                        "id",
                        "title",
                        "category",
                        "createdAt",
                        "updatedAt",
                        "revision",
                    ]
                    .into_iter()
                    .filter_map(|key| i.get(key).map(|v| (key.to_owned(), v.clone())))
                    .collect(),
                )
            })
            .collect();
        json!({"role":if s.is_owner(){"OWNER"}else{"HEIR"},"id":s.envelope()["id"],"revision":s.envelope()["revision"],"recovery":!s.envelope()["recovery"].is_null(),"items":items,"settings":s.data()["settings"]})
    }
    // 在当前授权下返回单条完整资产，并再次检查撤权代次。
    pub fn get_item(&self, id: &str, epoch: u64) -> Result<Value> {
        self.guard(epoch)?;
        let state = mutex(&self.session)?;
        let a = state
            .as_ref()
            .filter(|a| a.epoch == epoch)
            .ok_or(Error("LOCKED"))?;
        let item = a.session.data()["items"]
            .as_array()
            .and_then(|items| items.iter().find(|i| i["id"] == id))
            .ok_or(Error("NOT_FOUND"))?;
        self.guard(epoch)?;
        Ok(item.clone())
    }
    // 在 Rust 内搜索标题、用户名和备注，只把命中 ID 返回界面。
    pub fn search_items(&self, query: &str, epoch: u64) -> Result<Value> {
        self.guard(epoch)?;
        if query.len() > 4096 {
            return Err(Error("INVALID_SIZE"));
        }
        let query = query.to_lowercase();
        let state = mutex(&self.session)?;
        let a = state
            .as_ref()
            .filter(|a| a.epoch == epoch)
            .ok_or(Error("LOCKED"))?;
        let ids: Vec<Value> = a.session.data()["items"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|i| {
                ["title", "username", "notes"].iter().any(|key| {
                    i[key]
                        .as_str()
                        .unwrap_or("")
                        .to_lowercase()
                        .contains(&query)
                })
            })
            .map(|i| i["id"].clone())
            .collect();
        self.guard(epoch)?;
        Ok(json!(ids))
    }
    // 复制可写候选会话；继承人无法通过前端参数伪造私钥能力。
    fn owner(&self, epoch: u64) -> Result<Session> {
        self.guard(epoch)?;
        let state = mutex(&self.session)?;
        let active = state.as_ref().ok_or(Error("LOCKED"))?;
        if active.epoch != epoch {
            return Err(Error("LOCKED"));
        }
        active.session.fork_owner()
    }
    // 只检查当前所有者能力，不复制完整资产，适合对话框前置授权。
    pub fn assert_owner(&self, epoch: u64) -> Result<()> {
        self.guard(epoch)?;
        let s = mutex(&self.session)?;
        let a = s.as_ref().ok_or(Error("LOCKED"))?;
        if a.epoch != epoch {
            return Err(Error("LOCKED"));
        }
        if !a.session.is_owner() {
            return Err(Error("OWNER_REQUIRED"));
        }
        Ok(())
    }
    // 安装经过验证的会话前后复核代次，防止慢解锁覆盖新锁定。
    fn grant(&self, s: Session, source: PathBuf, epoch: u64) -> Result<Value> {
        let view = Self::view_of(&s);
        self.guard(epoch)?;
        let mut state = mutex(&self.session)?;
        self.guard(epoch)?;
        *state = Some(Active {
            epoch,
            session: s,
            source,
        });
        self.activity();
        self.guard(epoch)?;
        Ok(view)
    }
    // 原子提交候选封套后才替换活动会话；凭据槽变化先取消本机记忆。
    fn commit(&self, s: Session, expected: Option<&Value>, epoch: u64) -> Result<Value> {
        self.guard(epoch)?;
        if expected.is_none_or(|old| {
            old["owner"] != s.envelope()["owner"] || old["id"] != s.envelope()["id"]
        }) {
            self.forget_secret()?;
        }
        if let Err(e) = self
            .writer
            .write(&self.file, s.envelope(), expected, &|| self.guard(epoch))
        {
            if e == Error("COMMIT_UNCERTAIN") || e == Error("LOCAL_VAULT_CHANGED") {
                self.lock();
            }
            return Err(e);
        }
        self.grant(s, self.file.clone(), epoch)
    }
    // 执行本地订阅演示的写入限制；这不是支付或真实许可验证。
    fn writable(&self) -> Result<()> {
        if mutex(&self.preferences)?["subscriptionDemo"] == "expired" {
            Err(Error("DEMO_READ_ONLY"))
        } else {
            Ok(())
        }
    }
    // 仅在没有本机密库且不处于继承会话时创建空库。
    pub fn initialize(&self, password: &str, secret: &str, epoch: u64) -> Result<Value> {
        let _q = self.serial(epoch)?;
        if mutex(&self.session)?
            .as_ref()
            .is_some_and(|a| a.epoch == epoch && !a.session.is_owner())
        {
            return Err(Error("OWNER_REQUIRED"));
        }
        if self.status()?["exists"] == true {
            return Err(Error("VAULT_EXISTS"));
        }
        let s = vault_core::create(password, secret, json!([]))?;
        self.commit(s, None, epoch)
    }
    // 正常解锁本机；继承会话接管时还要通过本机身份和版本检查。
    pub fn unlock(&self, password: &str, secret: &str, epoch: u64) -> Result<Value> {
        let _q = self.serial(epoch)?;
        let heir = {
            let state = mutex(&self.session)?;
            state
                .as_ref()
                .filter(|a| a.epoch == epoch && !a.session.is_owner())
                .map(|a| a.session.envelope().clone())
        };
        if let Some(envelope) = heir {
            let next = vault_core::unlock_owner(envelope, password, secret)?;
            let old = self.check_import(next.envelope())?;
            self.commit(next, old.as_ref(), epoch)
        } else {
            let next = vault_core::unlock_owner(read_envelope(&self.file)?, password, secret)?;
            self.grant(next, self.file.clone(), epoch)
        }
    }
    // 拒绝覆盖损坏、不同身份或更新版本的本机密库。
    fn check_import(&self, next: &Value) -> Result<Option<Value>> {
        match read_envelope(&self.file) {
            Err(Error("NOT_FOUND")) => Ok(None),
            Err(_) => Err(Error("LOCAL_VAULT_DAMAGED")),
            Ok(old) => {
                if old["id"] != next["id"] || old["signingPublicKey"] != next["signingPublicKey"] {
                    return Err(Error("DIFFERENT_LOCAL_VAULT"));
                }
                if next["revision"].as_f64() < old["revision"].as_f64() {
                    return Err(Error("OLDER_BACKUP"));
                }
                Ok(Some(old))
            }
        }
    }
    // 服务端生成时间与资产版本，校验完整数据后事务提交。
    pub fn save_item(&self, mut item: Value, epoch: u64) -> Result<Value> {
        let _q = self.serial(epoch)?;
        let mut s = self.owner(epoch)?;
        self.writable()?;
        vault_core::validate_items(&json!([item]))?;
        let expected = s.envelope().clone();
        let mut data = s.data().clone();
        let items = data["items"].as_array_mut().ok_or(Error("INVALID_ITEMS"))?;
        let index = items.iter().position(|i| i["id"] == item["id"]);
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| Error("INVALID_TIME"))?
            .as_millis() as u64;
        let revision = index
            .map(|i| items[i]["revision"].as_u64().unwrap_or(0))
            .unwrap_or(0);
        if revision >= vault_core::MAX_SAFE {
            return Err(Error("REVISION_EXHAUSTED"));
        }
        item["createdAt"] = index
            .map(|i| items[i]["createdAt"].clone())
            .unwrap_or(json!(now));
        item["updatedAt"] = json!(now);
        item["revision"] = json!(revision + 1);
        if let Some(i) = index {
            items[i] = item;
        } else {
            items.insert(0, item);
        }
        s.update(data)?;
        self.commit(s, Some(&expected), epoch)
    }
    // 在候选数据中删除指定 ID，再加密签名和提交，避免先改活动内存。
    pub fn delete_item(&self, id: &str, epoch: u64) -> Result<Value> {
        let _q = self.serial(epoch)?;
        let mut s = self.owner(epoch)?;
        self.writable()?;
        let expected = s.envelope().clone();
        let mut data = s.data().clone();
        data["items"]
            .as_array_mut()
            .ok_or(Error("INVALID_ITEMS"))?
            .retain(|i| i["id"] != id);
        s.update(data)?;
        self.commit(s, Some(&expected), epoch)
    }
    // 修改密库内的加密设置，保持资产不变。
    pub fn settings(&self, settings: Value, epoch: u64) -> Result<Value> {
        let _q = self.serial(epoch)?;
        let mut s = self.owner(epoch)?;
        let expected = s.envelope().clone();
        let mut data = s.data().clone();
        data["settings"] = settings;
        s.update(data)?;
        self.commit(s, Some(&expected), epoch)
    }
    // 所有者修改本机显示偏好，使用受校验的原子写入后更新缓存。
    pub fn set_preferences(&self, value: Value, epoch: u64) -> Result<Value> {
        let _q = self.serial(epoch)?;
        self.assert_owner(epoch)?;
        validate_preferences(&value)?;
        let expected = match read(&self.preferences_file) {
            Ok(v) => Some(v),
            Err(Error("NOT_FOUND")) => None,
            Err(e) => return Err(e),
        };
        let result = storage::write_checked(
            &self.preferences_file,
            &value,
            expected.as_ref(),
            &|| self.guard(epoch),
            &|_| Ok(()),
            validate_preferences,
        );
        if let Err(e) = result {
            if e == Error("COMMIT_UNCERTAIN") {
                self.lock();
            }
            return Err(e);
        }
        *mutex(&self.preferences)? = value.clone();
        self.guard(epoch)?;
        Ok(value)
    }
    // 以双凭据导入完整封套，保留来源身份；本机保护规则先于覆盖。
    pub fn import_owner(
        &self,
        path: &Path,
        password: &str,
        secret: &str,
        epoch: u64,
    ) -> Result<Value> {
        let _q = self.serial(epoch)?;
        let source = read_envelope(path)?;
        let expected = self.check_import(&source)?;
        let next = vault_core::unlock_owner(source, password, secret)?;
        self.commit(next, expected.as_ref(), epoch)
    }
    // 合并资产：完全相同则跳过，同 ID 不同内容换新 ID 保留副本，本机设置和恢复配置不变。
    pub fn import_data(
        &self,
        path: &Path,
        password: &str,
        secret: &str,
        epoch: u64,
    ) -> Result<Value> {
        let _q = self.serial(epoch)?;
        let mut s = self.owner(epoch)?;
        self.writable()?;
        let source = vault_core::unlock_owner(read_envelope(path)?, password, secret)?;
        self.guard(epoch)?;
        let expected = s.envelope().clone();
        let mut data = s.data().clone();
        let items = data["items"].as_array_mut().ok_or(Error("INVALID_ITEMS"))?;
        let mut imported = 0;
        for item in source.data()["items"]
            .as_array()
            .ok_or(Error("INVALID_ITEMS"))?
        {
            let old = items.iter().find(|x| x["id"] == item["id"]);
            if old.is_some_and(|v| canonical_js(v) == canonical_js(item)) {
                continue;
            }
            let mut item = item.clone();
            if old.is_some() {
                item["id"] = json!(random_token());
            }
            items.push(item);
            imported += 1;
        }
        s.update(data)?;
        let view = self.commit(s, Some(&expected), epoch)?;
        Ok(json!({"view":view,"imported":imported}))
    }
    // 重新验证双凭据后导出当前加密封套，不覆盖已有目标。
    pub fn export(&self, path: &Path, password: &str, secret: &str, epoch: u64) -> Result<Value> {
        let _q = self.serial(epoch)?;
        let s = self.owner(epoch)?;
        let _checked = vault_core::unlock_owner(s.envelope().clone(), password, secret)?;
        self.guard(epoch)?;
        storage::export_new(path, canonical_js(s.envelope()).as_bytes(), &|| {
            self.guard(epoch)
        })?;
        Ok(json!({"path":path,"revision":s.envelope()["revision"]}))
    }
    // 先验证旧双凭据，再只重包装 owner 槽，提交时使本机记忆失效。
    pub fn credentials(
        &self,
        password: &str,
        secret: &str,
        new_password: &str,
        new_secret: &str,
        epoch: u64,
    ) -> Result<Value> {
        let _q = self.serial(epoch)?;
        let mut s = self.owner(epoch)?;
        let _checked = vault_core::unlock_owner(s.envelope().clone(), password, secret)?;
        self.guard(epoch)?;
        let expected = s.envelope().clone();
        s.rewrap(new_password, new_secret)?;
        self.commit(s, Some(&expected), epoch)
    }
    // 比较当前会话源与磁盘封套；读取失败或不一致立即撤销会话。
    pub fn health(&self, epoch: u64) -> Result<Value> {
        let _q = self.serial(epoch)?;
        let (envelope, source) = {
            let state = mutex(&self.session)?;
            let a = state.as_ref().ok_or(Error("LOCKED"))?;
            self.guard(a.epoch)?;
            (a.session.envelope().clone(), a.source.clone())
        };
        let disk = read_envelope(&source).inspect_err(|_| self.lock())?;
        if canonical_js(&disk) != canonical_js(&envelope) {
            self.lock();
            return Err(Error("LOCAL_VAULT_CHANGED"));
        }
        self.guard(epoch)?;
        Ok(
            json!({"signatureValid":true,"authenticatedData":true,"revision":envelope["revision"],"recovery":!envelope["recovery"].is_null()}),
        )
    }
    // 从文件与已提供份额建立只读会话；设备绑定恢复由 recovery 模块负责。
    pub fn recover_from_files(
        &self,
        path: &Path,
        primary: &Value,
        secondary: &Value,
        epoch: u64,
    ) -> Result<Value> {
        let _q = self.serial(epoch)?;
        let session = vault_core::unlock_recovery(read_envelope(path)?, primary, secondary)?;
        self.grant(session, path.to_owned(), epoch)
    }
    // 重新验证双凭据并发放两分钟一次性挑战，绑定当前代次和密库版本。
    pub fn prepare_destroy(&self, password: &str, secret: &str, epoch: u64) -> Result<Value> {
        let _q = self.serial(epoch)?;
        let s = self.owner(epoch)?;
        let _checked = vault_core::unlock_owner(s.envelope().clone(), password, secret)?;
        self.guard(epoch)?;
        let token = random_token();
        *mutex(&self.challenge)? = Some(Challenge {
            token: token.clone(),
            epoch,
            revision: s.envelope()["revision"].clone(),
            expires: Instant::now() + std::time::Duration::from_secs(120),
        });
        Ok(json!({"token":token}))
    }
    // 核对挑战及 DELETE 文本，仅清理本机密库和专属记录；任何结果都锁定，不删除外部备份。
    pub fn destroy(&self, token: &str, confirmation: &str, epoch: u64) -> Result<Value> {
        let _q = self.serial(epoch)?;
        let s = self.owner(epoch)?;
        let challenge = mutex(&self.challenge)?
            .take()
            .ok_or(Error("CONFIRMATION_REQUIRED"))?;
        if challenge.token != token
            || confirmation != "DELETE"
            || challenge.epoch != epoch
            || challenge.revision != s.envelope()["revision"]
            || Instant::now() > challenge.expires
        {
            return Err(Error("CONFIRMATION_REQUIRED"));
        }
        if canonical_js(&read_envelope(&self.file)?) != canonical_js(s.envelope()) {
            self.lock();
            return Err(Error("LOCAL_VAULT_CHANGED"));
        }
        let result = (|| {
            self.forget_secret()?;
            let mut paths = storage::owned_temporaries(&self.file)?;
            paths.extend([suffix(&self.file, ".previous"), self.file.clone()]);
            for path in paths {
                self.guard(epoch)?;
                storage::safe_path(&path)?;
                match fs::remove_file(path) {
                    Ok(()) => {}
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(_) => return Err(Error("DELETE_FAILED")),
                }
            }
            Ok(json!({"deleted":true}))
        })();
        self.lock();
        result
    }
}

#[cfg(test)]
mod revocation_tests {
    use super::*;
    #[test]
    fn lock_revokes_immediately_and_wipes_after_snapshot_releases() {
        let dir = tempfile::tempdir().unwrap();
        let service = Service::open(dir.path()).unwrap();
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../reference/legacy/tests/fixtures/v3-vault.json");
        service
            .import_owner(
                &fixture,
                "Golden fixture password!",
                &format!("LL3-{}", "1".repeat(64)),
                service.epoch(),
            )
            .unwrap();
        let epoch = service.epoch();
        let snapshot = service.session.lock().unwrap();
        service.lock();
        assert_eq!(service.guard(epoch), Err(Error("LOCKED")));
        drop(snapshot);
        let deadline = Instant::now() + std::time::Duration::from_secs(3);
        loop {
            if service.session.lock().unwrap().is_none() {
                break;
            }
            assert!(Instant::now() < deadline, "Revoked session was not wiped");
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }
}
