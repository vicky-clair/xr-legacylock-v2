import { m } from "../services/messages";
/** 主工作区：公共工具栏、信息列表与详情，以及设置和备份内容插槽。 */

import React, { useState, useEffect, useRef } from "react";
import {
  KeyRound,
  Copy,
  Plus,
  Minus,
  X,
  Eye,
  EyeOff,
  Check,
  Trash2,
  Edit,
  ShieldCheck,
  Compass,
  Palette,
  Maximize2,
  Search,
  Lock,
  Paperclip,
  Download,
  Crown,
} from "lucide-react";
import {
  NavCategoryType,
  VaultCategory,
  VaultItem,
  VaultAttachment,
} from "../types";
import { CATEGORIES, getCategoryDef } from "../services/categories";
import { THEMES, ThemeDefinition } from "../services/themes";
import { call, type Preferences } from "../services/vaultClient";
import { useI18n } from "../services/i18n";

function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function handleDownloadAttachment(att: VaultAttachment) {
  const link = document.createElement("a");
  link.href = att.data;
  link.download = att.name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * 主内容区属性接口
 */
interface RightContentAreaProps {
  selectedNav: NavCategoryType;
  items: VaultItem[];
  onAddNew: (category?: VaultCategory) => void;
  onEditItem: (item: VaultItem) => void;
  onDeleteItem: (id: string) => void;
  onOpenUsbPassword: () => void;
  onOpenHealthCheck: () => void;
  currentTheme: ThemeDefinition;
  onSelectTheme: (id: string) => void;
  onLock: () => void;
  onOpenSubscription?: () => void;
  canModify: boolean;
  isReadOnly: boolean;
  onRequestTakeover: () => void;
  settingsContent: React.ReactNode;
  backupContent: React.ReactNode;
  banner: React.ReactNode;
  demo: Preferences["subscriptionDemo"];
  busy: boolean;
}
export const RightContentArea: React.FC<RightContentAreaProps> = ({
  selectedNav,
  items,
  onAddNew,
  onEditItem,
  onDeleteItem,
  onOpenUsbPassword,
  onOpenHealthCheck,
  currentTheme,
  onSelectTheme,
  onLock,
  onOpenSubscription,
  canModify,
  isReadOnly,
  onRequestTakeover,
  settingsContent,
  backupContent,
  banner,
  demo,
  busy,
}) => {
  const { t } = useI18n();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [revealedIds, setRevealedIds] = useState<Record<string, boolean>>({});
  const [revealedCustomFieldIds, setRevealedCustomFieldIds] = useState<
    Record<string, boolean>
  >({});
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const detailRef = useRef<HTMLElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    workspaceRef.current?.scrollTo(0, 0);
  }, [selectedNav]);
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);

  const [copyError, setCopyError] = useState("");
  // 综合只读判断：试用到期只读 或 继承人双 U 盘只读模式
  const effectiveReadOnly = isReadOnly || !canModify;

  // 筛选资产
  const filteredItems = items.filter((item) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = item.title.toLowerCase().includes(q);
      const matchUser = (item.username || "").toLowerCase().includes(q);
      const matchNotes = (item.notes || "").toLowerCase().includes(q);
      if (!matchTitle && !matchUser && !matchNotes) return false;
    }

    if (selectedNav === "all") return true;
    if (selectedNav === "login") return item.category === "login";
    if (selectedNav === "note") return item.category === "note";
    if (selectedNav === "identity")
      return (
        item.category === "identity" ||
        item.category === "passport" ||
        item.category === "driverLicense" ||
        item.category === "ssn"
      );
    if (selectedNav === "card")
      return item.category === "card" || item.category === "bankAccount";
    if (selectedNav === "password") return item.category === "password";
    if (selectedNav === "document")
      return (
        item.category === "document" ||
        item.category === "softwareLicense" ||
        item.category === "outdoorLicense" ||
        item.category === "license"
      );
    if (selectedNav === "sshKey") return item.category === "sshKey";
    if (selectedNav === "apiCredential")
      return item.category === "apiCredential";
    if (selectedNav === "cryptoWallet") return item.category === "cryptoWallet";
    if (selectedNav === "server")
      return item.category === "server" || item.category === "database";
    if (selectedNav === "router") return item.category === "router";
    if (selectedNav === "email") return item.category === "email";
    if (selectedNav === "membership")
      return (
        item.category === "membership" ||
        item.category === "game" ||
        item.category === "reward" ||
        item.category === "medical"
      );
    return item.category === selectedNav;
  });

  const handleCopy = async (text: string, id: string) => {
    try {
      await call("copy", text);
      setCopyError("");
      setCopiedId(id);
    } catch (e) {
      setCopyError(e instanceof Error ? e.message : m("复制失败"));
    }
  };
  const selectedItem =
    filteredItems.find((item) => item.id === selectedItemId) ||
    filteredItems[0];
  useEffect(() => {
    setSelectedItemId(selectedItem?.id ?? null);
    setRevealedIds({});
    setRevealedCustomFieldIds({});
    setCopiedId(null);
    setCopyError("");
    detailRef.current?.scrollTo(0, 0);
  }, [selectedItem?.id, selectedNav, searchQuery]);
  const toggleReveal = (id: string) => {
    setRevealedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleCustomFieldReveal = (key: string) => {
    setRevealedCustomFieldIds((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const getNavInfo = () => {
    switch (selectedNav) {
      case "settings":
        return {
          title: t("nav.settings"),
          subtitle: m("背景、锁屏与托盘、继承说明和本机数据删除"),
        };
      case "import_export":
        return {
          title: t("nav.importExport"),
          subtitle: m("加密备份、双盘配置与同步"),
        };
      case "all":
        return { title: t("nav.all"), subtitle: m("{0} 项资产", items.length) };
      default:
        return {
          title: t(`nav.${selectedNav}`),
          subtitle: t(`categories.${selectedNav}.desc`),
        };
    }
  };

  const navInfo = getNavInfo();

  const isDirectCategory =
    selectedNav !== "all" &&
    selectedNav !== "settings" &&
    selectedNav !== "import_export" &&
    CATEGORIES.some((c) => c.id === selectedNav);

  const categoryActionTitle = isDirectCategory
    ? navInfo.title
    : t("topBar.addNew");

  return (
    <main
      className="app-main"
      style={{ background: currentTheme.mainStyle.background }}
      onClick={() => setIsThemeMenuOpen(false)}
    >
      {/* 顶部工具栏：消除大面积空隙，紧凑且功能完善 (支持双击最大化) */}
      <header
        className="main-topbar"
        style={{ background: currentTheme.mainStyle.topbarBg }}
        onDoubleClick={(e) => {
          if (
            e.target === e.currentTarget ||
            (e.target as HTMLElement).classList.contains("main-topbar")
          ) {
            void call("windowControl", "maximize");
          }
        }}
      >
        <div className="topbar-left">
          {/* 主行动按钮 (动态对齐当前分类标题，如「+ 登录信息」) */}
          <button
            onClick={() => {
              if (effectiveReadOnly) {
                if (!canModify && onRequestTakeover) {
                  onRequestTakeover();
                } else if (onOpenSubscription) {
                  onOpenSubscription();
                }
              } else {
                onAddNew(
                  isDirectCategory ? (selectedNav as VaultCategory) : undefined,
                );
              }
            }}
            className="btn-topbar-add-primary"
            title={
              effectiveReadOnly
                ? !canModify
                  ? m("当前处于继承人只读模式，需接管控制权后方可录入新资产")
                  : m("当前处于试用到期只读模式，点击升级订阅以录入新资产")
                : selectedNav === "all"
                  ? m("点击打开资产分类选择面板，添加新资产或密钥")
                  : `添加新「${categoryActionTitle}」`
            }
          >
            <Plus style={{ width: 15, height: 15 }} />
            <span>{categoryActionTitle}</span>
          </button>

          {/* 搜索框 */}
          <div className="search-container">
            <Search style={{ width: 14, height: 14, color: "#7E92C4" }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("topBar.searchPlaceholder")}
              className="search-input"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                style={{ color: "#7E92C4", cursor: "pointer", padding: 2 }}
                title="Clear"
              >
                <X style={{ width: 12, height: 12 }} />
              </button>
            )}
          </div>
        </div>

        {/* 中间快捷安全操作与主题工具组 */}
        <div className="topbar-center-tools">
          {/* 渐变主题切换按钮 */}
          <div style={{ position: "relative" }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsThemeMenuOpen(!isThemeMenuOpen);
              }}
              className="topbar-tool-pill"
              disabled={!canModify || busy}
              title={t("topBar.theme")}
            >
              <Palette style={{ width: 15, height: 15, color: "#FCD34D" }} />
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: "50%",
                  background: currentTheme.previewGradient,
                  border: "1px solid rgba(255,255,255,0.7)",
                }}
              />
              <span className="tool-pill-label">{t("topBar.theme")}</span>
            </button>

            {/* 主题选择下拉菜单 */}
            {isThemeMenuOpen && (
              <div
                className="theme-dropdown-menu"
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  style={{
                    padding: "4px 8px 8px 8px",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#7E92C4",
                    borderBottom: "1px solid rgba(255,255,255,0.1)",
                    marginBottom: 4,
                  }}
                >
                  {t("topBar.theme")}
                </div>
                {THEMES.map((th) => (
                  <button
                    key={th.id}
                    onClick={() => {
                      onSelectTheme(th.id);
                      setIsThemeMenuOpen(false);
                    }}
                    className={`theme-option-btn ${th.id === currentTheme.id ? "active" : ""}`}
                  >
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <span
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: "50%",
                          background: th.previewGradient,
                          boxShadow: "0 1px 4px rgba(0,0,0,0.5)",
                        }}
                      />
                      <span>{m(th.name)}</span>
                    </div>
                    {th.id === currentTheme.id && (
                      <Check
                        style={{ width: 14, height: 14, color: "#00D4FF" }}
                      />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 用户要求的核心功能按钮：【U盘密码】 */}
          <button
            onClick={onOpenUsbPassword}
            className="topbar-tool-pill cyan-highlight"
            disabled={!canModify || busy}
            title={m("密码与安全密钥")}
          >
            <KeyRound style={{ width: 15, height: 15, color: "#00D4FF" }} />
            <span className="tool-pill-label cyan-text">{m("密码与密钥")}</span>
          </button>

          {/* 密库健康自检快捷入口 */}
          <button
            onClick={onOpenHealthCheck}
            className="topbar-tool-pill green-highlight"
            disabled={!canModify || busy}
            title={t("topBar.healthCheck")}
          >
            <ShieldCheck style={{ width: 15, height: 15, color: "#34D399" }} />
            <span className="tool-pill-label green-text">
              {t("topBar.healthCheck")}
            </span>
          </button>

          {/* 一键立即安全锁屏 */}
          {onLock && (
            <button
              onClick={onLock}
              className="topbar-tool-pill"
              style={{
                borderColor: "rgba(168, 85, 247, 0.4)",
                background: "rgba(168, 85, 247, 0.12)",
              }}
              title={t("topBar.lockNow")}
            >
              <Lock style={{ width: 14, height: 14, color: "#C084FC" }} />
              <span className="tool-pill-label" style={{ color: "#D8B4FE" }}>
                {t("topBar.lockNow")}
              </span>
            </button>
          )}

          {onOpenSubscription && (
            <button
              className="topbar-tool-pill"
              onClick={onOpenSubscription}
              disabled={busy}
              title={m("订阅测试，不会扣费")}
            >
              <Crown size={15} color="#F59E0B" />
              <span>
                {m("订阅测试 ·")}{" "}
                {demo === "trial"
                  ? m("试用中")
                  : demo === "expired"
                    ? m("已到期")
                    : m("已开通")}
              </span>
            </button>
          )}
        </div>
        <div className="topbar-right">
          <div className="window-controls">
            <button
              className="win-btn"
              title={m("最大化或还原")}
              onClick={() => void call("windowControl", "maximize")}
            >
              <Maximize2 size={14} />
            </button>
            <button
              className="win-btn"
              title={m("最小化窗口")}
              onClick={() => void call("windowControl", "minimize")}
            >
              <Minus size={14} />
            </button>
            <button
              className="win-btn close"
              title={m("关闭应用")}
              onClick={() => void call("windowControl", "close")}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      </header>

      {/* 主工作滚动区域 */}
      <div
        ref={workspaceRef}
        className={`main-scroll-content ${selectedNav !== "settings" && selectedNav !== "import_export" ? "master-detail-content" : ""}`}
      >
        {banner}
        {copyError && <p role="alert">{copyError}</p>}
        {/* 顶部横幅 */}
        <div className="content-header-banner">
          <div className="hd-icon-3d">
            <div className="hd-drive-body">
              <div className="hd-platter-disc" />
            </div>
            <div className="hd-key-3d">
              <KeyRound style={{ width: 13, height: 13 }} />
            </div>
          </div>

          <div className="header-info">
            <div className="header-title-row">
              <h2 className="header-title">{navInfo.title}</h2>
              {selectedNav === "import_export" && (
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: "JetBrains Mono",
                    padding: "2px 8px",
                    borderRadius: 9999,
                    background: "rgba(0, 212, 255, 0.15)",
                    color: "#00D4FF",
                    border: "1px solid rgba(0, 212, 255, 0.3)",
                  }}
                >
                  {m("AES-256-GCM 认证加密")}
                </span>
              )}
              {selectedNav === "settings" && (
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: "JetBrains Mono",
                    padding: "2px 8px",
                    borderRadius: 9999,
                    background: "rgba(167, 139, 250, 0.15)",
                    color: "#C4B5FD",
                    border: "1px solid rgba(167, 139, 250, 0.3)",
                  }}
                >
                  LVCF 3
                </span>
              )}
            </div>

            <div className="header-subtitle-row">
              <span>{navInfo.subtitle}</span>
            </div>
          </div>
        </div>

        {/* 视图内容分流 */}
        {selectedNav === "settings" ? (
          settingsContent
        ) : selectedNav === "import_export" ? (
          backupContent
        ) : filteredItems.length === 0 ? (
          <div className="empty-state-wrapper">
            {/* 3D 质感打开的纸盒 + 青色放大镜 */}
            <div className="empty-3d-box-stage">
              <div className="box-isometric">
                <div className="box-face-front" />
                <div className="box-face-right" />
                <div className="box-flap-left" />
                <div className="box-flap-right" />
                <div className="box-interior" />
              </div>

              <div className="floating-magnifier-3d">
                <div className="magnifier-lens-ring" />
                <div className="magnifier-handle" />
              </div>
            </div>

            <p className="empty-text-label">
              {searchQuery
                ? `${t("itemCard.emptyTitle")} ("${searchQuery}")`
                : t("itemCard.emptyTitle")}
            </p>
            <p style={{ fontSize: 12, color: "#7E92C4", marginBottom: 16 }}>
              {t("itemCard.emptyDesc")}
            </p>

            <button
              onClick={() => {
                if (!canModify) {
                  onRequestTakeover();
                } else if (isReadOnly && onOpenSubscription) {
                  onOpenSubscription();
                } else {
                  onAddNew(
                    isDirectCategory
                      ? (selectedNav as VaultCategory)
                      : undefined,
                  );
                }
              }}
              className="btn-topbar-add-primary"
              style={{
                height: 40,
                padding: "0 24px",
                borderRadius: 10,
                fontSize: 13,
                gap: 8,
              }}
              title={t("itemCard.emptyBtn")}
            >
              <Plus style={{ width: 16, height: 16 }} />
              <span>{t("itemCard.emptyBtn")}</span>
            </button>
          </div>
        ) : (
          <div className="vault-master-detail">
            <section className="vault-list-pane" aria-label={m("信息列表")}>
              <div className="vault-list-heading">
                <span>{m("信息列表")}</span>
                <span>{m("{0} 项资产", filteredItems.length)}</span>
              </div>
              <div
                className="vault-list"
                role="listbox"
                aria-label={m("信息列表")}
              >
                {filteredItems.map((item, index) => {
                  const cat = getCategoryDef(item.category);
                  return (
                    <button
                      type="button"
                      key={item.id}
                      role="option"
                      aria-selected={selectedItem?.id === item.id}
                      tabIndex={selectedItem?.id === item.id ? 0 : -1}
                      className="vault-list-item"
                      onClick={() => setSelectedItemId(item.id)}
                      onKeyDown={(event) => {
                        const target =
                          event.key === "ArrowDown"
                            ? Math.min(index + 1, filteredItems.length - 1)
                            : event.key === "ArrowUp"
                              ? Math.max(index - 1, 0)
                              : event.key === "Home"
                                ? 0
                                : event.key === "End"
                                  ? filteredItems.length - 1
                                  : -1;
                        if (target < 0) return;
                        event.preventDefault();
                        setSelectedItemId(filteredItems[target].id);
                        const button = event.currentTarget.parentElement
                          ?.children[target] as HTMLElement;
                        button?.focus();
                      }}
                    >
                      <span
                        className="card-category-badge"
                        style={{ background: cat.bgColor, color: cat.color }}
                      >
                        <cat.icon />
                      </span>
                      <span className="vault-list-summary">
                        <strong>{item.title}</strong>
                        <span>{t(`categories.${cat.id}.name`)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
            <section
              ref={detailRef}
              className="vault-detail-pane"
              aria-label={m("详细信息")}
            >
              {selectedItem &&
                [selectedItem].map((item) => {
                  const catDef = getCategoryDef(item.category);
                  const isRevealed = revealedIds[item.id];

                  return (
                    <div key={item.id} className="vault-item-card">
                      <div className="card-top-row">
                        <div className="card-title-group">
                          <div
                            className="card-category-badge"
                            style={{
                              background: catDef.bgColor,
                              color: catDef.color,
                            }}
                          >
                            <catDef.icon />
                          </div>
                          <div>
                            <h3 className="card-title-text">{item.title}</h3>
                            <span className="card-cat-label">
                              {t(`categories.${catDef.id}.name`) || catDef.name}
                            </span>
                          </div>
                        </div>

                        <div className="card-actions">
                          <button
                            onClick={() => onEditItem(item)}
                            className="btn-card-action"
                            title={
                              effectiveReadOnly
                                ? m("详细信息")
                                : t("itemCard.edit")
                            }
                          >
                            {effectiveReadOnly ? (
                              <Eye size={14} />
                            ) : (
                              <Edit size={14} />
                            )}
                            <span>
                              {effectiveReadOnly
                                ? m("详细信息")
                                : t("itemCard.edit")}
                            </span>
                          </button>
                          {!effectiveReadOnly && (
                            <button
                              onClick={() => onDeleteItem(item.id)}
                              className="btn-card-action danger"
                              title={t("itemCard.delete")}
                            >
                              <Trash2 style={{ width: 14, height: 14 }} />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="card-fields-box">
                        {item.username?.trim() && (
                          <div className="card-field-row">
                            <span className="card-field-label">ID:</span>
                            <div className="card-field-value-group">
                              <span className="card-field-value">
                                {item.username}
                              </span>
                              <button
                                onClick={() =>
                                  handleCopy(item.username!, `u-${item.id}`)
                                }
                                className="btn-mini-copy"
                                title={t("itemCard.copyUser")}
                              >
                                {copiedId === `u-${item.id}` ? (
                                  <Check
                                    style={{
                                      width: 12,
                                      height: 12,
                                      color: "#34D399",
                                    }}
                                  />
                                ) : (
                                  <Copy style={{ width: 12, height: 12 }} />
                                )}
                              </button>
                            </div>
                          </div>
                        )}

                        {item.password?.trim() && (
                          <div className="card-field-row">
                            <span className="card-field-label">PW:</span>
                            <div className="card-field-value-group">
                              <span className="card-field-value">
                                {isRevealed ? item.password : "••••••••••••"}
                              </span>
                              <button
                                onClick={() => toggleReveal(item.id)}
                                className="btn-mini-copy"
                                title={
                                  isRevealed ? m("隐藏密码") : m("显示密码")
                                }
                              >
                                {isRevealed ? (
                                  <EyeOff style={{ width: 12, height: 12 }} />
                                ) : (
                                  <Eye style={{ width: 12, height: 12 }} />
                                )}
                              </button>
                              <button
                                onClick={() =>
                                  handleCopy(item.password!, `p-${item.id}`)
                                }
                                className="btn-mini-copy"
                                title={m("复制密码")}
                              >
                                {copiedId === `p-${item.id}` ? (
                                  <Check
                                    style={{
                                      width: 12,
                                      height: 12,
                                      color: "#34D399",
                                    }}
                                  />
                                ) : (
                                  <Copy style={{ width: 12, height: 12 }} />
                                )}
                              </button>
                            </div>
                          </div>
                        )}

                        {item.url?.trim() && (
                          <div className="card-field-row">
                            <span className="card-field-label">
                              {m("网址:")}
                            </span>
                            <div className="card-field-value-group">
                              <span className="card-field-value font-mono">
                                {item.url}
                              </span>
                              <button
                                onClick={() =>
                                  handleCopy(item.url!, `url-${item.id}`)
                                }
                                className="btn-mini-copy"
                                title={m("复制网址")}
                              >
                                {copiedId === `url-${item.id}` ? (
                                  <Check
                                    style={{
                                      width: 12,
                                      height: 12,
                                      color: "#34D399",
                                    }}
                                  />
                                ) : (
                                  <Copy style={{ width: 12, height: 12 }} />
                                )}
                              </button>
                            </div>
                          </div>
                        )}

                        {item.notes?.trim() && (
                          <div className="detail-notes">
                            <h4>{m("备注")}</h4>
                            <p>{item.notes}</p>
                          </div>
                        )}

                        {/* 自定义扩展选项 (自定义标题与内容) */}
                        {item.customFields?.some(
                          (cf) => cf.value.trim().length > 0,
                        ) && (
                          <div className="card-custom-fields-box">
                            {item.customFields
                              .filter((cf) => cf.value.trim().length > 0)
                              .map((cf) => {
                                const fieldKey = `${item.id}-${cf.id}`;
                                const isSecret = cf.isSecret;
                                const isFieldRevealed =
                                  revealedCustomFieldIds[fieldKey];
                                const displayVal =
                                  isSecret && !isFieldRevealed
                                    ? "••••••••••••"
                                    : cf.value;

                                return (
                                  <div
                                    key={cf.id}
                                    className="card-field-row custom"
                                  >
                                    <span className="card-field-label">
                                      {cf.name}:
                                    </span>
                                    <div className="card-field-value-group">
                                      <span
                                        className={`card-field-value ${cf.type === "url" || isSecret ? "font-mono" : ""}`}
                                      >
                                        {displayVal}
                                      </span>
                                      {isSecret && (
                                        <button
                                          onClick={() =>
                                            toggleCustomFieldReveal(fieldKey)
                                          }
                                          className="btn-mini-copy"
                                          title={
                                            isFieldRevealed
                                              ? m("隐藏明文")
                                              : m("显示明文")
                                          }
                                        >
                                          {isFieldRevealed ? (
                                            <EyeOff
                                              style={{ width: 12, height: 12 }}
                                            />
                                          ) : (
                                            <Eye
                                              style={{ width: 12, height: 12 }}
                                            />
                                          )}
                                        </button>
                                      )}
                                      <button
                                        onClick={() =>
                                          handleCopy(cf.value, `cf-${fieldKey}`)
                                        }
                                        className="btn-mini-copy"
                                        title={m("复制 {0}", cf.name)}
                                      >
                                        {copiedId === `cf-${fieldKey}` ? (
                                          <Check
                                            style={{
                                              width: 12,
                                              height: 12,
                                              color: "#34D399",
                                            }}
                                          />
                                        ) : (
                                          <Copy
                                            style={{ width: 12, height: 12 }}
                                          />
                                        )}
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                          </div>
                        )}

                        {/* 加密附件展示与一键导出 (Attachments) */}
                        {item.attachments && item.attachments.length > 0 && (
                          <div className="card-attachments-box">
                            <div className="card-attachments-header">
                              <Paperclip
                                style={{
                                  width: 12,
                                  height: 12,
                                  color: "#00D4FF",
                                }}
                              />
                              <span>
                                {m("加密附件 (")}
                                {item.attachments.length})
                              </span>
                            </div>
                            {item.attachments.map((att) => (
                              <div
                                key={att.id}
                                className="card-attachment-pill"
                              >
                                <div className="card-attachment-name-group">
                                  <Paperclip
                                    style={{
                                      width: 12,
                                      height: 12,
                                      color: "#38BDF8",
                                      flexShrink: 0,
                                    }}
                                  />
                                  <span
                                    className="card-attachment-name"
                                    title={att.name}
                                  >
                                    {att.name}
                                  </span>
                                  <span className="card-attachment-size">
                                    ({formatAttachmentSize(att.size)})
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleDownloadAttachment(att)}
                                  className="btn-mini-copy"
                                  title={m("下载/导出附件: {0}", att.name)}
                                >
                                  <Download
                                    style={{
                                      width: 12,
                                      height: 12,
                                      color: "#00D4FF",
                                    }}
                                  />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {item.inheritanceInstructions && (
                        <div className="takeover-badge">
                          <Compass
                            style={{ width: 14, height: 14, flexShrink: 0 }}
                          />
                          <span className="detail-inheritance">
                            {m("接管指引:")}
                            {item.inheritanceInstructions}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
            </section>
          </div>
        )}
      </div>
    </main>
  );
};
