"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const core = require("../electron/vault-core.cjs");
const { VaultStore } = require("../electron/vault-store.cjs");
const { LocalKey } = require("../electron/vault-local-key.cjs");
const password = "Synthetic test password!";
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "legacylock-local-key-"));
  const store = new VaultStore(path.join(dir, "vault.llvault"));
  t.after(async () => {
    store.lock();
    if (
      path.dirname(dir) !== path.resolve(os.tmpdir()) ||
      !path.basename(dir).startsWith("legacylock-local-key-")
    )
      throw Error("Unsafe cleanup");
    await fs.rm(dir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  });
  const key = crypto.randomBytes(32);
  const safe = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "gnome_libsecret",
    encryptString: (text) => {
      const iv = crypto.randomBytes(12),
        c = crypto.createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([c.update(text, "utf8"), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), body]);
    },
    decryptString: (bytes) => {
      const d = crypto.createDecipheriv(
        "aes-256-gcm",
        key,
        bytes.subarray(0, 12),
      );
      d.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([d.update(bytes.subarray(28)), d.final()]).toString(
        "utf8",
      );
    },
  };
  const local = new LocalKey(
      store,
      path.join(dir, "local-key-v1.json"),
      safe,
      "linux",
    ),
    secret = core.newSecret();
  store.beforeCommit = (v) => local.invalidateFor(v);
  await store.initialize(password, secret);
  return { dir, store, local, safe, secret };
}
test("system storage becoming unavailable still permits owner to forget the key", async (t) => {
  const { local, safe, secret } = await fixture(t);
  await local.set(true, password, secret);
  safe.isEncryptionAvailable = () => false;
  assert.deepEqual(await local.status(), {
    available: false,
    remembered: true,
  });
  await local.set(false);
  assert.equal((await local.status()).remembered, false);
});
test("locking during local unlock cannot resurrect an owner session", async (t) => {
  const { store, local, safe, secret } = await fixture(t);
  await local.set(true, password, secret);
  store.lock();
  const decrypt = safe.decryptString;
  safe.decryptString = (bytes) => {
    store.lock();
    return decrypt(bytes);
  };
  await assert.rejects(local.unlock(password), { code: "LOCKED" });
  assert.equal(store.session, null);
});
test("remembered key survives item writes and restart, still requires correct password and is not in backups", async (t) => {
  const { store, local, safe, secret } = await fixture(t);
  await local.set(true, password, secret);
  assert.ok(!(await fs.readFile(local.file, "utf8")).includes(secret));
  await store.saveItem({
    id: "item",
    title: "test",
    category: "note",
    createdAt: 1,
    updatedAt: 1,
  });
  store.lock();
  const restarted = new LocalKey(store, local.file, safe, "linux");
  await assert.rejects(restarted.unlock("Incorrect password!"));
  assert.equal(store.session, null);
  const result = await restarted.unlock(password);
  assert.equal(result.view.items.length, 1);
  await assert.rejects(core.unlockOwner(store.session.envelope, password, ""));
  await local.set(false);
  store.lock();
  await assert.rejects(local.unlock(password), {
    code: "LOCAL_KEY_UNAVAILABLE",
  });
});
test("remembering requires both owner credentials and a secure OS backend", async (t) => {
  const { store, local, safe, secret } = await fixture(t);
  await assert.rejects(local.set(true, password, core.newSecret()));
  assert.equal((await local.status()).remembered, false);
  safe.getSelectedStorageBackend = () => "basic_text";
  await assert.rejects(local.set(true, password, secret), {
    code: "LOCAL_KEY_UNAVAILABLE",
  });
  safe.getSelectedStorageBackend = () => "unknown";
  assert.equal(local.available(), false);
  store.session.role = "HEIR";
  await assert.rejects(local.set(false), { code: "OWNER_REQUIRED" });
  await assert.rejects(local.unlock(password), { code: "OWNER_REQUIRED" });
});
test("corrupt ciphertext falls back to explicit credentials without replacing the vault", async (t) => {
  const { store, local, secret } = await fixture(t);
  await local.set(true, password, secret);
  const record = JSON.parse(await fs.readFile(local.file, "utf8"));
  record.cipher = "broken";
  await fs.writeFile(local.file, JSON.stringify(record));
  store.lock();
  await assert.rejects(local.unlock(password), {
    code: "LOCAL_KEY_UNAVAILABLE",
  });
  await store.unlock(password, secret);
  assert.equal(store.session.role, "OWNER");
});
test("credential rotation invalidates remembered key", async (t) => {
  const { store, local, secret } = await fixture(t);
  await local.set(true, password, secret);
  const next = await core.rewrap(store.session, password, core.newSecret());
  await store.commit(next);
  assert.equal((await local.status()).remembered, false);
  await assert.rejects(fs.access(local.file), { code: "ENOENT" });
});
test("locking during remembered-key write removes the record and cannot authorize", async (t) => {
  const { store, local, safe, secret } = await fixture(t);
  const original = safe.encryptString;
  safe.encryptString = (text) => {
    store.lock();
    return original(text);
  };
  await assert.rejects(local.set(true, password, secret), { code: "LOCKED" });
  assert.equal(store.session, null);
  await assert.rejects(fs.access(local.file), { code: "ENOENT" });
});
