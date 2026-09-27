# 旧收集入口的兼容包装：转入按 package.json 版本收集的脚本，避免混用不同版本产物。
# Backward-compatible entry point for earlier test-package instructions.
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'collect-release.ps1')
