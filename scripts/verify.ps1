# 统一回归入口：按顺序验证冻结文件、前端、IPC、Rust 和双向互操作，任一步失败立即停止。
# 日志保存在 test-results；其中的公开样本和明文输出只用于测试，不应混入真实用户数据。
$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
  New-Item -ItemType Directory -Force -Path 'test-results' | Out-Null
  $checks = @(
    @{ Name='reference-hashes'; Exe='node'; Args=@('scripts/verify-reference.cjs') },
    @{ Name='frontend-build'; Exe='npm.cmd'; Args=@('run','build') },
    @{ Name='bridge'; Exe='node'; Args=@('--test','tests/desktop/bridge.test.cjs') },
    @{ Name='format'; Exe='cargo'; Args=@('fmt','--all','--check') },
    @{ Name='clippy'; Exe='cargo'; Args=@('clippy','--workspace','--all-targets','--locked','--','-D','warnings') },
    @{ Name='rust-tests'; Exe='cargo'; Args=@('test','--workspace','--locked') },
    @{ Name='interop-build'; Exe='cargo'; Args=@('build','-p','vault-core','--example','interop','--locked') },
    @{ Name='interop'; Exe='node'; Args=@('--test','tests/interoperability/protocol.cjs') },
    @{ Name='reference-tests'; Exe='node'; Args=@('--test','reference/legacy/tests/*.test.cjs') }
  )
  foreach ($check in $checks) {
    # 每项记录实际命令、退出码和起止时间；失败时不继续生成“全部通过”的假象。
    $checkArgs = $check.Args
    $logPath = "test-results/$($check.Name).log"
    "Started: $(Get-Date -Format o)`nCommand: $($check.Exe) $($checkArgs -join ' ')" | Set-Content -LiteralPath $logPath
    & $check.Exe @checkArgs 2>&1 | Tee-Object -FilePath $logPath -Append
    $checkExitCode = $LASTEXITCODE
    "Exit: $checkExitCode`nFinished: $(Get-Date -Format o)" | Add-Content -LiteralPath $logPath
    if ($checkExitCode -ne 0) { throw "Check failed: $($check.Name)" }
  }
} finally { Pop-Location }
