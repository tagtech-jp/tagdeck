<#
.SYNOPSIS
  音源パックの一括取り込みを 1 コマンドで（PowerShell 版・2026-10-17）。
  bash 版 scripts/se/run-pack.sh と同じ流れ: 道具と .env.local の確認 → dry-run → 確認 → 本実行。

.DESCRIPTION
  .env.local に要るもの（値はログに出さない。無ければ空の行を足して止まるので、値を入れてもう一度実行する）:
    DATABASE_URL                 アイテム一覧の取得と se_mappings の書き込み（dry-run でも要る）
    NEXT_PUBLIC_SUPABASE_URL     Storage の URL（本実行で要る）
    SUPABASE_SERVICE_ROLE_KEY    Storage へのアップロード（本実行で要る。Supabase ダッシュボード → Project Settings → API → service_role）
    SE_PACK_USER_ID              登録先のユーザー id（本実行で要る。無ければ SE_DEFAULT_SOURCE_USER_ID か、引数の --user <uuid>）
  仮の値（your_... など）は書かない: CLI がそれを本物として使い、分かりにくい失敗になるため。

.EXAMPLE
  cd D:\tagdeck
  .\scripts\se\run-pack.ps1                                  # .\source_se を取り込む
  .\scripts\se\run-pack.ps1 -Src D:\se-src                   # 別のフォルダ
  .\scripts\se\run-pack.ps1 -Yes                             # 確認を飛ばして本実行まで（自動化用）
  .\scripts\se\run-pack.ps1 -Src .\source_se -- --noise -40  # "--" の後は pnpm se:pack にそのまま渡す

  初回に「このシステムではスクリプトの実行が無効になっている」と出たら:
    powershell -ExecutionPolicy Bypass -File scripts\se\run-pack.ps1
#>
[CmdletBinding()]
param(
  [string]$Src = ".\source_se",
  [switch]$Yes,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$PackArgs = @()
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..\..")
$envFile = ".env.local"

function Fail([string]$message) {
  Write-Host "× $message" -ForegroundColor Red
  exit 1
}

Write-Host "=== 1. 道具と環境変数の確認 ==="
foreach ($tool in @("pnpm", "ffmpeg", "ffprobe")) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    Fail "$tool が見つかりません。インストールして PATH を通してください"
  }
}
if (-not (Test-Path -LiteralPath $Src -PathType Container)) {
  Fail "ソースフォルダがありません: $Src（音源を置くか、-Src でフォルダを指定）"
}
$fileCount = @(Get-ChildItem -LiteralPath $Src -Recurse -File).Count
Write-Host "・ソース: $Src（ファイル $fileCount 件）"

if (-not (Test-Path -LiteralPath $envFile)) { New-Item -ItemType File -Path $envFile | Out-Null }
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
$envPath = (Resolve-Path -LiteralPath $envFile).Path

# キーの行が無ければ空で追記する（値は社長が入れる）。BOM 無しの UTF-8 で書く（CLI の読み取りが先頭の BOM で崩れないように）
function Ensure-Line([string]$key) {
  $lines = @(Get-Content -LiteralPath $envPath -ErrorAction SilentlyContinue)
  if (-not ($lines | Where-Object { $_ -match "^$key=" })) {
    $text = [System.IO.File]::ReadAllText($envPath)
    $prefix = if ($text.Length -gt 0 -and -not $text.EndsWith("`n")) { "`n" } else { "" }
    [System.IO.File]::AppendAllText($envPath, "$prefix$key=`n", $utf8NoBom)
    Write-Host "・$key= の行を $envFile に追記しました（値は未設定）"
  }
}
foreach ($key in @("DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SE_PACK_USER_ID")) { Ensure-Line $key }

# .env.local の値（最後の行を採用。引用符は外す）。値そのものは表示しない
function Get-EnvValue([string]$key) {
  $line = @(Get-Content -LiteralPath $envPath | Where-Object { $_ -match "^$key=" }) | Select-Object -Last 1
  if (-not $line) { return "" }
  $value = $line.Substring($key.Length + 1).Trim()
  if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  return $value
}
function Test-EnvSet([string]$key) {
  $v = Get-EnvValue $key
  return ($v -ne "" -and -not $v.StartsWith("your_") -and -not $v.StartsWith("<"))
}

if (-not (Test-EnvSet "DATABASE_URL")) {
  Fail "DATABASE_URL が $envFile に未設定です（dry-run でもアイテム一覧の取得に要る）。値を入れてもう一度実行してください"
}

Write-Host "=== 2. 音源パック一括取り込みの dry-run（登録しない） ==="
& pnpm se:pack --src $Src --dry-run @PackArgs
if ($LASTEXITCODE -ne 0) { Fail "dry-run が失敗しました（上のメッセージを確認）" }

Write-Host "=== 3. 本実行の前の確認 ==="
$missing = @()
foreach ($key in @("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")) {
  if (-not (Test-EnvSet $key)) { $missing += $key }
}
$hasUser = (Test-EnvSet "SE_PACK_USER_ID") -or (Test-EnvSet "SE_DEFAULT_SOURCE_USER_ID") -or ($PackArgs -contains "--user")
if (-not $hasUser) { $missing += "SE_PACK_USER_ID" }
if ($missing.Count -gt 0) {
  Write-Host "dry-run は終わりました。本実行には次の値が $envFile に要ります: $($missing -join ' ')" -ForegroundColor Yellow
  Write-Host "値を入れてからもう一度このスクリプトを実行してください（切り出し済みの音源は使い回されるので速い）" -ForegroundColor Yellow
  exit 1
}

if (-not $Yes) {
  $yn = Read-Host "dry-run の計画（.se-pack\out\pack-manifest.json）を確認しましたか？ 本番へ登録を実行しますか？ (y/N)"
  if ($yn -notmatch "^[yY]") {
    Write-Host "キャンセルしました（何も登録していません）"
    exit 0
  }
}

Write-Host "=== 4. 本実行（Storage と se_mappings に登録） ==="
& pnpm se:pack --src $Src @PackArgs
if ($LASTEXITCODE -ne 0) { Fail "本実行が失敗しました（上のメッセージを確認。登録済みの行は pnpm se:pack --undo .se-pack\out\pack-manifest.json で戻せる）" }
Write-Host "すべての取り込み処理が完了しました。戻すときは: pnpm se:pack --undo .se-pack\out\pack-manifest.json"
