"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  c = require("node:crypto");
const core = require("../electron/vault-core.cjs"),
  { VaultStore, read, atomicWrite } = require("../electron/vault-store.cjs");
const { VaultController } = require("../electron/vault-controller.cjs"),
  media = require("../electron/vault-media.cjs");
const { legacyExport, legacyLocal } = require("../electron/vault-migrate.cjs");
const password = "Synthetic password 2026!",
  secret = core.newSecret();
const { Preferences } = require("../electron/vault-preferences.cjs");
test("appearance preferences persist; demo cannot authorize heirs or bypass queued writes", async (t) => {
  const { dir, store } = await fixture(t);
  const prefs = new Preferences(path.join(dir, "appearance.json"), store);
  await prefs.load();
  store.beforeAssetWrite = () => prefs.assertWritable();
  await assert.rejects(prefs.set({ ...prefs.value, theme: "cyber_cyan" }), {
    code: "OWNER_REQUIRED",
  });
  await store.initialize(password, secret);
  await prefs.set({ ...prefs.value, theme: "cyber_cyan", zoom: 1.15, language: 'ja', closeToTray: true });
  const restarted = await new Preferences(prefs.file,store).load();
  assert.equal(restarted.language,'ja');
  assert.equal(restarted.closeToTray,true);
  await assert.rejects(prefs.set({...prefs.value,language:'invalid'}),{code:'INVALID_SETTINGS'});
  const oldPrefs = path.join(dir,'old-appearance.json');
  await fs.writeFile(oldPrefs,JSON.stringify({theme:'royal_violet',zoom:1,subscriptionDemo:'trial'}));
  assert.equal((await new Preferences(oldPrefs,store).load()).language,'zh');
  assert.equal(
    (await new Preferences(prefs.file, store).load()).theme,
    "cyber_cyan",
  );
  const brokenPath = path.join(dir, "broken-appearance.json");
  await fs.writeFile(brokenPath, "{broken");
  const brokenPrefs = new Preferences(brokenPath, store);
  assert.equal((await brokenPrefs.load()).theme, "royal_violet");
  assert.equal(brokenPrefs.loadWarning, true);
  assert.equal(await fs.readFile(brokenPath, "utf8"), "{broken");
  assert.equal(store.view().role, "OWNER");
  await assert.rejects(
    prefs.set({ ...prefs.value, theme: "../../arbitrary" }),
    { code: "INVALID_SETTINGS" },
  );
  const expire = prefs.set({ ...prefs.value, subscriptionDemo: "expired" });
  const write = store.saveItem(item("blocked"));
  await expire;
  await assert.rejects(write, { code: "DEMO_READ_ONLY" });
  assert.equal(store.view().items.length, 0);
  await prefs.set({ ...prefs.value, subscriptionDemo: "yearly" });
  await store.saveItem(item("allowed"));
  const provisioned = core.provision(store.session);
  await store.commit(provisioned.session);
  const heir = core.unlockRecovery(
    store.session.envelope,
    provisioned.primary,
    provisioned.secondary,
  );
  store.lock();
  store.session = heir;
  await assert.rejects(
    prefs.set({ ...prefs.value, subscriptionDemo: "yearly" }),
    { code: "OWNER_REQUIRED" },
  );
  await assert.rejects(store.saveItem(item("forged")), {
    code: "OWNER_REQUIRED",
  });
  store.lock();
});
const item = (id) => ({
  id,
  title: "Synthetic " + id,
  category: "login",
  password: "fixture-only",
  createdAt: 1,
  updatedAt: 1,
  attachments: [
    {
      id: "a",
      name: "fixture.txt",
      type: "text/plain",
      data: "data:text/plain;base64,aGVsbG8=",
      size: 5,
      uploadedAt: 1,
    },
  ],
});
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "legacylock-test-"));
  t.after(() => {
    const resolved = path.resolve(dir);
    if (
      path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
      !path.basename(resolved).startsWith("legacylock-test-")
    )
      throw new Error("Unsafe fixture cleanup path");
    return fs.rm(resolved, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  });
  return { dir, store: new VaultStore(path.join(dir, "local.llvault")) };
}
test("both owner factors are required; signature and payload tampering fail closed", async () => {
  const s = await core.create(password, secret, [item("1")]);
  const good = await core.unlockOwner(s.envelope, password, secret);
  assert.equal(
    good.data.items[0].attachments[0].data,
    "data:text/plain;base64,aGVsbG8=",
  );
  core.destroySession(good);
  for (const [p, k] of [
    ["", secret],
    [password, ""],
    ["wrong password!", secret],
    [password, core.newSecret()],
  ])
    await assert.rejects(core.unlockOwner(s.envelope, p, k));
  for (const mutate of [
    (v) => v.revision++,
    (v) => (v.payload.data = "AA=="),
    (v) => (v.owner.salt = c.randomBytes(16).toString("base64")),
    (v) => (v.owner.kdf = "scrypt-1"),
    (v) => (v.payload.iv = "AA=="),
    (v) => (v.extra = true),
  ]) {
    const v = structuredClone(s.envelope);
    mutate(v);
    assert.throws(() => core.validateEnvelope(v));
  }
  core.destroySession(s);
});
test("recovery needs two independently signed shares and cannot sign writes", async () => {
  const s = await core.create(password, secret, [item("1")]),
    p = core.provision(s);
  const heir = core.unlockRecovery(p.session.envelope, p.primary, p.secondary);
  assert.equal(heir.role, "HEIR");
  assert.equal(heir.signingKey, null);
  for (const [a, b] of [
    [p.primary, p.primary],
    [p.secondary, p.primary],
    [null, p.secondary],
    [p.primary, null],
    [
      { ...p.primary, secret: c.randomBytes(32).toString("base64") },
      p.secondary,
    ],
  ])
    assert.throws(() => core.unlockRecovery(p.session.envelope, a, b));
  assert.throws(() => core.update(heir, heir.data), /OWNER_REQUIRED/);
  assert.throws(() => core.provision(heir), /OWNER_REQUIRED/);
  await assert.rejects(core.rewrap(heir, password, secret), /OWNER_REQUIRED/);
  assert.ok(!core.canonical(heir.data).includes("signingPrivateKey"));
  assert.ok(!core.canonical(p).includes(password));
  core.destroySession(heir);
  core.destroySession(s);
});
test("reconfiguration rotates data key; old pair cannot open current or future data", async () => {
  const initial = await core.create(password, secret),
    old = core.provision(initial),
    p = await core.rotateRecovery(old.session, password, secret);
  assert.notDeepEqual(p.session.vmk, old.session.vmk);
  assert.throws(() =>
    core.unlockRecovery(p.session.envelope, old.primary, old.secondary),
  );
  const heir = core.unlockRecovery(p.session.envelope, p.primary, p.secondary);
  assert.equal(heir.role, "HEIR");
  core.destroySession(heir);
  const owner = await core.unlockOwner(p.session.envelope, password, secret);
  core.destroySession(owner);
  core.destroySession(p.session);
  core.destroySession(initial);
});
test("credential changes preserve items; previous factors fail against new envelope", async () => {
  const s = await core.create(password, secret, [item("x")]),
    newSecret = core.newSecret(),
    n = await core.rewrap(s, password + "new", newSecret);
  await assert.rejects(core.unlockOwner(n.envelope, password, secret));
  const opened = await core.unlockOwner(
    n.envelope,
    password + "new",
    newSecret,
  );
  assert.equal(opened.data.items[0].id, "x");
  core.destroySession(opened);
  core.destroySession(s);
});
test("serialized item writes survive restart and restart is always locked", async (t) => {
  const { store } = await fixture(t);
  await store.initialize(password, secret);
  await Promise.all(
    Array.from({ length: 12 }, (_, i) => store.saveItem(item(String(i)))),
  );
  assert.equal(store.view().items.length, 12);
  assert.equal(store.view().revision, 13);
  const raw = await fs.readFile(store.file, "utf8");
  assert.ok(!raw.includes("fixture-only"));
  assert.ok(!raw.includes(secret));
  const reboot = new VaultStore(store.file);
  assert.equal((await reboot.status()).role, "LOCKED");
  assert.throws(() => reboot.view(), /LOCKED/);
  await assert.rejects(reboot.saveItem(item("x")), /OWNER_REQUIRED/);
  await reboot.unlock(password, secret);
  assert.equal(reboot.view().items.length, 12);
  store.lock();
  reboot.lock();
});
test("lock invalidates queued writes and in-flight authentication", async (t) => {
  const { store } = await fixture(t);
  await store.initialize(password, secret);
  const queued = store.saveItem(item("x"));
  store.lock();
  await assert.rejects(queued, /LOCKED/);
  assert.equal((await read(store.file)).revision, 1);
  const opening = store.unlock(password, secret);
  await new Promise((r) => setTimeout(r, 20));
  store.lock();
  await assert.rejects(opening, /LOCKED/);
  assert.equal(store.session, null);
});
test("write failure keeps prior disk and in-memory data and does not report success", async (t) => {
  const { store } = await fixture(t);
  await store.initialize(password, secret);
  const before = await fs.readFile(store.file, "utf8");
  const rename = fs.rename;
  fs.rename = async () => {
    throw Object.assign(new Error("injected failure"), { code: "EIO" });
  };
  try {
    await assert.rejects(store.saveItem(item("failure")), /injected/);
  } finally {
    fs.rename = rename;
  }
  assert.equal(await fs.readFile(store.file, "utf8"), before);
  assert.equal(store.view().items.length, 0);
  await store.saveItem(item("ok"));
  assert.equal(store.view().items.length, 1);
  store.lock();
});
test("corrupt or oversized local data is not replaced with an empty vault", async (t) => {
  const { store } = await fixture(t);
  await fs.writeFile(store.file, "{damaged");
  assert.equal((await store.status()).damaged, true);
  await assert.rejects(store.initialize(password, secret), /VAULT_EXISTS/);
  assert.equal(await fs.readFile(store.file, "utf8"), "{damaged");
  const h = await fs.open(store.file, "w");
  await h.truncate(core.MAX_BYTES + 1);
  await h.close();
  await assert.rejects(read(store.file), /INVALID_SIZE/);
});
test("distinct partitions on the same physical disk cannot qualify as a pair", () => {
  const drives = [
    { token: "a", physical: "disk1" },
    { token: "b", physical: "disk1" },
  ];
  assert.throws(() => media.pair(drives, "a", "b"), /TWO_PHYSICAL/);
  assert.throws(() => media.pair(drives, "a", "missing"), /USB_NOT_PRESENT/);
});
async function usbFixture(t) {
  const f = await fixture(t);
  let drives = [
    { token: "a", physical: "disk-a", root: path.join(f.dir, "a") },
    { token: "b", physical: "disk-b", root: path.join(f.dir, "b") },
  ];
  const devices = { ...media, scan: async () => drives };
  const dialog = { open: async () => null, save: async () => null };
  const controller = new VaultController(f.store, dialog, devices);
  await f.store.initialize(password, secret);
  await f.store.saveItem(item("inherited"));
  return {
    ...f,
    controller,
    devices,
    dialog,
    remove: () => {
      drives = drives.slice(0, 1);
    },
  };
}
test("real controller provisions, syncs and restores read-only on a different computer", async (t) => {
  const f = await usbFixture(t),
    configured = await f.controller.provision("a", "b", password, secret);
  assert.equal(configured.view.recovery, true);
  await f.store.saveItem(item("new"));
  await f.controller.sync("a", "b");
  const other = new VaultStore(path.join(f.dir, "other", "vault.llvault"));
  const reader = new VaultController(
    other,
    { open: async () => configured.paths[0] },
    f.devices,
  );
  const opened = await reader.recover("a", "b", true);
  assert.equal(opened.view.role, "HEIR");
  assert.equal(opened.view.items.length, 2);
  const operations = [
    () => other.saveItem(item("illegal")),
    () => other.deleteItem("new"),
    () => other.settings({ autoLockMinutes: 1, heirName: "x", heirNotes: "" }),
    () => reader.provision("a", "b", password, secret),
    () => reader.sync("a", "b"),
    () => reader.export(password, secret),
    () => reader.credentials(password, secret, password, secret),
  ];
  for (const fn of operations) await assert.rejects(fn(), /OWNER_REQUIRED/);
  assert.equal((await new VaultStore(other.file).status()).role, "LOCKED");
  f.remove();
  assert.equal(await reader.checkDevices(), false);
  assert.equal(other.session, null);
  await assert.rejects(fs.access(other.file), { code: "ENOENT" });
  await reader.importOwner(password, secret);
  await other.saveItem(item("authorized"));
  assert.equal(other.view().items.length, 3);
  other.lock();
  f.store.lock();
});
test("partial two-device provisioning failure leaves original local generation usable", async (t) => {
  const f = await usbFixture(t);
  await f.controller.provision("a", "b", password, secret);
  const before = core.canonical(f.store.session.envelope);
  const rename = fs.rename;
  fs.rename = async (a, b) => {
    if (b.endsWith("secondary.llkey")) throw new Error("USB removed");
    return rename(a, b);
  };
  try {
    await assert.rejects(
      f.controller.provision("a", "b", password, secret),
      /USB removed/,
    );
  } finally {
    fs.rename = rename;
  }
  assert.equal(core.canonical(f.store.session.envelope), before);
  assert.equal(core.canonical(await read(f.store.file)), before);
  f.controller.lock();
  f.dialog.open = async () =>
    (
      await media.location(
        (await f.devices.scan())[0],
        await read(f.store.file),
        "PRIMARY",
      )
    ).vault;
  assert.equal((await f.controller.recover("a", "b")).view.role, "HEIR");
  f.controller.lock();
});
test("stale and foreign backups cannot replace the local vault; canceled export creates nothing", async (t) => {
  const f = await usbFixture(t),
    old = await read(f.store.file);
  await f.store.saveItem(item("more"));
  await assert.rejects(f.store.assertNotRollback(old), /OLDER_BACKUP/);
  const other = await core.create(password, secret);
  await assert.rejects(
    f.store.assertNotRollback(other.envelope),
    /DIFFERENT_LOCAL/,
  );
  core.destroySession(other);
  assert.deepEqual(await f.controller.export(password, secret), {
    canceled: true,
  });
  f.store.lock();
});
test("attachment sizes, types and parser work limits are enforced", () => {
  assert.throws(() =>
    core.validateItems([{ ...item("x"), category: "untrusted" }]),
  );
  assert.throws(() => core.validateItems([item("same"), item("same")]));
  const invalid = item("x");
  invalid.attachments[0].size = 99;
  assert.throws(() => core.validateItems([invalid]));
  assert.throws(() =>
    core.validateSettings({ autoLockMinutes: 0, heirName: "", heirNotes: "" }),
  );
});
test("legacy migration refuses unauthenticated metadata and excessive KDF work", async () => {
  await assert.rejects(
    legacyLocal({ plan: { usbPasswordConfig: {} } }, password, secret),
    /LEGACY_EXPORT_REQUIRED/,
  );
  await assert.rejects(
    legacyExport(
      {
        magic: "LEGACYLOCK_ENCRYPTED_CONTAINER",
        format_version: "2.0",
        algorithm: "AES-256-GCM",
        kdf: "PBKDF2-SHA256",
        requiresSecretKey: true,
        iterations: 2 ** 31,
        salt: "00".repeat(16),
      },
      password,
      "LEGACYSECRET",
    ),
    /INVALID_FORMAT/,
  );
});
test("legacy authenticated export imports assets only, without retaining old plan secrets", async () => {
  const salt = c.randomBytes(16),
    iv = c.randomBytes(12),
    oldSecret = "LL-ABCDEFGHJKLMNPQRSTUVWX234",
    clean = oldSecret.replace(/[^2-9A-Z]/g, "");
  const key = c.pbkdf2Sync(
      password + "#SECRET_KEY:" + clean,
      salt,
      100000,
      32,
      "sha256",
    ),
    cipher = c.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([
    cipher.update(
      JSON.stringify({ items: [item("old")], plan: { secretKey: oldSecret } }),
    ),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const container = {
    magic: "LEGACYLOCK_ENCRYPTED_CONTAINER",
    format_version: "2.0",
    algorithm: "AES-256-GCM",
    kdf: "PBKDF2-SHA256",
    requiresSecretKey: true,
    iterations: 100000,
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    ciphertext: data.toString("hex"),
  };
  assert.equal(
    (await legacyExport(container, password, oldSecret))[0].id,
    "old",
  );
  await assert.rejects(legacyExport(container, password, "wrong"));
  key.fill(0);
});
test("atomic writes retain a complete previous version", async (t) => {
  const f = await fixture(t);
  await f.store.initialize(password, secret);
  const before = await read(f.store.file);
  await f.store.saveItem(item("x"));
  assert.deepEqual(await read(f.store.file + ".previous"), before);
  await assert.rejects(atomicWrite(path.join(f.dir, "bad"), { bogus: true }));
  f.store.lock();
});

test("offline reader recovers attachments and refuses to overwrite an existing output", async (t) => {
  const f = await usbFixture(t),
    p = await f.controller.provision("a", "b", password, secret);
  const env = f.store.session.envelope,
    drives = await f.devices.scan();
  const a = await media.location(drives[0], env, "PRIMARY"),
    b = await media.location(drives[1], env, "SECONDARY");
  const output = path.join(f.dir, "recovered.json"),
    args = [p.paths[0], a.key, b.key, output];
  const { run } = require("../scripts/recovery-reader.cjs");
  await run(args);
  const restored = await read(output);
  assert.equal(
    restored.items[0].attachments[0].data,
    "data:text/plain;base64,aGVsbG8=",
  );
  await assert.rejects(run(args), { code: "EEXIST" });
  f.store.lock();
});

test("uncertain post-rename failure locks the session rather than continuing with stale data", async (t) => {
  const { store } = await fixture(t);
  await store.initialize(password, secret);
  const original = fs.rename;
  fs.rename = async (a, b) => {
    await original(a, b);
    if (b === store.file) await fs.writeFile(b, "injected damage after rename");
  };
  try {
    await assert.rejects(store.saveItem(item("x")));
  } finally {
    fs.rename = original;
  }
  assert.equal(store.session, null);
  assert.equal((await store.status()).damaged, true);
  core.validateEnvelope(await read(store.file + ".previous"));
});

test("locking while the export chooser is open prevents the subsequent write", async (t) => {
  const f = await usbFixture(t);
  let release, shown;
  const waiting = new Promise((r) => {
    shown = r;
  });
  f.dialog.save = async () => {
    shown();
    return new Promise((r) => {
      release = r;
    });
  };
  const attempt = f.controller.export(password, secret);
  await waiting;
  f.controller.lock();
  release(path.join(f.dir, "not-written.llvault"));
  await assert.rejects(attempt, /LOCKED/);
  await assert.rejects(fs.stat(path.join(f.dir, "not-written.llvault")), {
    code: "ENOENT",
  });
});

test("checked-in LVCF 3 golden files stay readable by both authorized paths", async () => {
  const base = path.join(__dirname, "fixtures"),
    v = await read(path.join(base, "v3-vault.json"));
  const a = await read(path.join(base, "v3-primary.json")),
    b = await read(path.join(base, "v3-secondary.json"));
  const owner = await core.unlockOwner(
      v,
      "Golden fixture password!",
      "LL3-" + "11".repeat(32),
    ),
    heir = core.unlockRecovery(v, a, b);
  assert.deepEqual(owner.data, heir.data);
  assert.equal(owner.data.items[0].id, "golden-item");
  assert.equal(heir.signingKey, null);
  core.destroySession(owner);
  core.destroySession(heir);
});

test("lock during initial disk check does not resurrect an initialized owner session", async (t) => {
  const { store } = await fixture(t);
  let release, entered;
  const ready = new Promise((r) => {
    entered = r;
  });
  store.status = () => {
    entered();
    return new Promise((r) => {
      release = r;
    });
  };
  const request = store.initialize(password, secret);
  await ready;
  store.lock();
  release({ exists: false });
  await assert.rejects(request, /LOCKED/);
  assert.equal(store.session, null);
  await assert.rejects(fs.stat(store.file), { code: "ENOENT" });
});
