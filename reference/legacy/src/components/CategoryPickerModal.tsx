/**
 * ============================================================================
 * LegacyLock 军规遗产密钥库 — 资产分类选择弹窗组件 (CategoryPickerModal)
 * ============================================================================
 *
 * 界面交互设计 (Human-Centric & Modern Glassmorphism Redesign)：
 * 1. 响应「+ 添加新资产 / 密钥」或主界面行动按钮，唤起结构化资产分类选择面板；
 * 2. 宽幅 720px 奢华军规暗黑毛玻璃容器，告别拥挤局促，层级清晰舒适；
 * 3. 顶部提供实时模糊检索（支持中文名、英文名、用途描述及专属字段关键词），并配备清空快捷键；
 * 4. 提供人性化分类切换药丸导航标签 (全部、⭐ 常用推荐、💻 技术运维、💰 财务资产、🪪 证照生活)；
 * 5. 采用双列现代交互式卡片，提供图标光环、中英文双模标签、通俗用途描述及专属字段预览标签；
 * 6. 支持键盘 ESC 快速退出，点击卡片即刻加载对应结构化资产模板并唤起录入弹窗。
 */

import React, { useState, useEffect, useMemo, useRef } from "react";
import { m } from "../services/messages";
import {
  X,
  Search,
  ArrowRight,
  ShieldCheck,
  FolderOpen,
  Sparkles,
} from "lucide-react";
import { VaultCategory } from "../types";
import { CATEGORIES, CategoryDefinition } from "../services/categories";
import { useI18n } from "../services/i18n";

/**
 * 分类选择弹窗属性接口
 */
interface CategoryPickerModalProps {
  /** 弹窗显隐受控状态 */
  isOpen: boolean;
  /** 关闭弹窗回调 */
  onClose: () => void;
  /** 选中分类后的触发回调 */
  onSelectCategory: (category: VaultCategory) => void;
}

/**
 * 人性化资产分组定义
 */
interface CategoryGroup {
  id: string;
  name: string;
  badge: string;
  categoryIds: VaultCategory[];
  description: string;
}

