"use strict";
/**
 * 本机记住安全密钥模块 (Local Remembered Key with OS SafeStorage)
 * 
 * 安全架构与设计原则：
 * 1. 操作系统级安全存储：利用 OS 底层密钥库 (Windows DPAPI, macOS Keychain, Linux libsecret/kwallet) 加密存储安全密钥；
 * 2. 密码学绑定 (Cryptographic Binding)：记录中包含信封标识、签名公钥及 owner 包装头的 SHA-256 绑定哈希；
 * 3. 凭据变更自动失效：一旦修改主口令或安全密钥，绑定哈希改变，旧记录立即作废并自动物理删除；
 * 4. 隔离原则：此文件仅存在于本机当前 OS 用户目录，绝不会被打包或同步进 U 盘与外部信息导出包；
 * 5. 解锁双因子约束：即使开启本机记住密钥，解锁仍必须验证用户的主口令，严禁“免密直登”。
 */
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const core = require("./vault-core.cjs");
const { read, atomicWrite } = require("./vault-store.cjs");

/**
 * 计算信封的特征绑定哈希 (SHA-256)，用于校验本地安全存储与当前密库是否完全吻合
 */
const binding = (envelope) =>
  crypto
    .createHash("sha256")
    .update(
      core.canonical([envelope.id, envelope.signingPublicKey, envelope.owner]),
    )
    .digest("hex");

class LocalKey {
  constructor(store, file, safeStorage, platform = process.platform) {
    Object.assign(this, { store, file, safeStorage, platform });
  }

  /**
   * 检测当前操作系统安全存储服务是否真正可用且支持硬件/系统级加密
   */
  available() {
    try {
      return (
        this.safeStorage.isEncryptionAvailable() &&
        (this.platform !== "linux" ||
          ["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"].includes(
            this.safeStorage.getSelectedStorageBackend(),
          ))
      );
    } catch {
      return false;
    }
  }

  /**
   * 读取并校验本地存储的安全密钥记录，核验版本、绑定哈希及长度
   */
  async record(envelope) {
    try {
      const record = await read(this.file);
      if (
        record.version !== 1 ||
        record.binding !== binding(envelope) ||
        typeof record.cipher !== "string" ||
        record.cipher.length > 16384
      )
        return null;
      return record;
    } catch {
      return null;
    }
  }
  async status() {
    const available = this.available();
    try {
      const envelope = core.validateEnvelope(await read(this.store.file));
      return {
        available,
        remembered: !!(await this.record(envelope)),
      };
    } catch {
      return { available, remembered: false };
    }
  }
  async clear() {
    await fs.unlink(this.file).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
  async invalidateFor(envelope) {
    if (!(await this.record(envelope))) await this.clear();
  }
  set(enabled, password, secret) {
    return this.store.serial(async () => {
      core.owner(this.store.session);
      if (typeof enabled !== "boolean") core.fail("INVALID_SETTINGS");
      if (!enabled) {
        await this.clear();
        return;
      }
      if (!this.available()) core.fail("LOCAL_KEY_UNAVAILABLE");
      const epoch = this.store.epoch;
      await this.store.verifyCredentials(password, secret);
      if (epoch !== this.store.epoch) core.fail("LOCKED");
      const envelope = core.validateEnvelope(
        await read(this.store.file),
        this.store.session.envelope,
      );
      if (
        core.canonical(envelope) !== core.canonical(this.store.session.envelope)
      )
        core.fail("LOCAL_VAULT_CHANGED");
      if (epoch !== this.store.epoch) core.fail("LOCKED");
      const value = {
        version: 1,
        binding: binding(envelope),
        cipher: this.safeStorage
          .encryptString(JSON.stringify({ binding: binding(envelope), secret }))
          .toString("base64"),
      };
      const verify = (record) => {
        if (core.canonical(record) !== core.canonical(value))
          core.fail("WRITE_VERIFICATION_FAILED");
        const opened = JSON.parse(
          this.safeStorage.decryptString(Buffer.from(record.cipher, "base64")),
        );
        if (opened.secret !== secret || opened.binding !== value.binding)
          core.fail("WRITE_VERIFICATION_FAILED");
      };
      try {
        await atomicWrite(this.file, value, { backup: false, verify });
        if (epoch !== this.store.epoch) core.fail("LOCKED");
      } catch (e) {
        await this.clear();
        throw e;
      }
    });
  }
  unlock(password) {
    return this.store.serial(async () => {
      // Never use a remembered local credential to take over an external heir session.
      if (this.store.session) core.fail("OWNER_REQUIRED");
      if (!this.available()) core.fail("LOCAL_KEY_UNAVAILABLE");
      const epoch = this.store.epoch;
      const envelope = core.validateEnvelope(await read(this.store.file));
      const record = await this.record(envelope);
      if (!record) core.fail("LOCAL_KEY_UNAVAILABLE");
      let decoded;
      try {
        decoded = JSON.parse(
          this.safeStorage.decryptString(Buffer.from(record.cipher, "base64")),
        );
        if (decoded.binding !== binding(envelope))
          throw Error("Binding mismatch");
      } catch {
        core.fail("LOCAL_KEY_UNAVAILABLE");
      }
      let next;
      try {
        next = await core.unlockOwner(envelope, password, decoded.secret);
      } finally {
        decoded.secret = null;
      }
      if (epoch !== this.store.epoch) {
        core.destroySession(next);
        core.fail("LOCKED");
      }
      this.store.lock();
      this.store.session = next;
      this.store.lastActivity = Date.now();
      return { view: this.store.view() };
    });
  }
}
module.exports = { LocalKey };
