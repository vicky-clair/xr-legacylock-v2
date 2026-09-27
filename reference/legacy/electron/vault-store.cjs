"use strict";
/**
 * 密库持久化存储与原子 I/O 模块
 * 
 * 核心安全机制：
 * 1. 同文件系统临时文件写入 + 独占排他创建标志 (wx, 0o600)；
 * 2. 强制物理落盘 (fsync)，杜绝断电导致的文件损坏；
 * 3. 写入读回校验：每次写入后立即从磁盘重新读取，校验 canonical 字节与数字签名；
 * 4. 自动保留上一快照 (.previous)，防止灾难事故；
 * 5. 原子替换 (rename)，规避中间半截入库状态；
 * 6. 串行操作锁 (serial queue) 与 代次代数 (epoch)，防范并发竞争与旧会话越权。
 */
const fs = require("node:fs/promises"),
  path = require("node:path"),
  crypto = require("node:crypto");
const core = require("./vault-core.cjs");

/**
 * 安全读取密库文件，校验文件大小及读取完整性
 */
async function read(file) {
  const h = await fs.open(file, "r");
  try {
    const stat = await h.stat();
    if (!stat.isFile() || stat.size > core.MAX_BYTES) core.fail("INVALID_SIZE");
    const bytes = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const r = await h.read(bytes, offset, bytes.length - offset, null);
      if (!r.bytesRead) break;
      offset += r.bytesRead;
    }
    if (offset !== stat.size) core.fail("FILE_CHANGED");
    return core.json(bytes.subarray(0, offset).toString("utf8"));
  } finally {
    await h.close();
  }
}

/**
 * 工业级原子写入 (Atomic Write with Fsync & Verify)
 * 写入流程：
 * 1. 检查软链接符号攻击 (Anti-Symlink Attack)；
 * 2. 写入随机同级临时文件 (.tmp-xxx) 并执行 fsync() 强制刷盘；
 * 3. 立即读回临时文件，校验 canonical JSON 字节与信封结构；
 * 4. 将原有效文件备份至 .previous；
 * 5. 通过系统原子 rename 替换目标文件；
 * 6. 再次读回目标文件核实，若出现异常则标记 commitUncertain = true 触发会话锁定。
 */
