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
  .\scripts\se\run-pack.ps1 -PreScript .\auto_download.py -Yes   # 取り込みの前に自分のスクリプト（.py / .ps1）を呼ぶ。
                                                                 # 音源の取得など、取り込みの前段を 1 コマンドにつなぐ入口。失敗したら止まる
  -Src と -PreScript は必ず名前付きで指定する（名前の無い引数はすべて pnpm se:pack に渡る。"--" の後に書くのが確実）
  確認の入力ができない実行（スケジューラ・パイプ・ツールからの呼び出し）では、-Yes が無い限り本実行に進まず止まる

  初回に「このシステムではスクリプトの実行が無効になっている」と出たら:
    powershell -ExecutionPolicy Bypass -File scripts\se\run-pack.ps1
#>
[CmdletBinding(PositionalBinding = $false)]
param(
  [string]$Src = ".\source_se",
  [switch]$Yes,
  # 取り込みの前に呼ぶ自分のスクリプト（.py は python で、.ps1 はそのまま実行）。音源を $Src に置く処理をここにつなぐ
  [string]$PreScript = "",
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
if ($Src.StartsWith("-")) {
  Fail "-Src の値がフォルダではなく引数に見えます: $Src（pnpm se:pack に渡す引数は ""--"" の後に書く。例: -Src .\source_se -- --max-clips 40）"
}
foreach ($tool in @("pnpm", "ffmpeg", "ffprobe")) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    Fail "$tool が見つかりません。インストールして PATH を通してください"
  }
}
if ($PreScript -ne "") {
  Write-Host "=== 0. 取り込み前の処理（$PreScript） ==="
  if (-not (Test-Path -LiteralPath $PreScript -PathType Leaf)) { Fail "PreScript が見つかりません: $PreScript" }
  $preExt = [System.IO.Path]::GetExtension($PreScript).ToLowerInvariant()
  if ($preExt -eq ".py") {
    if (-not (Get-Command python -ErrorAction SilentlyContinue)) { Fail "python が見つかりません（.py の PreScript に要る）" }
    & python $PreScript
  } else {
    & $PreScript
  }
  if ($LASTEXITCODE -ne 0) { Fail "取り込み前の処理が失敗しました（exit $LASTEXITCODE）。音源の取り込みはしていません" }
}
if (-not (Test-Path -LiteralPath $Src -PathType Container)) {
  Fail "ソースフォルダがありません: $Src（音源を置くか、-Src でフォルダを指定）"
}
$fileCount = @(Get-ChildItem -LiteralPath $Src -Recurse -File).Count
Write-Host "・ソース: $Src（ファイル $fileCount 件）"
if ($fileCount -eq 0) {
  Fail "ソースフォルダに音源がありません: $Src（取り込み前の処理が何も置いていないか、置き場が違う）"
}

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
  # 確認の入力ができない実行（stdin なし・パイプ・スケジューラ・ツールからの呼び出し）では本実行に進まない。
  # 2026-10-17 の実害: stdin が無いと Read-Host が空の列挙を返し、`$yn -notmatch` が空配列（偽）になって取り消しを素通りし、本実行まで走った
  if ([Console]::IsInputRedirected -or -not [Environment]::UserInteractive) {
    Fail "確認の入力ができない実行（非対話・stdin なし）なので本実行はしません。本実行するなら -Yes を付けて明示してください"
  }
  $yn = ""
  try { $yn = [string](Read-Host "dry-run の計画（.se-pack\out\pack-manifest.json）を確認しましたか？ 本番へ登録を実行しますか？ (y/N)") } catch { $yn = "" }
  if ([string]::IsNullOrWhiteSpace($yn) -or $yn -notmatch "^[yY]") {
    Write-Host "キャンセルしました（何も登録していません）"
    exit 0
  }
}

Write-Host "=== 4. 本実行（Storage と se_mappings に登録） ==="
& pnpm se:pack --src $Src @PackArgs
if ($LASTEXITCODE -ne 0) { Fail "本実行が失敗しました（上のメッセージを確認。登録済みの行は pnpm se:pack --undo .se-pack\out\pack-manifest.json で戻せる）" }
Write-Host "すべての取り込み処理が完了しました。戻すときは: pnpm se:pack --undo .se-pack\out\pack-manifest.json"
