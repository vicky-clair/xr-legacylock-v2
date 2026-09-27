#!/usr/bin/env node
"use strict";
/**
 * LegacyLock 独立只读离线恢复阅读器 (Standalone Offline Recovery Reader)
 * 
 * 核心安全特性：
 * 1. 零第三方依赖：仅依赖 Node.js 内置模块与项目的密码学核心；
 * 2. 永不过期与无需激活：不依赖任何网络服务器，不依赖 GUI 界面，随时随地可用；
 * 3. 2-of-2 强约束：必须同时提供 vault.llvault、主盘 primary.llkey、副盘 secondary.llkey 三个文件；
 * 4. 防覆盖保护：输出文件必须为新文件 (wx 标志)，杜绝意外覆盖已有数据；
 * 5. 权限边界约束：恢复出的为明文备份 JSON，阅读器不持有签名私钥，原密库保持只读且不被修改。
 */
const core = require("../electron/vault-core.cjs");
const { read } = require("../electron/vault-store.cjs");
const fs = require("node:fs/promises");

/**
 * 运行离线数据恢复程序
 * @param {string[]} args 包含四个参数：密库路径、主盘密钥路径、副盘密钥路径、输出明文路径
 */
async function run(args) {
  if (args.length !== 4)
    throw new Error(
      "用法: node scripts/recovery-reader.cjs <vault.llvault> <primary.llkey> <secondary.llkey> <新输出.json>",
    );
  const [vault, a, b, output] = args;
  const session = core.unlockRecovery(
    await read(vault),
    await read(a),
    await read(b),
  );
  let handle;
  try {
    handle = await fs.open(output, "wx", 0o600);
    await handle.writeFile(
      core.canonical({
        id: session.envelope.id,
        revision: session.envelope.revision,
        ...session.data,
      }),
    );
    await handle.sync();
  } finally {
    await handle?.close();
    core.destroySession(session);
  }
  process.stdout.write(
    "已验证签名并恢复全部数据（含附件）。输出为明文，请妥善保管。原密库未修改。\n",
  );
}
if (require.main === module)
  run(process.argv.slice(2)).catch((e) => {
    process.stderr.write((e.code || e.message) + "\n");
    process.exitCode = 1;
  });
module.exports = { run };
