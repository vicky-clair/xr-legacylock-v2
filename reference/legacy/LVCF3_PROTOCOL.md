# LVCF 3 协议与威胁边界

规范实现为 `electron/vault-core.cjs`，Node.js 24+。所有 JSON 先验证大小和字段，再参与密码运算。外部文件最大 32 MB；资产 JSON 最大 20 MB、最多 10,000 项，单附件最大 2 MB。无在线服务、格式到期日或激活依赖。

## 密库信封

必需且仅允许的字段：`magic='LEGACYLOCK'`、`format=3`、UUID `id`、正整数 `revision`、`signingPublicKey`、`owner`、`recovery`、`payload`、`signature`。

签名公钥是 Ed25519 SPKI DER 的规范 base64。签名为 64 字节 Ed25519 签名的 base64；签署去除 `signature` 后的整个信封，包括所有密钥槽、代次、密文、id、版本和修订号。

规范 JSON 按 JavaScript `Object.keys().sort()` 顺序排列对象键，省略对象中 `undefined` 字段，数组保留顺序，标量使用 JSON 编码；不插入多余空白。签名和 AAD 编码为 UTF-8。文件不得含任意非 JSON JavaScript 类型。

AES-256-GCM 密文盒仅包含 `iv`（随机 12 字节）、`tag`（16 字节）、`data` 三个规范 base64 字段。每次加密生成新 nonce。AAD 为以下数组的规范 JSON：`['LVCF3', id, signingPublicKey, kind]`。

## 数据和所有者槽

每个密库随机生成 32 字节 VMK（数据密钥）和独立 Ed25519 签名密钥。`payload` 使用 VMK 加密 `{items,settings}`，AAD kind 为 `payload`。数据中不包含所有者凭据或签名私钥。

`owner` 字段为 `{kdf:'scrypt-32768-8-1',salt,wrapped}`，salt 为随机 16 字节。密码原样使用，长度 12～1024 个 JavaScript 字符，不 trim 或 Unicode 规范化。安全密钥为随机 32 字节，以 `LL3-` 和十六进制分组显示；解码时去掉可选 LL3 前缀及连字符，不接受缺失或非 64 位十六进制内容。

KDF 输入是 `[password,lowercaseSecretHex]` 的 JSON UTF-8。使用 scrypt N=32768、r=8、p=1、输出 32 字节、maxmem=64 MiB，参数不可由输入任意扩张。由此密钥加密 `{vmk,signingPrivateKey}`，分别为 32 字节 VMK 与 Ed25519 PKCS8 DER 的 base64；AAD kind 为 `owner`。解密后再验证私钥导出的公钥与信封一致。

## 双份恢复

首次配置或重新配置时生成两份相互独立的 32 字节随机秘密 A、B。恢复 KEK 是 HKDF-SHA256：输入 A||B、salt 为 UTF-8 id、info 为 UTF-8 `LVCF3 recovery <generation>`、输出 32 字节。

`recovery` 为 null 或 `{generation,wrapped}`，wrapped 仅加密原始 32 字节 VMK，**不包含签名私钥**。AAD kind 为 `recovery:<generation>`。

每份 `.llkey` 包含 `magic='LEGACYLOCK_SHARE'`、`format=3`、`id`、`signingPublicKey`、`generation`、`role='PRIMARY'|'SECONDARY'`、`secret`、`signature`。除 signature 外全部字段由所有者 Ed25519 密钥签署。两份密钥必须分别匹配角色、身份、根公钥和代次。公开信封没有足以重建任一秘密的派生种子。

重新配置还更换 VMK、重加密 payload 和 owner 槽，使旧的 VMK 无法打开后续数据。旧副本仍可被旧凭据读取；轮换不承诺追溯撤回已知信息。更换所有者密码和安全密钥仅重包 owner 槽，保留两盘读取能力。

## 授权、版本与保存

所有者会话持有签名私钥，才可签署 revision+1 的新信封。只读会话只有 VMK；主进程也检查角色。前端没有接口提交任意磁盘路径、调用 shell、设置角色或写入未验证容器。

当前本机信封固定 id 与根公钥；导入不允许不同身份或较低 revision 覆盖。全新电脑依靠正确的两份签名恢复秘密或所有者双凭据建立信任。若攻击者控制整个操作系统并回滚所有文件，本软件没有独立硬件计数器证明历史最高版本。

保存按会话队列顺序执行，以同目录临时文件写入、fsync、验签及读回校验、保留 `.previous`、rename、再读回确认。跨两盘没有硬件原子事务；配置采用独立代次目录，仅在两盘全部写入并验证后提交本机配置。失败的新代次目录可能残留，不能把文件存在当作配置成功。

## 2026-09-21 信息备份与存储流程补充

加密格式和既有签名密钥份额不变。日常更新仅验证主份额并写主盘 `vault.llvault`，不需要或修改副盘；新配置的副盘仅写 `secondary.llkey`。更换所有者凭据保留 VMK 和恢复代次，因此既有副盘仍有效。显式重配才轮换恢复秘密和 VMK。

只读导入是内存会话，不替换本机文件，可以查看不同身份或较旧版本；取得所有者管理权限再写入本机时仍执行身份与回滚检查。已解锁所有者的“信息合并”分别验证源文件双凭据，并以本机身份重签数据，保留本机设置和恢复配置。相同记录跳过，ID 冲突保留为新副本。

删除本机文件只允许所有者双凭据重新验证后，用绑定会话代次和数据版本的两分钟单次确认令牌执行，另需字面值 `DELETE`。仅删除应用专属本机文件，不保证物理擦除其他系统副本。

## 不承诺的能力

USB 秘密文件可以复制；软件扫描只能防误选，不能实现真正硬件防克隆。拥有两份秘密者可以离线读取，不能签署原身份更新，但可以编辑自己的副本。无法抵御已控制操作系统的攻击者读取解锁进程内存、截屏或键盘记录。Node/React 字符串不保证物理内存清零；可清零的 Buffer 在退出会话时清零，同时释放私钥和明文引用。此协议需要进一步独立审查，不能称为“军规认证”“绝对安全”或“法律真实性保证”。
