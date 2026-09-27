// LVCF 3 纯协议核心：加解密、签名、凭据包装和双份额恢复，不访问文件、桌面或网络。
// 序列化、UTF-16 长度和数字表示必须兼容冻结的 JavaScript 实现，不能随意改成 Rust 默认规则。
//! LVCF 3 协议实现；不持有文件系统、桌面或网络能力。
mod model;
use aes_gcm::{
    Aes256Gcm, KeyInit, Nonce,
    aead::{Aead, Payload},
};
use base64::{Engine, engine::general_purpose::STANDARD as B64};
use ed25519_dalek::{
    Signature, Signer, SigningKey, Verifier, VerifyingKey,
    pkcs8::{DecodePrivateKey, DecodePublicKey, EncodePrivateKey, EncodePublicKey},
};
pub use model::{validate_data, validate_items};
use rand::{RngCore, rngs::OsRng};
use serde_json::{Value, json};
use zeroize::{Zeroize, Zeroizing};

pub const MAX_BYTES: usize = 32 * 1024 * 1024;
pub const MAX_SAFE: u64 = 9_007_199_254_740_991;
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Error(pub &'static str);
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.0)
    }
}
impl std::error::Error for Error {}
pub type Result<T> = std::result::Result<T, Error>;
// 将协议断言转成稳定错误码，不把输入秘密拼接进错误信息。
pub(crate) fn require(ok: bool, code: &'static str) -> Result<()> {
    if ok { Ok(()) } else { Err(Error(code)) }
}
// 按 UTF-16 码元计数以匹配旧版 JavaScript 的字符串长度。
pub(crate) fn string(v: &Value, max: usize) -> bool {
    v.as_str().is_some_and(|s| s.encode_utf16().count() <= max)
}
// 仅接受 JavaScript 安全整数范围内的有限非负整数。
pub(crate) fn integer(v: &Value, min: u64) -> bool {
    v.as_f64().is_some_and(|n| {
        n.is_finite() && n.fract() == 0.0 && n >= min as f64 && n <= MAX_SAFE as f64
    })
}
// 检查对象键集合完全相等，防止静默忽略格式扩展。
pub(crate) fn exact(v: &Value, keys: &[&str]) -> bool {
    v.as_object()
        .is_some_and(|m| m.len() == keys.len() && keys.iter().all(|k| m.contains_key(*k)))
}
// 在解析前限制文件大小；格式错误由统一错误码报告。
pub fn parse(bytes: &[u8]) -> Result<Value> {
    require(bytes.len() <= MAX_BYTES, "INVALID_SIZE")?;
    // serde 拒绝孤立 UTF-16 代理项；不能替换为 U+FFFD 后继续处理签名。
    serde_json::from_slice(bytes).map_err(|_| Error("INVALID_FORMAT"))
}
/// 与 JSON.stringify 数字格式及 Object.keys(...).sort() 的 UTF-16 排序一致。
// 生成与旧版签名输入一致的 JSON：对象键按 UTF-16 排序，数字使用 JavaScript 表示。
pub fn canonical_js(v: &Value) -> String {
    match v {
        Value::Object(m) => {
            let mut keys: Vec<_> = m.keys().collect();
            keys.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
            format!(
                "{{{}}}",
                keys.into_iter()
                    .map(|k| format!(
                        "{}:{}",
                        serde_json::to_string(k).unwrap(),
                        canonical_js(&m[k])
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
        Value::Array(a) => format!(
            "[{}]",
            a.iter().map(canonical_js).collect::<Vec<_>>().join(",")
        ),
        Value::Number(n) => ryu_js::Buffer::new().format(n.as_f64().unwrap()).to_owned(),
        _ => serde_json::to_string(v).unwrap(),
    }
}
// 要求规范 Base64 编码及可选解码长度，避免同一字节串出现多个外部表示。
pub(crate) fn b64(v: &Value, size: Option<usize>) -> Result<Vec<u8>> {
    let s = v.as_str().ok_or(Error("INVALID_FORMAT"))?;
    require(s.len() <= MAX_BYTES, "INVALID_SIZE")?;
    let b = B64.decode(s).map_err(|_| Error("INVALID_FORMAT"))?;
    require(
        B64.encode(&b) == s && size.is_none_or(|n| n == b.len()),
        "INVALID_FORMAT",
    )?;
    Ok(b)
}
// 使用系统随机源生成随机字节，并在包装释放时清零。
fn random<const N: usize>() -> Zeroizing<[u8; N]> {
    let mut b = Zeroizing::new([0; N]);
    OsRng.fill_bytes(b.as_mut());
    b
}
// 生成 256 位随机 LL3 安全密钥；连字符仅用于便于抄录。
pub fn new_secret() -> String {
    let b = random::<32>();
    let hex = b.iter().map(|b| format!("{b:02X}")).collect::<String>();
    format!(
        "LL3-{}",
        hex.as_bytes()
            .chunks(8)
            .map(|s| std::str::from_utf8(s).unwrap())
            .collect::<Vec<_>>()
            .join("-")
    )
}
// 规范化安全密钥后，将密码与密钥的 JSON 数组送入固定参数 scrypt。
fn credential_key(password: &str, secret: &str, salt: &[u8]) -> Result<Zeroizing<[u8; 32]>> {
    require(
        (12..=1024).contains(&password.encode_utf16().count())
            && secret.encode_utf16().count() <= 200,
        "INVALID_CREDENTIALS",
    )?;
    let s = if secret
        .get(..4)
        .is_some_and(|p| p.eq_ignore_ascii_case("LL3-"))
    {
        &secret[4..]
    } else {
        secret
    };
    let clean = Zeroizing::new(s.replace('-', "").to_ascii_lowercase());
    require(
        clean.len() == 64 && clean.bytes().all(|b| b.is_ascii_hexdigit()),
        "INVALID_CREDENTIALS",
    )?;
    let material = Zeroizing::new(serde_json::to_vec(&[password, clean.as_str()]).unwrap());
    let mut out = Zeroizing::new([0; 32]);
    let params = scrypt::Params::new(15, 8, 1, 32).map_err(|_| Error("KDF_FAILED"))?;
    scrypt::scrypt(&material, salt, &params, out.as_mut()).map_err(|_| Error("KDF_FAILED"))?;
    Ok(out)
}
// 检查 AES-GCM 容器的字段、12 字节 nonce 和 16 字节认证标签。
fn check_box(v: &Value) -> Result<()> {
    require(exact(v, &["iv", "tag", "data"]), "INVALID_FORMAT")?;
    b64(&v["iv"], Some(12))?;
    b64(&v["tag"], Some(16))?;
    b64(&v["data"], None)?;
    Ok(())
}
// 把密库身份、公钥及槽位用途绑定为附加认证数据，防止跨槽替换密文。
fn aad(v: &Value, kind: &str) -> String {
    canonical_js(&json!(["LVCF3", v["id"], v["signingPublicKey"], kind]))
}
// 使用新 nonce 加密，并按旧协议拆分密文和认证标签。
fn encrypt(key: &[u8], bytes: &[u8], aad: &str) -> Result<Value> {
    let iv = random::<12>();
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| Error("INVALID_FORMAT"))?;
    let mut data = cipher
        .encrypt(
            Nonce::from_slice(iv.as_ref()),
            Payload {
                msg: bytes,
                aad: aad.as_bytes(),
            },
        )
        .map_err(|_| Error("ENCRYPTION_FAILED"))?;
    let tag = data.split_off(data.len() - 16);
    Ok(json!({"iv":B64.encode(iv.as_ref()),"tag":B64.encode(tag),"data":B64.encode(data)}))
}
// 加密规范化 JSON，临时明文字节在离开作用域时清零。
fn encrypt_json(key: &[u8], v: &Value, aad: &str) -> Result<Value> {
    let bytes = Zeroizing::new(canonical_js(v).into_bytes());
    encrypt(key, &bytes, aad)
}
// 验证 GCM 认证标签后才返回明文；认证失败不返回部分内容。
fn decrypt(key: &[u8], v: &Value, aad: &str) -> Result<Zeroizing<Vec<u8>>> {
    check_box(v)?;
    let iv = b64(&v["iv"], Some(12))?;
    let mut data = b64(&v["data"], None)?;
    data.extend(b64(&v["tag"], Some(16))?);
    let c = Aes256Gcm::new_from_slice(key).map_err(|_| Error("INVALID_FORMAT"))?;
    c.decrypt(
        Nonce::from_slice(&iv),
        Payload {
            msg: &data,
            aad: aad.as_bytes(),
        },
    )
    .map(Zeroizing::new)
    .map_err(|_| Error("AUTHENTICATION_FAILED"))
}
// 构造不包含 signature 字段的签名输入，保留其余字段。
fn unsigned(v: &Value) -> Value {
    let mut v = v.clone();
    if let Some(m) = v.as_object_mut() {
        m.remove("signature");
    }
    v
}
// 对规范化封套签名；调用方必须持有所有者私钥。
fn sign(v: &mut Value, key: &SigningKey) {
    v["signature"] = json!(B64.encode(key.sign(canonical_js(&unsigned(v)).as_bytes()).to_bytes()));
}
// 从旧版兼容的 DER 公钥表示恢复 Ed25519 验证密钥。
fn public(v: &Value) -> Result<VerifyingKey> {
    VerifyingKey::from_public_key_der(&b64(&v["signingPublicKey"], None)?)
        .map_err(|_| Error("INVALID_FORMAT"))
}
// 验证整个封套或份额签名；尚不等同于已解密并校验资产数据。
fn verify(v: &Value) -> Result<()> {
    let sig = Signature::from_slice(&b64(&v["signature"], Some(64))?)
        .map_err(|_| Error("INVALID_FORMAT"))?;
    public(v)?
        .verify(canonical_js(&unsigned(v)).as_bytes(), &sig)
        .map_err(|_| Error("INVALID_SIGNATURE"))
}
// 依次检查协议版本、精确字段、加密槽结构和签名，拒绝不受支持格式。
pub fn validate_envelope(v: &Value) -> Result<()> {
    require(
        v["magic"] == "LEGACYLOCK"
            && v["format"].as_f64() == Some(3.0)
            && v["id"].as_str().is_some_and(|s| {
                s.len() == 36
                    && s.bytes()
                        .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c) || c == b'-')
            })
            && integer(&v["revision"], 1),
        "UNSUPPORTED_FORMAT",
    )?;
    require(
        exact(
            v,
            &[
                "magic",
                "format",
                "id",
                "revision",
                "signingPublicKey",
                "owner",
                "recovery",
                "payload",
                "signature",
            ],
        ),
        "INVALID_FORMAT",
    )?;
    let o = &v["owner"];
    require(
        exact(o, &["kdf", "salt", "wrapped"]) && o["kdf"] == "scrypt-32768-8-1",
        "INVALID_FORMAT",
    )?;
    b64(&o["salt"], Some(16))?;
    check_box(&o["wrapped"])?;
    check_box(&v["payload"])?;
    let r = &v["recovery"];
    if !r.is_null() {
        require(
            exact(r, &["generation", "wrapped"]) && integer(&r["generation"], 1),
            "INVALID_FORMAT",
        )?;
        check_box(&r["wrapped"])?;
    }
    verify(v)
}
// 递归清零 JSON 字符串；不承诺清除浏览器、交换文件或其他历史副本。
fn wipe_value(v: &mut Value) {
    match v {
        Value::String(s) => s.zeroize(),
        Value::Array(a) => a.iter_mut().for_each(wipe_value),
        Value::Object(m) => m.values_mut().for_each(wipe_value),
        _ => {}
    }
}
/// 签名能力保持私有，调用方或 IPC DTO 不能注入此能力。
pub struct Session {
    // 加密封套可以导出，解密数据只能在当前授权下返回必要部分。
    envelope: Value,
    data: Value,
    // VMK 负责数据加解密；签名私钥只存在于所有者会话。
    vmk: Zeroizing<Vec<u8>>,
    signing: Option<SigningKey>,
}
impl Drop for Session {
    fn drop(&mut self) {
        wipe_value(&mut self.data);
    }
}
impl Session {
    /// 私钥能力保持封装；此副本只用于构造事务候选。
    // 复制事务候选会话；无私钥的继承会话不能获得此写入能力。
    pub fn fork_owner(&self) -> Result<Self> {
        Ok(Self {
            envelope: self.envelope.clone(),
            data: self.data.clone(),
            vmk: Zeroizing::new(self.vmk.to_vec()),
            signing: Some(self.owner()?.clone()),
        })
    }
    // 借用当前加密封套，调用方不得绕过事务自行修改。
    pub fn envelope(&self) -> &Value {
        &self.envelope
    }
    // 借用已认证的解密数据；仅在受控会话范围内使用。
    pub fn data(&self) -> &Value {
        &self.data
    }
    // 依据是否持有签名私钥判断所有者能力，不信任前端角色字段。
    pub fn is_owner(&self) -> bool {
        self.signing.is_some()
    }
    // 没有签名私钥时拒绝所有写操作。
    fn owner(&self) -> Result<&SigningKey> {
        self.signing.as_ref().ok_or(Error("OWNER_REQUIRED"))
    }
    // 创建下一个封套版本；达到 JavaScript 安全整数上限后停止递增。
    fn next(&self) -> Result<Value> {
        let mut v = self.envelope.clone();
        let n = v["revision"].as_f64().ok_or(Error("INVALID_FORMAT"))? as u64;
        require(n < MAX_SAFE, "REVISION_EXHAUSTED")?;
        v["revision"] = json!(n + 1);
        Ok(v)
    }
    // 验证新数据、重新加密并签名，再替换内存数据；磁盘提交由服务负责。
    pub fn update(&mut self, data: Value) -> Result<()> {
        let key = self.owner()?;
        validate_data(&data)?;
        let mut v = self.next()?;
        v["payload"] = encrypt_json(&self.vmk, &data, &aad(&v, "payload"))?;
        sign(&mut v, key);
        self.envelope = v;
        wipe_value(&mut self.data);
        self.data = data;
        Ok(())
    }
    // 仅更换所有者凭据包装；保留 VMK 和已有双份额恢复能力。
    pub fn rewrap(&mut self, password: &str, secret: &str) -> Result<()> {
        let key = self.owner()?;
        let mut v = self.next()?;
        v["owner"] = wrap_owner(&v, &self.vmk, key, password, secret)?;
        sign(&mut v, key);
        self.envelope = v;
        Ok(())
    }
    // 生成下一代两份随机恢复材料并签名；此方法本身不写 USB。
    pub fn provision(&mut self) -> Result<(Value, Value)> {
        let signing = self.owner()?;
        let mut v = self.next()?;
        let old = v["recovery"]["generation"].as_f64().unwrap_or(0.0) as u64;
        require(old < MAX_SAFE, "GENERATION_EXHAUSTED")?;
        let generation = old + 1;
        let a = random::<32>();
        let b = random::<32>();
        let key = recovery_key(
            a.as_ref(),
            b.as_ref(),
            v["id"].as_str().unwrap(),
            generation,
        )?;
        v["recovery"] = json!({"generation":generation,"wrapped":encrypt(key.as_ref(),&self.vmk,&aad(&v,&format!("recovery:{generation}")))?});
        let share = |role: &str, secret: &[u8]| {
            let mut s = json!({"magic":"LEGACYLOCK_SHARE","format":3,"id":v["id"],"signingPublicKey":v["signingPublicKey"],"generation":generation,"role":role,"secret":B64.encode(secret)});
            sign(&mut s, signing);
            s
        };
        let primary = share("PRIMARY", a.as_ref());
        let secondary = share("SECONDARY", b.as_ref());
        sign(&mut v, signing);
        self.envelope = v;
        Ok((primary, secondary))
    }
    // 重新验证所有者后轮换 VMK，再生成新代次；旧份额不能解密新封套。
    pub fn rotate_recovery(&mut self, password: &str, secret: &str) -> Result<(Value, Value)> {
        self.owner()?;
        let checked = unlock_owner(self.envelope.clone(), password, secret)?;
        let vmk = Zeroizing::new(random::<32>().to_vec());
        let mut v = self.envelope.clone();
        v["owner"] = wrap_owner(&v, &vmk, checked.owner()?, password, secret)?;
        v["payload"] = encrypt_json(&vmk, &self.data, &aad(&v, "payload"))?;
        let mut candidate = Session {
            envelope: v,
            data: self.data.clone(),
            vmk,
            signing: Some(checked.owner()?.clone()),
        };
        let shares = candidate.provision()?;
        *self = candidate;
        Ok(shares)
    }
}
// 把 VMK 和签名私钥放入双凭据保护的 owner 槽，并清理临时明文。
fn wrap_owner(
    v: &Value,
    vmk: &[u8],
    signing: &SigningKey,
    password: &str,
    secret: &str,
) -> Result<Value> {
    let salt = random::<16>();
    let key = credential_key(password, secret, salt.as_ref())?;
    let der = signing
        .to_pkcs8_der()
        .map_err(|_| Error("INVALID_FORMAT"))?;
    let mut inner = json!({"vmk":B64.encode(vmk),"signingPrivateKey":B64.encode(der.as_bytes())});
    let result = encrypt_json(key.as_ref(), &inner, &aad(v, "owner"));
    wipe_value(&mut inner);
    Ok(json!({"kdf":"scrypt-32768-8-1","salt":B64.encode(salt.as_ref()),"wrapped":result?}))
}
// 生成独立密库身份、签名密钥和 VMK，创建版本 1 的所有者会话。
pub fn create(password: &str, secret: &str, items: Value) -> Result<Session> {
    validate_items(&items)?;
    let signing = SigningKey::generate(&mut OsRng);
    let vmk = Zeroizing::new(random::<32>().to_vec());
    let mut id = *random::<16>();
    id[6] = (id[6] & 15) | 64;
    id[8] = (id[8] & 63) | 128;
    let h = id.iter().map(|b| format!("{b:02x}")).collect::<String>();
    let id = format!(
        "{}-{}-{}-{}-{}",
        &h[..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..]
    );
    let mut v = json!({"magic":"LEGACYLOCK","format":3,"id":id,"revision":1,"signingPublicKey":B64.encode(signing.verifying_key().to_public_key_der().map_err(|_|Error("INVALID_FORMAT"))?.as_bytes()),"owner":null,"recovery":null,"payload":null});
    let data =
        json!({"items":items,"settings":{"autoLockMinutes":15,"heirName":"","heirNotes":""}});
    v["owner"] = wrap_owner(&v, &vmk, &signing, password, secret)?;
    v["payload"] = encrypt_json(&vmk, &data, &aad(&v, "payload"))?;
    sign(&mut v, &signing);
    Ok(Session {
        envelope: v,
        data,
        vmk,
        signing: Some(signing),
    })
}
// 解密 payload 后继续验证资产结构，不能仅凭签名认定明文有效。
fn read_data(v: &Value, vmk: &[u8]) -> Result<Value> {
    let data = parse(&decrypt(vmk, &v["payload"], &aad(v, "payload"))?)?;
    validate_data(&data)?;
    Ok(data)
}
// 验证封套和双凭据，检查私钥对应公钥后授予所有者会话。
pub fn unlock_owner(v: Value, password: &str, secret: &str) -> Result<Session> {
    validate_envelope(&v)?;
    let key = credential_key(password, secret, &b64(&v["owner"]["salt"], Some(16))?)?;
    let mut decoded = parse(&decrypt(
        key.as_ref(),
        &v["owner"]["wrapped"],
        &aad(&v, "owner"),
    )?)?;
    let result = (|| {
        let vmk = Zeroizing::new(b64(&decoded["vmk"], Some(32))?);
        let der = Zeroizing::new(b64(&decoded["signingPrivateKey"], None)?);
        let signing = SigningKey::from_pkcs8_der(&der).map_err(|_| Error("INVALID_FORMAT"))?;
        require(
            signing.verifying_key() == public(&v)?,
            "AUTHENTICATION_FAILED",
        )?;
        let data = read_data(&v, &vmk)?;
        Ok(Session {
            envelope: v,
            data,
            vmk,
            signing: Some(signing),
        })
    })();
    wipe_value(&mut decoded);
    result
}
// 按主、副份额顺序拼接材料，使用密库 ID 与代次绑定 HKDF 派生。
fn recovery_key(a: &[u8], b: &[u8], id: &str, generation: u64) -> Result<Zeroizing<[u8; 32]>> {
    let mut seed = Zeroizing::new(a.to_vec());
    seed.extend(b);
    let mut out = Zeroizing::new([0; 32]);
    hkdf::Hkdf::<sha2::Sha256>::new(Some(id.as_bytes()), &seed)
        .expand(
            format!("LVCF3 recovery {generation}").as_bytes(),
            out.as_mut(),
        )
        .map_err(|_| Error("INVALID_FORMAT"))?;
    Ok(out)
}
// 检查份额角色、密库、公钥、代次和签名，拒绝错盘或混合代次。
fn verify_share(s: &Value, v: &Value, role: &str) -> Result<Zeroizing<Vec<u8>>> {
    require(
        exact(
            s,
            &[
                "magic",
                "format",
                "id",
                "signingPublicKey",
                "generation",
                "role",
                "secret",
                "signature",
            ],
        ) && s["magic"] == "LEGACYLOCK_SHARE"
            && s["format"].as_f64() == Some(3.0)
            && s["role"] == role
            && s["id"] == v["id"]
            && s["signingPublicKey"] == v["signingPublicKey"]
            && s["generation"].as_f64() == v["recovery"]["generation"].as_f64(),
        "WRONG_RECOVERY_KEYS",
    )?;
    verify(s)?;
    Ok(Zeroizing::new(b64(&s["secret"], Some(32))?))
}
// 双份额只恢复 VMK；会话不含签名私钥，因此只能读取。
pub fn unlock_recovery(v: Value, primary: &Value, secondary: &Value) -> Result<Session> {
    validate_envelope(&v)?;
    require(!v["recovery"].is_null(), "NO_RECOVERY")?;
    let a = verify_share(primary, &v, "PRIMARY")?;
    let b = verify_share(secondary, &v, "SECONDARY")?;
    let generation = v["recovery"]["generation"].as_f64().unwrap() as u64;
    let key = recovery_key(&a, &b, v["id"].as_str().unwrap(), generation)?;
    let vmk = decrypt(
        key.as_ref(),
        &v["recovery"]["wrapped"],
        &aad(&v, &format!("recovery:{generation}")),
    )?;
    require(vmk.len() == 32, "INVALID_FORMAT")?;
    let data = read_data(&v, &vmk)?;
    Ok(Session {
        envelope: v,
        data,
        vmk,
        signing: None,
    })
}
// 验证单份恢复文件的格式与自身签名；配对关系在恢复时另行核对。
pub fn validate_recovery_share(s: &Value) -> Result<()> {
    let role = s["role"].as_str().ok_or(Error("WRONG_RECOVERY_KEYS"))?;
    require(
        matches!(role, "PRIMARY" | "SECONDARY") && integer(&s["generation"], 1),
        "WRONG_RECOVERY_KEYS",
    )?;
    let envelope = json!({"id":s["id"],"signingPublicKey":s["signingPublicKey"],"recovery":{"generation":s["generation"]}});
    verify_share(s, &envelope, role)?;
    Ok(())
}
// 同步主盘前确认主份额属于当前密库及恢复代次。
pub fn validate_primary(s: &Value, envelope: &Value) -> Result<()> {
    verify_share(s, envelope, "PRIMARY")?;
    Ok(())
}
