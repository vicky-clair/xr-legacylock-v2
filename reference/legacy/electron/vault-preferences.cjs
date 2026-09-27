"use strict";
const core = require("./vault-core.cjs");
const { read, atomicWrite } = require("./vault-store.cjs");
const defaults = {
  theme: "royal_violet",
  zoom: 1,
  subscriptionDemo: "trial",
  language: "zh",
  closeToTray: false,
};
function validate(value) {
  if (
    value &&
    Object.keys(value).sort().join(",") === "subscriptionDemo,theme,zoom"
  )
    value = { ...defaults, ...value };
  if (
    !value ||
    Object.keys(value).sort().join(",") !==
      "closeToTray,language,subscriptionDemo,theme,zoom" ||
    !["zh", "en", "ja"].includes(value.language) ||
    typeof value.closeToTray !== "boolean" ||
    ![
      "royal_violet",
      "cyber_cyan",
      "obsidian_gold",
      "electric_magenta",
      "abyssal_navy",
    ].includes(value.theme) ||
    ![0.85, 1, 1.15, 1.25].includes(value.zoom) ||
    !["trial", "expired", "monthly", "quarterly", "yearly"].includes(
      value.subscriptionDemo,
    )
  )
    core.fail("INVALID_SETTINGS");
  return value;
}
class Preferences {
  constructor(file, store) {
    this.file = file;
    this.store = store;
    this.value = { ...defaults };
  }
  async load() {
    try {
      this.value = validate(await read(this.file));
    } catch (e) {
      // Presentation/demo state must never prevent access to the encrypted vault.
      this.loadWarning = e.code !== "ENOENT";
    }
    return this.value;
  }
  set(value) {
    return this.store.serial(async () => {
      core.owner(this.store.session);
      const epoch = this.store.epoch;
      const next = { ...validate(value) };
      await atomicWrite(this.file, next, { verify: validate });
      this.value = next;
      this.loadWarning = false;
      if (epoch !== this.store.epoch) core.fail("LOCKED");
      return next;
    });
  }
  assertWritable() {
    core.owner(this.store.session);
    if (this.value.subscriptionDemo === "expired") core.fail("DEMO_READ_ONLY");
  }
}
module.exports = { Preferences, validate, defaults };
