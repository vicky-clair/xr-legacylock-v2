# LegacyLock V2 · 0.2.0 Windows 测试版

独立的 Tauri 2 + Rust 客户端，依据上级 `tauri2-rust/` 两份开发规范实现。现在已接入真实密库存储；这是待完成实机验收的测试版本，尚不是签名商用发行版。

## 已实现

- LVCF 3 创建、双凭据解锁、资产增删改、设置、凭据轮换、加密导入导出、冲突副本合并。
- 原子文件替换、读回验签、previous 回退文件、进程文件锁、串行写入、锁定 epoch。
- Windows DPAPI 本机记住安全密钥；手动验证启用，更换凭据或恢复配置时失效。
- USB 主副盘配置、主盘单独同步、继承人只读恢复、物理设备复核及拔盘轮询锁定。
- 托盘、三选项关闭、系统锁屏/睡眠锁定、单实例、30 秒剪贴板清理。
- 原三栏、24 分类、五主题、三语言、缩放、订阅演示。大列表窗口化；详情按需读取；搜索在 Rust 执行；附件通过原生对话框导入导出。
- 无 WebView/Node 依赖的离线 Rust 阅读器。

## 从旧版迁移

新版不会直接共用或修改 `C:\XMWJJ\xr-LegacyLock` 的数据。默认路径：旧版导出 LVCF 3 `.llvault` → 新版选择所有者导入 → 手动输入该备份的密码和安全密钥。旧 Electron 的本机记忆文件不自动迁移；原双 USB 份额无需重新配置。

完整操作、恢复流程及限制见 [使用与迁移说明](docs/使用与迁移说明.md)。兼容边界见 [协议兼容策略](docs/协议兼容策略.md)。

## 开发与验证

开发交接请先阅读 [开发维护指南](docs/开发维护指南.md) 和 [接口与配置索引](docs/接口与配置索引.md)。涵盖模块职责、会话与事务、命令参数、测试打包、中文注释维护以及离线包体积来源。

Rust 1.91.1、Node/npm、Windows MSVC 和 WebView2。应用 ID 保持 `com.legacylock.tauri.preview`，数据位于 Tauri 的独立 app_data_dir；便携 EXE 与本测试版安装包使用同一用户数据目录。

```powershell
npm ci
npm run tauri dev
./scripts/verify.ps1
cargo run -p vault-service --example benchmark --release --locked
```

验证脚本包括冻结快照、前端、桥接/ACL、fmt、Clippy、全 Rust 测试、Node/Rust 互操作及旧参考回归。测试只使用临时目录和公开合成样本。

```powershell
npm run package:preview
./scripts/collect-release.ps1
npm run package:offline
./scripts/collect-release.ps1 -Offline
```

精简安装包在缺少 WebView2 时联网安装运行库；完整离线安装包另行构建。发布目录含安装包、便携 ZIP、离线阅读器、说明及 SHA-256。

[阶段验收记录](docs/阶段验收记录.md)区分已实现、自动测试通过和仍需人工/硬件验证。当前 Windows 平台开发；macOS/Linux 系统密钥库、USB 和系统事件尚未完成，不能作为已支持平台发布。
