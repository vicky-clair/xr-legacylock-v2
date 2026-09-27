"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { VaultTray } = require("../electron/vault-tray.cjs");
test("tray hides only after locking; restore and explicit exit remain available", () => {
  const events = [];
  let menu;
  class Tray {
    setToolTip() {}
    on() {}
    isDestroyed() {
      return false;
    }
    setContextMenu(value) {
      menu = value;
    }
    destroy() {
      events.push("destroy");
    }
  }
  const win = {
    isDestroyed: () => false,
    isMinimized: () => true,
    restore: () => events.push("restore"),
    show: () => events.push("show"),
    focus: () => events.push("focus"),
    hide: () => events.push("hide"),
  };
  const tray = new VaultTray({
    Tray,
    nativeImage: { createFromPath: () => ({ isEmpty: () => false }) },
    Menu: { buildFromTemplate: (v) => v },
    icon: "fixture",
    window: () => win,
    lock: () => events.push("lock"),
    quit: () => events.push("quit"),
    text: (s) => s,
  });
  assert.equal(tray.hide(), true);
  assert.deepEqual(events, ["lock", "hide"]);
  menu[0].click();
  assert.deepEqual(events.slice(2), ["restore", "show", "focus"]);
  menu[3].click();
  assert.equal(events.at(-1), "quit");
  tray.destroy();
  assert.equal(events.at(-1), "destroy");
});
test("unavailable native tray never hides the only window", () => {
  const tray = new VaultTray({
    nativeImage: { createFromPath: () => ({ isEmpty: () => false }) },
    Tray: class {
      constructor() {
        throw Error("unavailable");
      }
    },
    window: () => {
      throw Error("must not hide");
    },
  });
  assert.equal(tray.hide(), false);
});
test("invalid tray image is rejected before creating or hiding a native window", () => {
  const tray = new VaultTray({
    nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
    Tray: class {
      constructor() {
        throw Error("must not construct");
      }
    },
    window: () => {
      throw Error("must not hide");
    },
  });
  assert.equal(tray.hide(), false);
  assert.equal(tray.lastError, "TRAY_ICON_EMPTY");
});
