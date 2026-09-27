"use strict";
/**
 * Electron 主进程与系统生命周期管理器 (Main Process)
 * 
 * 核心安全防御体系：
 * 1. 单实例互斥锁 (Single Instance Lock)：防止多个实例同时访问和争用密库；
 * 2. 剪贴板安全销毁：复制密码等敏感信息后自动启动定时销毁，锁定密库时立即清空剪贴板；
 * 3. 来源严苛校验 (Sender Verification)：核验 IPC 消息必须来自主窗口顶层本地 HTML，防范恶意脚本跨帧投毒；
 * 4. 强制网络断网隔离 (Air-Gap Simulation)：拦截渲染进程所有发往外部的外联网络请求；
 * 5. OS 系统级感知联动：监听系统锁屏、睡眠挂起事件，第一时间触发密库零化锁定；
 * 6. 不确定性提交防御 (Fail-Closed)：发生写入异常或未决状态时，立即阻断后续执行并强制锁定。
 */
const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  powerMonitor,
  session,
  clipboard,
  Tray,
  Menu,
  nativeImage,
  safeStorage,
} = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const fs = require("node:fs");
const core = require("./vault-core.cjs");
const { VaultStore } = require("./vault-store.cjs");
const { VaultController } = require("./vault-controller.cjs");
const { Preferences } = require("./vault-preferences.cjs");
const { VaultTray } = require("./vault-tray.cjs");
const { LocalKey } = require("./vault-local-key.cjs");
const messages = require("./ui-messages.json");

let displayLanguage = "zh",
  tray;
const text = (source) =>
  messages[source]?.[displayLanguage === "ja" ? 1 : 0] &&
  displayLanguage !== "zh"
    ? messages[source][displayLanguage === "ja" ? 1 : 0]
    : source;
let preferences, clipboardTimer, copiedText;

/**
 * 清空复制到剪贴板的敏感密码，避免密码常驻系统剪贴板被其他应用读取
 */
function clearCopiedText() {
  clearTimeout(clipboardTimer);
  try {
    if (copiedText !== undefined && clipboard.readText() === copiedText)
      clipboard.clear();
  } catch {
    /* 剪贴板异常不得阻断密库锁定流程 */
  }
  copiedText = undefined;
}

let win,
  store,
  controller,
  timer,
  closing = false,
  polling = false;
let closePrompt = false;
const entry = path.join(__dirname, "..", "dist", "index.html"),
  entryUrl = pathToFileURL(entry).href;

/**
 * 触发全局安全锁定
 */
function lock() {
  clearCopiedText();
  controller?.lock();
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
    try {
      win.webContents.send("secure:locked");
    } catch {
      /* 渲染进程若已销毁则忽略 */
    }
  }
}

/**
 * 严格校验 IPC 发送源是否为合法的主窗口本地 Frame
 */
function sender(event) {
  if (
    !win ||
    event.sender !== win.webContents ||
    event.senderFrame !== win.webContents.mainFrame ||
    event.senderFrame.url !== entryUrl
  )
    core.fail("UNTRUSTED_SENDER");
}

/**
 * 注册受保护的 IPC 处理函数，包含大小边界校验和错误锁定保护
 */
