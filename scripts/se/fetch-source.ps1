<#
.SYNOPSIS
  音源の自動取得 + 下ごしらえ（pnpm se:fetch）を呼ぶ入口（PowerShell 版・2026-10-17）。
  run-pack.ps1 の -PreScript に渡すと、取得 → 下ごしらえ → dry-run → 確認 → 本実行 が 1 コマンドになる。

.EXAMPLE
  .\scripts\se\run-pack.ps1 -PreScript .\scripts\se\fetch-source.ps1 -- --max-clips 40       # sources.csv → 取得 → source_se → dry-run → 確認 → 本実行
  .\scripts\se\run-pack.ps1 -PreScript .\scripts\se\fetch-source.ps1 -Yes -- --max-clips 40  # 確認を飛ばして本実行まで（全自動）
  .\scripts\se\fetch-source.ps1 --dry-run                                                   # 単体でも使える（引数は pnpm se:fetch にそのまま渡る）
#>
[CmdletBinding(PositionalBinding = $false)]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$FetchArgs = @()
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..\..")
foreach ($tool in @("pnpm", "yt-dlp", "ffmpeg")) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    Write-Host "× $tool が見つかりません。インストールして PATH を通してください（yt-dlp は python -m pip install --user yt-dlp）" -ForegroundColor Red
    exit 1
  }
}
& pnpm se:fetch @FetchArgs
exit $LASTEXITCODE
