/**
 * ============================================================================
 * LegacyLock 军规遗产密钥库 — 资产分类语义字典与图标映射 (Categories Registry)
 * ============================================================================
 * 
 * 功能职责：
 * 1. 完整定义 12+ 大资产维度的中文语义、英文标识、主题强调色、透光背景与 Lucide 图标；
 * 2. 区分顶部常用大卡片 (Primary Cards) 与全部结构化分类，支持分类选择弹窗渲染；
 * 3. 为每种资产分类预置专属的数据字段模板 (defaultFields)，极大简化用户输入流程。
 */

import React from 'react';
import {
  KeyRound,
  FileText,
  CreditCard,
  UserCheck,
  Lock,
  FileCode,
  Terminal,
  Code2,
  BadgePercent,
  Wallet,
  HeartPulse,
  Gift,
  Compass,
  Globe2,
  Database,
  Wifi,
  Server,
  Mail,
  ShieldAlert,
  Award,
  CircleDollarSign,
  Car,
  Gamepad2,
} from 'lucide-react';
import { VaultCategory } from '../types';

/**
 * 资产分类定义接口
 */
export interface CategoryDefinition {
  /** 分类唯一 ID */
  id: VaultCategory;
  /** 中文标准显示名称 */
  name: string;
  /** 英文对照名称 */
  englishName: string;
  /** 分类详细用途说明 */
  description: string;
  /** 是否属于顶部置顶大卡片 (用于弹窗优先展示) */
  isPrimary: boolean;
  /** 分类代表高亮主题色 (Hex) */
  color: string;
  /** 分类图标半透明背景色 (rgba) */
  bgColor: string;
  /** 专属 Lucide 图标组件渲染函数 */
  icon: React.FC<{ className?: string }>;
  /** 初始预设字段模板列表 (名称、是否保密掩码、默认取值) */
  defaultFields?: Array<{ name: string; isSecret: boolean; defaultValue?: string }>;
}

