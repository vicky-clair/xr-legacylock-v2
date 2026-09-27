// Current asset model. Encryption envelopes are validated in electron/vault-core.cjs.
export type VaultCategory =
  | "login" // 登录信息：账号、密码、2FA 动态验证码
  | "note" // 安全便签：遗嘱补充、私密留言、保险箱实体密码
  | "card" // 银行卡/信用卡：卡号、CVV、有效期、开户网点
  | "identity" // 身份标识：身份证、护照、社保号、户籍信息
  | "password" // 独立密码：锁屏 PIN、BIOS 口令、WiFi 密码
  | "document" // 加密文档：房产证明、信托合约、重要授权书
  | "sshKey" // SSH 密钥：服务器根私钥、Git 凭据
  | "apiCredential" // API 凭据：云服务 Token、OpenAI/AI 访问密钥
  | "membership" // 会员权益：积分会员、俱乐部凭证
  | "cryptoWallet" // 加密货币钱包：BIP39 助记词、冷钱包私钥
  | "medical" // 医疗健康档案：病历、紧急医疗卡
  | "reward" // 奖励积点：航司里程、酒店尊享积分
  | "outdoorLicense" // 特种执照：执业资格证、持枪许可等
  | "passport" // 护照专属卡
  | "database" // 数据库凭据：MySQL、PostgreSQL、Redis 连接串
  | "router" // 路由器网关：管理账号、无线通信口令
  | "server" // 服务器/云主机：Linux VPS 根凭据、RDP 连接口令
  | "email" // 核心主邮箱凭据
  | "ssn" // 社会安全号专属卡
  | "softwareLicense" // 商业软件买断授权序列号
  | "bankAccount" // 银行储蓄与对公结算账户
  | "driverLicense" // 驾驶证凭据
  | "game" // 游戏平台资产：Steam、PlayStation、战网
  | "license";

export type VaultFieldType =
  | "text" // 文本
  | "url" // 网站 URL
  | "email" // 电子邮件
  | "address" // 地址
  | "date" // 日期
  | "totp" // 一次性密码
  | "password" // 密码 / 敏感保密口令
  | "phone" // 电话
  | "note";

export interface VaultField {
  /** 字段唯一识别符 (UUID) */
  id: string;
  /** 字段展示名称 / 自定义标题 (如 "备用邮箱", "二阶段验证码") */
  name: string;
  /** 字段真实取值 / 自定义内容 */
  value: string;
  /** 是否属于敏感保密字段 (为 true 时默认掩码隐藏，防物理窥视) */
  isSecret: boolean;
  /** 字段语义类型 */
  type?: VaultFieldType;
}

export const MAX_ATTACHMENT_SIZE_BYTES = 2 * 1024 * 1024;

export interface VaultAttachment {
  /** 附件唯一识别符 (UUID) */
  id: string;
  /** 原始文件名 (如 "房产证明.pdf", "privkey.pem", "id_photo.jpg") */
  name: string;
  /** 文件原始大小 (字节)，必须 <= 2MB */
  size: number;
  /** 文件 MIME 类型 (如 "application/pdf", "image/png") */
  type: string;
  /** 文件 Base64 Data URL (data:...;base64,...) */
  data: string;
  /** 上传时间戳 (毫秒) */
  uploadedAt: number;
}

export interface VaultItem {
  /** 资产全局唯一 ID (UUIDv4) */
  id: string;
  /** 资产标题/名称 (如 "个人中心主银行卡") */
  title: string;
  /** 归属资产分类 */
  category: VaultCategory;
  /** 登录账号 / 用户名 / 公钥 */
  username?: string;
  /** 登录密码 / 核心私钥 / PIN 码 */
  password?: string;
  /** 关联网址 / 服务端接入点 URL */
  url?: string;
  /** 私密备注 / 说明文字 / 纸质线索指引 */
  notes?: string;
  /** 自定义扩展键值对列表 */
  customFields?: VaultField[];
  /** 加密附件列表 (单个文件 <= 2MB) */
  attachments?: VaultAttachment[];
  /** 继承人专属接管指引与留言 (仅继承人激活后可见) */
  inheritanceInstructions?: string;
  /** 修订版本流水号 (单调递增，用于防重放与防回滚) */
  revision?: number;
  /** 创建时间戳 (毫秒) */
  createdAt: number;
  /** 最后修改时间戳 (毫秒) */
  updatedAt: number;
}

export type NavCategoryType =
  | "all" // 全部资产
  | "registry" // 系统注册项/主目录
  | "browser" // 浏览器存储密码
  | "network" // 网络资产
  | "mail" // 电子邮箱
  | "wifi" // WiFi 连接
  | "bitlocker" // 磁盘 BitLocker 恢复密钥
  | "external_drive" // 外部驱动器
  | "import_export" // 军规加密导入导出
  | "settings" // 系统设置与安全控制中心
  | VaultCategory;
