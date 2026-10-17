<#
.SYNOPSIS
  元メディアの下ごしらえ（pnpm se:prep）を呼ぶ入口（PowerShell 版・2026-10-17）。
  run-pack.ps1 の -PreScript に渡すと、下ごしらえ → dry-run → 確認 → 本実行 が 1 コマンドになる。

.EXAMPLE
  .\scripts\se\run-pack.ps1 -PreScript .\scripts\se\prep-source.ps1 -- --max-clips 40       # source_raw → source_se → dry-run → 確認 → 本実行
  .\scripts\se\run-pack.ps1 -PreScript .\scripts\se\prep-source.ps1 -Yes -- --max-clips 40  # 確認を飛ばして本実行まで（全自動）
  .\scripts\se\prep-source.ps1 --dry-run                                                   # 単体でも使える（引数は pnpm se:prep にそのまま渡る）
#>
[CmdletBinding(PositionalBinding = $false)]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$PrepArgs = @()
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..\..")
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Host "× pnpm が見つかりません。インストールして PATH を通してください" -ForegroundColor Red
  exit 1
}
& pnpm se:prep @PrepArgs
exit $LASTEXITCODE