async function atomicWrite(
  file,
  value,
  { backup = true, verify = core.validateEnvelope } = {},
) {
  const body = core.canonical(value);
  if (Buffer.byteLength(body) > core.MAX_BYTES) core.fail("INVALID_SIZE");
  verify(value);
  await fs.mkdir(path.dirname(file), { recursive: true });
  for (const target of [file, file + ".previous"]) {
    try {
      if ((await fs.lstat(target)).isSymbolicLink())
        core.fail("UNSAFE_MEDIA_PATH");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  const temp = file + ".tmp-" + crypto.randomBytes(12).toString("hex");
  let h,
    replaced = false;
  try {
    h = await fs.open(temp, "wx", 0o600);
    await h.writeFile(body, "utf8");
    await h.sync();
    await h.close();
    h = null;
    const check = await read(temp);
    verify(check);
    if (core.canonical(check) !== body) core.fail("WRITE_VERIFICATION_FAILED");
    if (backup) {
      try {
        await fs.copyFile(file, file + ".previous");
        const old = await fs.open(file + ".previous", "r+");
        try {
          await old.sync();
        } finally {
          await old.close();
        }
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }
    await fs.rename(temp, file);
    replaced = true;
    // Directory fsync is unsupported on some Windows filesystems.
    if (process.platform !== "win32") {
      const dir = await fs.open(path.dirname(file), "r");
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
    }
    const saved = await read(file);
    verify(saved);
    if (core.canonical(saved) !== body) core.fail("WRITE_VERIFICATION_FAILED");
    return file;
  } catch (e) {
    if (replaced) e.commitUncertain = true;
    throw e;
  } finally {
    await h?.close();
    await fs.unlink(temp).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
}
/**
 * 密库持久化存储管理类
 * 维护内存中解密的会话对象 (session)、磁盘文件路径、串行写队列与活动状态
 */
class VaultStore {
  constructor(file) {
    this.file = file;
    this.session = null;
    this.queue = Promise.resolve();
    this.epoch = 0; // 会话代次：锁定后立即自增，使排队中的过期写入立即作废 (fail-closed)
    this.lastActivity = Date.now();
  }

  /**
   * 串行化执行高危 I/O 操作，杜绝多线程/多事件并发导致的数据交错
   * 同时比对执行时刻与排队时刻的 epoch，如果期间发生过锁屏或退出，则拒绝执行并报错 LOCKED
   */
  serial(fn) {
    const epoch = this.epoch;
    const next = this.queue.then(() => {
      if (epoch !== this.epoch) core.fail("LOCKED");
      return fn();
    });
    this.queue = next.catch(() => {});
    return next;
  }

  /**
   * 安全锁定会话：代次自增使等待任务失效，内存擦除零化 session，并置空引用
   */
  lock() {
    this.epoch++;
    core.destroySession(this.session);
    this.session = null;
  }
  async status() {
    let envelope;
    try {
      envelope = core.validateEnvelope(await read(this.file));
    } catch (e) {
      if (e.code === "ENOENT") return { exists: false, role: "LOCKED" };
      return {
        exists: true,
        role: "LOCKED",
        damaged: true,
        error: e.code || "READ_FAILED",
      };
    }
    return {
      exists: true,
      role: "LOCKED",
      id: envelope.id,
      revision: envelope.revision,
      recovery: !!envelope.recovery,
    };
  }
  view() {
    const s = this.session;
    if (!s) core.fail("LOCKED");
    return {
      role: s.role,
      id: s.envelope.id,
      revision: s.envelope.revision,
      recovery: !!s.envelope.recovery,
      items: s.data.items,
      settings: s.data.settings,
    };
  }
  async commit(next) {
    const epoch = this.epoch;
    try {
      await this.beforeCommit?.(next.envelope);
      if (epoch !== this.epoch) core.fail("LOCKED");
      await atomicWrite(this.file, next.envelope);
      if (epoch !== this.epoch) {
        core.destroySession(next);
        core.fail("LOCKED");
      }
      this.session = next;
      this.lastActivity = Date.now();
      return this.view();
    } catch (e) {
      if (e.commitUncertain) this.lock();
      if (this.session?.vmk !== next.vmk) core.destroySession(next);
      throw e;
    }
  }
  initialize(password, secret) {
    return this.serial(async () => {
      const epoch = this.epoch;
      if ((await this.status()).exists) core.fail("VAULT_EXISTS");
      if (epoch !== this.epoch) core.fail("LOCKED");
      const next = await core.create(password, secret);
      if (epoch !== this.epoch) {
        core.destroySession(next);
        core.fail("LOCKED");
      }
      return this.commit(next);
    });
  }
  unlock(password, secret) {
    return this.serial(async () => {
      const epoch = this.epoch;
      const next = await core.unlockOwner(
        await read(this.file),
        password,
        secret,
      );
      if (epoch !== this.epoch) {
        core.destroySession(next);
        core.fail("LOCKED");
      }
      this.lock();
      this.session = next;
      this.lastActivity = Date.now();
      return this.view();
    });
  }
  saveItem(item) {
    return this.serial(async () => {
      core.owner(this.session);
      this.beforeAssetWrite?.();
      core.validateItems([item]);
      const items = this.session.data.items;
      const old = items.find((i) => i.id === item.id);
      const value = {
        ...item,
        createdAt: old?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
        revision: (old?.revision || 0) + 1,
      };
      return this.commit(
        core.update(this.session, {
          ...this.session.data,
          items: old
            ? items.map((i) => (i.id === item.id ? value : i))
            : [value, ...items],
        }),
      );
    });
  }
  deleteItem(id) {
    return this.serial(async () => {
      core.owner(this.session);
      this.beforeAssetWrite?.();
      if (typeof id !== "string") core.fail("INVALID_ITEMS");
      return this.commit(
        core.update(this.session, {
          ...this.session.data,
          items: this.session.data.items.filter((i) => i.id !== id),
        }),
      );
    });
  }
  settings(value) {
    return this.serial(async () => {
      core.owner(this.session);
      core.validateSettings(value);
      return this.commit(
        core.update(this.session, { ...this.session.data, settings: value }),
      );
    });
  }
  async verifyCredentials(password, secret) {
    core.owner(this.session);
    const s = await core.unlockOwner(this.session.envelope, password, secret);
    core.destroySession(s);
  }
  async assertNotRollback(envelope) {
    const status = await this.status();
    if (status.damaged) core.fail("LOCAL_VAULT_DAMAGED");
    if (status.exists) {
      const old = await read(this.file);
      if (
        old.id !== envelope.id ||
        old.signingPublicKey !== envelope.signingPublicKey
      )
        core.fail("DIFFERENT_LOCAL_VAULT");
      if (envelope.revision < old.revision) core.fail("OLDER_BACKUP");
    }
  }
  importOwner(file, password, secret) {
    return this.serial(async () => {
      const epoch = this.epoch,
        envelope = core.validateEnvelope(await read(file));
      await this.assertNotRollback(envelope);
      const next = await core.unlockOwner(envelope, password, secret);
      if (epoch !== this.epoch) {
        core.destroySession(next);
        core.fail("LOCKED");
      }
      this.lock();
      return this.commit(next);
    });
  }
  importRecovery(file, primary, secondary) {
    return this.serial(async () => {
      const epoch = this.epoch,
        envelope = core.validateEnvelope(await read(file));
      await this.assertNotRollback(envelope);
      const next = core.unlockRecovery(envelope, primary, secondary);
      if (epoch !== this.epoch) {
        core.destroySession(next);
        core.fail("LOCKED");
      }
      this.lock();
      return this.commit(next);
    });
  }
}
module.exports = { read, atomicWrite, VaultStore };
