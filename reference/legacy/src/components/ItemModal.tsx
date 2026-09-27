import { m } from "../services/messages";
/**
 * ============================================================================
 * LegacyLock 军规遗产密钥库 — 资产录入与编辑模态弹窗组件 (ItemModal)
 * ============================================================================
 *
 * 核心功能：
 * 1. 结构化表单录入：标题、归属分类、账号、密码、URL网址、私密便签；
 * 2. 继承人接管嘱托：专供继承人在身后联合解锁后查阅的法律交接说明；
 * 3. 20位军规高强度真随机密码生成器：
 *    - 严格基于底层操作系统 CSPRNG (window.crypto.getRandomValues)；
 *    - 应用无偏模数拒绝采样算法 (Rejection Sampling)，杜绝模偏置（Modulo Bias）漏洞；
 * 4. 动态扩展键值对：支持自由增删带保密掩码标记的自定义字段；
 * 5. 密码明文/掩码即时切换开关与安全复制。
 */

import React, { useState, useEffect, useRef } from "react";
import {
  X,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  RefreshCw,
  Sparkles,
  ShieldCheck,
  ChevronDown,
  Compass,
  Type,
  Globe,
  Mail,
  MapPin,
  Calendar,
  Clock,
  Lock,
  Phone,
  FileText,
  MinusCircle,
  Paperclip,
  Download,
  File,
  FileArchive,
  FileCode,
  FileImage,
  AlertTriangle,
} from "lucide-react";
import {
  VaultCategory,
  VaultField,
  VaultFieldType,
  VaultItem,
  VaultAttachment,
  MAX_ATTACHMENT_SIZE_BYTES,
} from "../types";
import { CATEGORIES, getCategoryDef } from "../services/categories";
import { useI18n } from "../services/i18n";

/**
 * 格式化文件字节大小 (B / KB / MB)
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * 根据文件 MIME 类型或文件扩展名获取对应图标
 */
function getAttachmentIcon(type: string, name: string) {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (
    type.startsWith("image/") ||
    ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico"].includes(ext)
  ) {
    return FileImage;
  }
  if (["zip", "rar", "7z", "tar", "gz", "bz2", "xz"].includes(ext)) {
    return FileArchive;
  }
  if (
    [
      "json",
      "xml",
      "yaml",
      "yml",
      "js",
      "ts",
      "py",
      "sh",
      "pem",
      "key",
      "bin",
      "pub",
      "env",
      "conf",
    ].includes(ext)
  ) {
    return FileCode;
  }
  if (
    ["pdf", "doc", "docx", "txt", "rtf", "odt", "pages", "md"].includes(ext) ||
    type.startsWith("text/")
  ) {
    return FileText;
  }
  return File;
}

/**
 * 获取自定义选项图标
 */
function getCustomFieldIcon(type?: VaultFieldType) {
  switch (type) {
    case "url":
      return Globe;
    case "email":
      return Mail;
    case "phone":
      return Phone;
    case "address":
      return MapPin;
    case "date":
      return Calendar;
    case "totp":
      return Clock;
    case "password":
      return Lock;
    case "note":
      return FileText;
    default:
      return Type;
  }
}

/**
 * 资产编辑弹窗属性接口
 */
interface ItemModalProps {
  /** 弹窗是否可见 */
  isOpen: boolean;
  /** 关闭弹窗回调 */
  onClose: () => void;
  /** 保存提交回调 */
  onSave: (item: VaultItem) => void | Promise<void>;
  /** 删除资产回调 (处于编辑模式时提供) */
  onDelete?: (id: string) => void | Promise<void>;
  /** 正在编辑的历史资产对象 (为空时代表新建录入) */
  initialItem?: VaultItem | null;
  /** 默认初始分类 */
  defaultCategory?: VaultCategory;
  /** 是否处于试用到期只读模式 (禁止修改提交) */
  isReadOnly?: boolean;
  /** 是否处于继承人只读模式 */
  isHeirReadOnly?: boolean;
  /** 触发升级订阅弹窗回调 */
  onUpgrade?: () => void;
  /** 请求接管控制权回调 */
  onRequestTakeover?: () => void;
}

