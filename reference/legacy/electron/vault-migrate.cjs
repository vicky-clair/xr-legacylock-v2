"use strict";
// Import only. Old public-seed recovery channels are deliberately not supported.
const c = require("node:crypto"),
  { promisify } = require("node:util");
const pbkdf2 = promisify(c.pbkdf2),
  core = require("./vault-core.cjs"),
  { read } = require("./vault-store.cjs");
const clean = (s) =>
  typeof s === "string"
    ? s
        .trim()
        .toUpperCase()
        .replace(/[^2-9A-Z]/g, "")
    : "";
const hash = (s) => c.createHash("sha256").update(s).digest("hex");
function hex(v, size) {
  if (
    typeof v !== "string" ||
    v.length > core.MAX_BYTES ||
    !/^([a-fA-F0-9]{2})+$/.test(v) ||
    (size !== undefined && v.length !== size * 2)
  )
    core.fail("INVALID_FORMAT");
  return Buffer.from(v, "hex");
}
async function decrypt(seed, salt, iv, data, iterations) {
  if (
    !Number.isInteger(iterations) ||
    iterations < 10000 ||
    iterations > 600000
  )
    core.fail("INVALID_FORMAT");
  const key = await pbkdf2(seed, hex(salt, 16), iterations, 32, "sha256"),
    bytes = hex(data);
  let plain;
  try {
    if (bytes.length < 16) core.fail("INVALID_FORMAT");
    const d = c.createDecipheriv("aes-256-gcm", key, hex(iv, 12));
    d.setAuthTag(bytes.subarray(-16));
    plain = Buffer.concat([d.update(bytes.subarray(0, -16)), d.final()]);
    return core.json(plain.toString("utf8"));
  } catch {
    core.fail("AUTHENTICATION_FAILED");
  } finally {
    key.fill(0);
    plain?.fill(0);
  }
}
async function legacyExport(v, password, secret) {
  if (
    v?.magic !== "LEGACYLOCK_ENCRYPTED_CONTAINER" ||
    v.format_version !== "2.0" ||
    v.algorithm !== "AES-256-GCM" ||
    v.kdf !== "PBKDF2-SHA256" ||
    typeof v.requiresSecretKey !== "boolean"
  )
    core.fail("UNSUPPORTED_LEGACY_FORMAT");
  if (
    typeof password !== "string" ||
    !password ||
    password.length > 1024 ||
    (v.requiresSecretKey && !clean(secret))
  )
    core.fail("INVALID_CREDENTIALS");
  const seed = v.requiresSecretKey
    ? password.trim() + "#SECRET_KEY:" + clean(secret)
    : password.trim();
  const data = await decrypt(seed, v.salt, v.iv, v.ciphertext, v.iterations);
  return core.validateItems(data.items);
}
async function legacyLocal(snapshot, password, secret) {
  const plan = snapshot?.plan,
    config = plan?.usbPasswordConfig;
  // Missing old authentication metadata is not equivalent to successful authentication.
  if (
    !config?.masterPasswordHash ||
    !config?.masterPasswordSalt ||
    !config?.secretKeyHash
  )
    core.fail("LEGACY_EXPORT_REQUIRED");
  if (
    typeof password !== "string" ||
    password.length > 1024 ||
    !clean(secret) ||
    hash(
      Buffer.concat([
        hex(config.masterPasswordSalt, 16),
        Buffer.from(password),
      ]),
    ) !== config.masterPasswordHash ||
    hash("LEGACY_SECRET_KEY_SALT_2026:" + clean(secret)) !==
      config.secretKeyHash
  )
    core.fail("AUTHENTICATION_FAILED");
  if (snapshot.plain) return core.validateItems(snapshot.plain);
  const v = snapshot.encrypted;
  if (!v?.__encrypted) core.fail("NO_LEGACY_DATA");
  const seeds = [
    `LEGACY_LOCAL_SALT_2026:${config.masterPasswordHash}:${config.secretKeyHash}:${plan.userPublicHex || "LOCAL_VAULT_INSTANCE"}`,
    `LEGACY_LOCAL_SALT_2026:${config.masterPasswordHash}:${plan.userPublicHex || "LOCAL_VAULT_INSTANCE"}`,
    "LEGACY_LOCAL_STORAGE_SALT_2026",
  ];
  for (const seed of seeds) {
    try {
      return core.validateItems(
        await decrypt(seed, v.salt_hex, v.nonce_hex, v.ciphertext_hex, 10000),
      );
    } catch (e) {
      if (e.code !== "AUTHENTICATION_FAILED") throw e;
    }
  }
  core.fail("AUTHENTICATION_FAILED");
}
async function migrate(
  controller,
  source,
  password,
  secret,
  newPassword,
  newSecret,
  snapshot,
) {
  if (source !== "file" && source !== "local") core.fail("INVALID_FORMAT");
  const store = controller.store,
    epoch = store.epoch;
  const file =
    source === "file"
      ? await controller.dialogs.open("选择旧版加密导出包（只读迁移）")
      : null;
  if (source === "file" && !file) return { canceled: true };
  controller.guard(epoch);
  return store.serial(async () => {
    if ((await store.status()).exists) core.fail("VAULT_EXISTS");
    const items =
      source === "file"
        ? await legacyExport(await read(file), password, secret)
        : await legacyLocal(snapshot, password, secret);
    controller.guard(epoch);
    const next = await core.create(newPassword, newSecret, items);
    try {
      controller.guard(epoch);
      return { view: await store.commit(next) };
    } catch (e) {
      core.destroySession(next);
      throw e;
    }
  });
}
module.exports = { migrate, legacyExport, legacyLocal };
