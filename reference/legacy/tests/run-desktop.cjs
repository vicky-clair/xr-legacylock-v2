"use strict";
const { spawn } = require("node:child_process"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "legacylock-desktop-"));
  try {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    await new Promise((resolve, reject) => {
      const child = spawn(
        require("electron"),
        [path.join(__dirname, "electron-smoke.cjs"), dir],
        { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "";
      child.stdout.on("data", (d) => {
        output += d;
      });
      child.stderr.on("data", (d) => {
        output += d;
      });
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error("Desktop regression timed out. " + output));
      }, 60000);
      child.on("error", (e) => {
        clearTimeout(timeout);
        reject(e);
      });
      child.on("exit", (code) => {
        clearTimeout(timeout);
        if (code) reject(new Error(output));
        else {
          process.stdout.write(output);
          resolve();
        }
      });
    });
  } finally {
    const resolved = path.resolve(dir),
      parent = path.resolve(os.tmpdir());
    if (
      path.dirname(resolved) !== parent ||
      !path.basename(resolved).startsWith("legacylock-desktop-")
    )
      throw new Error("Unsafe fixture cleanup path");
    await fs.rm(resolved, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
})().catch((e) => {
  process.stderr.write(e.message + "\n");
  process.exitCode = 1;
});
