import { m } from "./messages";
import type { VaultItem } from "../types";
export interface Preferences {
  language: "zh" | "en" | "ja";
  closeToTray: boolean;
  theme: string;
  zoom: number;
  subscriptionDemo: "trial" | "expired" | "monthly" | "quarterly" | "yearly";
}
export interface Settings {
  autoLockMinutes: number;
  heirName: string;
  heirNotes: string;
}
export interface View {
  role: "OWNER" | "HEIR";
  id: string;
  revision: number;
  recovery: boolean;
  items: VaultItem[];
  settings: Settings;
}
export interface Status {
  preferencesWarning?: boolean;
  exists: boolean;
  damaged?: boolean;
  recovery?: boolean;
}
export interface Drive {
  token: string;
  root: string;
  label: string;
  size: number;
}
type Method =
  | "status"
  | "newSecret"
  | "initialize"
  | "unlock"
  | "unlockLocal"
  | "localUnlockStatus"
  | "setRememberedSecret"
  | "lock"
  | "saveItem"
  | "deleteItem"
  | "settings"
  | "scan"
  | "provision"
  | "sync"
  | "recover"
  | "importOwner"
  | "export"
  | "credentials"
  | "health"
  | "importData"
  | "prepareDestroy"
  | "destroy"
  | "preferences"
  | "setPreferences"
  | "windowControl"
  | "viewLanguage"
  | "copy";
type Reply = { ok: true; value: unknown } | { ok: false; error: string };
declare global {
  interface Window {
    vaultAPI?: Record<Method, (...args: unknown[]) => Promise<Reply>> & {
      onLocked: (fn: () => void) => () => void;
      activity: () => void;
    };
  }
}
const errors: Record<string, string> = {
  LOCAL_KEY_UNAVAILABLE: "本机记住的密钥不可用，请改用密码和安全密钥解锁。",
  CONFIRMATION_REQUIRED: "销毁确认已失效，请重新验证密码和安全密钥。",
  DEMO_READ_ONLY:
    "当前模拟试用到期；可在订阅测试页面恢复试用或模拟开通。不会扣费。",
  AUTHENTICATION_FAILED: "密码或安全密钥错误，或密库内容已损坏。",
  INVALID_CREDENTIALS: "请填写至少 12 位密码和完整的 LL3 安全密钥。",
  OWNER_REQUIRED: "此操作需要所有者权限，请同时输入密码和安全密钥接管。",
  LOCKED: "会话已锁定，请重新解锁。",
  TWO_PHYSICAL_DRIVES_REQUIRED:
    "主、副盘必须是两个不同的物理 USB 设备，不能是同一盘的两个分区。",
  USB_NOT_PRESENT: "未检测到所选 U 盘，请重新扫描。",
  WRONG_RECOVERY_KEYS: "密钥文件与此密库或当前密钥代次不匹配。",
  INVALID_SIGNATURE: "签名验证失败，请停止使用该文件并检查备份。",
  WRONG_VAULT: "该备份属于另一个密库。",
  DIFFERENT_LOCAL_VAULT:
    "这台电脑已有另一个密库；请在独立系统账户中导入，避免覆盖本机数据。",
  OLDER_BACKUP: "该备份比本机密库旧，已阻止覆盖。",
  LOCAL_VAULT_DAMAGED:
    "本机密库损坏，已阻止覆盖。请先保全文件并按恢复文档处理。",
  VAULT_EXISTS: "本机已有密库，已阻止重新初始化。",
  INVALID_SIZE: "数据超出限制：密库文件 32 MB，资产总量 20 MB。",
  INVALID_ITEMS: "资产格式不正确或超出容量限制；单个附件最多 2 MB。",
  INVALID_SETTINGS: "设置值无效。",
  UNSUPPORTED_FORMAT:
    "文件不是受支持的 LVCF 3 信息备份，请保留原文件并查阅恢复文档。",
  INVALID_FORMAT: "文件结构无效或已损坏。",
  UNSUPPORTED_LEGACY_FORMAT:
    "此旧文件格式不受迁移器支持。请保留原文件，参阅迁移文档。",
  LEGACY_EXPORT_REQUIRED:
    "旧本机数据缺少完整认证信息，不能自动授权迁移；请保留原数据并使用已知凭据的旧版加密导出包。",
  NO_LEGACY_DATA: "未发现旧版数据。",
  NO_RECOVERY: "尚未配置双 U 盘恢复。",
  TRY_LATER: "请稍后再试。",
  LOCAL_VAULT_CHANGED: "磁盘密库与当前会话不一致，请锁定后重新打开。",
  UNSAFE_MEDIA_PATH: "U 盘目录包含链接或异常路径，已停止写入。",
  WRITE_VERIFICATION_FAILED: "写入后的校验失败，不能确认保存成功。",
  OPERATION_FAILED:
    "操作失败，未确认成功。请检查设备、文件权限和剩余空间；不要删除原文件。",
};
export async function call<T>(method: Method, ...args: unknown[]): Promise<T> {
  if (!window.vaultAPI)
    throw new Error(m("请使用桌面应用。浏览器预览不提供真实密库或模拟 U 盘。"));
  const r = await window.vaultAPI[method](...args);
  if (!r.ok)
    throw new Error(
      m(errors[r.error] || "操作失败") +
        (errors[r.error] ? "" : ` (${r.error})`),
    );
  return r.value as T;
}
