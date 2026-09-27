"use strict";
const { app, BrowserWindow, dialog, ipcMain, clipboard } = require("electron");
// Never touch the user's real clipboard in desktop regression.
let fakeClipboard = "",
  clipboardUnavailable = false;
clipboard.writeText = (value) => {
  fakeClipboard = value;
};
clipboard.readText = () => {
  if (clipboardUnavailable) throw new Error("Synthetic clipboard unavailable");
  return fakeClipboard;
};
clipboard.clear = () => {
  fakeClipboard = "";
};
const fs = require("node:fs/promises"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const dir = path.resolve(process.argv[2]);
const startupStarted = performance.now();
let closeChoice = 0,
  closeDialogs = 0,
  lastCloseOptions;
dialog.showMessageBox = async (_win, options) => {
  closeDialogs++;
  lastCloseOptions = options;
  return { response: closeChoice };
};
const trayModule = require("../electron/vault-tray.cjs");
const RealTray = trayModule.VaultTray;
let trayController, trayMenu;
class FakeNativeTray {
  setToolTip() {}
  on() {}
  isDestroyed() {
    return false;
  }
  destroy() {}
  setContextMenu(menu) {
    trayMenu = menu;
  }
}
trayModule.VaultTray = class extends RealTray {
  constructor(options) {
    super({
      ...options,
      Tray: FakeNativeTray,
      Menu: { buildFromTemplate: (v) => v },
    });
    trayController = this;
  }
};
app.disableHardwareAcceleration();
app.setPath("userData", dir);
app.setPath("sessionData", dir);
app.setName("LegacyLock isolated regression");
BrowserWindow.prototype.show = function () {};
const handlers = new Map(),
  registerHandler = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (name, handler) => {
  handlers.set(name, handler);
  return registerHandler(name, handler);
};
const media = require("../electron/vault-media.cjs");
media.scan = async () => [
  {
    token: "a",
    physical: "test-disk-a",
    root: path.join(dir, "usb-a"),
    label: "测试主盘",
  },
  {
    token: "b",
    physical: "test-disk-b",
    root: path.join(dir, "usb-b"),
    label: "测试副盘",
  },
];
dialog.showSaveDialog = async () => ({
  canceled: false,
  filePath: path.join(dir, "export.llvault"),
});
let openedPath;
dialog.showOpenDialog = async () => ({
  canceled: false,
  filePaths: [openedPath],
});
dialog.showErrorBox = (title, message) => {
  process.stderr.write(title + ": " + message);
  app.exit(1);
};
app.on("browser-window-created", (_event, win) => {
  win.webContents.setBackgroundThrottling(false);
  win.webContents.once("did-finish-load", async () => {
    const js = (s) =>
      win.webContents.executeJavaScript(s, true).catch((e) => {
        throw new Error(e.message + "\nTest step: " + s);
      });
    const tick = () => new Promise((r) => setTimeout(r, 150));
    const visible = async (selector) => {
      const deadline = Date.now() + 5000;
      while (
        !(await js(`!!document.querySelector(${JSON.stringify(selector)})`))
      ) {
        if (Date.now() > deadline) throw Error("UI did not load: " + selector);
        await new Promise((r) => setTimeout(r, 50));
      }
    };
    const screenshot = async (name) => {
      const folder = path.join(
        __dirname,
        "..",
        "audit",
        "2026-09-21",
        "remembered-key-ui",
      );
      await fs.mkdir(folder, { recursive: true });
      // Hidden windows can return an older compositor frame. Request frames before retaining one.
      let captured;
      for (let i = 0; i < 3; i++) {
        try {
          captured = await win.webContents.capturePage(undefined, {
            stayHidden: false,
            stayAwake: true,
          });
        } catch (e) {
          if (i === 2) throw e;
        }
        await new Promise((r) => setTimeout(r, 180));
      }
      await fs.writeFile(path.join(folder, name), captured.toPNG());
    };
    try {
      await tick();
      process.stdout.write(
        `Initial locked UI ready: ${Math.round(performance.now() - startupStarted)} ms (isolated test environment)\n`,
      );
      await new Promise((resolve, reject) => {
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const child = require("node:child_process").spawn(
          process.execPath,
          [path.join(__dirname, "single-instance-child.cjs"), dir],
          { env, windowsHide: true, stdio: "ignore" },
        );
        const timeout = setTimeout(() => {
          child.kill();
          reject(Error("Second instance timed out"));
        }, 10000);
        child.on("error", (e) => {
          clearTimeout(timeout);
          reject(e);
        });
        child.on("exit", (code) => {
          clearTimeout(timeout);
          code === 0
            ? resolve()
            : reject(Error("Second instance acquired lock: " + code));
        });
      });
      assert.equal(await js("typeof window.vaultAPI.initialize"), "function");
      assert.equal(await js("typeof window.legacyLockAPI"), "undefined");
      assert.equal(await js("typeof require"), "undefined");
      const pref = win.webContents.getLastWebPreferences();
      assert.equal(pref.sandbox, true);
      assert.equal(pref.contextIsolation, true);
      assert.equal(pref.nodeIntegration, false);
      assert.equal(
        (
          await handlers.get("secure:status")({
            sender: null,
            senderFrame: null,
          })
        ).error,
        "UNTRUSTED_SENDER",
      );
      assert.equal(
        (
          await handlers.get("secure:status")({
            sender: win.webContents,
            senderFrame: { url: win.webContents.getURL() },
          })
        ).error,
        "UNTRUSTED_SENDER",
      );
      await screenshot("01-setup.png");
      await js(
        `(async()=>{const r=await window.vaultAPI.newSecret();window.testSecret=r.value;const fields=document.querySelectorAll('form input[type="password"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const f of fields){setter.call(f,'Test password for desktop!');f.dispatchEvent(new Event('input',{bubbles:true}));}return true;})()`,
      );
      // Exercise actual form generation, confirmation and submit, not just the crypto library.
      await js(
        `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='生成随机安全密钥').click()`,
      );
      await tick();
      await js(
        `window.testSecret=document.querySelector('textarea').value;document.querySelector('input[type="checkbox"]').click()`,
      );
      await tick();
      await js(`document.querySelector('form').requestSubmit()`);
      await new Promise((r) => setTimeout(r, 500));
      assert.match(await js("document.body.innerText"), /所有者 · 可管理/);
      assert.equal(await js(`localStorage.getItem('legacylock_items')`), null);
      assert.equal(await js(`localStorage.getItem('legacylock_plan')`), null);
      await js(
        `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('加密导入导出')).click()`,
      );
      await tick();
      await js(
        "document.querySelector('.secure-actions').scrollIntoView({block:'center'})",
      );
      await screenshot("15-backup-buttons.png");
      await js(
        `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('系统设置与安全')).click()`,
      );
      await tick();
      await screenshot("05-settings.png");
      for (const [lang, expected, name] of [
        ["en", "Delete local vault", "11-settings-en.png"],
        ["ja", "この端末の保管庫を削除", "12-settings-ja.png"],
        ["zh", "删除本机密库", "13-settings-zh.png"],
      ]) {
        await js(
          `(()=>{const el=document.querySelector('.appearance-panel select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,'${lang}');el.dispatchEvent(new Event('change',{bubbles:true}));})()`,
        );
        await tick();
        assert.ok((await js("document.body.innerText")).includes(expected));
        assert.equal(
          (await js("window.vaultAPI.preferences()")).value.language,
          lang,
        );
        await screenshot(name);
      }
      assert.equal(
        await js(
          "(()=>{const panel=document.querySelector('.restored-settings').getBoundingClientRect();const side=document.querySelector('.app-sidebar').getBoundingClientRect();const bar=document.querySelector('.main-topbar').getBoundingClientRect();return panel.left>=side.right && panel.top>=bar.bottom;})()",
        ),
        true,
      );
      await js(
        `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='密码与密钥').click()`,
      );
      await tick();
      assert.equal(
        await js(
          `document.querySelector('dialog').matches(':modal')&&document.querySelector('dialog').contains(document.activeElement)`,
        ),
        true,
      );
      await screenshot("06-credentials.png");
      await js(
        `Array.from(document.querySelectorAll('dialog button')).find(b=>b.textContent==='取消').click()`,
      );
      await tick();
      await js(`document.querySelector('.sidebar-nav-item').click()`);
      await tick();
      await js(
        `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('添加新资产')).click()`,
      );
      await tick();
      await visible(".cat-rich-card");
      await js("document.querySelector('.cat-rich-card').click()");
      await tick();
      await visible(".modal-window-dialog");
      await screenshot("02-item-editor.png");
      await js(
        `(()=>{const f=document.querySelector('.modal-window-dialog select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(f,'note');f.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      );
      await tick();
      assert.equal(
        await js("document.querySelector('details.optional-fields').open"),
        false,
      );
      await js(
        `(()=>{const f=document.querySelector('.modal-window-dialog select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(f,'login');f.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      );
      await tick();
      assert.equal(
        await js("document.querySelector('details.optional-fields').open"),
        true,
      );
      assert.equal(
        await js("document.querySelector('.attachment-dropzone')===null"),
        true,
      );
      await js("document.querySelector('.btn-add-more-pill').click()");
      await tick();
      await js(
        `(()=>{const input=document.querySelector('input[type=file]');const original=input.click;input.click=()=>{window.attachmentPickerOpened=true};Array.from(document.querySelectorAll('.dropdown-menu-item')).find(b=>b.textContent.includes('附上文件')).click();input.click=original;})()`,
      );
      assert.equal(await js("window.attachmentPickerOpened"), true);
      await js(
        `(()=>{const input=document.querySelector('input[type=file]');const data=new DataTransfer();data.items.add(new File(['Synthetic attachment'],'test-attachment.txt',{type:'text/plain'}));input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      );
      await tick();
      assert.match(
        await js("document.querySelector('.attachment-container').innerText"),
        /test-attachment.txt/,
      );
      assert.equal(
        await js("document.querySelector('.btn-quick-add-link')===null"),
        true,
      );
      assert.equal(
        await js(
          "(()=>{const r=document.querySelector('dialog.modal-backdrop').getBoundingClientRect();return r.left===0 && r.top===0 && r.width===window.innerWidth;})()",
        ),
        true,
      );
      await js(
        `(()=>{const f=document.querySelector('.modal-window-dialog input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(f,'界面新增资产');f.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await tick();
      const originalRename = fs.rename;
      await js(
        `(()=>{const f=document.querySelector('.modal-window-dialog textarea.framed-textarea:not(.font-mono)');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(f,'完整备注第一行\\n完整备注第二行');f.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await tick();
      fs.rename = async () => {
        throw new Error("Synthetic disk write failure");
      };
      try {
        await js(`document.querySelector('.btn-action-submit').click()`);
        await tick();
        assert.equal(
          await js(`document.querySelector('.modal-window-dialog')!==null`),
          true,
        );
        assert.match(
          await js(`document.querySelector('.modal-window-dialog').innerText`),
          /操作失败/,
        );
      } finally {
        fs.rename = originalRename;
      }
      await js(`document.querySelector('.btn-action-submit').click()`);
      await tick();
      assert.equal(
        await js(`document.querySelector('.modal-window-dialog')===null`),
        true,
      );
      assert.match(await js("document.body.innerText"), /界面新增资产/);
      assert.match(
        await js("document.querySelector('.vault-detail-pane').innerText"),
        /完整备注第二行/,
      );
      await js("document.querySelector('.btn-topbar-add-primary').click()");
      await visible(".cat-rich-card");
      await js("document.querySelector('.cat-rich-card').click()");
      await visible(".modal-window-dialog");
      await js(
        `(()=>{const f=document.querySelector('.modal-window-dialog input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(f,'第二个列表条目');f.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await tick();
      await js("document.querySelector('.btn-action-submit').click()");
      await tick();
      assert.equal(
        await js("document.querySelectorAll('.vault-list-item').length"),
        2,
      );
      await js(
        "Array.from(document.querySelectorAll('.vault-list-item')).find(b=>b.textContent.includes('第二个列表条目')).click()",
      );
      await tick();
      assert.match(
        await js("document.querySelector('.vault-detail-pane').innerText"),
        /第二个列表条目/,
      );
      assert.equal(
        await js("document.querySelector('.modal-window-dialog')===null"),
        true,
      );
      await js(
        "Array.from(document.querySelectorAll('.vault-list-item')).find(b=>b.textContent.includes('界面新增资产')).click()",
      );
      await tick();
      assert.match(
        await js("document.querySelector('.vault-detail-pane').innerText"),
        /完整备注第二行/,
      );
      await js(
        `(()=>{const f=document.querySelector('.search-input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(f,'没有匹配信息');f.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await tick();
      assert.equal(
        await js("document.querySelector('.vault-detail-pane')===null"),
        true,
      );
      await js(
        `(()=>{const f=document.querySelector('.search-input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(f,'');f.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await tick();
      assert.equal(
        await js(
          "(()=>{const list=document.querySelector('.vault-list-pane').getBoundingClientRect(),detail=document.querySelector('.vault-detail-pane').getBoundingClientRect();return list.right<=detail.left+1 && detail.width>200})()",
        ),
        true,
      );
      await screenshot("07-dashboard.png");
      await js(
        "document.querySelector('.vault-list-item[aria-selected=\"true\"]').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))",
      );
      await tick();
      assert.equal(
        await js(
          "document.activeElement===document.querySelector('.vault-list-item:last-child')",
        ),
        true,
      );
      await screenshot("14-selected-details.png");
      // Original theme picker saves through owner-authorized main process preferences.
      await js(
        "document.querySelector('button[title=\"切换渐变主题\"]')?.click()",
      );
      if (!(await js("!!document.querySelector('.theme-option-btn')"))) {
        await js(
          "document.querySelector('.topbar-center-tools button').click()",
        );
      }
      await tick();
      await js("document.querySelectorAll('.theme-option-btn')[1].click()");
      await tick();
      assert.equal(
        (await js("window.vaultAPI.preferences()")).value.theme,
        "cyber_cyan",
      );
      assert.equal(
        JSON.parse(
          await fs.readFile(path.join(dir, "appearance-v1.json"), "utf8"),
        ).theme,
        "cyber_cyan",
      );
      await screenshot("08-theme.png");
      await js(
        "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('订阅测试')).click()",
      );
      await tick();
      await visible(".sub-modal-container");
      assert.equal(
        await js(
          "document.querySelector('.sub-modal-container').matches(':modal')",
        ),
        true,
      );
      await screenshot("09-subscription.png");
      await js(
        "Array.from(document.querySelectorAll('dialog button')).find(b=>b.textContent==='模拟试用到期').click()",
      );
      await tick();
      assert.equal(
        (await js("window.vaultAPI.deleteItem('desktop-item')")).error,
        "DEMO_READ_ONLY",
      );
      await js(
        "Array.from(document.querySelectorAll('dialog button')).find(b=>b.textContent.includes('模拟开通所选套餐')).click()",
      );
      await tick();
      assert.equal(
        (await js("window.vaultAPI.preferences()")).value.subscriptionDemo,
        "yearly",
      );
      await js(
        "document.querySelector('[aria-label=\"关闭订阅测试\"]').click()",
      );
      await tick();
      win.setSize(800, 500);
      await tick();
      assert.equal(
        await js(
          "document.querySelector('.restored-app').scrollWidth <= window.innerWidth",
        ),
        true,
      );
      await screenshot("10-dashboard-800x500.png");
      win.setSize(1180, 800);
      await tick();
      // Test real IPC and persisted attachment round trip, using synthetic values only.
      let result = await js(
        `window.vaultAPI.saveItem({id:'desktop-item',title:'桌面测试资产',category:'login',password:'Synthetic only',customFields:[{id:'empty',name:'SHOULD_NOT_RENDER',value:'   ',type:'text',isSecret:false},{id:'filled',name:'保留字段',value:'0',type:'text',isSecret:false}],createdAt:1,updatedAt:1})`,
      );
      assert.equal(result.ok, true);
      result = await js(
        `window.vaultAPI.provision('a','b','Test password for desktop!',window.testSecret)`,
      );
      assert.equal(result.ok, true, JSON.stringify(result));
      openedPath = result.value.paths[0];
      result = await js(
        `window.vaultAPI.export('Test password for desktop!',window.testSecret)`,
      );
      assert.equal(result.ok, true);
      result = await js("window.vaultAPI.copy('Synthetic clipboard value')");
      assert.equal(result.ok, true);
      assert.equal(fakeClipboard, "Synthetic clipboard value");
      clipboardUnavailable = true;
      await js("window.vaultAPI.lock()");
      clipboardUnavailable = false;
      await tick();
      assert.ok(
        !(await js("document.body.innerText")).includes("桌面测试资产"),
      );
      assert.equal(
        await js(`document.querySelector('.modal-window-dialog')===null`),
        true,
      );
      result = await js(
        `window.vaultAPI.saveItem({id:'forged',title:'forged',category:'login',createdAt:1,updatedAt:1})`,
      );
      assert.equal(result.ok, false);
      await js(
        `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='扫描设备').click()`,
      );
      await tick();
      await js(
        `(()=>{const selects=document.querySelectorAll('.secure-usb select');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;['a','b'].forEach((v,i)=>{setter.call(selects[i],v);selects[i].dispatchEvent(new Event('change',{bubbles:true}));});})()`,
      );
      await tick();
      await js(
        `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='选择信息备份并只读访问').click()`,
      );
      await tick();
      assert.match(await js("document.body.innerText"), /继承人 · 只读/);
      assert.match(await js("document.body.innerText"), /桌面测试资产/);
      await js(
        "Array.from(document.querySelectorAll('.vault-list-item')).find(b=>b.textContent.includes('桌面测试资产')).click()",
      );
      await tick();
      await js("document.querySelector('button[title=\"显示密码\"]').click()");
      await tick();
      assert.match(
        await js("document.querySelector('.vault-detail-pane').innerText"),
        /Synthetic only/,
      );
      await js(
        "Array.from(document.querySelectorAll('.vault-list-item')).find(b=>b.textContent.includes('界面新增资产')).click()",
      );
      await tick();
      await js(
        "Array.from(document.querySelectorAll('.vault-list-item')).find(b=>b.textContent.includes('桌面测试资产')).click()",
      );
      await tick();
      assert.ok(
        !(
          await js("document.querySelector('.vault-detail-pane').innerText")
        ).includes("Synthetic only"),
      );
      assert.ok(
        !(await js("document.body.innerText")).includes("SHOULD_NOT_RENDER"),
      );
      assert.ok((await js("document.body.innerText")).includes("保留字段"));
      result = await js(
        `window.vaultAPI.settings({autoLockMinutes:1,heirName:'forged',heirNotes:''})`,
      );
      assert.equal(result.error, "OWNER_REQUIRED");
      result = await js(`window.vaultAPI.deleteItem('desktop-item')`);
      assert.equal(result.error, "OWNER_REQUIRED");
      result = await js(
        "window.vaultAPI.setPreferences({theme:'royal_violet',zoom:1,subscriptionDemo:'yearly'})",
      );
      assert.equal(result.error, "OWNER_REQUIRED");
      assert.equal(
        await js(
          "document.querySelector('.topbar-center-tools button').disabled",
        ),
        true,
      );
      await screenshot("03-heir-readonly.png");
      await js("document.querySelector('.btn-card-action').click()");
      await tick();
      assert.equal(
        await js(
          "Array.from(document.querySelectorAll('dialog button')).some(b=>b.textContent.includes('升级'))",
        ),
        false,
      );
      await js("document.querySelector('.modal-window-close').click()");
      await js("window.vaultAPI.lock()");
      await tick();
      win.setSize(800, 500);
      await tick();
      await screenshot("04-lock-800x500.png");
      assert.equal(
        await js(
          `document.querySelector('.secure-app').scrollWidth <= window.innerWidth`,
        ),
        true,
      );
      const bytes = await fs.readFile(
        path.join(dir, "vault-v3.llvault"),
        "utf8",
      );
      assert.ok(!bytes.includes("Synthetic only"));
      // Tray preference remains owner-only, and native close locks instead of quitting.
      await js(
        `(()=>{const fields=document.querySelectorAll('form input[type="password"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;['Test password for desktop!',window.testSecret].forEach((v,i)=>{setter.call(fields[i],v);fields[i].dispatchEvent(new Event('input',{bubbles:true}));});})()`,
      );
      await tick();
      await js("document.querySelector('form').requestSubmit()");
      await new Promise((r) => setTimeout(r, 350));
      assert.match(await js("document.body.innerText"), /所有者 · 可管理/);
      assert.equal(
        (
          await js(
            `(async()=>{const p=(await window.vaultAPI.preferences()).value;return window.vaultAPI.setPreferences({...p,closeToTray:true});})()`,
          )
        ).ok,
        true,
      );
      win.setSize(1180, 800);
      await js(
        `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('加密导入导出')).click()`,
      );
      await tick();
      await screenshot("15-information-backup.png");
      await js(`document.querySelector('.sidebar-settings-btn').click()`);
      await tick();
      await js(
        `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='在本机记住安全密钥').click()`,
      );
      await tick();
      await js(
        `(()=>{const fields=document.querySelectorAll('dialog input[type="password"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;['Test password for desktop!',window.testSecret].forEach((v,i)=>{setter.call(fields[i],v);fields[i].dispatchEvent(new Event('input',{bubbles:true}));});})()`,
      );
      await tick();
      await js("document.querySelector('dialog form').requestSubmit()");
      await new Promise((r) => setTimeout(r, 350));
      assert.equal(
        (await js("window.vaultAPI.localUnlockStatus()")).value.remembered,
        true,
      );
      assert.ok(
        !(
          await fs.readFile(path.join(dir, "local-key-v1.json"), "utf8")
        ).includes(await js("window.testSecret")),
      );
      await js("window.vaultAPI.lock()");
      await tick();
      assert.equal(
        await js(
          "document.querySelectorAll('form input[type=password]').length",
        ),
        1,
      );
      await screenshot("16-password-only.png");
      await js(
        `(()=>{const f=document.querySelector('form input[type=password]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(f,'Test password for desktop!');f.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await new Promise((r) => setTimeout(r, 1600));
      await js("document.querySelector('form').requestSubmit()");
      await new Promise((r) => setTimeout(r, 350));
      assert.match(await js("document.body.innerText"), /所有者 · 可管理/);
      await js(`document.querySelector('.sidebar-settings-btn').click()`);
      await tick();
      await js(
        `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='删除本机密库（需两次确认）').click()`,
      );
      await tick();
      await js(
        `(()=>{const fields=document.querySelectorAll('dialog input[type="password"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;['Test password for desktop!',window.testSecret].forEach((v,i)=>{setter.call(fields[i],v);fields[i].dispatchEvent(new Event('input',{bubbles:true}));});})()`,
      );
      await tick();
      await js(`document.querySelector('dialog form').requestSubmit()`);
      await new Promise((r) => setTimeout(r, 350));
      await fs.access(path.join(dir, "vault-v3.llvault"));
      assert.match(
        await js('document.querySelector("dialog").innerText'),
        /第二次确认/,
      );
      await screenshot("14-delete-confirmation.png");
      await js(
        `(()=>{const f=document.querySelector('dialog input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(f,'DELETE');f.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await tick();
      await js(`document.querySelector('dialog form').requestSubmit()`);
      await tick();
      assert.equal((await js("window.vaultAPI.status()")).value.exists, false);
      await assert.rejects(fs.access(path.join(dir, "local-key-v1.json")), {
        code: "ENOENT",
      });
      await assert.rejects(
        fs.access(path.join(dir, "vault-v3.llvault.previous")),
        { code: "ENOENT" },
      );
      await fs.access(path.join(dir, "export.llvault"));
      closeChoice = 2;
      win.close();
      await tick();
      assert.equal(win.isDestroyed(), false);
      assert.equal(lastCloseOptions.cancelId, 2);
      assert.equal(lastCloseOptions.buttons.length, 3);
      closeChoice = 0;
      win.close();
      await tick();
      assert.equal(win.isDestroyed(), false);
      assert.equal((await js("window.vaultAPI.status()")).value.role, "LOCKED");
      assert.ok(trayMenu.some((entry) => entry.label === "退出应用"));
      assert.equal(closeDialogs, 2);
      trayController.restore();
      assert.ok(!win.isDestroyed());
      process.stdout.write(
        "Desktop smoke passed: sandbox, real form create, disk save, USB fixture provisioning, owner export, theme persistence, subscription demo, lock despite clipboard failure, heir UI, IPC denial, settings bounds and 800x500 layout.\n",
      );
      app.exit(0);
    } catch (e) {
      process.stderr.write(e.stack + "\n");
      app.exit(1);
    }
  });
});
require("../electron/main.cjs");