export const CATEGORIES: CategoryDefinition[] = [
  // 顶部 6 个核心大卡片 (Primary Cards)
  {
    id: 'login',
    name: '登录信息',
    englishName: 'Login',
    description: '网站、在线服务及应用程序的登录凭据',
    isPrimary: true,
    color: '#00D4FF',
    bgColor: 'rgba(0, 212, 255, 0.15)',
    icon: ({ className }) => <KeyRound className={className || 'w-6 h-6 text-[#00D4FF]'} />,
    defaultFields: [
      { name: '一次性密码 (2FA)', isSecret: true },
      { name: '密码提示问题', isSecret: false },
    ],
  },
  {
    id: 'note',
    name: '安全备注',
    englishName: 'Secure Note',
    description: '加密便签、遗嘱说明、保险柜口令与私密笔记',
    isPrimary: true,
    color: '#F59E0B',
    bgColor: 'rgba(245, 158, 11, 0.15)',
    icon: ({ className }) => <FileText className={className || 'w-6 h-6 text-[#F59E0B]'} />,
    defaultFields: [
      { name: '紧急处理指引', isSecret: false },
      { name: '物理保管地点', isSecret: false },
    ],
  },
  {
    id: 'card',
    name: '信用卡',
    englishName: 'Credit Card',
    description: '维萨、万事达、银联卡及境外银行卡凭据',
    isPrimary: true,
    color: '#38BDF8',
    bgColor: 'rgba(56, 189, 248, 0.15)',
    icon: ({ className }) => <CreditCard className={className || 'w-6 h-6 text-[#38BDF8]'} />,
    defaultFields: [
      { name: '持卡人姓名', isSecret: false },
      { name: '卡号', isSecret: false },
      { name: '有效期 (MM/YY)', isSecret: false },
      { name: '安全码 (CVV/CVC)', isSecret: true },
      { name: '取款 PIN 码', isSecret: true },
      { name: '发卡行', isSecret: false },
    ],
  },
  {
    id: 'identity',
    name: '身份标识',
    englishName: 'Identity',
    description: '居民身份证、家庭成员档案及个人法定身份',
    isPrimary: true,
    color: '#10B981',
    bgColor: 'rgba(16, 185, 129, 0.15)',
    icon: ({ className }) => <UserCheck className={className || 'w-6 h-6 text-[#10B981]'} />,
    defaultFields: [
      { name: '姓名', isSecret: false },
      { name: '身份证号码', isSecret: false },
      { name: '出生日期', isSecret: false },
      { name: '签发机关', isSecret: false },
      { name: '户籍常住地址', isSecret: false },
    ],
  },
  {
    id: 'password',
    name: '密码',
    englishName: 'Password',
    description: '独立的设备锁屏口令、PIN 码与固件密码',
    isPrimary: true,
    color: '#06B6D4',
    bgColor: 'rgba(6, 182, 212, 0.15)',
    icon: ({ className }) => <Lock className={className || 'w-6 h-6 text-[#06B6D4]'} />,
    defaultFields: [
      { name: '适用设备 / 场景', isSecret: false },
      { name: '备用解锁 PIN', isSecret: true },
    ],
  },
  {
    id: 'document',
    name: '文档',
    englishName: 'Document',
    description: '房产证、信托协议、合同公证等加密扫描件与索引',
    isPrimary: true,
    color: '#60A5FA',
    bgColor: 'rgba(96, 165, 250, 0.15)',
    icon: ({ className }) => <FileCode className={className || 'w-6 h-6 text-[#60A5FA]'} />,
    defaultFields: [
      { name: '文档公证编号', isSecret: false },
      { name: '签署生效日期', isSecret: false },
      { name: '原始文件存放处', isSecret: false },
    ],
  },

  // 下方 16 个次级模板 (Secondary List)
  {
    id: 'sshKey',
    name: 'SSH 密钥',
    englishName: 'SSH Key',
    description: 'RSA / Ed25519 服务器与代码仓库运维私钥',
    isPrimary: false,
    color: '#E2E8F0',
    bgColor: 'rgba(226, 232, 240, 0.12)',
    icon: ({ className }) => <Terminal className={className || 'w-4 h-4 text-[#FACC15]'} />,
    defaultFields: [
      { name: '私钥 (Private Key)', isSecret: true },
      { name: '公钥 (Public Key)', isSecret: false },
      { name: '密钥保护密码 (Passphrase)', isSecret: true },
      { name: '指纹 (Fingerprint)', isSecret: false },
    ],
  },
  {
    id: 'apiCredential',
    name: 'API 凭据',
    englishName: 'API Credential',
    description: '云服务、AI 平台与开发者接口 API Key',
    isPrimary: false,
    color: '#2DD4BF',
    bgColor: 'rgba(45, 212, 191, 0.12)',
    icon: ({ className }) => <Code2 className={className || 'w-4 h-4 text-[#2DD4BF]'} />,
    defaultFields: [
      { name: 'API Key', isSecret: false },
      { name: 'API Secret / Token', isSecret: true },
      { name: '接口端点 (Endpoint URL)', isSecret: false },
      { name: '权限有效期', isSecret: false },
    ],
  },
  {
    id: 'membership',
    name: '会员信息',
    englishName: 'Membership',
    description: '私人会所、高尔夫、商旅贵宾及俱乐部卡号',
    isPrimary: false,
    color: '#C084FC',
    bgColor: 'rgba(192, 132, 252, 0.12)',
    icon: ({ className }) => <BadgePercent className={className || 'w-4 h-4 text-[#C084FC]'} />,
    defaultFields: [
      { name: '会员卡号 / ID', isSecret: false },
      { name: '会员等级', isSecret: false },
      { name: '绑定手机号', isSecret: false },
      { name: '会员专属 PIN', isSecret: true },
    ],
  },
  {
    id: 'cryptoWallet',
    name: '加密钱包',
    englishName: 'Crypto Wallet',
    description: '比特币、以太坊等区块链硬件钱包与助记词',
    isPrimary: false,
    color: '#F472B6',
    bgColor: 'rgba(244, 114, 182, 0.12)',
    icon: ({ className }) => <Wallet className={className || 'w-4 h-4 text-[#F472B6]'} />,
    defaultFields: [
      { name: '12/24 位助记词 (Seed Phrase)', isSecret: true },
      { name: '主公钥地址 (Public Address)', isSecret: false },
      { name: '私钥 (Private Key)', isSecret: true },
      { name: '所属主链网络', isSecret: false },
    ],
  },
  {
    id: 'medical',
    name: '医疗记录',
    englishName: 'Medical Record',
    description: '重大病历档案、血型、慢性用药与紧急就医档案',
    isPrimary: false,
    color: '#FB7185',
    bgColor: 'rgba(251, 113, 133, 0.12)',
    icon: ({ className }) => <HeartPulse className={className || 'w-4 h-4 text-[#FB7185]'} />,
    defaultFields: [
      { name: '血型与特殊体质', isSecret: false },
      { name: '药物过敏史', isSecret: false },
      { name: '主治医生与就诊医院', isSecret: false },
      { name: '医保档案号', isSecret: false },
    ],
  },
  {
    id: 'reward',
    name: '奖励',
    englishName: 'Reward',
    description: '航空里程常旅客卡、酒店忠诚度积分及礼品卡',
    isPrimary: false,
    color: '#F43F5E',
    bgColor: 'rgba(244, 63, 94, 0.12)',
    icon: ({ className }) => <Gift className={className || 'w-4 h-4 text-[#F43F5E]'} />,
    defaultFields: [
      { name: '积分计划名称', isSecret: false },
      { name: '会员卡号', isSecret: false },
      { name: '当前积分余额估算', isSecret: false },
      { name: '兑换授权 PIN 码', isSecret: true },
    ],
  },
  {
    id: 'outdoorLicense',
    name: '户外许可证',
    englishName: 'Outdoor License',
    description: '野外探险、露营、航海及特种户外执照',
    isPrimary: false,
    color: '#4ADE80',
    bgColor: 'rgba(74, 222, 128, 0.12)',
    icon: ({ className }) => <Compass className={className || 'w-4 h-4 text-[#4ADE80]'} />,
    defaultFields: [
      { name: '许可证编号', isSecret: false },
      { name: '签发行政区划', isSecret: false },
      { name: '有效期至', isSecret: false },
      { name: '救援无线电呼号', isSecret: false },
    ],
  },
  {
    id: 'passport',
    name: '护照',
    englishName: 'Passport',
    description: '因私护照、签证信息及跨境出行档案',
    isPrimary: false,
    color: '#38BDF8',
    bgColor: 'rgba(56, 189, 248, 0.12)',
    icon: ({ className }) => <Globe2 className={className || 'w-4 h-4 text-[#38BDF8]'} />,
    defaultFields: [
      { name: '英文姓名全拼', isSecret: false },
      { name: '护照号码', isSecret: false },
      { name: '国籍 / 签发国', isSecret: false },
      { name: '签发日期', isSecret: false },
      { name: '到期日期', isSecret: false },
    ],
  },
  {
    id: 'database',
    name: '数据库',
    englishName: 'Database',
    description: 'MySQL / PostgreSQL / Oracle / Redis 生产数据库',
    isPrimary: false,
    color: '#34D399',
    bgColor: 'rgba(52, 211, 153, 0.12)',
    icon: ({ className }) => <Database className={className || 'w-4 h-4 text-[#34D399]'} />,
    defaultFields: [
      { name: '数据库类型', isSecret: false, defaultValue: 'PostgreSQL' },
      { name: '主机名 / IP', isSecret: false },
      { name: '端口', isSecret: false, defaultValue: '5432' },
      { name: '数据库名称', isSecret: false },
      { name: '连接字符串 (Connection URI)', isSecret: true },
    ],
  },
  {
    id: 'router',
    name: '无线路由器',
    englishName: 'Wireless Router',
    description: '家庭主路由器、WiFi 网络与网络存储 NAS 设置',
    isPrimary: false,
    color: '#38BDF8',
    bgColor: 'rgba(56, 189, 248, 0.12)',
    icon: ({ className }) => <Wifi className={className || 'w-4 h-4 text-[#38BDF8]'} />,
    defaultFields: [
      { name: '无线网络名称 (SSID)', isSecret: false },
      { name: 'WiFi 连接密码', isSecret: true },
      { name: '后台管理地址', isSecret: false, defaultValue: '192.168.1.1' },
      { name: '管理账号', isSecret: false, defaultValue: 'admin' },
      { name: '管理密码', isSecret: true },
    ],
  },
  {
    id: 'server',
    name: '服务器',
    englishName: 'Server',
    description: '物理机房服务器、云主机 VPS 与内网机架节点',
    isPrimary: false,
    color: '#93C5FD',
    bgColor: 'rgba(147, 197, 253, 0.12)',
    icon: ({ className }) => <Server className={className || 'w-4 h-4 text-[#93C5FD]'} />,
    defaultFields: [
      { name: '公网 IP / 域名', isSecret: false },
      { name: 'SSH 端口', isSecret: false, defaultValue: '22' },
      { name: '管理账号 (Root)', isSecret: false, defaultValue: 'root' },
      { name: 'Root 登录口令', isSecret: true },
      { name: 'IPMI / 远程控制卡地址', isSecret: false },
    ],
  },
  {
    id: 'email',
    name: '电子邮件',
    englishName: 'Email Account',
    description: '独立域名企业邮局、Gmail、ProtonMail 邮箱',
    isPrimary: false,
    color: '#F43F5E',
    bgColor: 'rgba(244, 63, 94, 0.12)',
    icon: ({ className }) => <Mail className={className || 'w-4 h-4 text-[#F43F5E]'} />,
    defaultFields: [
      { name: '邮箱地址', isSecret: false },
      { name: '邮箱密码', isSecret: true },
      { name: 'IMAP 收件服务器', isSecret: false },
      { name: 'SMTP 发信服务器', isSecret: false },
    ],
  },
  {
    id: 'ssn',
    name: '社会保险号码',
    englishName: 'Social Security',
    description: '社会保障号、公积金账户与商业养老信托卡',
    isPrimary: false,
    color: '#60A5FA',
    bgColor: 'rgba(96, 165, 250, 0.12)',
    icon: ({ className }) => <ShieldAlert className={className || 'w-4 h-4 text-[#60A5FA]'} />,
    defaultFields: [
      { name: '社保号 / 参保登记号', isSecret: false },
      { name: '参保属地', isSecret: false },
      { name: '公积金查询账号', isSecret: false },
      { name: '网上查询口令', isSecret: true },
    ],
  },
  {
    id: 'softwareLicense',
    name: '软件许可',
    englishName: 'Software License',
    description: '生产力软件永久授权、序列号与开发者激活码',
    isPrimary: false,
    color: '#3B82F6',
    bgColor: 'rgba(59, 130, 246, 0.12)',
    icon: ({ className }) => <Award className={className || 'w-4 h-4 text-[#3B82F6]'} />,
    defaultFields: [
      { name: '许可证密钥 / 序列号', isSecret: false },
      { name: '注册邮箱 / 用户名', isSecret: false },
      { name: '授权席位数量', isSecret: false },
      { name: '版本号', isSecret: false },
    ],
  },
  {
    id: 'bankAccount',
    name: '银行账户',
    englishName: 'Bank Account',
    description: '储蓄卡、对公账户、离岸账户与大额存单账号',
    isPrimary: false,
    color: '#EAB308',
    bgColor: 'rgba(234, 179, 8, 0.12)',
    icon: ({ className }) => <CircleDollarSign className={className || 'w-4 h-4 text-[#EAB308]'} />,
    defaultFields: [
      { name: '银行名称', isSecret: false },
      { name: '户名', isSecret: false },
      { name: '银行账号', isSecret: false },
      { name: '开户支行网点', isSecret: false },
      { name: 'SWIFT Code / 联行号', isSecret: false },
      { name: '电话银行密码', isSecret: true },
    ],
  },
  {
    id: 'driverLicense',
    name: '驾驶执照',
    englishName: 'Driver License',
    description: '机动车驾驶证、准驾车型与清分到期日',
    isPrimary: false,
    color: '#FB7185',
    bgColor: 'rgba(251, 113, 133, 0.12)',
    icon: ({ className }) => <Car className={className || 'w-4 h-4 text-[#FB7185]'} />,
    defaultFields: [
      { name: '驾驶人姓名', isSecret: false },
      { name: '证号 (身份证号)', isSecret: false },
      { name: '准驾车型', isSecret: false, defaultValue: 'C1' },
      { name: '档案编号', isSecret: false },
      { name: '有效起始日', isSecret: false },
      { name: '有效终止日', isSecret: false },
    ],
  },

  // 兼容老数据中的游戏分类
  {
    id: 'game',
    name: '游戏数字遗产',
    englishName: 'Game Heritage',
    description: 'Steam、Epic、战网及主机数字资产库',
    isPrimary: false,
    color: '#A855F7',
    bgColor: 'rgba(168, 85, 247, 0.12)',
    icon: ({ className }) => <Gamepad2 className={className || 'w-4 h-4 text-[#A855F7]'} />,
    defaultFields: [
      { name: '备用恢复验证码', isSecret: true },
      { name: '绑定邮箱', isSecret: false },
    ],
  },
];

export const getCategoryDef = (cat: VaultCategory): CategoryDefinition => {
  return (
    CATEGORIES.find((c) => c.id === cat) || {
      id: cat,
      name: '未命名分类',
      englishName: 'Item',
      description: '通用加密凭据',
      isPrimary: false,
      color: '#60A5FA',
      bgColor: 'rgba(96, 165, 250, 0.12)',
      icon: ({ className }) => <FileText className={className || 'w-4 h-4 text-blue-400'} />,
    }
  );
};
