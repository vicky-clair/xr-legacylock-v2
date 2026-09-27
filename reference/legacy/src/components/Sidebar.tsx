/**
 * ============================================================================
 * LegacyLock 军规遗产密钥库 — 左侧主导航侧边栏组件 (Sidebar Component)
 * ============================================================================
 * 
 * 功能职责：
 * 1. 密库资产分类树导航：支持按照 12 大维度分类实时过滤右侧资产列表；
 * 2. 动态计数徽标：实时统计并展示每个分类下当前收录的有效凭据数量；
 * 3. 硬件外部设备探查标识：显示当前检测到的外接 USB 驱动器总数；
 * 4. 底部常驻入口：置顶常驻「系统设置与安全控制中心 (Settings)」与「军规导入导出」。
 */

import React from 'react';
import {
  LayoutGrid,
  KeyRound,
  FileText,
  UserCheck,
  CreditCard,
  Lock,
  FileCode,
  Terminal,
  Code2,
  Wallet,
  Server,
  Wifi,
  Mail,
  Award,
  ArrowDownUp,
  Settings,
} from 'lucide-react';
import { NavCategoryType } from '../types';
import { ThemeDefinition } from '../services/themes';
import { useI18n } from '../services/i18n';

/**
 * 侧边栏属性接口
 */
interface SidebarProps {
  /** 当前选中的左侧导航分类 ID */
  selectedNav: NavCategoryType;
  /** 切换导航分类的回调函数 */
  onSelectNav: (nav: NavCategoryType) => void;
  /** 各分类资产总数映射表 Record<category, count> */
  categoryCounts: Record<string, number>;
  /** 资产库总数量 */
  totalCount: number;
  /** 检测到的外部物理介质数量 */
  detectedDrivesCount?: number;
  /** 触发新增资产的回调函数 */
  onAddNew?: () => void;
  /** 当前启用的渐变主题配置 */
  theme?: ThemeDefinition;
}