export const ItemModal: React.FC<ItemModalProps> = ({
  isOpen,
  onClose,
  onSave,
  onDelete,
  initialItem,
  defaultCategory = "login",
  isReadOnly = false,
  isHeirReadOnly = false,
  onUpgrade,
  onRequestTakeover,
}) => {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const modalRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (isOpen && modalRef.current && !modalRef.current.open)
      modalRef.current.showModal();
  }, [isOpen]);
  const { t, language } = useI18n();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<VaultCategory>(defaultCategory);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [inheritanceInstructions, setInheritanceInstructions] = useState("");
  const [customFields, setCustomFields] = useState<VaultField[]>([]);
  const [showPassword, setShowPassword] = useState(false);
  const [showGenerator, setShowGenerator] = useState(false);
  const [genLength, setGenLength] = useState(20);
  const [includeSymbols, setIncludeSymbols] = useState(true);

  // 自定义选项交互状态：下拉菜单与密文字段明文展示
  const [isAddMoreOpen, setIsAddMoreOpen] = useState(false);
  const [revealedFieldIds, setRevealedFieldIds] = useState<
    Record<string, boolean>
  >({});

  // 附件管理状态 (单文件限制 <= 2MB)
  const [attachments, setAttachments] = useState<VaultAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialItem) {
      setTitle(initialItem.title);
      setCategory(initialItem.category);
      setUsername(initialItem.username || "");
      setPassword(initialItem.password || "");
      setUrl(initialItem.url || "");
      setNotes(initialItem.notes || "");
      setInheritanceInstructions(initialItem.inheritanceInstructions || "");
      setCustomFields(initialItem.customFields || []);
      setAttachments(initialItem.attachments || []);
      setAttachmentError(null);
    } else {
      const cat = defaultCategory || "login";
      const def = getCategoryDef(cat);
      setCategory(cat);
      setTitle("");
      setUsername("");
      setPassword("");
      setUrl("");
      setNotes("");
      setInheritanceInstructions("");
      setAttachments([]);
      setAttachmentError(null);

      if (def.defaultFields && def.defaultFields.length > 0) {
        setCustomFields(
          def.defaultFields.map((f, idx) => ({
            id: `field-preset-${idx}-${Date.now()}`,
            name: f.name,
            value: f.defaultValue || "",
            isSecret: f.isSecret,
          })),
        );
      } else {
        setCustomFields([]);
      }
    }
  }, [initialItem, defaultCategory, isOpen]);

  useEffect(() => {
    if (!isAddMoreOpen) return;
    const handleDocumentClick = () => setIsAddMoreOpen(false);
    window.addEventListener("click", handleDocumentClick);
    return () => window.removeEventListener("click", handleDocumentClick);
  }, [isAddMoreOpen]);

  if (!isOpen) return null;

  const currentCategoryDef = getCategoryDef(category);
  const CategoryIcon = currentCategoryDef.icon;

  const getCategoryName = (catId: string) => {
    const transKey = `categories.${catId}.name` as const;
    const translated = t(transKey as any);
    if (translated && translated !== transKey) return translated;
    const def = getCategoryDef(catId as any);
    return language === "en" ? def.englishName : def.name;
  };

  const getCategoryDescription = (catId: string) => {
    const transKey = `categories.${catId}.desc` as const;
    const translated = t(transKey as any);
    if (translated && translated !== transKey) return translated;
    const def = getCategoryDef(catId as any);
    return def.description;
  };

  const generatePassword = (length = genLength, symbols = includeSymbols) => {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    const numbers = "0123456789";
    const syms = "!@#$%^&*()_+-=[]{}|;:,.<>?";
    let pool = letters + numbers;
    if (symbols) pool += syms;

    // 采用密码学安全伪随机数发生器 (WebCrypto CSPRNG) 并进行无偏模映射 (Rejection Sampling)
    const poolLen = pool.length;
    const maxValid = Math.floor(0xffffffff / poolLen) * poolLen;
    const randomBuffer = new Uint32Array(length * 2);
    let result = "";

    while (result.length < length) {
      window.crypto.getRandomValues(randomBuffer);
      for (let i = 0; i < randomBuffer.length && result.length < length; i++) {
        const val = randomBuffer[i];
        if (val < maxValid) {
          result += pool.charAt(val % poolLen);
        }
      }
    }

    setPassword(result);
  };

  const handleAddCustomField = (
    type: VaultFieldType = "text",
    customTitle?: string,
  ) => {
    let defaultTitle = customTitle;
    if (!defaultTitle) {
      if (language === "zh") {
        switch (type) {
          case "url":
            defaultTitle = m("网站");
            break;
          case "email":
            defaultTitle = m("电子邮件");
            break;
          case "phone":
            defaultTitle = m("电话");
            break;
          case "address":
            defaultTitle = m("地址");
            break;
          case "date":
            defaultTitle = m("日期");
            break;
          case "totp":
            defaultTitle = m("一次性密码");
            break;
          case "password":
            defaultTitle = m("密码");
            break;
          case "note":
            defaultTitle = m("安全便签");
            break;
          default:
            defaultTitle = m("文本");
            break;
        }
      } else if (language === "ja") {
        switch (type) {
          case "url":
            defaultTitle = "ウェブサイト";
            break;
          case "email":
            defaultTitle = "メール";
            break;
          case "phone":
            defaultTitle = m("電話番号");
            break;
          case "address":
            defaultTitle = m("住所");
            break;
          case "date":
            defaultTitle = m("日付");
            break;
          case "totp":
            defaultTitle = "ワンタイムパスワード (TOTP)";
            break;
          case "password":
            defaultTitle = "パスワード";
            break;
          case "note":
            defaultTitle = m("安全なメモ");
            break;
          default:
            defaultTitle = "テキスト";
            break;
        }
      } else {
        switch (type) {
          case "url":
            defaultTitle = "Website";
            break;
          case "email":
            defaultTitle = "Email";
            break;
          case "phone":
            defaultTitle = "Phone";
            break;
          case "address":
            defaultTitle = "Address";
            break;
          case "date":
            defaultTitle = "Date";
            break;
          case "totp":
            defaultTitle = "TOTP (2FA)";
            break;
          case "password":
            defaultTitle = "Password";
            break;
          case "note":
            defaultTitle = "Secure Note";
            break;
          default:
            defaultTitle = "Text";
            break;
        }
      }
    }

    const isSecret = type === "password" || type === "totp";
    const newField: VaultField = {
      id: crypto.randomUUID(),
      name: defaultTitle,
      value: "",
      isSecret,
      type,
    };

    setCustomFields((prev) => [...prev, newField]);
    setIsAddMoreOpen(false);
  };

  const handleRemoveField = (id: string) => {
    setCustomFields((prev) => prev.filter((f) => f.id !== id));
  };

  const handleFieldChange = (
    id: string,
    key: "name" | "value" | "isSecret" | "type",
    val: any,
  ) => {
    setCustomFields((prev) =>
      prev.map((f) => (f.id === id ? { ...f, [key]: val } : f)),
    );
  };

  // 处理附件选取与拖拽上传 (严格限制单文件 <= 2MB)
  const handleProcessFiles = (fileList: FileList | File[]) => {
    setAttachmentError(null);
    const files = Array.from(fileList);
    if (files.length === 0) return;

    for (const file of files) {
      // 严格检查是否超过 2MB
      if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
        const currentMB = (file.size / (1024 * 1024)).toFixed(2);
        setAttachmentError(
          language === "zh"
            ? `上传拦截：文件「${file.name}」大小为 ${currentMB} MB，超出单个附件最大 2MB 限制！`
            : language === "ja"
              ? `アップロード拒否: ファイル「${file.name}」(${currentMB} MB) は2MBの制限を超えています！`
              : `Upload blocked: File "${file.name}" (${currentMB} MB) exceeds maximum 2MB attachment limit!`,
        );
        continue;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const newAttachment: VaultAttachment = {
          id: crypto.randomUUID(),
          name: file.name,
          size: file.size,
          type: file.type || "application/octet-stream",
          data: reader.result as string,
          uploadedAt: Date.now(),
        };
        setAttachments((prev) => [...prev, newAttachment]);
      };
      reader.readAsDataURL(file);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleProcessFiles(e.target.files);
    }
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleDownloadAttachment = (att: VaultAttachment) => {
    const link = document.createElement("a");
    link.href = att.data;
    link.download = att.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || isReadOnly || isHeirReadOnly) return;
    if (!title.trim()) {
      alert(
        language === "zh"
          ? m("请输入资产项目的标题名称")
          : language === "ja"
            ? m("資産のタイトルを入力してください")
            : "Please enter an asset title",
      );
      return;
    }

    const item: VaultItem = {
      id: initialItem?.id || crypto.randomUUID(),
      title,
      category,
      username: username || undefined,
      password: password || undefined,
      url: url || undefined,
      notes: notes || undefined,
      inheritanceInstructions: inheritanceInstructions || undefined,
      customFields: customFields.filter((f) => f.name.trim() !== ""),
      attachments: attachments.length > 0 ? attachments : undefined,
      createdAt: initialItem?.createdAt || Date.now(),
      updatedAt: Date.now(),
      revision: (initialItem?.revision || 0) + 1,
    };

    if (isReadOnly) {
      if (onUpgrade) onUpgrade();
      return;
    }

    setSaving(true);
    setSaveError("");
    try {
      await onSave(item);
      onClose();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : m("保存失败，请重试。"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <dialog
      ref={modalRef}
      className="modal-backdrop"
      aria-label={isReadOnly ? m("查看资产") : m("编辑资产")}
      onCancel={(e) => {
        e.preventDefault();
        if (!saving) onClose();
      }}
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div className="modal-window-dialog" onClick={(e) => e.stopPropagation()}>
        {/* 顶部独立窗口标题栏 */}
        <div className="modal-window-header">
          <div className="modal-window-title">
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: currentCategoryDef.bgColor,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
                flexShrink: 0,
              }}
            >
              <CategoryIcon className="w-5 h-5 text-white" />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{ fontSize: 16, fontWeight: 700, color: "#FFFFFF" }}
                >
                  {initialItem
                    ? isReadOnly
                      ? `${t("itemModal.viewTitlePrefix")} · ${title || getCategoryName(category)}`
                      : t("itemModal.editTitle")
                    : `${t("itemModal.newTitlePrefix")} · ${getCategoryName(category)}`}
                </span>
                <span className="modal-badge-cat">
                  {getCategoryName(category)}
                </span>
                {isReadOnly && (
                  <span
                    style={{
                      fontSize: 10.5,
                      padding: "2px 8px",
                      borderRadius: 6,
                      background: "rgba(245, 158, 11, 0.2)",
                      border: "1px solid rgba(245, 158, 11, 0.4)",
                      color: "#F59E0B",
                      fontWeight: 600,
                    }}
                  >
                    {t("itemModal.readOnlyBadge")}
                  </span>
                )}
              </div>
              <p style={{ fontSize: 11, color: "#8EA4D4", marginTop: 2 }}>
                {isReadOnly
                  ? isHeirReadOnly
                    ? m("只读访问；修改需要所有者密码和安全密钥。")
                    : m("订阅测试：模拟试用到期，可在订阅测试中恢复试用。")
                  : getCategoryDescription(category)}
              </p>
            </div>
          </div>

          <button
            disabled={saving}
            onClick={onClose}
            className="modal-window-close"
            title={t("common.close")}
          >
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>

        {/* 只读模式警告与订阅引导横幅 */}
        {isReadOnly && (
          <div
            style={{
              margin: "12px 24px 0 24px",
              padding: "10px 16px",
              borderRadius: 10,
              background: "rgba(245, 158, 11, 0.12)",
              border: "1px solid rgba(245, 158, 11, 0.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <AlertTriangle
                style={{
                  width: 18,
                  height: 18,
                  color: "#F59E0B",
                  flexShrink: 0,
                }}
              />
              <span
                style={{ fontSize: 12.5, color: "#FDE68A", lineHeight: 1.4 }}
              >
                <strong>{m("只读保护中")}</strong>：
                {isHeirReadOnly
                  ? m("您可以查看和下载附件，修改资产需要验证所有者凭据。")
                  : m(
                      "当前模拟试用到期。可在订阅测试中恢复试用或模拟开通，不会扣费。",
                    )}
              </span>
            </div>
            {onUpgrade && (
              <button
                type="button"
                onClick={onUpgrade}
                style={{
                  padding: "5px 12px",
                  borderRadius: 6,
                  background:
                    "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)",
                  color: "#0B0F24",
                  fontSize: 12,
                  fontWeight: 700,
                  border: "none",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {t("itemModal.upgradeBtn")}
              </button>
            )}
          </div>
        )}

        {/* 独立窗口表单正文 */}
        <form onSubmit={handleSubmit} className="modal-window-body">
          {/* 卡片 1: 基本标识 (项目标题与所属分类) */}
          <div className="form-card">
            <div className="form-card-title">
              <span>
                {language === "zh"
                  ? m("基本信息 (Basic Info)")
                  : language === "ja"
                    ? m("基本情報 (Basic Info)")
                    : "Basic Info"}
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: "#00D4FF",
                  textTransform: "none",
                }}
              >
                *{" "}
                {language === "zh"
                  ? m("必填项")
                  : language === "ja"
                    ? m("必須")
                    : "Required"}
              </span>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 1fr",
                gap: 12,
              }}
            >
              <div className="framed-input-container">
                <label className="framed-label">
                  {t("itemModal.titleLabel")} *
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t("itemModal.titlePlaceholder")}
                  className="framed-input"
                />
              </div>

              <div className="framed-input-container">
                <label className="framed-label">
                  {t("itemModal.categoryLabel")}
                </label>
                <div style={{ position: "relative" }}>
                  <select
                    value={category}
                    onChange={(e) =>
                      setCategory(e.target.value as VaultCategory)
                    }
                    className="framed-select"
                  >
                    {CATEGORIES.map((c) => (
                      <option
                        key={c.id}
                        value={c.id}
                        style={{ background: "#12173B", color: "#FFFFFF" }}
                      >
                        {getCategoryName(c.id)}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    style={{
                      width: 14,
                      height: 14,
                      color: "#8EA4D4",
                      position: "absolute",
                      right: 12,
                      top: 13,
                      pointerEvents: "none",
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 卡片 2: 核心凭证 (Credentials) */}
          <details
            className="form-card optional-fields"
            key={`credentials-${category}`}
            open={
              !!(username || password || url) ||
              [
                "login",
                "email",
                "password",
                "server",
                "database",
                "router",
                "game",
              ].includes(category)
            }
          >
            <summary>{m("账号、密码与网址（按需填写）")}</summary>

            {/* 用户名 / 账号 */}
            <div className="framed-input-container">
              <label className="framed-label">
                {t("itemModal.usernameLabel")}
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t("itemModal.usernamePlaceholder")}
                className="framed-input"
              />
            </div>

            {/* 密码 / 核心加密口令 */}
            <div className="framed-input-container">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <label className="framed-label">
                  {t("itemModal.passwordLabel")}
                </label>
                <button
                  type="button"
                  onClick={() => setShowGenerator(!showGenerator)}
                  className="btn-framed-cyan"
                >
                  <Sparkles style={{ width: 12, height: 12 }} />
                  <span>{t("itemModal.generatePassBtn")}</span>
                </button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("itemModal.passwordPlaceholder")}
                  className="framed-input font-mono"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="btn-framed-icon"
                  title={
                    showPassword
                      ? language === "zh"
                        ? m("隐藏明文")
                        : language === "ja"
                          ? m("非表示")
                          : "Hide"
                      : language === "zh"
                        ? m("显示明文")
                        : language === "ja"
                          ? m("表示")
                          : "Show"
                  }
                >
                  {showPassword ? (
                    <EyeOff style={{ width: 15, height: 15 }} />
                  ) : (
                    <Eye style={{ width: 15, height: 15 }} />
                  )}
                </button>
              </div>

              {/* 展开的密码生成器 (带框美化) */}
              {showGenerator && (
                <div
                  style={{
                    marginTop: 8,
                    padding: 14,
                    borderRadius: 10,
                    background: "rgba(12, 16, 46, 0.95)",
                    border: "1px solid rgba(0, 212, 255, 0.3)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    boxShadow: "0 4px 14px rgba(0,0,0,0.4)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      fontSize: 12,
                    }}
                  >
                    <span style={{ color: "#D3E0FA", fontWeight: 600 }}>
                      {language === "zh"
                        ? `密码长度: ${genLength} 位`
                        : language === "ja"
                          ? `パスワード長: ${genLength} 桁`
                          : `Length: ${genLength} chars`}
                    </span>
                    <button
                      type="button"
                      onClick={() => generatePassword()}
                      className="btn-framed-cyan"
                    >
                      <RefreshCw style={{ width: 12, height: 12 }} />
                      <span>
                        {language === "zh"
                          ? m("重新生成")
                          : language === "ja"
                            ? m("再生成")
                            : "Regenerate"}
                      </span>
                    </button>
                  </div>

                  <input
                    type="range"
                    min="12"
                    max="48"
                    value={genLength}
                    onChange={(e) => {
                      const len = parseInt(e.target.value);
                      setGenLength(len);
                      generatePassword(len);
                    }}
                    style={{
                      accentColor: "#00D4FF",
                      width: "100%",
                      cursor: "pointer",
                    }}
                  />

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12,
                      color: "#A4B8E4",
                    }}
                  >
                    <input
                      type="checkbox"
                      id="gen-symbols"
                      checked={includeSymbols}
                      onChange={(e) => {
                        setIncludeSymbols(e.target.checked);
                        generatePassword(genLength, e.target.checked);
                      }}
                      style={{ accentColor: "#0572EC", cursor: "pointer" }}
                    />
                    <label htmlFor="gen-symbols" style={{ cursor: "pointer" }}>
                      {language === "zh"
                        ? m("包含特殊符号 (!@#$%^&*)")
                        : language === "ja"
                          ? m("記号を含む (!@#$%^&*)")
                          : "Include Symbols (!@#$%^&*)"}
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* 关联网址 */}
            <div className="framed-input-container">
              <label className="framed-label">{t("itemModal.urlLabel")}</label>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t("itemModal.urlPlaceholder")}
                className="framed-input font-mono"
              />
            </div>
          </details>

          {/* 卡片 3: 自定义选项与扩展属性 (Custom Options - Military Style) */}
          <div className="form-card" onClick={() => setIsAddMoreOpen(false)}>
            <div className="form-card-title">
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span>
                  {t("itemModal.customFieldsTitle")} ({customFields.length})
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: "#00D4FF",
                    textTransform: "none",
                  }}
                >
                  ·{" "}
                  {language === "zh"
                    ? m("用户可自由自定义标题与内容")
                    : language === "ja"
                      ? m("項目名と内容をカスタマイズ可能")
                      : "Customizable label & content"}
                </span>
              </div>
            </div>

            {customFields.length > 0 ? (
              <div
                style={{ display: "flex", flexDirection: "column", gap: 10 }}
              >
                {customFields
                  .filter(
                    (field) => !isReadOnly || field.value.trim().length > 0,
                  )
                  .map((field) => {
                    const Icon = getCustomFieldIcon(field.type);
                    const isFieldRevealed = revealedFieldIds[field.id];

                    return (
                      <div key={field.id} className="custom-option-card">
                        {/* 上半行：图标 + 自定义标题输入框 + 敏感掩码开关 + 红色减号删除按钮 */}
                        <div className="custom-option-header">
                          <div className="custom-option-title-group">
                            <div className="custom-option-type-badge">
                              <Icon
                                style={{
                                  width: 14,
                                  height: 14,
                                  color: "#00D4FF",
                                }}
                              />
                            </div>
                            <input
                              type="text"
                              value={field.name}
                              onChange={(e) =>
                                handleFieldChange(
                                  field.id,
                                  "name",
                                  e.target.value,
                                )
                              }
                              placeholder={
                                language === "zh"
                                  ? m(
                                      "自定义标题 (例如: 网站 / 备用邮箱 / 密保)",
                                    )
                                  : language === "ja"
                                    ? m(
                                        "項目名 (例: ウェブサイト / 予備メール)",
                                      )
                                    : "Custom Field Label (e.g. Website / Backup Email)"
                              }
                              className="custom-option-title-input"
                              title={
                                language === "zh"
                                  ? m("点击可修改此选项的自定义标题")
                                  : language === "ja"
                                    ? m("クリックして項目名を変更")
                                    : "Click to edit field label"
                              }
                            />
                          </div>

                          <div className="custom-option-actions">
                            {/* 设为密文掩码 / 明文 */}
                            <button
                              type="button"
                              onClick={() =>
                                handleFieldChange(
                                  field.id,
                                  "isSecret",
                                  !field.isSecret,
                                )
                              }
                              className={`btn-custom-toggle-secret ${field.isSecret ? "active" : ""}`}
                              title={
                                field.isSecret
                                  ? language === "zh"
                                    ? m("当前已掩码隐藏，点击设为普通明文")
                                    : language === "ja"
                                      ? m("現在マスク中、クリックで平文表示")
                                      : "Currently masked, click to show plaintext"
                                  : language === "zh"
                                    ? m("当前为明文，点击设为保密掩码")
                                    : language === "ja"
                                      ? m("現在平文、クリックでマスク")
                                      : "Currently plaintext, click to mask"
                              }
                            >
                              {field.isSecret ? (
                                <EyeOff
                                  style={{
                                    width: 13,
                                    height: 13,
                                    color: "#F59E0B",
                                  }}
                                />
                              ) : (
                                <Eye
                                  style={{
                                    width: 13,
                                    height: 13,
                                    color: "#8EA4D4",
                                  }}
                                />
                              )}
                            </button>

                            {/* 红色减号删除按钮 (完全对齐用户参考图 1) */}
                            <button
                              type="button"
                              onClick={() => handleRemoveField(field.id)}
                              className="btn-custom-delete-minus"
                              title={
                                language === "zh"
                                  ? m("删除此自定义选项")
                                  : language === "ja"
                                    ? m("この項目を削除")
                                    : "Delete this field"
                              }
                            >
                              <MinusCircle style={{ width: 18, height: 18 }} />
                            </button>
                          </div>
                        </div>

                        {/* 下半行：自定义内容输入框 (支持文本、密码、网址、日期、多行便签) */}
                        <div className="custom-option-body">
                          {field.type === "note" ? (
                            <textarea
                              rows={2}
                              value={field.value}
                              onChange={(e) =>
                                handleFieldChange(
                                  field.id,
                                  "value",
                                  e.target.value,
                                )
                              }
                              placeholder={
                                language === "zh"
                                  ? m("输入自定义内容 / 便签备忘...")
                                  : language === "ja"
                                    ? m("カスタム内容やメモを入力...")
                                    : "Enter custom content or notes..."
                              }
                              className="framed-textarea font-mono"
                              style={{
                                fontSize: 12.5,
                                background: "rgba(9, 13, 36, 0.85)",
                              }}
                            />
                          ) : (
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                              }}
                            >
                              <input
                                type={
                                  field.isSecret && !isFieldRevealed
                                    ? "password"
                                    : field.type === "date"
                                      ? "date"
                                      : "text"
                                }
                                value={field.value}
                                onChange={(e) =>
                                  handleFieldChange(
                                    field.id,
                                    "value",
                                    e.target.value,
                                  )
                                }
                                placeholder={
                                  field.type === "url"
                                    ? "https://example.com"
                                    : field.type === "email"
                                      ? "user@domain.com"
                                      : field.type === "phone"
                                        ? "+1 (555) 000-0000"
                                        : field.type === "totp"
                                          ? language === "zh"
                                            ? m("输入 2FA 密钥或六位动态码")
                                            : language === "ja"
                                              ? m(
                                                  "2FAシークレットまたは6桁コード",
                                                )
                                              : "Enter 2FA secret or 6-digit code"
                                          : field.type === "password"
                                            ? language === "zh"
                                              ? m("输入敏感保密密码口令")
                                              : language === "ja"
                                                ? m("機密パスワードを入力")
                                                : "Enter sensitive password"
                                            : language === "zh"
                                              ? m("输入自定义内容...")
                                              : language === "ja"
                                                ? m("内容を入力...")
                                                : "Enter custom content..."
                                }
                                className={`framed-input ${field.isSecret || field.type === "url" ? "font-mono" : ""}`}
                                style={{
                                  flex: 1,
                                  height: 36,
                                  fontSize: 13,
                                  background: "rgba(9, 13, 36, 0.85)",
                                }}
                              />
                              {field.isSecret && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setRevealedFieldIds((prev) => ({
                                      ...prev,
                                      [field.id]: !prev[field.id],
                                    }))
                                  }
                                  className="btn-framed-icon"
                                  style={{ width: 36, height: 36 }}
                                  title={
                                    isFieldRevealed
                                      ? language === "zh"
                                        ? m("隐藏明文")
                                        : language === "ja"
                                          ? m("非表示")
                                          : "Hide"
                                      : language === "zh"
                                        ? m("查看明文")
                                        : language === "ja"
                                          ? m("平文を表示")
                                          : "Show plaintext"
                                  }
                                >
                                  {isFieldRevealed ? (
                                    <EyeOff style={{ width: 14, height: 14 }} />
                                  ) : (
                                    <Eye style={{ width: 14, height: 14 }} />
                                  )}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            ) : (
              <div
                style={{
                  padding: "14px 16px",
                  borderRadius: 10,
                  border: "1px dashed rgba(255, 255, 255, 0.12)",
                  textAlign: "center",
                  fontSize: 12,
                  color: "#7E92C4",
                }}
              >
                {language === "zh"
                  ? m("暂无自定义选项，可点击下方「添加更多」自定标题与内容")
                  : language === "ja"
                    ? m(
                        "カスタム項目はありません。「さらに追加」をクリックしてください",
                      )
                    : 'No custom fields. Click "Add More" below to add custom fields.'}
              </div>
            )}

            {/* 添加字段类型菜单（包含 URL） */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                position: "relative",
                marginTop: 4,
              }}
            >
              {/* 核心按钮: + 添加更多 */}
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsAddMoreOpen(!isAddMoreOpen);
                  }}
                  className="btn-add-more-pill"
                  title={
                    language === "zh"
                      ? m("点击展开自定义选项类型列表")
                      : language === "ja"
                        ? m("カスタム項目一覧を展開")
                        : "Expand field types"
                  }
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <Plus style={{ width: 14, height: 14 }} />
                    <span>
                      {language === "zh"
                        ? m("添加更多")
                        : language === "ja"
                          ? m("さらに追加")
                          : "Add More"}
                    </span>
                  </div>
                  <ChevronDown
                    style={{
                      width: 14,
                      height: 14,
                      transform: isAddMoreOpen ? "rotate(180deg)" : "none",
                      transition: "transform 0.2s",
                    }}
                  />
                </button>

                {/* 弹出类型选择菜单 */}
                {isAddMoreOpen && (
                  <div
                    className="add-more-dropdown-menu"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        handleAddCustomField(
                          "text",
                          language === "zh"
                            ? m("文本")
                            : language === "ja"
                              ? "テキスト"
                              : "Text",
                        )
                      }
                      className="dropdown-menu-item"
                    >
                      <Type
                        style={{ width: 15, height: 15, color: "#93C5FD" }}
                      />
                      <span>
                        {language === "zh"
                          ? m("文本")
                          : language === "ja"
                            ? "テキスト"
                            : "Text"}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleAddCustomField(
                          "url",
                          language === "zh"
                            ? m("网站")
                            : language === "ja"
                              ? "ウェブサイト"
                              : "Website",
                        )
                      }
                      className="dropdown-menu-item"
                    >
                      <Globe
                        style={{ width: 15, height: 15, color: "#67E8F9" }}
                      />
                      <span>URL</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleAddCustomField(
                          "email",
                          language === "zh"
                            ? m("电子邮件")
                            : language === "ja"
                              ? "メール"
                              : "Email",
                        )
                      }
                      className="dropdown-menu-item"
                    >
                      <Mail
                        style={{ width: 15, height: 15, color: "#FCD34D" }}
                      />
                      <span>
                        {language === "zh"
                          ? m("电子邮件")
                          : language === "ja"
                            ? "メール"
                            : "Email"}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleAddCustomField(
                          "address",
                          language === "zh"
                            ? m("地址")
                            : language === "ja"
                              ? m("住所")
                              : "Address",
                        )
                      }
                      className="dropdown-menu-item"
                    >
                      <MapPin
                        style={{ width: 15, height: 15, color: "#F87171" }}
                      />
                      <span>
                        {language === "zh"
                          ? m("地址")
                          : language === "ja"
                            ? m("住所")
                            : "Address"}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleAddCustomField(
                          "date",
                          language === "zh"
                            ? m("日期")
                            : language === "ja"
                              ? m("日付")
                              : "Date",
                        )
                      }
                      className="dropdown-menu-item"
                    >
                      <Calendar
                        style={{ width: 15, height: 15, color: "#C084FC" }}
                      />
                      <span>
                        {language === "zh"
                          ? m("日期")
                          : language === "ja"
                            ? m("日付")
                            : "Date"}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleAddCustomField(
                          "totp",
                          language === "zh"
                            ? m("一次性密码")
                            : language === "ja"
                              ? "ワンタイムパスワード"
                              : "One-Time Password",
                        )
                      }
                      className="dropdown-menu-item"
                    >
                      <Clock
                        style={{ width: 15, height: 15, color: "#34D399" }}
                      />
                      <span>
                        {language === "zh"
                          ? m("一次性密码")
                          : language === "ja"
                            ? "ワンタイムパスワード"
                            : "TOTP (2FA)"}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleAddCustomField(
                          "password",
                          language === "zh"
                            ? m("密码")
                            : language === "ja"
                              ? "パスワード"
                              : "Password",
                        )
                      }
                      className="dropdown-menu-item"
                    >
                      <Lock
                        style={{ width: 15, height: 15, color: "#FB923C" }}
                      />
                      <span>
                        {language === "zh"
                          ? m("密码")
                          : language === "ja"
                            ? "パスワード"
                            : "Password"}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleAddCustomField(
                          "phone",
                          language === "zh"
                            ? m("电话")
                            : language === "ja"
                              ? m("電話番号")
                              : "Phone",
                        )
                      }
                      className="dropdown-menu-item"
                    >
                      <Phone
                        style={{ width: 15, height: 15, color: "#60A5FA" }}
                      />
                      <span>
                        {language === "zh"
                          ? m("电话")
                          : language === "ja"
                            ? m("電話番号")
                            : "Phone"}
                      </span>
                    </button>
                    <div className="dropdown-menu-divider" />
                    <button
                      type="button"
                      onClick={() =>
                        handleAddCustomField(
                          "note",
                          language === "zh"
                            ? m("安全便签")
                            : language === "ja"
                              ? m("安全なメモ")
                              : "Secure Note",
                        )
                      }
                      className="dropdown-menu-item"
                    >
                      <FileText
                        style={{ width: 15, height: 15, color: "#A7F3D0" }}
                      />
                      <span>
                        {language === "zh"
                          ? m("安全便签")
                          : language === "ja"
                            ? m("安全なメモ")
                            : "Secure Note"}
                      </span>
                    </button>
                    <div className="dropdown-menu-divider" />
                    <button
                      type="button"
                      onClick={() => {
                        setIsAddMoreOpen(false);
                        fileInputRef.current?.click();
                      }}
                      className="dropdown-menu-item"
                    >
                      <Paperclip
                        style={{ width: 15, height: 15, color: "#38BDF8" }}
                      />
                      <span>
                        {language === "zh"
                          ? m("附上文件 (≤ 2MB)")
                          : language === "ja"
                            ? m("ファイルを添付 (≤ 2MB)")
                            : "Attach File (≤ 2MB)"}
                      </span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 添加入口统一保留在“添加更多”，文件输入始终挂载。 */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            hidden
            multiple
          />
          {(attachments.length > 0 || attachmentError) && (
            <div className="form-card">
              <div
                className="form-card-title"
                style={{ justifyContent: "space-between" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Paperclip
                    style={{ width: 14, height: 14, color: "#00D4FF" }}
                  />
                  <span>{t("itemModal.attachmentsTitle")}</span>
                  {attachments.length > 0 && (
                    <span
                      style={{
                        fontSize: 11,
                        padding: "1px 6px",
                        borderRadius: 10,
                        background: "rgba(0, 212, 255, 0.15)",
                        color: "#00D4FF",
                        fontWeight: 600,
                      }}
                    >
                      {attachments.length}
                    </span>
                  )}
                </div>
                <span className="attachment-limit-badge">
                  {language === "zh"
                    ? m("单文件限制 ≤ 2MB")
                    : language === "ja"
                      ? m("ファイル上限 ≤ 2MB")
                      : "Max file size ≤ 2MB"}
                </span>
              </div>

              {/* 超限错误提示条 */}
              {attachmentError && (
                <div
                  className="attachment-error-banner"
                  style={{ marginBottom: 10 }}
                >
                  <AlertTriangle
                    style={{ width: 15, height: 15, flexShrink: 0 }}
                  />
                  <span style={{ flex: 1 }}>{attachmentError}</span>
                  <button
                    type="button"
                    onClick={() => setAttachmentError(null)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#FCA5A5",
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    <X style={{ width: 14, height: 14 }} />
                  </button>
                </div>
              )}

              {/* 附件列表 */}
              {attachments.length > 0 && (
                <div
                  className="attachment-container"
                  style={{ marginBottom: 10 }}
                >
                  {attachments.map((att) => {
                    const AttIcon = getAttachmentIcon(att.type, att.name);
                    return (
                      <div key={att.id} className="attachment-card">
                        <div className="attachment-left">
                          <div className="attachment-file-icon">
                            <AttIcon style={{ width: 16, height: 16 }} />
                          </div>
                          <div className="attachment-info">
                            <span className="attachment-name" title={att.name}>
                              {att.name}
                            </span>
                            <span className="attachment-meta">
                              <span>{formatFileSize(att.size)}</span>
                              <span>•</span>
                              <span>
                                {new Date(att.uploadedAt).toLocaleDateString()}
                              </span>
                            </span>
                          </div>
                        </div>

                        <div className="attachment-actions">
                          <button
                            type="button"
                            onClick={() => handleDownloadAttachment(att)}
                            className="btn-attachment-download"
                            title={
                              language === "zh"
                                ? m("解密并下载此附件")
                                : language === "ja"
                                  ? m("復号してダウンロード")
                                  : "Decrypt and download attachment"
                            }
                          >
                            <Download style={{ width: 14, height: 14 }} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveAttachment(att.id)}
                            className="btn-custom-delete-minus"
                            title={
                              language === "zh"
                                ? m("移除此附件")
                                : language === "ja"
                                  ? m("添付ファイルを削除")
                                  : "Remove attachment"
                            }
                          >
                            <MinusCircle style={{ width: 18, height: 18 }} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* 卡片 5: 常规安全备注 (General Notes) */}
          <div className="form-card">
            <div className="form-card-title">
              <span>{t("itemModal.notesLabel")}</span>
            </div>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("itemModal.notesPlaceholder")}
              className="framed-textarea"
            />
          </div>

          {/* 卡片 6: 副卡接管向导指示 (Takeover Guide) */}
          <details
            className="form-card optional-fields"
            open={!!inheritanceInstructions}
            style={{
              borderColor: "rgba(0, 212, 255, 0.35)",
              background:
                "linear-gradient(180deg, rgba(14, 25, 65, 0.8) 0%, rgba(18, 18, 55, 0.8) 100%)",
            }}
          >
            <summary>{m("这项资产如何交接（选填）")}</summary>
            <div className="form-card-title">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  color: "#00D4FF",
                }}
              >
                <Compass style={{ width: 16, height: 16 }} />
                <span>{t("itemModal.heirNotesLabel")}</span>
              </div>
              <span
                style={{
                  fontSize: 10,
                  fontFamily: "JetBrains Mono",
                  padding: "2px 8px",
                  borderRadius: 6,
                  background: "rgba(0, 212, 255, 0.15)",
                  color: "#00D4FF",
                  border: "1px solid rgba(0, 212, 255, 0.3)",
                  textTransform: "none",
                }}
              >
                {language === "zh"
                  ? m("继承人专用")
                  : language === "ja"
                    ? m("継承者専用")
                    : "Heir Exclusive"}
              </span>
            </div>
            <p style={{ fontSize: 11.5, color: "#A4B8E4", lineHeight: 1.5 }}>
              {m(
                "使用双 U 盘只读打开信息备份后，继承人可在该资产中查看此说明。",
              )}
            </p>
            <textarea
              rows={3}
              value={inheritanceInstructions}
              onChange={(e) => setInheritanceInstructions(e.target.value)}
              placeholder={t("itemModal.heirNotesPlaceholder")}
              className="framed-textarea font-mono"
              style={{ fontSize: 12 }}
            />
          </details>
        </form>

        {/* 底部独立按钮栏 (加框美化与操作区) */}
        <div
          className="modal-window-footer"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {initialItem && onDelete && !isReadOnly && (
              <button
                type="button"
                disabled={saving}
                onClick={async () => {
                  const confirmMsg =
                    language === "zh"
                      ? `确定要从遗产密库中永久删除“${initialItem.title}”吗？此操作不可恢复。`
                      : language === "ja"
                        ? `「${initialItem.title}」を金庫から完全に削除してもよろしいですか？この操作は取り消せません。`
                        : `Are you sure you want to permanently delete "${initialItem.title}" from the vault? This cannot be undone.`;
                  if (window.confirm(confirmMsg)) {
                    setSaving(true);
                    setSaveError("");
                    try {
                      await onDelete(initialItem.id);
                      onClose();
                    } catch (e) {
                      setSaveError(
                        e instanceof Error
                          ? e.message
                          : m("删除失败，请重试。"),
                      );
                    } finally {
                      setSaving(false);
                    }
                  }
                }}
                className="btn-action-cancel"
                style={{
                  color: "#F43F5E",
                  borderColor: "rgba(244, 63, 94, 0.4)",
                  background: "rgba(244, 63, 94, 0.1)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  cursor: "pointer",
                }}
                title={t("itemModal.deleteItemBtn")}
              >
                <Trash2 style={{ width: 14, height: 14 }} />
                <span>{t("itemModal.deleteItemBtn")}</span>
              </button>
            )}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "#8EA4D4",
              }}
            >
              <ShieldCheck
                style={{ width: 16, height: 16, color: "#34D399" }}
              />
              <span>{m("本机加密保存 · AES-256-GCM")}</span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {saveError && (
              <span role="alert" style={{ color: "#fda4af" }}>
                {saveError}
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="btn-action-cancel"
              disabled={saving}
            >
              {isReadOnly
                ? t("itemModal.closeViewBtn")
                : t("itemModal.cancelBtn")}
            </button>
            {isReadOnly ? (
              isHeirReadOnly ? (
                <button
                  type="button"
                  onClick={() => {
                    if (onRequestTakeover) {
                      onRequestTakeover();
                    } else if (onUpgrade) {
                      onUpgrade();
                    }
                  }}
                  className="btn-action-submit"
                  style={{
                    background:
                      "linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)",
                    color: "#FFFFFF",
                    fontWeight: 700,
                    boxShadow: "0 4px 14px rgba(99, 102, 241, 0.35)",
                    border: "none",
                    cursor: "pointer",
                  }}
                  title={
                    language === "zh"
                      ? m(
                          "当前处于继承人只读模式，点击输入所有者主密码与紧急安全密钥以接管修改权限",
                        )
                      : language === "ja"
                        ? m(
                            "現在継承者読み取り専用モードです。マスターPINと緊急キーを入力して権限を引き継ぎます",
                          )
                        : "Currently in Heir Read-Only mode. Click to verify master credentials and takeover write permissions"
                  }
                >
                  {t("itemModal.heirReadOnlyTakeover")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onUpgrade}
                  className="btn-action-submit"
                  style={{
                    background:
                      "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)",
                    color: "#0B0F24",
                    fontWeight: 700,
                    boxShadow: "0 4px 14px rgba(245, 158, 11, 0.3)",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  {t("itemModal.upgradeBtn")}
                </button>
              )
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                className="btn-action-submit"
                disabled={saving}
              >
                {initialItem
                  ? t("itemModal.saveChangesBtn")
                  : t("itemModal.createItemBtn")}
              </button>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
};
