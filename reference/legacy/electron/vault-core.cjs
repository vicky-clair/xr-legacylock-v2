"use strict";
/**
 * LVCF 3 (LegacyLock Vault Container Format v3) 密码学与安全核心实现
 * 
 * 核心安全设计哲学：
 * 1. 唯一协议权威：桌面主进程与独立离线阅读器共享此单一、带版本号的协议实现；
 * 2. 强口令 KDF 派生：采用 scrypt (N=32768, r=8, p=1) 计算口令与安全密钥派生密钥；
 * 3. 军工级对称加密：主数据采用 AES-256-GCM 认证加密 (AEAD)，附加认证数据 (AAD) 强绑定信封上下文；
 * 4. 非对称抗篡改签名：采用 Ed25519 签名体系，信封任何字节被修改即触发验签失败 (Fail-Closed)；
 * 5. 双物理 U 盘只读恢复：采用 HKDF-SHA256 派生双份独立恢复秘密 (2-of-2)，无单点破解后门；
 * 6. 内存即时零化擦除 (Zeroization)：密钥材料使用完毕后立即调用 .fill(0) 清除。
 */
const c = require("node:crypto");
const { promisify } = require("node:util");
const scrypt = promisify(c.scrypt);

// 单个密库容器与解析的最大容量上限 (32MB)，防范内存耗尽 DoS 攻击
const MAX_BYTES = 32 * 1024 * 1024;

// 资产允许的合法类别白名单集合
const CATEGORIES = new Set([
  "login",
  "note",
  "card",
  "identity",
  "password",
  "document",
  "sshKey",
  "apiCredential",
  "membership",
  "cryptoWallet",
  "medical",
  "reward",
  "outdoorLicense",
  "passport",
  "database",
  "router",
  "server",
  "email",
  "ssn",
  "softwareLicense",
  "bankAccount",
  "driverLicense",
  "game",
  "license",
]);

/**
 * 密库核心安全异常类
 */
class VaultError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/**
 * 快速抛出密库异常工具函数
 * @param {string} code 错误代码标识
 */
function fail(code) {
  throw new VaultError(code);
}

/**
 * 规范化 JSON 序列化 (Canonical JSON)
 * 递归对对象的键名按字母升序排序，保证相同的对象结构始终生成严格一致的字节流，
 * 彻底消除因空白字符或字段乱序导致的数字签名验签不一致问题。
 */
function canonical(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
      .join(",") +
    "}"
  );
}

/**
 * 安全解析 JSON 文本，包含最大字节数限制检测与异常封装
 */
function json(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_BYTES)
    fail("INVALID_SIZE");
  try {
    return JSON.parse(text);
  } catch {
    fail("INVALID_FORMAT");
  }
}
function object(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}
function str(v, max = 100000) {
  return typeof v === "string" && v.length <= max;
}
function b64(v, size) {
  if (!str(v, MAX_BYTES) || !/^[A-Za-z0-9+/]*={0,2}$/.test(v))
    fail("INVALID_FORMAT");
  const b = Buffer.from(v, "base64");
  if (b.toString("base64") !== v || (size !== undefined && b.length !== size))
    fail("INVALID_FORMAT");
  return b;
}
function secretText(v) {
  if (!str(v, 200)) fail("INVALID_CREDENTIALS");
  const clean = v.replace(/^LL3-/i, "").replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) fail("INVALID_CREDENTIALS");
  return clean;
}
/**
 * 生成符合 LL3- 格式规范的随机 256 位安全密钥文本 (64 字符十六进制，带连字符分组)
 */
function newSecret() {
  return (
    "LL3-" +
    c.randomBytes(32).toString("hex").match(/.{8}/g).join("-").toUpperCase()
  );
}

/**
 * 基于用户口令 + 安全密钥派生高强度对称密钥
 * 采用 scrypt 密码散列函数 (N=32768 CPU/内存开销，r=8 分块大小，p=1 并行度)，
 * 并在计算完成后立即执行内存清空零化 (fill(0))。
 */