function register(name, fn) {
  ipcMain.handle("secure:" + name, async (event, ...args) => {
    try {
      sender(event);
      if (Buffer.byteLength(JSON.stringify(args)) > core.MAX_BYTES)
        core.fail("INVALID_SIZE");
      return { ok: true, value: await fn(...args) };
    } catch (e) {
      if (e.commitUncertain) lock();
      return {
        ok: false,
        error: e instanceof core.VaultError ? e.code : "OPERATION_FAILED",
      };
    }
  });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (win?.isMinimized()) win.restore();
    win?.show();
    win?.focus();
  });
  app
    .whenReady()
    .then(async () => {
      if (!fs.existsSync(entry)) {
        dialog.showErrorBox(
          "LegacyLock",
          "缺少应用构建文件。请运行 npm run build 后再启动；不会连接外部开发服务器。",
        );
        app.quit();
        return;
      }
      store = new VaultStore(
        path.join(app.getPath("userData"), "vault-v3.llvault"),
      );
      preferences = new Preferences(
        path.join(app.getPath("userData"), "appearance-v1.json"),
        store,
      );
      await preferences.load();
      displayLanguage = preferences.value.language;
      store.beforeAssetWrite = () => preferences.assertWritable();
      controller = new VaultController(store, {
        open: async (title) => {
          const r = await dialog.showOpenDialog(win, {
            title: text(title),
            properties: ["openFile"],
            filters: [
              {
                name: "LegacyLock",
                extensions: ["llvault", "legacylock", "json"],
              },
            ],
          });
          return r.canceled ? null : r.filePaths[0];
        },
        save: async (title, defaultPath) => {
          const r = await dialog.showSaveDialog(win, {
            title: text(title),
            defaultPath,
            filters: [{ name: "LegacyLock", extensions: ["llvault"] }],
          });
          return r.canceled ? null : r.filePath;
        },
      });
      register("status", async () => ({
        ...(await store.status()),
        preferencesWarning: !!preferences.loadWarning,
      }));
      register("newSecret", () => core.newSecret());
      const localKey = new LocalKey(
        store,
        path.join(app.getPath("userData"), "local-key-v1.json"),
        safeStorage,
      );
      store.beforeCommit = (envelope) => localKey.invalidateFor(envelope);
      controller.beforeDestroy = () => localKey.clear();
      register("localUnlockStatus", () => localKey.status());
      let nextAttempt = 0;
      const authenticate =
        (fn) =>
        async (...args) => {
          if (Date.now() < nextAttempt) core.fail("TRY_LATER");
          nextAttempt = Date.now() + 1500;
          return fn(...args);
        };
      register("initialize", (p, s) => store.initialize(p, s));
      register(
        "unlockLocal",
        authenticate((p) => localKey.unlock(p)),
      );
      register(
        "setRememberedSecret",
        authenticate(async (enabled, p, s) => {
          await localKey.set(enabled, p, s);
          return { localUnlock: await localKey.status() };
        }),
      );
      register(
        "unlock",
        authenticate(async (p, s) => {
          return controller.unlock(p, s);
        }),
      );
      register("lock", () => lock());
      register("saveItem", (v) => {
        preferences.assertWritable();
        return store.saveItem(v);
      });
      register("deleteItem", (id) => {
        preferences.assertWritable();
        return store.deleteItem(id);
      });
      register("preferences", () => preferences.value);
      register("setPreferences", async (v) => {
        const saved = await preferences.set(v);
        displayLanguage = saved.language;
        tray?.refresh();
        if (saved.closeToTray) tray?.ensure();
        return saved;
      });
      register("viewLanguage", (language) => {
        if (!["zh", "en", "ja"].includes(language))
          core.fail("INVALID_SETTINGS");
        displayLanguage = language;
        tray?.refresh();
      });
      register("windowControl", (action) => {
        if (action === "minimize") win.minimize();
        else if (action === "maximize")
          win.isMaximized() ? win.unmaximize() : win.maximize();
        else if (action === "close") win.close();
        else if (action === "quit") app.quit();
        else if (action === "tray") {
          if (!tray.hide()) core.fail("OPERATION_FAILED");
        } else core.fail("INVALID_SETTINGS");
      });
      register("copy", (text) => {
        if (!store.session) core.fail("LOCKED");
        if (typeof text !== "string" || text.length > 100000)
          core.fail("INVALID_SIZE");
        clearCopiedText();
        clipboard.writeText(text);
        copiedText = text;
        clipboardTimer = setTimeout(clearCopiedText, 30000);
      });
      register("settings", (v) => store.settings(v));
      for (const method of [
        "scan",
        "provision",
        "sync",
        "recover",
        "importOwner",
        "export",
        "credentials",
        "health",
        "importData",
        "prepareDestroy",
      ])
        register(method, (...args) => controller[method](...args));
      register("destroy", async (...args) => {
        try {
          return await controller.destroy(...args);
        } finally {
          if (!store.session) lock();
        }
      });
      const ses = session.defaultSession;
      ses.setPermissionRequestHandler((_wc, _permission, callback) =>
        callback(false),
      );
      ses.setPermissionCheckHandler(() => false);
      ses.webRequest.onBeforeRequest((details, callback) => {
        let allowed = false;
        try {
          const u = new URL(details.url);
          allowed =
            u.protocol === "file:" &&
            (u.href === entryUrl ||
              u.href.startsWith(
                pathToFileURL(path.join(__dirname, "..", "dist", "assets"))
                  .href + "/",
              ));
        } catch {}
        callback({ cancel: !allowed });
      });
      win = new BrowserWindow({
        width: 1180,
        height: 800,
        minWidth: 640,
        minHeight: 460,
        show: false,
        backgroundColor: "#0b1220",
        autoHideMenuBar: true,
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
          devTools: !app.isPackaged,
          spellcheck: false,
        },
      });
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.webContents.on("will-navigate", (event) => event.preventDefault());
      win.webContents.on("will-attach-webview", (event) =>
        event.preventDefault(),
      );
      win.webContents.on("before-input-event", (_event, input) => {
        if (store.session && input.type === "keyDown")
          store.lastActivity = Date.now();
      });
      ipcMain.on("secure:activity", (event) => {
        try {
          sender(event);
          if (store.session) store.lastActivity = Date.now();
        } catch {}
      });
      win.webContents.on("render-process-gone", lock);
      win.webContents.on("did-start-loading", lock);
      win.on("close", async (event) => {
        if (closing) return;
        event.preventDefault();
        if (closePrompt) return;
        closePrompt = true;
        try {
          const choice = await dialog.showMessageBox(win, {
            type: "question",
            title: "LegacyLock",
            message: text("关闭应用确认"),
            detail: text("隐藏到托盘会立即锁定密库。请选择关闭方式。"),
            buttons: [text("锁定并隐藏到托盘"), text("退出应用"), text("取消")],
            defaultId: preferences.value.closeToTray ? 0 : 1,
            cancelId: 2,
            noLink: true,
          });
          if (closing || win.isDestroyed()) return;
          if (choice.response === 0) {
            if (!tray.hide())
              await dialog.showMessageBox(win, {
                type: "error",
                message: text("无法创建托盘，窗口保持打开。"),
                buttons: [text("关闭")],
              });
          } else if (choice.response === 1) app.quit();
        } catch {
          if (!win.isDestroyed()) win.show();
        } finally {
          closePrompt = false;
        }
      });
      tray = new VaultTray({
        Tray,
        Menu,
        nativeImage,
        icon: path.join(__dirname, "tray-icon.png"),
        window: () => win,
        lock,
        quit: () => app.quit(),
        text,
      });
      if (preferences.value.closeToTray) tray.ensure();
      app.on("activate", () => tray.restore());
      powerMonitor.on("suspend", lock);
      powerMonitor.on("lock-screen", lock);
      timer = setInterval(async () => {
        // Idle locking must not wait for a slow OS media scan to finish.
        if (
          store.session &&
          Date.now() - store.lastActivity >
            store.session.data.settings.autoLockMinutes * 60000
        )
          lock();
        if (polling) return;
        polling = true;
        try {
          if (!(await controller.checkDevices())) lock();
        } finally {
          polling = false;
        }
      }, 2500);
      await win.loadFile(entry);
      win.show();
    })
    .catch(() => {
      dialog.showErrorBox(
        "LegacyLock",
        "启动失败。原密库文件保持不变，请检查应用文件和数据目录权限。",
      );
      app.quit();
    });
  app.on("before-quit", (event) => {
    if (store && !closing) {
      event.preventDefault();
      lock();
      store.queue.finally(() => {
        closing = true;
        app.quit();
      });
    }
  });
  app.on("will-quit", () => {
    tray?.destroy();
    clearInterval(timer);
    lock();
  });
  app.on("window-all-closed", () => app.quit());
}
