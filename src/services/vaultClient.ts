// 业务调用适配：定义界面 DTO 并将后端稳定错误码转成提示；浏览器预览不提供模拟密库。
// View.items 在运行时只含列表摘要；需要秘密字段时必须调用 getItem。
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
import { desktopBridge, type Method } from './desktopBridge';
const errors: Record<string, string> = {
  COMMIT_UNCERTAIN: "写入结果尚不能确认，会话已锁定。请保留文件并重新解锁检查。",
  OUTPUT_EXISTS_OR_UNAVAILABLE: "目标文件已存在或无法写入，请选择新的文件名。",
  USB_SCAN_FAILED: "无法读取 USB 设备信息，请检查设备后重新扫描。",
  USB_SCAN_TIMEOUT: "USB 扫描超时，请重新插入设备后再试。",
  UNSUPPORTED_PLATFORM: "当前平台尚不支持此功能。",
  RECOVERY_DIRECTORY_EXISTS: "所选设备已有该恢复代次，请使用空白恢复目录所在的设备。",
  TRAY_UNAVAILABLE: "系统托盘不可用，窗口将保持打开。",
  WRITE_FAILED: "文件写入失败，请检查空间和写入权限，保留原文件。",
  READ_FAILED: "文件读取失败，请检查文件和设备是否可用。",
  NOT_FOUND: "未找到所需文件或资产。",
  CLIPBOARD_UNAVAILABLE: "剪贴板当前不可用，请稍后重试。",
  VAULT_IN_USE: "保险库已由另一个进程打开。",
  SERVICE_FAILED: "服务执行失败，请重新打开应用后重试。",
  DELETE_FAILED: "本机文件未能全部删除，请保留现场并检查文件权限。",
  NOT_IMPLEMENTED: '此功能尚未迁移；未读取或写入任何密库。',
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
// 统一业务错误提示；泛型只辅助编译期使用，不构成数据校验。
export async function call<T>(method: Method, ...args: unknown[]): Promise<T> {
  if (!desktopBridge.available())
    throw new Error(m("请使用桌面应用。浏览器预览不提供真实密库或模拟 U 盘。"));
  const r = await desktopBridge.call(method, args);
  if (!r.ok)
    throw new Error(
      m(errors[r.error] || "操作失败") +
        (errors[r.error] ? "" : ` (${r.error})`),
    );
  return r.value as T;
}