async function credentialKey(password, secret, salt) {
  if (!str(password, 1024) || password.length < 12) fail("INVALID_CREDENTIALS");
  const material = Buffer.from(JSON.stringify([password, secretText(secret)]));
  try {
    return await scrypt(material, salt, 32, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
  } finally {
    material.fill(0);
  }
}

/**
 * AES-256-GCM 认证加密
 * @param {Buffer} key 256 位对称密钥
 * @param {Buffer|object} data 明文数据（自动规范化转为 Buffer）
 * @param {string} aad 附加认证数据 (Associated Authenticated Data)，用于绑定上下文防篡改与重放
 * @returns {{iv: string, tag: string, data: string}} Base64 编码的密文盒
 */
function encrypt(key, data, aad) {
  const iv = c.randomBytes(12),
    cipher = c.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(canonical(data));
  try {
    const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
    return {
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: encrypted.toString("base64"),
    };
  } finally {
    if (!Buffer.isBuffer(data)) bytes.fill(0);
  }
}

function boxCheck(box) {
  if (!object(box) || Object.keys(box).sort().join(",") !== "data,iv,tag")
    fail("INVALID_FORMAT");
  b64(box.iv, 12);
  b64(box.tag, 16);
  b64(box.data);
}

/**
 * AES-256-GCM 认证解密
 * 严格验证 IV (12字节)、Tag (16字节) 与 AAD，任何不匹配均触发 AUTHENTICATION_FAILED
 */
function decrypt(key, box, aad) {
  boxCheck(box);
  try {
    const d = c.createDecipheriv("aes-256-gcm", key, b64(box.iv, 12));
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(b64(box.tag, 16));
    return Buffer.concat([d.update(b64(box.data)), d.final()]);
  } catch {
    fail("AUTHENTICATION_FAILED");
  }
}

/**
 * 解密密文盒并解析还原为 JSON 数据对象，解析后立即清零明文临时缓冲区
 */
function unpack(key, box, aad) {
  const buf = decrypt(key, box, aad);
  try {
    return json(buf.toString("utf8"));
  } finally {
    buf.fill(0);
  }
}
/**
 * 解析并生成 Ed25519 签名根公钥对象
 */
function rootKey(v) {
  try {
    const k = c.createPublicKey({ key: b64(v), format: "der", type: "spki" });
    if (k.asymmetricKeyType !== "ed25519") fail("INVALID_FORMAT");
    return k;
  } catch {
    fail("INVALID_FORMAT");
  }
}

/**
 * 剥离信封对象的 signature 字段，获取待签名原始载荷
 */
function unsigned(v) {
  const { signature, ...rest } = v;
  return rest;
}

/**
 * 使用 Ed25519 私钥对信封规范化 JSON 进行数字签名
 * @returns {object} 附加 Base64 格式 signature 字段的完整信封
 */
function sign(v, key) {
  const body = unsigned(v);
  return {
    ...body,
    signature: c
      .sign(null, Buffer.from(canonical(body)), key)
      .toString("base64"),
  };
}

/**
 * 严格校验密库信封 (LVCF 3) 的结构、字段类型、KDF 参数及 Ed25519 数字签名
 * 任何结构偏差或签名篡改均会直接抛出异常拒绝加载 (Fail-Closed)
 */
function validateEnvelope(v, pin) {
  if (
    !object(v) ||
    v.magic !== "LEGACYLOCK" ||
    v.format !== 3 ||
    !str(v.id, 64) ||
    !/^[a-f0-9-]{36}$/.test(v.id) ||
    !Number.isSafeInteger(v.revision) ||
    v.revision < 1
  )
    fail("UNSUPPORTED_FORMAT");
  if (
    Object.keys(v).sort().join(",") !==
    "format,id,magic,owner,payload,recovery,revision,signature,signingPublicKey"
  )
    fail("INVALID_FORMAT");
  if (pin && (v.id !== pin.id || v.signingPublicKey !== pin.signingPublicKey))
    fail("WRONG_VAULT");
  if (
    !object(v.owner) ||
    v.owner.kdf !== "scrypt-32768-8-1" ||
    Object.keys(v.owner).sort().join(",") !== "kdf,salt,wrapped"
  )
    fail("INVALID_FORMAT");
  b64(v.owner.salt, 16);
  boxCheck(v.owner.wrapped);
  boxCheck(v.payload);
  if (v.recovery !== null) {
    if (
      !object(v.recovery) ||
      Object.keys(v.recovery).sort().join(",") !== "generation,wrapped" ||
      !Number.isSafeInteger(v.recovery.generation) ||
      v.recovery.generation < 1
    )
      fail("INVALID_FORMAT");
    boxCheck(v.recovery.wrapped);
  }
  if (
    !c.verify(
      null,
      Buffer.from(canonical(unsigned(v))),
      rootKey(v.signingPublicKey),
      b64(v.signature, 64),
    )
  )
    fail("INVALID_SIGNATURE");
  return v;
}
function validateItems(items) {
  if (!Array.isArray(items) || items.length > 10000) fail("INVALID_ITEMS");
  const ids = new Set();
  for (const i of items) {
    if (
      !object(i) ||
      !str(i.id, 128) ||
      !i.id ||
      ids.has(i.id) ||
      !str(i.title, 1024) ||
      !i.title.trim() ||
      !CATEGORIES.has(i.category)
    )
      fail("INVALID_ITEMS");
    ids.add(i.id);
    const allowed = new Set([
      "id",
      "title",
      "category",
      "username",
      "password",
      "url",
      "notes",
      "customFields",
      "attachments",
      "inheritanceInstructions",
      "revision",
      "createdAt",
      "updatedAt",
    ]);
    if (Object.keys(i).some((k) => !allowed.has(k))) fail("INVALID_ITEMS");
    for (const k of [
      "username",
      "password",
      "url",
      "notes",
      "inheritanceInstructions",
    ])
      if (i[k] !== undefined && !str(i[k])) fail("INVALID_ITEMS");
    for (const k of ["createdAt", "updatedAt"])
      if (!Number.isSafeInteger(i[k]) || i[k] < 0) fail("INVALID_ITEMS");
    if (
      i.revision !== undefined &&
      (!Number.isSafeInteger(i.revision) || i.revision < 0)
    )
      fail("INVALID_ITEMS");
    if (i.customFields !== undefined) {
      if (!Array.isArray(i.customFields) || i.customFields.length > 100)
        fail("INVALID_ITEMS");
      for (const f of i.customFields)
        if (
          !object(f) ||
          !str(f.id, 128) ||
          !str(f.name, 1024) ||
          !str(f.value) ||
          typeof f.isSecret !== "boolean" ||
          (f.type !== undefined && !str(f.type, 40))
        )
          fail("INVALID_ITEMS");
    }
    if (i.attachments !== undefined) {
      if (!Array.isArray(i.attachments) || i.attachments.length > 100)
        fail("INVALID_ITEMS");
      for (const a of i.attachments) {
        if (
          !object(a) ||
          !str(a.id, 128) ||
          !str(a.name, 255) ||
          !str(a.type, 255) ||
          !Number.isSafeInteger(a.size) ||
          a.size < 0 ||
          a.size > 2 * 1024 * 1024 ||
          !str(a.data, 3 * 1024 * 1024)
        )
          fail("INVALID_ITEMS");
        const m = /^data:[^,]*;base64,([A-Za-z0-9+/]*={0,2})$/.exec(a.data);
        if (!m || b64(m[1]).length !== a.size) fail("INVALID_ITEMS");
      }
    }
  }
  if (Buffer.byteLength(canonical(items)) > 20 * 1024 * 1024)
    fail("INVALID_SIZE");
  return items;
}
function validateSettings(s) {
  if (
    !object(s) ||
    Object.keys(s).sort().join(",") !== "autoLockMinutes,heirName,heirNotes"
  )
    fail("INVALID_SETTINGS");
  if (
    ![1, 5, 15, 30, 60].includes(s.autoLockMinutes) ||
    !str(s.heirName, 200) ||
    !str(s.heirNotes, 10000)
  )
    fail("INVALID_SETTINGS");
  return s;
}
function validateData(d) {
  if (!object(d) || Object.keys(d).sort().join(",") !== "items,settings")
    fail("INVALID_FORMAT");
  validateItems(d.items);
  validateSettings(d.settings);
  return d;
}
function aad(v, kind) {
  return canonical(["LVCF3", v.id, v.signingPublicKey, kind]);
}
function owner(session) {
  if (!session || session.role !== "OWNER" || !session.signingKey)
    fail("OWNER_REQUIRED");
}
function dataOf(v, vmk) {
  return validateData(unpack(vmk, v.payload, aad(v, "payload")));
}
async function wrapOwner(v, vmk, signingKey, password, secret) {
  const salt = c.randomBytes(16),
    key = await credentialKey(password, secret, salt);
  const privateBytes = signingKey.export({ format: "der", type: "pkcs8" });
  try {
    return {
      kdf: "scrypt-32768-8-1",
      salt: salt.toString("base64"),
      wrapped: encrypt(
        key,
        {
          vmk: vmk.toString("base64"),
          signingPrivateKey: privateBytes.toString("base64"),
        },
        aad(v, "owner"),
      ),
    };
  } finally {
    key.fill(0);
    privateBytes.fill(0);
  }
}
/**
 * 创建新密库 (初始化)
 * 1. 自动生成专属 Ed25519 签名密钥对；
 * 2. 随机生成 256 位 Vault Master Key (VMK) 主数据密钥；
 * 3. 使用用户输入的口令与安全密钥通过 scrypt 派生包装密钥，封装 VMK 和 Ed25519 私钥；
 * 4. 使用 VMK 加密初始资产数据；
 * 5. 使用私钥对整个信封生成数字签名。
 */
async function create(password, secret, initial = []) {
  validateItems(initial);
  const keys = c.generateKeyPairSync("ed25519"),
    vmk = c.randomBytes(32);
  const v = {
    magic: "LEGACYLOCK",
    format: 3,
    id: c.randomUUID(),
    revision: 1,
    signingPublicKey: keys.publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64"),
    owner: null,
    recovery: null,
    payload: null,
  };
  try {
    v.owner = await wrapOwner(v, vmk, keys.privateKey, password, secret);
    const data = {
      items: initial,
      settings: { autoLockMinutes: 15, heirName: "", heirNotes: "" },
    };
    v.payload = encrypt(vmk, data, aad(v, "payload"));
    return {
      envelope: sign(v, keys.privateKey),
      vmk,
      signingKey: keys.privateKey,
      role: "OWNER",
      data,
    };
  } catch (e) {
    vmk.fill(0);
    throw e;
  }
}

/**
 * 所有者解锁会话
 * 校验数字签名 -> scrypt 派生口令密钥 -> 解密 VMK 与 Ed25519 签名私钥 -> 校验公私钥匹配 -> 解密资产数据
 */
async function unlockOwner(envelope, password, secret, pin) {
  const v = validateEnvelope(envelope, pin),
    key = await credentialKey(password, secret, b64(v.owner.salt, 16));
  let vmk;
  try {
    const decoded = unpack(key, v.owner.wrapped, aad(v, "owner"));
    vmk = b64(decoded.vmk, 32);
    const priv = b64(decoded.signingPrivateKey);
    let signingKey;
    try {
      signingKey = c.createPrivateKey({
        key: priv,
        format: "der",
        type: "pkcs8",
      });
    } finally {
      priv.fill(0);
    }
    if (
      c
        .createPublicKey(signingKey)
        .export({ format: "der", type: "spki" })
        .toString("base64") !== v.signingPublicKey
    )
      fail("AUTHENTICATION_FAILED");
    return {
      envelope: v,
      vmk,
      signingKey,
      role: "OWNER",
      data: dataOf(v, vmk),
    };
  } catch (e) {
    vmk?.fill(0);
    throw e;
  } finally {
    key.fill(0);
  }
}

/**
 * 更新密库数据 (保存资产/设置变更)
 * 版本号递增 (revision + 1)，用 VMK 重新加密载荷，并用 Ed25519 私钥重新签名
 */
function update(session, data) {
  owner(session);
  validateData(data);
  const v = {
    ...session.envelope,
    revision: session.envelope.revision + 1,
    payload: encrypt(session.vmk, data, aad(session.envelope, "payload")),
  };
  return { ...session, envelope: sign(v, session.signingKey), data };
}

/**
 * 基于 HKDF-SHA256 算法，将双物理 U 盘的随机秘密 a 与 b 合并派生出恢复密钥
 */
function recoveryKey(a, b, id, generation) {
  const seed = Buffer.concat([a, b]);
  try {
    return Buffer.from(
      c.hkdfSync(
        "sha256",
        seed,
        Buffer.from(id),
        Buffer.from("LVCF3 recovery " + generation),
        32,
      ),
    );
  } finally {
    seed.fill(0);
  }
}

/**
 * 为双 USB 设备配置/签发恢复秘密份额 (2-of-2 独立签名凭证)
 * 生成新的 recovery generation 代次，使用 Ed25519 签名主盘和副盘的独立 llkey 文件
 */
function provision(session) {
  owner(session);
  const a = c.randomBytes(32),
    b = c.randomBytes(32),
    generation = (session.envelope.recovery?.generation || 0) + 1;
  const v = { ...session.envelope, revision: session.envelope.revision + 1 },
    key = recoveryKey(a, b, v.id, generation);
  try {
    v.recovery = {
      generation,
      wrapped: encrypt(key, session.vmk, aad(v, "recovery:" + generation)),
    };
    const share = (role, secret) =>
      sign(
        {
          magic: "LEGACYLOCK_SHARE",
          format: 3,
          id: v.id,
          signingPublicKey: v.signingPublicKey,
          generation,
          role,
          secret: secret.toString("base64"),
        },
        session.signingKey,
      );
    return {
      session: { ...session, envelope: sign(v, session.signingKey) },
      primary: share("PRIMARY", a),
      secondary: share("SECONDARY", b),
    };
  } finally {
    a.fill(0);
    b.fill(0);
    key.fill(0);
  }
}

/**
 * 核验单个恢复份额 (llkey) 的结构、角色、代次及所有者 Ed25519 数字签名
 */
function verifyShare(s, v, role) {
  if (
    !object(s) ||
    Object.keys(s).sort().join(",") !==
      "format,generation,id,magic,role,secret,signature,signingPublicKey" ||
    s.magic !== "LEGACYLOCK_SHARE" ||
    s.format !== 3 ||
    s.role !== role ||
    s.id !== v.id ||
    s.signingPublicKey !== v.signingPublicKey ||
    s.generation !== v.recovery?.generation
  )
    fail("WRONG_RECOVERY_KEYS");
  if (
    !c.verify(
      null,
      Buffer.from(canonical(unsigned(s))),
      rootKey(v.signingPublicKey),
      b64(s.signature, 64),
    )
  )
    fail("INVALID_SIGNATURE");
  return b64(s.secret, 32);
}

/**
 * 继承人双盘只读恢复会话
 * 必须同时提供主盘和副盘秘密文件，核验两份签名有效且代次匹配后，恢复解密 VMK，生成只读会话 (role: HEIR)
 * 注意：继承人会话不包含 signingKey，根本无法伪造或签署任何写入修改！
 */
function unlockRecovery(envelope, primary, secondary) {
  const v = validateEnvelope(envelope);
  if (!v.recovery) fail("NO_RECOVERY");
  let vmk, a, b, key;
  try {
    a = verifyShare(primary, v, "PRIMARY");
    b = verifyShare(secondary, v, "SECONDARY");
    key = recoveryKey(a, b, v.id, v.recovery.generation);
    vmk = decrypt(
      key,
      v.recovery.wrapped,
      aad(v, "recovery:" + v.recovery.generation),
    );
    if (vmk.length !== 32) fail("INVALID_FORMAT");
    return {
      envelope: v,
      vmk,
      signingKey: null,
      role: "HEIR",
      data: dataOf(v, vmk),
    };
  } catch (e) {
    vmk?.fill(0);
    throw e;
  } finally {
    a?.fill(0);
    b?.fill(0);
    key?.fill(0);
  }
}

/**
 * 修改所有者密码与安全密钥 (重包装 owner 结构)
 */
async function rewrap(session, password, secret) {
  owner(session);
  const v = { ...session.envelope, revision: session.envelope.revision + 1 };
  v.owner = await wrapOwner(
    v,
    session.vmk,
    session.signingKey,
    password,
    secret,
  );
  return { ...session, envelope: sign(v, session.signingKey) };
}

/**
 * 轮换恢复代次并重置主数据密钥 (VMK)
 * 重新生成全新 VMK，并强制使之前的历史恢复秘密失效
 */
async function rotateRecovery(session, password, secret) {
  owner(session);
  const checked = await unlockOwner(session.envelope, password, secret);
  destroySession(checked);
  const vmk = c.randomBytes(32),
    v = { ...session.envelope };
  try {
    v.owner = await wrapOwner(v, vmk, session.signingKey, password, secret);
    v.payload = encrypt(vmk, session.data, aad(v, "payload"));
    return provision({ ...session, vmk, envelope: v });
  } catch (e) {
    vmk.fill(0);
    throw e;
  }
}

/**
 * 彻底销毁并擦除会话内存（主动调用 fill(0) 清除 VMK 主密钥，清空数据引用）
 */
function destroySession(s) {
  if (s) {
    s.vmk?.fill(0);
    s.signingKey = null;
    s.data = null;
    s.role = "LOCKED";
  }
}
module.exports = {
  MAX_BYTES,
  VaultError,
  fail,
  canonical,
  json,
  newSecret,
  validateItems,
  validateSettings,
  verifyShare,
  validateEnvelope,
  create,
  unlockOwner,
  unlockRecovery,
  update,
  provision,
  rewrap,
  rotateRecovery,
  destroySession,
  owner,
};
