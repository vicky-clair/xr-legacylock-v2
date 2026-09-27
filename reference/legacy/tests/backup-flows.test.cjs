const { test } = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const core = require("../electron/vault-core.cjs");
const {
  VaultStore,
  read,
  atomicWrite,
} = require("../electron/vault-store.cjs");
const { VaultController } = require("../electron/vault-controller.cjs");
const media = require("../electron/vault-media.cjs");
const password = "Testing only password 2026!",
  secret = core.newSecret();
const item = (id) => ({
  id,
  title: "跨平台情報 " + id,
  category: "note",
  notes: "Windows/macOS/Linux UTF-8",
  createdAt: 1,
  updatedAt: 1,
});
async function setup(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "legacylock-flow-"));
  t.after(async () => {
    if (
      path.dirname(path.resolve(dir)) !== path.resolve(os.tmpdir()) ||
      !path.basename(dir).startsWith("legacylock-flow-")
    )
      throw Error("Unsafe cleanup");
    await fs.rm(dir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  });
  const all = [
    { token: "a", physical: "disk-a", root: path.join(dir, "primary") },
    { token: "b", physical: "disk-b", root: path.join(dir, "secondary") },
  ];
  const devices = { ...media, scan: async () => all };
  const store = new VaultStore(path.join(dir, "local.llvault"));
  const dialogs = {
    open: async () => null,
    save: async () => path.join(dir, "information.llvault"),
  };
  const controller = new VaultController(store, dialogs, devices);
  await store.initialize(password, secret);
  await store.saveItem(item("one"));
  return { dir, all, devices, store, dialogs, controller };
}
test("secondary is key-only and unchanged while primary updates without it, including credential changes", async (t) => {
  const f = await setup(t),
    configured = await f.controller.provision("a", "b", password, secret);
  const location = await media.location(
    f.all[1],
    f.store.session.envelope,
    "SECONDARY",
  );
  const handedOff = await fs.readFile(location.key);
  await assert.rejects(fs.stat(location.vault), { code: "ENOENT" });
  f.devices.scan = async () => [f.all[0]];
  await f.store.saveItem(item("two"));
  await f.controller.sync("a");
  const nextSecret = core.newSecret();
  await f.controller.credentials(
    password,
    secret,
    password + "new",
    nextSecret,
  );
  await f.store.saveItem(item("three"));
  await f.controller.sync("a");
  assert.deepEqual(await fs.readFile(location.key), handedOff);
  f.devices.scan = async () => f.all;
  f.dialogs.open = async () => configured.paths[0];
  f.controller.lock();
  const opened = await f.controller.recover("a", "b");
  assert.equal(opened.view.role, "HEIR");
  assert.equal(opened.view.items.length, 3);
  await assert.rejects(f.controller.unlock(password, secret));
  assert.equal(
    (await f.controller.unlock(password + "new", nextSecret)).view.role,
    "OWNER",
  );
  f.controller.lock();
});
test("readonly file import never replaces another local vault; owner merge preserves local USB configuration", async (t) => {
  const f = await setup(t),
    configured = await f.controller.provision("a", "b", password, secret);
  const other = new VaultStore(path.join(f.dir, "other.llvault"));
  await other.initialize(password, secret);
  await other.saveItem(item("local"));
  const before = await fs.readFile(other.file);
  const reader = new VaultController(
    other,
    { open: async () => configured.paths[0] },
    f.devices,
  );
  await reader.recover("a", "b");
  assert.deepEqual(await fs.readFile(other.file), before);
  await assert.rejects(reader.unlock(password, secret), {
    code: "DIFFERENT_LOCAL_VAULT",
  });
  reader.lock();
  await reader.unlock(password, secret);
  const ownerRoot = other.session.envelope.id;
  const imported = await reader.importData(password, secret);
  assert.equal(imported.view.items.length, 2);
  assert.equal(imported.view.id, ownerRoot);
  assert.equal((await reader.importData(password, secret)).imported, 0);
  reader.lock();
  f.controller.lock();
});
test("information exports require both factors and roundtrip unicode on a fresh installation", async (t) => {
  const f = await setup(t);
  await f.controller.provision("a", "b", password, secret);
  await assert.rejects(f.controller.export(password, ""));
  await assert.rejects(f.controller.export("", secret));
  const exported = await f.controller.export(password, secret);
  const other = new VaultStore(path.join(f.dir, "fresh.llvault"));
  const reader = new VaultController(
    other,
    { open: async () => exported.path },
    f.devices,
  );
  const imported = await reader.importOwner(password, secret);
  assert.equal(imported.view.items[0].title, "跨平台情報 one");
  assert.equal(imported.view.recovery, true);
  await reader.sync("a");
  reader.lock();
  f.controller.lock();
});
test("local destruction requires fresh factors and two confirmations, preserves external backups", async (t) => {
  const f = await setup(t),
    backup = await f.controller.export(password, secret);
  await assert.rejects(f.controller.prepareDestroy(password, "wrong"));
  await assert.rejects(f.controller.destroy("forged", "DELETE"), {
    code: "CONFIRMATION_REQUIRED",
  });
  let step = await f.controller.prepareDestroy(password, secret);
  await f.store.saveItem(item("changed"));
  await assert.rejects(f.controller.destroy(step.token, "DELETE"), {
    code: "CONFIRMATION_REQUIRED",
  });
  step = await f.controller.prepareDestroy(password, secret);
  await assert.rejects(f.controller.destroy(step.token, "wrong"), {
    code: "CONFIRMATION_REQUIRED",
  });
  const leftover = f.store.file + ".tmp-" + "a".repeat(24);
  await atomicWrite(leftover, await read(f.store.file));
  step = await f.controller.prepareDestroy(password, secret);
  await f.controller.destroy(step.token, "DELETE");
  for (const file of [f.store.file, f.store.file + ".previous", leftover])
    await assert.rejects(fs.stat(file), { code: "ENOENT" });
  assert.equal(f.store.session, null);
  assert.equal((await f.store.status()).exists, false);
  const recovered = await core.unlockOwner(
    await read(backup.path),
    password,
    secret,
  );
  assert.equal(recovered.data.items.length, 1);
  core.destroySession(recovered);
});
