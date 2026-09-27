"use strict";
const core = require("./vault-core.cjs");
const { read, atomicWrite } = require("./vault-store.cjs");
const media = require("./vault-media.cjs");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
// UI-independent orchestration; adapters allow device and I/O fault regression tests.
class VaultController {
  constructor(store, dialogs, devices = media) {
    this.store = store;
    this.dialogs = dialogs;
    this.devices = devices;
    this.recoveryPair = null;
  }
  guard(epoch) {
    if (this.store.epoch !== epoch) core.fail("LOCKED");
  }
  lock() {
    this.destroyChallenge = null;
    this.recoveryPair = null;
    this.store.lock();
  }
  async scan() {
    return (await this.devices.scan()).map(
      ({ token, label, root, size, free }) => ({
        token,
        label,
        root,
        size,
        free,
      }),
    );
  }
  async pair(a, b) {
    return this.devices.pair(await this.devices.scan(), a, b);
  }
  async shares(envelope, pair) {
    const paths = await Promise.all(
      pair.map((d, i) =>
        this.devices.location(d, envelope, i ? "SECONDARY" : "PRIMARY"),
      ),
    );
    return {
      paths,
      primary: await read(paths[0].key),
      secondary: await read(paths[1].key),
    };
  }
  provision(a, b, password, secret) {
    return this.store.serial(async () => {
      core.owner(this.store.session);
      const epoch = this.store.epoch;
      const pair = await this.pair(a, b);
      this.guard(epoch);
      const result = await core.rotateRecovery(
        this.store.session,
        password,
        secret,
      );
      let committed = false;
      try {
        this.guard(epoch);
        const paths = await Promise.all(
          pair.map((d, i) =>
            this.devices.location(
              d,
              result.session.envelope,
              i ? "SECONDARY" : "PRIMARY",
            ),
          ),
        );
        const verify = () => {
          const opened = core.unlockRecovery(
            result.session.envelope,
            result.primary,
            result.secondary,
          );
          core.destroySession(opened);
        };
        verify();
        // Generation directories preserve the previous working pair on partial failure.
        await atomicWrite(paths[0].key, result.primary, {
          backup: false,
          verify,
        });
        this.guard(epoch);
        await atomicWrite(paths[1].key, result.secondary, {
          backup: false,
          verify,
        });
        this.guard(epoch);
        // The handed-off secondary contains its immutable unlock share only.
        await atomicWrite(paths[0].vault, result.session.envelope, {
          backup: false,
        });
        this.guard(epoch);
        await this.pair(a, b);
        this.guard(epoch);
        const saved = await this.shares(result.session.envelope, pair),
          checked = core.unlockRecovery(
            result.session.envelope,
            saved.primary,
            saved.secondary,
          );
        core.destroySession(checked);
        const old = this.store.session;
        const view = await this.store.commit(result.session);
        committed = true;
        core.destroySession(old);
        return {
          view,
          paths: [paths[0].vault],
          keyPaths: paths.map((p) => p.key),
        };
      } finally {
        if (!committed) core.destroySession(result.session);
      }
    });
  }
  sync(a) {
    return this.store.serial(async () => {
      core.owner(this.store.session);
      const epoch = this.store.epoch,
        envelope = this.store.session.envelope;
      if (!envelope.recovery) core.fail("NO_RECOVERY");
      const drive = (await this.devices.scan()).find((d) => d.token === a);
      if (!drive) core.fail("USB_NOT_PRESENT");
      const saved = await this.devices.location(drive, envelope, "PRIMARY");
      this.guard(epoch);
      const primary = core.verifyShare(
        await read(saved.key),
        envelope,
        "PRIMARY",
      );
      primary.fill(0);
      await atomicWrite(saved.vault, envelope);
      if (!(await this.devices.scan()).some((d) => d.token === a))
        core.fail("USB_NOT_PRESENT");
      this.guard(epoch);
      return {
        revision: envelope.revision,
        paths: [saved.vault],
      };
    });
  }
  async recover(a, b) {
    const epoch = this.store.epoch;
    const file = await this.dialogs.open("选择信息数据备份（只读访问）");
    if (!file) return { canceled: true };
    this.guard(epoch);
    return this.store.serial(async () => {
      this.guard(epoch);
      const envelope = core.validateEnvelope(await read(file));
      const pair = await this.pair(a, b),
        saved = await this.shares(envelope, pair);
      this.guard(epoch);
      const next = core.unlockRecovery(
        envelope,
        saved.primary,
        saved.secondary,
      );
      try {
        await this.pair(a, b);
        this.guard(epoch);
        this.lock();
        // Viewing someone else's backup must never replace this computer's vault.
        this.store.session = next;
        const view = this.store.view();
        this.recoveryPair = [a, b];
        this.store.lastActivity = Date.now();
        return { view };
      } catch (e) {
        core.destroySession(next);
        throw e;
      }
    });
  }
  async unlock(password, secret) {
    if (this.store.session?.role !== "HEIR") {
      const view = await this.store.unlock(password, secret);
      this.recoveryPair = null;
      return { view };
    }
    return this.store.serial(async () => {
      const epoch = this.store.epoch;
      const next = await core.unlockOwner(
        this.store.session.envelope,
        password,
        secret,
      );
      try {
        this.guard(epoch);
        await this.store.assertNotRollback(next.envelope);
        this.guard(epoch);
        this.lock();
        return { view: await this.store.commit(next) };
      } catch (e) {
        core.destroySession(next);
        throw e;
      }
    });
  }
  async importData(password, secret) {
    // An unlocked owner may merge a separately authenticated information backup.
    core.owner(this.store.session);
    const epoch = this.store.epoch;
    const file = await this.dialogs.open(
      "导入信息数据备份（合并，不覆盖现有资产）",
    );
    if (!file) return { canceled: true };
    this.guard(epoch);
    return this.store.serial(async () => {
      core.owner(this.store.session);
      this.store.beforeAssetWrite?.();
      const source = await core.unlockOwner(await read(file), password, secret);
      try {
        this.guard(epoch);
        const items = [...this.store.session.data.items];
        let imported = 0;
        for (const item of source.data.items) {
          const existing = items.find((v) => v.id === item.id);
          if (existing && core.canonical(existing) === core.canonical(item))
            continue;
          items.push(existing ? { ...item, id: crypto.randomUUID() } : item);
          imported++;
        }
        const view = await this.store.commit(
          core.update(this.store.session, {
            ...this.store.session.data,
            items,
          }),
        );
        return { view, imported };
      } finally {
        core.destroySession(source);
      }
    });
  }
  prepareDestroy(password, secret) {
    return this.store.serial(async () => {
      const epoch = this.store.epoch;
      await this.store.verifyCredentials(password, secret);
      this.guard(epoch);
      const token = crypto.randomBytes(32).toString("hex");
      this.destroyChallenge = {
        token,
        epoch,
        revision: this.store.session.envelope.revision,
        expires: Date.now() + 120000,
      };
      return { token };
    });
  }
  destroy(token, confirmation) {
    return this.store.serial(async () => {
      core.owner(this.store.session);
      const challenge = this.destroyChallenge;
      this.destroyChallenge = null;
      if (
        !challenge ||
        token !== challenge.token ||
        confirmation !== "DELETE" ||
        challenge.epoch !== this.store.epoch ||
        challenge.revision !== this.store.session.envelope.revision ||
        Date.now() > challenge.expires
      )
        core.fail("CONFIRMATION_REQUIRED");
      const epoch = this.store.epoch;
      const disk = core.validateEnvelope(
        await read(this.store.file),
        this.store.session.envelope,
      );
      if (core.canonical(disk) !== core.canonical(this.store.session.envelope))
        core.fail("LOCAL_VAULT_CHANGED");
      this.guard(epoch);
      const directory = path.dirname(this.store.file),
        base = path.basename(this.store.file);
      const files = (await fs.readdir(directory)).filter(
        (name) =>
          name.startsWith(base + ".tmp-") &&
          /^[a-f0-9]{24}$/.test(name.slice((base + ".tmp-").length)),
      );
      // Only exact application-owned files, never external exports or USB contents.
      await this.beforeDestroy?.();
      this.guard(epoch);
      files.push(base + ".previous", base);
      try {
        for (const name of files) {
          this.guard(epoch);
          const file = path.join(directory, name);
          try {
            const stat = await fs.lstat(file);
            if (stat.isSymbolicLink() || !stat.isFile())
              core.fail("UNSAFE_MEDIA_PATH");
            await fs.unlink(file);
          } catch (e) {
            if (e.code !== "ENOENT") throw e;
          }
        }
      } finally {
        this.lock();
      }
      return { deleted: true };
    });
  }
  async importOwner(password, secret) {
    const epoch = this.store.epoch,
      file = await this.dialogs.open("选择 LVCF 3 密库备份");
    if (!file) return { canceled: true };
    this.guard(epoch);
    const view = await this.store.importOwner(file, password, secret);
    this.recoveryPair = null;
    return { view };
  }
  export(password, secret) {
    return this.store.serial(async () => {
      const epoch = this.store.epoch;
      await this.store.verifyCredentials(password, secret);
      this.guard(epoch);
      const file = await this.dialogs.save(
        "导出信息数据备份（加密）",
        "LegacyLock-information.llvault",
      );
      if (!file) return { canceled: true };
      this.guard(epoch);
      await atomicWrite(file, this.store.session.envelope);
      this.guard(epoch);
      return { path: file, revision: this.store.session.envelope.revision };
    });
  }
  credentials(password, secret, newPassword, newSecret) {
    return this.store.serial(async () => {
      const epoch = this.store.epoch;
      await this.store.verifyCredentials(password, secret);
      this.guard(epoch);
      const next = await core.rewrap(
        this.store.session,
        newPassword,
        newSecret,
      );
      this.guard(epoch);
      return { view: await this.store.commit(next) };
    });
  }
  health() {
    return this.store.serial(async () => {
      if (!this.store.session) core.fail("LOCKED");
      const epoch = this.store.epoch,
        pin = this.store.session.envelope;
      const disk =
        this.store.session.role === "HEIR"
          ? core.validateEnvelope(pin)
          : core.validateEnvelope(await read(this.store.file), pin);
      this.guard(epoch);
      if (core.canonical(disk) !== core.canonical(pin))
        core.fail("LOCAL_VAULT_CHANGED");
      return {
        revision: disk.revision,
        signatureValid: true,
        authenticatedData: true,
        recovery: !!disk.recovery,
      };
    });
  }
  async checkDevices() {
    if (this.store.session?.role === "HEIR" && this.recoveryPair) {
      const epoch = this.store.epoch;
      try {
        await this.pair(...this.recoveryPair);
      } catch {
        if (this.store.epoch !== epoch || this.store.session?.role !== "HEIR")
          return true;
        this.lock();
        return false;
      }
    }
    return true;
  }
}
module.exports = { VaultController };
