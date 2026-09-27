/**
 * ============================================================================
 * LegacyLock 军规遗产密钥库 — 视觉主题与渐变调色板规范 (Theme System)
 * ============================================================================
 * 
 * 设计理念：
 * 1. 采用高对比度、深色模式军规审美，提供 5 款深邃典雅的渐变色系；
 * 2. 主题偏好支持联动操作系统本地配置文件与 localStorage，实现跨重启 100% 持久化；
 * 3. 实时响应式注入 document.documentElement.style.background，避免页面重载闪白。
 */

/**
 * 主题配置接口规范
 */
export interface ThemeDefinition {
  /** 主题唯一键名 */
  id: string;
  /** 中文展示名称 */
  name: string;
  /** 英文标识名称 */
  englishName: string;
  /** 预览气泡色阶渐变 CSS */
  previewGradient: string;
  /** 主强调高亮色 (用于按钮、边框光晕、标签) */
  primaryAccent: string;
  /** 侧边导航栏专属色彩配置 */
  sidebarStyle: {
    background: string;
    borderColor: string;
  };
  /** 主内容区色彩配置 */
  mainStyle: {
    background: string;
    topbarBg: string;
    cardBg: string;
    cardHoverBorder: string;
    activeNavBg: string;
  };
}

/**
 * 全局预设的 5 套军规渐变配色方案
 */
export const THEMES: ThemeDefinition[] = [
  {
    id: 'royal_violet',
    name: '幻紫星雲 (默認)',
    englishName: 'Royal Indigo',
    previewGradient: 'linear-gradient(135deg, #181D5E, #2E1D66)',
    primaryAccent: '#00D4FF',
    sidebarStyle: {
      background: 'linear-gradient(180deg, rgba(20, 26, 76, 0.95), rgba(16, 20, 60, 0.98))',
      borderColor: 'rgba(255, 255, 255, 0.08)',
    },
    mainStyle: {
      background: 'linear-gradient(135deg, #181D5E 0%, #202068 50%, #2E1D66 100%)',
      topbarBg: 'rgba(18, 22, 74, 0.75)',
      cardBg: 'rgba(22, 29, 82, 0.85)',
      cardHoverBorder: 'rgba(0, 212, 255, 0.4)',
      activeNavBg: '#253075',
    },
  },
  {
    id: 'cyber_cyan',
    name: '極光深空',
    englishName: 'Midnight Aurora',
    previewGradient: 'linear-gradient(135deg, #071C2B, #0A393E)',
    primaryAccent: '#00F0FF',
    sidebarStyle: {
      background: 'linear-gradient(180deg, rgba(7, 26, 38, 0.95), rgba(5, 18, 28, 0.98))',
      borderColor: 'rgba(0, 240, 255, 0.12)',
    },
    mainStyle: {
      background: 'linear-gradient(135deg, #071C2B 0%, #0A2E35 50%, #083D3A 100%)',
      topbarBg: 'rgba(6, 22, 32, 0.75)',
      cardBg: 'rgba(10, 36, 44, 0.85)',
      cardHoverBorder: 'rgba(0, 240, 255, 0.5)',
      activeNavBg: '#0E444B',
    },
  },
  {
    id: 'obsidian_gold',
    name: '黑曜玄金',
    englishName: 'Obsidian Gold',
    previewGradient: 'linear-gradient(135deg, #16171C, #2E2512)',
    primaryAccent: '#F59E0B',
    sidebarStyle: {
      background: 'linear-gradient(180deg, rgba(20, 21, 26, 0.95), rgba(14, 15, 18, 0.98))',
      borderColor: 'rgba(245, 158, 11, 0.15)',
    },
    mainStyle: {
      background: 'linear-gradient(135deg, #14151B 0%, #1F1E24 50%, #2A2312 100%)',
      topbarBg: 'rgba(18, 19, 24, 0.8)',
      cardBg: 'rgba(28, 29, 36, 0.85)',
      cardHoverBorder: 'rgba(245, 158, 11, 0.45)',
      activeNavBg: '#38321D',
    },
  },
  {
    id: 'electric_magenta',
    name: '賽博霓虹',
    englishName: 'Electric Magenta',
    previewGradient: 'linear-gradient(135deg, #180D33, #3E1045)',
    primaryAccent: '#F43F5E',
    sidebarStyle: {
      background: 'linear-gradient(180deg, rgba(22, 12, 44, 0.95), rgba(15, 8, 30, 0.98))',
      borderColor: 'rgba(244, 63, 94, 0.15)',
    },
    mainStyle: {
      background: 'linear-gradient(135deg, #180D33 0%, #291147 50%, #3E1045 100%)',
      topbarBg: 'rgba(20, 10, 38, 0.75)',
      cardBg: 'rgba(36, 17, 60, 0.85)',
      cardHoverBorder: 'rgba(244, 63, 94, 0.45)',
      activeNavBg: '#441656',
    },
  },
  {
    id: 'abyssal_navy',
    name: '深海潛航',
    englishName: 'Abyssal Navy',
    previewGradient: 'linear-gradient(135deg, #091326, #122852)',
    primaryAccent: '#38BDF8',
    sidebarStyle: {
      background: 'linear-gradient(180deg, rgba(9, 18, 36, 0.95), rgba(6, 12, 26, 0.98))',
      borderColor: 'rgba(56, 189, 248, 0.12)',
    },
    mainStyle: {
      background: 'linear-gradient(135deg, #091326 0%, #0F2042 50%, #132D5E 100%)',
      topbarBg: 'rgba(8, 16, 32, 0.75)',
      cardBg: 'rgba(16, 32, 64, 0.85)',
      cardHoverBorder: 'rgba(56, 189, 248, 0.45)',
      activeNavBg: '#18386E',
    },
  },
];

/** 默认主题 ID */
export const DEFAULT_THEME_ID = 'royal_violet';

/**
 * 根据主题 ID 查找匹配的主题定义对象
 * 若未匹配到，则回退降级为第一套默认主题
 * 
 * @param id 主题标识符
 * @returns {ThemeDefinition} 主题样式完整配置
 */
export function getTheme(id: string): ThemeDefinition {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}
