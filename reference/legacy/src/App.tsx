import { m } from "./services/messages";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { LockKeyhole, ShieldCheck, Usb } from "lucide-react";
const ItemModal = lazy(() =>
  import("./components/ItemModal").then((module) => ({
    default: module.ItemModal,
  })),
);
import { Sidebar } from "./components/Sidebar";
const RightContentArea = lazy(() =>
  import("./components/RightContentArea").then((module) => ({
    default: module.RightContentArea,
  })),
);
const CategoryPickerModal = lazy(() =>
  import("./components/CategoryPickerModal").then((module) => ({
    default: module.CategoryPickerModal,
  })),
);
import { BackupImport } from "./components/BackupImport";
const SubscriptionModal = lazy(() =>
  import("./components/SubscriptionModal").then((module) => ({
    default: module.SubscriptionModal,
  })),
);
import { THEMES, getTheme } from "./services/themes";
import { useI18n } from "./services/i18n";
import {
  call,
  type Preferences,
  type Drive,
  type Settings,
  type Status,
  type View,
} from "./services/vaultClient";
import type { NavCategoryType, VaultCategory, VaultItem } from "./types";
import "./secure-app.css";
import "./restored-app.css";

type Action =
  "unlock" | "export" | "provision" | "credentials" | "destroy" | "remember";