export const CategoryPickerModal: React.FC<CategoryPickerModalProps> = ({
  isOpen,
  onClose,
  onSelectCategory,
}) => {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<string>("popular");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (isOpen && !dialogRef.current?.open) dialogRef.current?.showModal();
  }, [isOpen]);

  const categoryGroups: CategoryGroup[] = useMemo(
    () => [
      {
        id: "popular",
        name: t("categoryPicker.popularTab"),
        badge: t("categoryPicker.popularTab"),
        categoryIds: [
          "login",
          "note",
          "card",
          "identity",
          "password",
          "document",
        ],
        description: t("categories.login.desc"),
      },
      {
        id: "tech",
        name: t("categoryPicker.techTab"),
        badge: t("categoryPicker.techTab"),
        categoryIds: [
          "sshKey",
          "apiCredential",
          "server",
          "database",
          "router",
          "softwareLicense",
          "email",
        ],
        description: t("categories.sshKey.desc"),
      },
      {
        id: "finance",
        name: t("categoryPicker.financeTab"),
        badge: t("categoryPicker.financeTab"),
        categoryIds: ["cryptoWallet", "bankAccount", "membership", "reward"],
        description: t("categories.cryptoWallet.desc"),
      },
      {
        id: "docs",
        name: t("categoryPicker.docsTab"),
        badge: t("categoryPicker.docsTab"),
        categoryIds: [
          "passport",
          "driverLicense",
          "ssn",
          "medical",
          "outdoorLicense",
          "game",
        ],
        description: t("categories.identity.desc"),
      },
    ],
    [t],
  );

  // 监听 ESC 键关闭
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // 打开弹窗时重置并聚焦搜索框
  useEffect(() => {
    if (isOpen) {
      setSearch("");
      setActiveTab("popular");
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 80);
    }
  }, [isOpen]);

  // 建立 ID 到定义对象的快速映射
  const categoryMap = useMemo(() => {
    const map = new Map<VaultCategory, CategoryDefinition>();
    CATEGORIES.forEach((cat) => map.set(cat.id, cat));
    return map;
  }, []);

  // 搜索过滤计算
  const filteredCategories = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      if (activeTab === "all") {
        return CATEGORIES;
      }
      const group = categoryGroups.find((g) => g.id === activeTab);
      if (!group) return CATEGORIES;
      return group.categoryIds
        .map((id) => categoryMap.get(id))
        .filter(Boolean) as CategoryDefinition[];
    }

    return CATEGORIES.filter((cat) => {
      const localizedName = t(`categories.${cat.id}.name`) || cat.name;
      const localizedDesc = t(`categories.${cat.id}.desc`) || cat.description;
      const matchName =
        localizedName.toLowerCase().includes(q) ||
        cat.name.toLowerCase().includes(q);
      const matchEng = cat.englishName.toLowerCase().includes(q);
      const matchDesc =
        localizedDesc.toLowerCase().includes(q) ||
        cat.description.toLowerCase().includes(q);
      const matchFields = cat.defaultFields?.some((f) =>
        f.name.toLowerCase().includes(q),
      );
      return matchName || matchEng || matchDesc || matchFields;
    });
  }, [search, activeTab, categoryMap, categoryGroups, t]);

  // 统计每个分组的数量
  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = { all: CATEGORIES.length };
    categoryGroups.forEach((g) => {
      counts[g.id] = g.categoryIds.length;
    });
    return counts;
  }, [categoryGroups]);

  if (!isOpen) return null;

  const isSearching = !!search.trim();

  return (
    <dialog
      ref={dialogRef}
      className="restored-dialog restored-category-dialog"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-labelledby="cat-picker-title"
    >
      <div
        className="cat-modern-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cat-picker-title"
      >
        {/* Top Header */}
        <div className="cat-modern-header">
          <div className="cat-header-top-row">
            <div className="cat-title-cluster">
              <div className="cat-header-icon-badge">
                <Sparkles className="w-5 h-5 text-[#00D4FF]" />
              </div>
              <div>
                <h2 id="cat-picker-title" className="cat-header-title">
                  {t("categoryPicker.title")}
                </h2>
                <p className="cat-header-subtitle">
                  {t("categoryPicker.subtitle")}
                </p>
              </div>
            </div>

            <button
              className="cat-modern-close-btn"
              onClick={onClose}
              title="ESC"
              aria-label="Close"
            >
              <span className="cat-close-kbd">ESC</span>
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Search Bar */}
          <div className="cat-modern-search-wrapper">
            <div className="cat-modern-search-box">
              <Search className="w-4 h-4 text-[#7E92C4] flex-shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("categoryPicker.searchPlaceholder")}
                className="cat-modern-search-input"
              />
              {search && (
                <button
                  type="button"
                  className="cat-search-clear-btn"
                  onClick={() => {
                    setSearch("");
                    searchInputRef.current?.focus();
                  }}
                  title="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Segmented Category Filter Tabs (Visible when not searching) */}
          {!isSearching ? (
            <div className="cat-tab-pills-bar">
              <button
                type="button"
                className={`cat-tab-pill ${activeTab === "all" ? "active" : ""}`}
                onClick={() => setActiveTab("all")}
              >
                <span>{t("categoryPicker.allAssets")}</span>
                <span className="cat-tab-badge">{groupCounts.all}</span>
              </button>
              {categoryGroups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  className={`cat-tab-pill ${activeTab === group.id ? "active" : ""}`}
                  onClick={() => setActiveTab(group.id)}
                >
                  <span>{group.name}</span>
                  <span className="cat-tab-badge">{groupCounts[group.id]}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="cat-search-status-bar">
              <span>
                {t("categoryPicker.searchFoundPrefix")}
                <strong className="text-[#00D4FF]">{search}</strong>
                {t("categoryPicker.searchFoundSuffix")}:{" "}
                <strong className="text-white">
                  {filteredCategories.length}
                </strong>
              </span>
              <button
                type="button"
                className="cat-reset-search-link"
                onClick={() => setSearch("")}
              >
                {t("categoryPicker.returnAll")}
              </button>
            </div>
          )}
        </div>

        {/* Scrollable Categories Body */}
        <div className="cat-modern-body">
          {filteredCategories.length === 0 ? (
            <div className="cat-empty-search-state">
              <div className="cat-empty-icon-circle">
                <FolderOpen className="w-8 h-8 text-[#7E92C4]" />
              </div>
              <h3 className="cat-empty-title">
                {t("categoryPicker.emptyTitle")}
              </h3>
              <p className="cat-empty-desc">{t("categoryPicker.emptyDesc")}</p>
              <button
                type="button"
                className="cat-empty-reset-btn"
                onClick={() => {
                  setSearch("");
                  setActiveTab("all");
                  searchInputRef.current?.focus();
                }}
              >
                {t("categoryPicker.resetBtn")}
              </button>
            </div>
          ) : !isSearching && activeTab === "all" ? (
            // 全部模式：按人性化分组渲染优雅的区块，避免一盘散沙
            <div className="cat-grouped-sections">
              {categoryGroups.map((group) => {
                const itemsInGroup = group.categoryIds
                  .map((id) => categoryMap.get(id))
                  .filter(Boolean) as CategoryDefinition[];

                return (
                  <div key={group.id} className="cat-group-section">
                    <div className="cat-group-section-header">
                      <div className="cat-group-tag">{group.badge}</div>
                      <span className="cat-group-desc">
                        {group.description}
                      </span>
                    </div>

                    <div className="cat-cards-grid">
                      {itemsInGroup.map((cat) => (
                        <CategoryCard
                          key={cat.id}
                          cat={cat}
                          onSelect={() => {
                            onSelectCategory(cat.id);
                            onClose();
                          }}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            // 筛选或搜索结果网格
            <div className="cat-cards-grid">
              {filteredCategories.map((cat) => (
                <CategoryCard
                  key={cat.id}
                  cat={cat}
                  onSelect={() => {
                    onSelectCategory(cat.id);
                    onClose();
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Modern Ergonomic Footer */}
        <div className="cat-modern-footer">
          <div className="cat-footer-info">
            <ShieldCheck className="w-4 h-4 text-[#00D4FF] flex-shrink-0" />
            <span className="cat-footer-tip">
              {m("先选择类型，再填写内容；只有标题必填。")}
            </span>
          </div>
          <button
            type="button"
            className="cat-footer-cancel-btn"
            onClick={onClose}
          >
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </dialog>
  );
};

/**
 * 单个资产卡片组件 (双列交互卡片)
 */
interface CategoryCardProps {
  cat: CategoryDefinition;
  onSelect: () => void;
}

const CategoryCard: React.FC<CategoryCardProps> = ({ cat, onSelect }) => {
  const { t, language } = useI18n();
  const Icon = cat.icon;
  const displayName = t(`categories.${cat.id}.name`) || cat.name;
  const displayDesc = t(`categories.${cat.id}.desc`) || cat.description;

  return (
    <div
      className="cat-rich-card"
      onClick={onSelect}
      style={
        {
          "--cat-accent": cat.color,
          "--cat-accent-bg": cat.bgColor,
        } as React.CSSProperties
      }
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      {/* Visual Icon Badge */}
      <div
        className="cat-card-icon-container"
        style={{
          background: cat.bgColor,
          borderColor: `${cat.color}40`,
        }}
      >
        <Icon className="w-5 h-5" />
      </div>

      {/* Card Content */}
      <div className="cat-card-content">
        <div className="cat-card-header-row">
          <div className="cat-card-title-wrap">
            <span className="cat-card-name">{displayName}</span>
            {language !== "en" && (
              <span className="cat-card-english-badge">{cat.englishName}</span>
            )}
          </div>
          <div className="cat-card-arrow-box">
            <ArrowRight className="w-3.5 h-3.5 cat-card-arrow" />
          </div>
        </div>

        <p className="cat-card-description" title={displayDesc}>
          {displayDesc}
        </p>

        {/* Preset field preview tags */}
        {cat.defaultFields && cat.defaultFields.length > 0 && (
          <div className="cat-card-field-tags">
            {cat.defaultFields.slice(0, 2).map((field, idx) => (
              <span key={idx} className="cat-field-tag">
                {field.name}
              </span>
            ))}
            {cat.defaultFields.length > 2 && (
              <span className="cat-field-tag cat-field-tag-more">
                +{cat.defaultFields.length - 2}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