export const Sidebar: React.FC<SidebarProps> = ({
  selectedNav,
  onSelectNav,
  categoryCounts,
  totalCount,
  theme,
}) => {
  // 准确计算与添加内容完全一致的各分类总计数据
  const loginCount = categoryCounts['login'] || 0;
  const noteCount = categoryCounts['note'] || 0;
  const identityCount =
    (categoryCounts['identity'] || 0) +
    (categoryCounts['passport'] || 0) +
    (categoryCounts['driverLicense'] || 0) +
    (categoryCounts['ssn'] || 0);
  const cardCount = (categoryCounts['card'] || 0) + (categoryCounts['bankAccount'] || 0);
  const passwordCount = categoryCounts['password'] || 0;
  const documentCount =
    (categoryCounts['document'] || 0) +
    (categoryCounts['softwareLicense'] || 0) +
    (categoryCounts['outdoorLicense'] || 0) +
    (categoryCounts['license'] || 0);

  const sshCount = categoryCounts['sshKey'] || 0;
  const apiCount = categoryCounts['apiCredential'] || 0;
  const cryptoCount = categoryCounts['cryptoWallet'] || 0;
  const serverCount = (categoryCounts['server'] || 0) + (categoryCounts['database'] || 0);
  const wifiCount = categoryCounts['router'] || 0;
  const mailCount = categoryCounts['email'] || 0;
  const membershipCount =
    (categoryCounts['membership'] || 0) +
    (categoryCounts['game'] || 0) +
    (categoryCounts['reward'] || 0) +
    (categoryCounts['medical'] || 0);

  const formatBadge = (num: number) => (num > 0 ? num : '--');
  const { t } = useI18n();

  return (
    <aside
      className="app-sidebar"
      style={{
        background: theme?.sidebarStyle.background,
        borderColor: theme?.sidebarStyle.borderColor,
      }}
    >
      {/* 顶部 Logo 与应用名称 */}
      <div className="sidebar-header">
        <div className="sidebar-logo-icon">
          <div className="sidebar-logo-inner">
            <KeyRound style={{ width: 16, height: 16, color: '#00D4FF' }} />
          </div>
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 className="sidebar-brand-title" title={t('brand.title')}>{t('brand.title')}</h1>
          <p className="sidebar-brand-sub" title={t('brand.sub')}>{t('brand.sub')}</p>
        </div>
      </div>

      {/* 导航列表区：分类名称与添加的内容 100% 保持一致，并动态显示真实总计数据 */}
      <div className="sidebar-nav-scroll">
        {/* 分组 1: 核心数字资产 */}
        <div className="sidebar-section">
          <div className="sidebar-section-title">{t('nav.coreGroup')}</div>

          {/* 所有密匙 (总计) */}
          <button
            onClick={() => onSelectNav('all')}
            className={`sidebar-nav-item ${selectedNav === 'all' ? 'active' : ''}`}
          >
            <div className="nav-item-left">
              <LayoutGrid className="nav-item-icon" />
              <span>{t('nav.all')}</span>
            </div>
            <span className="sidebar-nav-badge">
              {totalCount}
            </span>
          </button>

          {/* 登录信息 */}
          <button
            onClick={() => onSelectNav('login')}
            className={`sidebar-nav-item ${selectedNav === 'login' ? 'active' : ''}`}
          >
            <div className="nav-item-left">
              <KeyRound className="nav-item-icon" />
              <span>{t('nav.login')}</span>
            </div>
            <span className="sidebar-nav-badge">{formatBadge(loginCount)}</span>
          </button>

          {/* 安全备注 */}
          <button
            onClick={() => onSelectNav('note')}
            className={`sidebar-nav-item ${selectedNav === 'note' ? 'active' : ''}`}
          >
            <div className="nav-item-left">
              <FileText className="nav-item-icon" />
              <span>{t('nav.note')}</span>
            </div>
            <span className="sidebar-nav-badge">{formatBadge(noteCount)}</span>
          </button>

          {/* 身份标识 */}
          <button
            onClick={() => onSelectNav('identity')}
            className={`sidebar-nav-item ${selectedNav === 'identity' ? 'active' : ''}`}
          >
            <div className="nav-item-left">
              <UserCheck className="nav-item-icon" />
              <span>{t('nav.identity')}</span>
            </div>
            <span className="sidebar-nav-badge">{formatBadge(identityCount)}</span>
          </button>

          {/* 信用卡与银行 */}
          <button
            onClick={() => onSelectNav('card')}
            className={`sidebar-nav-item ${selectedNav === 'card' ? 'active' : ''}`}
          >
            <div className="nav-item-left">
              <CreditCard className="nav-item-icon" />
              <span>{t('nav.card')}</span>
            </div>
            <span className="sidebar-nav-badge">{formatBadge(cardCount)}</span>
          </button>

          {/* 密码 */}
          <button
            onClick={() => onSelectNav('password')}
            className={`sidebar-nav-item ${selectedNav === 'password' ? 'active' : ''}`}
          >
            <div className="nav-item-left">
              <Lock className="nav-item-icon" />
              <span>{t('nav.password')}</span>
            </div>
            <span className="sidebar-nav-badge">{formatBadge(passwordCount)}</span>
          </button>

          {/* 文档 */}
          <button
            onClick={() => onSelectNav('document')}
            className={`sidebar-nav-item ${selectedNav === 'document' ? 'active' : ''}`}
          >
            <div className="nav-item-left">
              <FileCode className="nav-item-icon" />
              <span>{t('nav.document')}</span>
            </div>
            <span className="sidebar-nav-badge">{formatBadge(documentCount)}</span>
          </button>
        </div>

        {/* 分组 2: 凭据与网络开发 */}
        <div className="sidebar-section">
          <div className="sidebar-section-title">{t('nav.devGroup')}</div>

          {/* SSH 密钥 */}
          <button
            onClick={() => onSelectNav('sshKey')}
            className={`sidebar-nav-item ${selectedNav === 'sshKey' ? 'active' : ''}`}
          >
            <div className="nav-item-left">
              <Terminal className="nav-item-icon" />
              <span>{t('nav.sshKey')}</span>
            </div>
            <span className="sidebar-nav-badge">{formatBadge(sshCount)}</span>
          </button>

          {/* API 凭据 */}
          <button
            onClick={() => onSelectNav('apiCredential')}
            className={`sidebar-nav-item ${selectedNav === 'apiCredential' ? 'active' : ''}`}
          >
            <div className="nav-item-left">
              <Code2 className="nav-item-icon" />
              <span>{t('nav.apiCredential')}</span>
            </div>
            <span className="sidebar-nav-badge">{formatBadge(apiCount)}</span>
          </button>

          {/* 加密钱包 */}
          <button
            onClick={() => onSelectNav('cryptoWallet')}
            className={`sidebar-nav-item ${selectedNav === 'cryptoWallet' ? 'active' : ''}`}
          >
            <div className="nav-item-left">
              <Wallet className="nav-item-icon" />
              <span>{t('nav.cryptoWallet')}</span>
            </div>
            <span className="sidebar-nav-badge">{formatBadge(cryptoCount)}</span>
          </button>

          {/* 服务器与数据库 */}
          <button
            onClick={() => onSelectNav('server')}
            className={`sidebar-nav-item ${selectedNav === 'server' ? 'active' : ''}`}
          >
            <div className="nav-item-left">
              <Server className="nav-item-icon" />
              <span>{t('nav.server')}</span>
            </div>
            <span className="sidebar-nav-badge">{formatBadge(serverCount)}</span>
          </button>

          {/* 无线网络 */}
          <button
            onClick={() => onSelectNav('router')}
            className={`sidebar-nav-item ${selectedNav === 'router' ? 'active' : ''}`}
          >
            <div className="nav-item-left">
              <Wifi className="nav-item-icon" />
              <span>{t('nav.router')}</span>
            </div>
            <span className="sidebar-nav-badge">{formatBadge(wifiCount)}</span>
          </button>

          {/* 电子邮件 */}
          <button
            onClick={() => onSelectNav('email')}
            className={`sidebar-nav-item ${selectedNav === 'email' ? 'active' : ''}`}
          >
            <div className="nav-item-left">
              <Mail className="nav-item-icon" />
              <span>{t('nav.email')}</span>
            </div>
            <span className="sidebar-nav-badge">{formatBadge(mailCount)}</span>
          </button>

          {/* 会员与数字资产 */}
          <button
            onClick={() => onSelectNav('membership')}
            className={`sidebar-nav-item ${selectedNav === 'membership' ? 'active' : ''}`}
          >
            <div className="nav-item-left">
              <Award className="nav-item-icon" />
              <span>{t('nav.membership')}</span>
            </div>
            <span className="sidebar-nav-badge">{formatBadge(membershipCount)}</span>
          </button>
        </div>

        {/* 存储与备份 (左侧加密导入导出模块) */}
        <div className="sidebar-section">
          <div className="sidebar-section-title">{t('nav.personalGroup')}</div>
          <button
            onClick={() => onSelectNav('import_export')}
            className={`sidebar-nav-item ${selectedNav === 'import_export' ? 'active' : ''}`}
          >
            <div className="nav-item-left">
              <ArrowDownUp
                className="nav-item-icon"
                style={{ color: selectedNav === 'import_export' ? '#00D4FF' : '#38BDF8' }}
              />
              <span>{t('nav.importExport')}</span>
            </div>
            <span
              className="sidebar-nav-badge"
              style={{
                background: selectedNav === 'import_export' ? '#00D4FF' : 'rgba(0, 212, 255, 0.15)',
                color: selectedNav === 'import_export' ? '#040B1C' : '#38E1FF',
                fontWeight: 700,
              }}
            >
              AES
            </span>
          </button>
        </div>
      </div>

      {/* 底部系统设置按钮 */}
      <div className="sidebar-footer">
        <button
          onClick={() => onSelectNav('settings')}
          className={`sidebar-settings-btn ${selectedNav === 'settings' ? 'active' : ''}`}
          title={t('nav.settings')}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Settings className="settings-btn-icon" style={{ width: 17, height: 17 }} />
            <span style={{ fontWeight: 600, fontSize: 13 }}>{t('nav.settings')}</span>
          </div>
          <span className="settings-version-tag">LVCF 3</span>
        </button>
      </div>
    </aside>
  );
};