type LocalUnlock = { available: boolean; remembered: boolean };
type Result = {
  localUnlock?: LocalUnlock;
  view?: View;
  canceled?: boolean;
  path?: string;
  paths?: string[];
  revision?: number;
};
export default function App() {
  return <VaultApp />;
}
function VaultApp() {
  const { language, setLanguage } = useI18n();
  const [status, setStatus] = useState<Status | null>(null),
    [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [localUnlock, setLocalUnlock] = useState<LocalUnlock>({
    available: false,
    remembered: false,
  });
  const [manualKey, setManualKey] = useState(false);
  const canUseLocalKey = localUnlock.remembered && localUnlock.available;
  useEffect(() => {
    let active = true;
    void call<LocalUnlock>("localUnlockStatus")
      .then((value) => {
        if (active) setLocalUnlock(value);
      })
      .catch(() => {
        if (active) setLocalUnlock({ available: false, remembered: false });
      });
    return () => {
      active = false;
    };
  }, [view?.id, view?.revision]);
  const [nav, setNav] = useState<NavCategoryType>("all");
  const [category, setCategory] = useState<VaultCategory>("login");
  const [picker, setPicker] = useState(false),
    [subscription, setSubscription] = useState(false);
  const [preferences, setPreferences] = useState<Preferences>({
    theme: "royal_violet",
    zoom: 1,
    subscriptionDemo: "trial",
    language: "zh",
    closeToTray: false,
  });
  const currentTheme = getTheme(preferences.theme);
  const [editor, setEditor] = useState<VaultItem | null | undefined>(undefined);
  const [drives, setDrives] = useState<Drive[]>([]),
    [primary, setPrimary] = useState(""),
    [secondary, setSecondary] = useState("");
  const [password, setPassword] = useState(""),
    [secret, setSecret] = useState(""),
    [repeat, setRepeat] = useState(""),
    [backed, setBacked] = useState(false);
  const [newPassword, setNewPassword] = useState(""),
    [newSecret, setNewSecret] = useState(""),
    [newRepeat, setNewRepeat] = useState("");
  const [action, setAction] = useState<Action | null>(null),
    [settings, setSettings] = useState<Settings>({
      autoLockMinutes: 15,
      heirName: "",
      heirNotes: "",
    });
  const [backupRevision, setBackupRevision] = useState<number | null>(null);
  const [destroyToken, setDestroyToken] = useState(""),
    [destroyText, setDestroyText] = useState("");
  const epoch = useRef(0),
    pending = useRef(false);
  const lastError = useRef("");
  useEffect(() => {
    setError("");
    setNotice("");
  }, [language]);
  const credentialDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (action && !credentialDialog.current?.open)
      credentialDialog.current?.showModal();
  }, [action]);
  const owner = view?.role === "OWNER",
    ready = !!primary && !!secondary && primary !== secondary;
  const clearCredentials = () => {
    setPassword("");
    setSecret("");
    setRepeat("");
    setNewPassword("");
    setNewSecret("");
    setNewRepeat("");
    setBacked(false);
    setDestroyToken("");
    setDestroyText("");
  };
  const clear = () => {
    setManualKey(false);
    epoch.current++;
    setView(null);
    setEditor(undefined);
    setAction(null);
    setNav("all");
    setPicker(false);
    setSubscription(false);
    setNotice("");
    setBackupRevision(null);
    setError("");
    setSettings({ autoLockMinutes: 15, heirName: "", heirNotes: "" });
    clearCredentials();
  };
  useEffect(() => {
    if (!window.vaultAPI) return;
    void call<Preferences>("preferences")
      .then((p) => {
        setPreferences(p);
        setLanguage(p.language);
      })
      .catch((e) => setError(e.message));
    const off = window.vaultAPI.onLocked(() => {
      clear();
      void call<Status>("status")
        .then(setStatus)
        .catch((e) => setError(e.message));
    });
    void call<Status>("status")
      .then(setStatus)
      .catch((e) => setError(e.message));
    let last = 0;
    const activity = () => {
      if (Date.now() - last > 5000) {
        window.vaultAPI?.activity();
        last = Date.now();
      }
    };
    window.addEventListener("pointerdown", activity);
    window.addEventListener("keydown", activity);
    return () => {
      off();
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
    };
  }, []);
  async function perform<T>(
    fn: () => Promise<T>,
    message?: string,
  ): Promise<boolean> {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const started = epoch.current;
    try {
      const value = await fn();
      if (started !== epoch.current) return false;
      const r = value as Result & Partial<View>;
      if (r?.localUnlock) setLocalUnlock(r.localUnlock);
      if (r?.canceled) return false;
      const next = r?.view || (r?.role && r?.items ? (r as View) : null);
      if (next) {
        setView(next);
        setSettings(next.settings);
        setStatus({ exists: true, recovery: next.recovery });
      }
      if (message)
        setNotice(
          message +
            (r?.path ? " " + r.path : r?.paths ? " " + r.paths.join("；") : ""),
        );
      return true;
    } catch (e) {
      if (started === epoch.current) {
        lastError.current = e instanceof Error ? e.message : m("操作失败");
        setError(lastError.current);
      }
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function updatePreferences(next: Preferences) {
    const started = epoch.current;
    return perform(async () => {
      const saved = await call<Preferences>("setPreferences", next);
      if (started === epoch.current) {
        setPreferences(saved);
        setLanguage(saved.language);
      }
      return {};
    }, m("界面设置已保存。"));
  }
  const selectNav = (next: NavCategoryType) => {
    if (!owner && next === "settings") {
      openAction("unlock");
      return;
    }
    setNav(next);
  };
  const add = (c?: VaultCategory) => {
    if (busy) return;
    if (!owner) {
      openAction("unlock");
      return;
    }
    if (preferences.subscriptionDemo === "expired") {
      setSubscription(true);
      return;
    }
    if (c) {
      setCategory(c);
      setEditor(null);
    } else setPicker(true);
  };
  const lock = () => {
    clear();
    void call("lock").catch((e) => setError(e.message));
  };
  const openAction = (a: Action) => {
    clearCredentials();
    setEditor(undefined);
    setError("");
    setAction(a);
  };
  const generate = async (newValue = false) => {
    await perform(async () => {
      const s = await call<string>("newSecret");
      if (newValue) setNewSecret(s);
      else setSecret(s);
      setBacked(false);
      return {};
    });
  };
  const scan = () =>
    perform(async () => {
      const d = await call<Drive[]>("scan");
      setDrives(d);
      if (!d.some((x) => x.token === primary)) setPrimary("");
      if (!d.some((x) => x.token === secondary)) setSecondary("");
      return {};
    }, m("已扫描实际 USB 设备。"));
  const usbControls = (
    <div className="secure-usb">
      <div className="secure-row">
        <h3>
          <Usb size={18} />
          {m("双 U 盘")}
        </h3>
        <button disabled={busy} onClick={() => void scan()}>
          {m("扫描设备")}
        </button>
      </div>
      <p>
        {m(
          "请选择两个不同的物理 USB 设备。密钥文件可复制，不具备不可克隆的硬件保护。",
        )}
      </p>
      <div className="secure-two">
        {([m("主盘 A"), m("副盘 B")] as const).map((label, i) => (
          <label key={label}>
            {label}
            <select
              disabled={busy}
              value={i ? secondary : primary}
              onChange={(e) => (i ? setSecondary : setPrimary)(e.target.value)}
            >
              <option value="">{m("请选择已扫描的设备")}</option>
              {drives.map((d) => (
                <option key={d.token} value={d.token}>
                  {d.label || "USB"} · {d.root}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {!drives.length && (
        <p className="secure-hint">
          {m("尚无设备列表。插入 U 盘后点击“扫描设备”；不会显示模拟设备。")}
        </p>
      )}
    </div>
  );
  const secretInput = (
    value: string,
    set: (s: string) => void,
    label = m("安全密钥"),
  ) => (
    <label>
      {label}
      <input
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder={m("LL3-…（密码与密钥必须同时提供）")}
      />
    </label>
  );
  const newFields = (
    <>
      <label>
        {m("新密码（至少 12 位）")}
        <input
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
      </label>
      <label>
        {m("再次输入新密码")}
        <input
          type="password"
          autoComplete="new-password"
          value={newRepeat}
          onChange={(e) => setNewRepeat(e.target.value)}
        />
      </label>
      <label>
        {m("新安全密钥")}
        <textarea readOnly value={newSecret} rows={3} />
      </label>
      <button type="button" disabled={busy} onClick={() => void generate(true)}>
        {m("生成新的随机安全密钥")}
      </button>
      <label className="secure-check">
        <input
          type="checkbox"
          checked={backed}
          onChange={(e) => setBacked(e.target.checked)}
        />
        {m("我已将新安全密钥保存到独立安全位置。重新生成后须重新备份。")}
      </label>
    </>
  );
  async function submitAction() {
    let success = false;
    if (action === "remember")
      success = await perform(
        () => call("setRememberedSecret", true, password, secret),
        m("已在本机记住安全密钥；请继续保留独立密钥备份。"),
      );
    if (action === "unlock")
      success = await perform(
        () => call("unlock", password, secret),
        m("已验证两项凭据，进入所有者会话。"),
      );
    if (action === "export")
      success = await perform(
        () => call("export", password, secret),
        m("已写入并校验加密备份："),
      );
    if (action === "provision")
      success = await perform(
        () => call("provision", primary, secondary, password, secret),
        m("两盘解锁密钥和主盘信息备份已写入并校验："),
      );
    if (action === "credentials") {
      if (
        newPassword.length < 12 ||
        newPassword !== newRepeat ||
        !newSecret ||
        !backed
      ) {
        setError(m("请确认新密码一致且至少 12 位，并备份新密钥。"));
        return;
      }
      success = await perform(
        () => call("credentials", password, secret, newPassword, newSecret),
        m(
          "本机凭据已更新；请重新导出并更新主盘，副盘无需更改。旧备份仍使用旧凭据。",
        ),
      );
    }
    if (action === "destroy") {
      if (!destroyToken) {
        let result: { token: string } | undefined;
        const ok = await perform(async () => {
          result = await call("prepareDestroy", password, secret);
          return {};
        });
        if (ok && result) {
          setDestroyToken(result.token);
          setPassword("");
          setSecret("");
        }
        return;
      }
      if (destroyText !== "DELETE") {
        setError(m("请输入 DELETE 进行第二次确认。"));
        return;
      }
      await perform(() => call("destroy", destroyToken, destroyText));
      return;
    }
    if (success) {
      setAction(null);
      clearCredentials();
    }
  }
  const appearancePanel = (
    <section className="secure-card appearance-panel">
      <h2>{m("外观与背景")}</h2>
      <label>
        {m("界面语言")}
        <select
          aria-label={m("界面语言")}
          disabled={busy}
          value={language}
          onChange={(e) =>
            void updatePreferences({
              ...preferences,
              language: e.target.value as Preferences["language"],
            })
          }
        >
          <option value="zh">简体中文</option>
          <option value="en">English</option>
          <option value="ja">日本語</option>
        </select>
      </label>
      <label className="secure-check">
        <input
          type="checkbox"
          checked={preferences.closeToTray}
          disabled={busy}
          onChange={(e) =>
            void updatePreferences({
              ...preferences,
              closeToTray: e.target.checked,
            })
          }
        />
        {m("关闭提示默认选择托盘")}
      </label>
      <p>{m("托盘菜单可以重新打开或彻底退出。隐藏到托盘会立即锁定密库。")}</p>
      <div className="secure-row">
        <button
          disabled={busy}
          onClick={() => void perform(() => call("windowControl", "tray"))}
        >
          {m("锁定并隐藏到托盘")}
        </button>
        <button
          disabled={busy}
          onClick={() => void call("windowControl", "quit")}
        >
          {m("退出应用")}
        </button>
      </div>
      <p>{m("保留原来的五套渐变背景；保存后下次启动继续使用。")}</p>
      <div className="appearance-themes">
        {THEMES.map((theme) => (
          <button
            key={theme.id}
            disabled={busy}
            aria-pressed={preferences.theme === theme.id}
            onClick={() =>
              void updatePreferences({ ...preferences, theme: theme.id })
            }
            style={{ background: theme.previewGradient }}
          >
            {m(theme.name)}
          </button>
        ))}
      </div>
      <label>
        {m("界面缩放")}
        <select
          value={preferences.zoom}
          disabled={busy}
          onChange={(e) =>
            void updatePreferences({
              ...preferences,
              zoom: Number(e.target.value),
            })
          }
        >
          {[0.85, 1, 1.15, 1.25].map((z) => (
            <option key={z} value={z}>
              {Math.round(z * 100)}%
            </option>
          ))}
        </select>
      </label>
      <button disabled={busy} onClick={() => setSubscription(true)}>
        {m("付费订阅 · 测试体验")}
      </button>
    </section>
  );
  const settingsPanel = owner && view && (
    <div className="secure-controls restored-settings">
      {appearancePanel}
      <section className="secure-card">
        <h2>{m("应用与继承设置")}</h2>
        <h3>{m("本机解锁方式")}</h3>
        <p>
          {localUnlock.remembered
            ? m("已记住安全密钥：本机解锁只需密码。")
            : m("每次解锁必须输入密码和安全密钥。")}
        </p>
        <p className="secure-hint">
          {m(
            "记住密钥会降低本机保护强度；备份导入、导出及更换凭据仍需要密码和安全密钥。",
          )}
        </p>
        <button
          disabled={busy || (!localUnlock.available && !localUnlock.remembered)}
          onClick={() =>
            localUnlock.remembered
              ? void perform(
                  () => call("setRememberedSecret", false),
                  m("已取消记住密钥，下次解锁需要两项凭据。"),
                )
              : openAction("remember")
          }
        >
          {localUnlock.remembered
            ? m("改为每次输入安全密钥")
            : m("在本机记住安全密钥")}
        </button>
        {!localUnlock.available && (
          <p className="secure-hint">
            {m("系统安全存储不可用，无法启用记住密钥。")}
          </p>
        )}
        <hr />
        <p className="secure-hint">
          {m(
            "交接信息仅用于说明，不验证身份、不通知对方，也不授予权限；只读访问仍需要双 U 盘。",
          )}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void perform(
              () => call("settings", settings),
              m("设置已加密保存。"),
            );
          }}
        >
          <label>
            {m("无操作自动锁定")}
            <select
              value={settings.autoLockMinutes}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  autoLockMinutes: Number(e.target.value),
                })
              }
            >
              {[1, 5, 15, 30, 60].map((n) => (
                <option key={n} value={n}>
                  {n} {m("分钟")}
                </option>
              ))}
            </select>
          </label>
          <label>
            {m("交接对象姓名（选填）")}
            <input
              maxLength={200}
              value={settings.heirName}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  heirName: e.target.value,
                })
              }
            />
          </label>
          <label>
            {m("整体交接说明（选填）")}
            <textarea
              maxLength={10000}
              rows={4}
              value={settings.heirNotes}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  heirNotes: e.target.value,
                })
              }
            />
          </label>
          <button className="primary" disabled={busy}>
            {m("保存设置")}
          </button>
        </form>
        <hr />
        <h3>{m("删除本机密库")}</h3>
        <p>
          {m(
            "删除本机的所有登录信息、安全备注、附件、继承设置和本机回退副本。外部导出文件、U 盘及系统快照不会被删除，无法保证存储介质残留不可恢复。",
          )}
        </p>
        <button
          className="danger"
          disabled={busy}
          onClick={() => openAction("destroy")}
        >
          {m("删除本机密库（需两次确认）")}
        </button>
      </section>
    </div>
  );
  const informationImport = (
    <BackupImport
      busy={busy}
      ownerSession={owner}
      ready={ready}
      usbControls={usbControls}
      onOwner={(p, s) =>
        perform(
          () => call(owner ? "importData" : "importOwner", p, s),
          m("信息数据已验证并导入。"),
        )
      }
      onHeir={() =>
        perform(
          () => call("recover", primary, secondary),
          m("已打开信息备份，当前为只读会话，不覆盖本机密库。"),
        )
      }
    />
  );
  const backupPanel = view && (
    <div className="secure-controls restored-settings">
      {owner && (
        <section className="secure-card">
          <h2>{m("信息数据备份（.llvault）")}</h2>
          <p>
            {m(
              "包含登录信息、安全备注、自定义字段和附件，以加密文件保存；不是 U 盘解锁密钥文件。完整使用需要密码＋安全密钥，已配置的双盘只能只读访问。",
            )}
          </p>
          <button disabled={busy} onClick={() => openAction("export")}>
            {m("验证凭据并导出信息数据")}
          </button>
          <p>
            {m(
              "同一文件格式用于 Windows、macOS 和 Linux。双盘配置前导出的旧备份不会自动获得双盘恢复能力，请配置后重新导出。",
            )}
          </p>
        </section>
      )}
      {informationImport}
      {owner && (
        <section className="secure-card">
          <h2>{m("主盘更新与双盘解锁密钥")}</h2>
          {usbControls}
          <p>
            {m(
              "首次配置需要两盘：主盘保存信息备份和 primary.llkey，副盘只保存 secondary.llkey。解锁密钥文件不是信息数据备份。",
            )}
          </p>
          <p>
            {m(
              "副盘可提前交给继承人；之后保存资产、更换密码或安全密钥、更新主盘，都不需要重新写入副盘。",
            )}
          </p>
          <div className="secure-actions">
            <button
              disabled={busy || !ready}
              onClick={() => openAction("provision")}
            >
              {view.recovery
                ? m("重新配置两盘（副盘需在场）")
                : m("首次配置主、副 U 盘")}
            </button>
            <button
              className="primary"
              disabled={busy || !primary || !view.recovery}
              onClick={() =>
                void perform(async () => {
                  const r = await call<Result>("sync", primary);
                  setBackupRevision(r.revision || null);
                  return r;
                }, m("当前信息备份已更新到主盘，副盘保持不变。"))
              }
            >
              {m("更新主盘信息备份（无需副盘）")}
            </button>
          </div>
          <p className="secure-hint">
            {m("本机版本")}
            {view.revision}；
            {backupRevision === view.revision
              ? m("本次会话已确认主盘更新到此版本。")
              : m("尚未确认主盘包含最新版本，请更新主盘。")}
          </p>
          <p>
            {m(
              "“重新配置两盘”仅用于更换整套解锁密钥，会使新数据改用新的一对密钥。日常更新请使用上面的主盘更新按钮。",
            )}
          </p>
        </section>
      )}
    </div>
  );
  if (!window.vaultAPI)
    return (
      <main className="secure-app">
        <section className="secure-card secure-welcome">
          <LockKeyhole />
          <h1>{m("LegacyLock 桌面密库")}</h1>
          <p>
            {m(
              "浏览器模式只用于界面开发。真实密库、导入、U 盘和加密设置仅在桌面应用中可用。",
            )}
          </p>
          <p>{m("运行 npm run build，再运行 npm run electron。")}</p>
        </section>
      </main>
    );
  return (
    <main
      className={view ? "restored-app app-shell" : "secure-app restored-lock"}
      aria-busy={busy}
      style={
        {
          background: currentTheme.mainStyle.background,
          "--vault-card-bg": currentTheme.mainStyle.cardBg,
          "--vault-accent": currentTheme.primaryAccent,
        } as React.CSSProperties
      }
    >
      {view && (
        <Sidebar
          selectedNav={nav}
          onSelectNav={selectNav}
          totalCount={view.items.length}
          theme={currentTheme}
          categoryCounts={view.items.reduce<Record<string, number>>(
            (counts, item) => {
              counts[item.category] = (counts[item.category] || 0) + 1;
              return counts;
            },
            {},
          )}
        />
      )}
      {!view && (
        <header className="secure-header">
          <div className="secure-brand">
            <ShieldCheck />
            <div>
              <strong>LegacyLock</strong>
              <small>{m("数字遗产密库 · LVCF 3")}</small>
            </div>
          </div>
          <div className="secure-row">
            <span className="secure-badge">
              {view
                ? owner
                  ? m("所有者 · 可管理")
                  : m("继承人 · 只读")
                : m("已锁定")}
            </span>
            {view && (
              <button onClick={lock}>
                <LockKeyhole size={16} />
                {m("立即锁定")}
              </button>
            )}
          </div>
        </header>
      )}
      <div
        className={view ? "restored-workspace" : "secure-shell"}
        style={view ? { zoom: preferences.zoom } : undefined}
      >
        {error && (
          <div className="secure-message error" role="alert">
            {error}
          </div>
        )}
        {status?.preferencesWarning && (
          <div className="secure-message" role="status">
            {m(
              "外观配置无法读取，暂用默认主题。密库不受影响；所有者解锁后可重新保存界面设置。",
            )}
          </div>
        )}
        {notice && (
          <div className="secure-message" role="status">
            {notice}
          </div>
        )}
        {busy && <p role="status">{m("正在验证或保存，请等待完成…")}</p>}
        {!status ? (
          <p>{m("正在检查本机密库…")}</p>
        ) : !view ? (
          <div className="secure-grid">
            <section className="secure-card">
              <h1>{status.exists ? m("解锁本机密库") : m("创建本机密库")}</h1>

              {status.damaged && (
                <p className="secure-message error">
                  {m(
                    "本机文件未通过校验。不会自动清空或覆盖，请保全文件并参考恢复文档。",
                  )}
                </p>
              )}
              <p>
                {canUseLocalKey && status.exists
                  ? m("已记住安全密钥：本机解锁只需密码。")
                  : m(
                      "所有者解锁需要同时提供密码和安全密钥。继承人可通过双 U 盘入口只读访问。",
                    )}
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (
                    !status.exists &&
                    (password.length < 12 || password !== repeat || !backed)
                  ) {
                    setError(
                      m("密码须至少 12 位且两次一致；请先备份安全密钥。"),
                    );
                    return;
                  }
                  void perform(
                    () =>
                      call(
                        status.exists
                          ? canUseLocalKey && !manualKey
                            ? "unlockLocal"
                            : "unlock"
                          : "initialize",
                        password,
                        secret,
                      ),
                    m("密库已解锁。"),
                  ).then((ok) => {
                    if (ok) clearCredentials();
                  });
                }}
              >
                <label>
                  {!status.exists ? m("设置密码（至少 12 位）") : m("密码")}
                  <input
                    required
                    type="password"
                    autoComplete="off"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                {!status.exists && (
                  <label>
                    {m("再次输入密码")}
                    <input
                      required
                      type="password"
                      autoComplete="new-password"
                      value={repeat}
                      onChange={(e) => setRepeat(e.target.value)}
                    />
                  </label>
                )}
                {!status.exists ? (
                  <>
                    <label>
                      {m("安全密钥（请抄录或保存）")}
                      <textarea readOnly rows={3} value={secret} />
                    </label>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void generate()}
                    >
                      {m("生成随机安全密钥")}
                    </button>
                    <label className="secure-check">
                      <input
                        type="checkbox"
                        checked={backed}
                        onChange={(e) => setBacked(e.target.checked)}
                      />
                      {m("已在独立安全位置备份此密钥")}
                    </label>
                  </>
                ) : !canUseLocalKey || manualKey ? (
                  secretInput(secret, setSecret)
                ) : null}
                {status.exists && canUseLocalKey && (
                  <label className="secure-check">
                    <input
                      type="checkbox"
                      checked={manualKey}
                      onChange={(e) => {
                        setManualKey(e.target.checked);
                        setSecret("");
                      }}
                    />
                    {m("改用密码和安全密钥解锁")}
                  </label>
                )}
                <button
                  className="primary"
                  disabled={
                    busy || status.damaged || (!status.exists && !secret)
                  }
                >
                  {status.exists ? m("解锁为所有者") : m("创建加密密库")}
                </button>
              </form>
            </section>
            {informationImport}
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="panel-loading" role="status">
                {m("正在加载界面…")}
              </div>
            }
          >
            <RightContentArea
              selectedNav={nav}
              items={view.items}
              currentTheme={currentTheme}
              busy={busy}
              canModify={owner}
              isReadOnly={preferences.subscriptionDemo === "expired"}
              demo={preferences.subscriptionDemo}
              onAddNew={add}
              onEditItem={(item) => {
                if (!busy) setEditor(item);
              }}
              onDeleteItem={(id) => {
                if (
                  !busy &&
                  owner &&
                  window.confirm(
                    m(
                      "删除“{0}”？删除后请更新主盘备份。",
                      view.items.find((i) => i.id === id)?.title || m("此资产"),
                    ),
                  )
                ) {
                  void perform(
                    () => call("deleteItem", id),
                    m("资产已删除，请更新主盘备份。"),
                  );
                }
              }}
              onSelectTheme={(theme) =>
                void updatePreferences({ ...preferences, theme })
              }
              onOpenUsbPassword={() => openAction("credentials")}
              onOpenHealthCheck={() =>
                void perform(
                  () => call("health"),
                  m(
                    "当前磁盘签名及会话完整性校验通过。此结果不代表离线 U 盘已更新。",
                  ),
                )
              }
              onOpenSubscription={
                owner ? () => setSubscription(true) : undefined
              }
              onRequestTakeover={() => openAction("unlock")}
              onLock={lock}
              settingsContent={settingsPanel}
              backupContent={backupPanel}
              banner={
                <div className="workspace-status">
                  <span className="secure-badge">
                    {owner ? m("所有者 · 可管理") : m("继承人 · 只读")}
                  </span>
                  <span>
                    {m("资产")}
                    {view.items.length} {m("· 版本")}
                    {view.revision} {m("· 本机保存后请更新主盘")}
                  </span>
                  {!owner && (
                    <>
                      <button onClick={() => openAction("unlock")}>
                        {m("输入密码和密钥，接管管理权限")}
                      </button>
                      {view.settings.heirName && (
                        <p>
                          {m("交接对象姓名（选填）")}: {view.settings.heirName}
                        </p>
                      )}
                      {view.settings.heirNotes && (
                        <p>
                          {m("整体交接说明（选填）")}: {view.settings.heirNotes}
                        </p>
                      )}
                    </>
                  )}
                  {owner && preferences.subscriptionDemo === "expired" && (
                    <p>
                      {m(
                        "订阅测试：模拟试用到期，资产只读。可在订阅测试中恢复试用，不会扣费。",
                      )}
                    </p>
                  )}
                </div>
              }
            />
          </Suspense>
        )}
      </div>
      {!owner && (
        <label className="temporary-language">
          Language / 语言 / 言語
          <select
            aria-label="Language"
            value={language}
            onChange={(e) => {
              const lang = e.target.value as Preferences["language"];
              setLanguage(lang);
              void call("viewLanguage", lang).catch((e) => setError(e.message));
            }}
          >
            <option value="zh">简体中文</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
          </select>
        </label>
      )}
      {owner && subscription && (
        <Suspense
          fallback={
            <div className="panel-loading" role="status">
              {m("正在加载界面…")}
            </div>
          }
        >
          <SubscriptionModal
            mode={preferences.subscriptionDemo}
            busy={busy}
            onClose={() => {
              if (!busy) setSubscription(false);
            }}
            onChange={(subscriptionDemo) =>
              updatePreferences({ ...preferences, subscriptionDemo })
            }
          />
        </Suspense>
      )}
      {owner && picker && (
        <Suspense
          fallback={
            <div className="panel-loading" role="status">
              {m("正在加载界面…")}
            </div>
          }
        >
          <CategoryPickerModal
            isOpen
            onClose={() => setPicker(false)}
            onSelectCategory={(c) => {
              setCategory(c);
              setEditor(null);
            }}
          />
        </Suspense>
      )}
      {view && editor !== undefined && (
        <Suspense
          fallback={
            <div className="panel-loading" role="status">
              {m("正在加载界面…")}
            </div>
          }
        >
          <ItemModal
            isOpen
            initialItem={editor}
            defaultCategory={category || "login"}
            isReadOnly={!owner || preferences.subscriptionDemo === "expired"}
            isHeirReadOnly={!owner}
            onUpgrade={
              owner
                ? () => {
                    setEditor(undefined);
                    setSubscription(true);
                  }
                : undefined
            }
            onClose={() => {
              if (!busy) setEditor(undefined);
            }}
            onRequestTakeover={() =>
              owner ? setSubscription(true) : openAction("unlock")
            }
            onSave={async (item) => {
              if (
                !(await perform(
                  () => call("saveItem", item),
                  m("资产已加密保存，请更新主盘备份。"),
                ))
              )
                throw new Error(lastError.current || m("保存未完成，请重试。"));
            }}
            onDelete={async (id) => {
              if (
                !(await perform(
                  () => call("deleteItem", id),
                  m("资产已删除，请更新主盘备份。"),
                ))
              )
                throw new Error(lastError.current || m("删除未完成。"));
            }}
          />
        </Suspense>
      )}
      {action && (
        <dialog
          ref={credentialDialog}
          className="secure-overlay secure-controls"
          onCancel={(e) => {
            e.preventDefault();
            if (!busy) {
              setAction(null);
              clearCredentials();
            }
          }}
        >
          <section
            className="secure-card secure-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="credential-title"
          >
            <h2 id="credential-title">
              {
                {
                  unlock: m("验证所有者凭据"),
                  export: m("验证并导出信息数据"),
                  provision: m("验证并配置两盘"),
                  credentials: m("更换所有者凭据"),
                  destroy: m("删除本机密库"),
                  remember: m("在本机记住安全密钥"),
                }[action]
              }
            </h2>
            {!destroyToken && (
              <p>{m("请同时填写密码和安全密钥。凭据不会写入浏览器存储。")}</p>
            )}
            {action === "provision" && (
              <p>
                {m(
                  "此操作写入所选两盘的独立 LegacyLock 目录，不格式化设备。成功后仍需妥善保管旧版备份。",
                )}
              </p>
            )}
            {error && (
              <p className="secure-message error" role="alert">
                {error}
              </p>
            )}
            {action === "destroy" && destroyToken ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitAction();
                }}
              >
                <p role="alert">
                  {m(
                    "第二次确认：这将删除本机密库和本机回退副本，应用内无法撤销。外部备份与系统残留不在删除范围。",
                  )}
                </p>
                <label>
                  {m("输入 DELETE 确认删除")}
                  <input
                    autoFocus
                    autoComplete="off"
                    value={destroyText}
                    onChange={(e) => setDestroyText(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setAction(null);
                    clearCredentials();
                  }}
                >
                  {m("取消")}
                </button>
                <button
                  className="danger"
                  disabled={busy || destroyText !== "DELETE"}
                >
                  {m("确认删除本机密库")}
                </button>
              </form>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitAction();
                }}
              >
                <label>
                  {m("当前密码")}
                  <input
                    autoFocus
                    required
                    type="password"
                    autoComplete="off"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                {secretInput(secret, setSecret, m("当前安全密钥"))}
                {action === "credentials" && newFields}
                <div className="secure-row">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setAction(null);
                      clearCredentials();
                    }}
                  >
                    {m("取消")}
                  </button>
                  <button className="primary" disabled={busy}>
                    {action === "destroy"
                      ? m("第一次确认：验证并继续")
                      : m("验证并执行")}
                  </button>
                </div>
              </form>
            )}
          </section>
        </dialog>
      )}
    </main>
  );
}
