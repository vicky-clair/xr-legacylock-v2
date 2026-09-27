"use strict";
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  { spawn } = require("node:child_process");
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "legacylock-tray-"));
  try {
    const env = { ...process.env, LEGACYLOCK_TRAY_TEST_PROFILE: dir };
    delete env.ELECTRON_RUN_AS_NODE;
    process.exitCode = await new Promise((resolve, reject) => {
      const child = spawn(
        require("electron"),
        [path.join(__dirname, "tray-native.cjs"), ...process.argv.slice(2)],
        { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      child.stdout.on("data", (d) => process.stdout.write(d));
      child.stderr.on("data", (d) => process.stderr.write(d));
      const timeout = setTimeout(() => {
        child.kill();
        reject(Error("Native tray timeout"));
      }, 15000);
      child.on("error", (e) => {
        clearTimeout(timeout);
        reject(e);
      });
      child.on("exit", (code) => {
        clearTimeout(timeout);
        resolve(code ?? 1);
      });
    });
  } finally {
    if (
      path.dirname(path.resolve(dir)) !== path.resolve(os.tmpdir()) ||
      !path.basename(dir).startsWith("legacylock-tray-")
    )
      throw Error("Unsafe fixture cleanup");
    await fs.rm(dir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
