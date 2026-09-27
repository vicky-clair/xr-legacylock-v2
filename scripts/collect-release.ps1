# 收集已成功构建的 Windows 产物、说明和许可证，并生成便携 ZIP 与 SHA-256 清单。
# 先构建精简包并收集，再构建离线包并以 -Offline 收集；两种构建共用同一个 NSIS 输出文件名。
param([switch]$Offline)
$ErrorActionPreference='Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
  $version=(Get-Content -Raw package.json | ConvertFrom-Json).version
  if ($version -notmatch '^\d+\.\d+\.\d+$') {throw 'Unexpected release version'}
  $delivery="releases/$version-test-win-x64"
  New-Item -ItemType Directory -Force -Path $delivery | Out-Null
  $installers=@(Get-ChildItem -LiteralPath 'target/release/bundle/nsis' -Filter "*${version}*x64*setup.exe" -File)
  if($installers.Count -ne 1){throw 'Expected one installer for the current version'}
  $variant=if($Offline){'-offline'}else{''}
  # 构建输出不区分后缀，必须由调用者与刚完成的构建类型保持一致。
  Copy-Item -LiteralPath $installers[0].FullName -Destination "$delivery/LegacyLock-V2-$version-x64$variant-setup.exe"
  if(-not $Offline){
    # 首轮收集应用、阅读器和说明；离线轮只补安装器，避免重复覆盖精简包。
    Copy-Item -LiteralPath 'target/release/legacylock-desktop.exe' -Destination "$delivery/LegacyLock-V2.exe"
    Copy-Item -LiteralPath 'target/release/vault-reader.exe' -Destination "$delivery/vault-reader.exe"
    Copy-Item -LiteralPath 'docs/使用与迁移说明.md' -Destination "$delivery/README.md"
    Copy-Item -LiteralPath 'docs/阶段验收记录.md' -Destination "$delivery/VALIDATION.md"
    Copy-Item -LiteralPath 'docs/dependencies/THIRD-PARTY-NOTICES.txt' -Destination "$delivery/THIRD-PARTY-NOTICES.txt"
    Copy-Item -LiteralPath 'docs/dependencies/inventory.json' -Destination "$delivery/dependency-inventory.json"
    Compress-Archive -LiteralPath "$delivery/LegacyLock-V2.exe","$delivery/vault-reader.exe","$delivery/README.md","$delivery/VALIDATION.md","$delivery/THIRD-PARTY-NOTICES.txt","$delivery/dependency-inventory.json" -DestinationPath "$delivery/LegacyLock-V2-$version-win-x64.zip" -Force
  }
  # 校验清单覆盖交付文件本身，不包含清单自身，便于下载后独立核验。
  Get-ChildItem -LiteralPath $delivery -File | Where-Object Name -ne 'SHA256SUMS.txt' | Sort-Object Name | ForEach-Object {
    '{0}  {1}' -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(),$_.Name
  } | Set-Content -LiteralPath "$delivery/SHA256SUMS.txt" -Encoding utf8
  Get-ChildItem -LiteralPath $delivery -File | Select-Object Name,Length
} finally {Pop-Location}
