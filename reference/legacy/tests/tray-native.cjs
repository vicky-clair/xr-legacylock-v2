"use strict";
const { app, nativeImage, Tray, Menu } = require("electron");
const path = require("node:path");
const { VaultTray } = require("../electron/vault-tray.cjs");
app.disableHardwareAcceleration();
if (process.env.LEGACYLOCK_TRAY_TEST_PROFILE)
  app.setPath("userData", process.env.LEGACYLOCK_TRAY_TEST_PROFILE);
app.whenReady().then(() => {
  const icon = path.resolve(process.argv[2] || "electron/tray-icon.png");
  const decoded = nativeImage.createFromPath(icon);
  console.log(
    JSON.stringify({ empty: decoded.isEmpty(), size: decoded.getSize() }),
  );
  let tray;
  try {
    if (decoded.isEmpty()) throw Error("TRAY_ICON_EMPTY");
    if (process.argv.includes("--create")) {
      tray = new VaultTray({
        Tray,
        Menu,
        nativeImage,
        icon,
        window: () => null,
        lock: () => {},
        quit: () => {},
        text: (s) => s,
      });
      if (!tray.ensure()) throw Error(tray.lastError);
      console.log("NATIVE_TRAY_OK");
    }
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    tray?.destroy();
    app.exit(process.exitCode || 0);
  }
});
