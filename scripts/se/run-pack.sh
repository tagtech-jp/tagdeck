#!/usr/bin/env bash
# 音源パックの一括取り込みを 1 コマンドで（2026-10-17 社長提供の手順スクリプトを整えたもの）。
# scripts/se/pack-pipeline.ts の前後の手作業（道具と .env.local の確認 → dry-run → 確認 → 本実行）をまとめる。
#
# 使い方（リポジトリのフォルダで。Windows は Git Bash か WSL。PowerShell なら同じ内容の scripts/se/run-pack.ps1 を使う）:
#   bash scripts/se/run-pack.sh                              # ./source_se を取り込む
#   bash scripts/se/run-pack.sh D:/se-src                    # 別のフォルダ
#   bash scripts/se/run-pack.sh ./source_se --noise -40      # 2 つ目以降の引数は pnpm se:pack にそのまま渡す
#   YES=1 bash scripts/se/run-pack.sh                        # 確認を飛ばして本実行まで（自動化用）
#   PRE_SCRIPT=./auto_download.py bash scripts/se/run-pack.sh   # 取り込みの前に自分のスクリプト（.py は python / それ以外は bash）を呼ぶ。
#                                                                 # 音源の取得など、取り込みの前段を 1 コマンドにつなぐ入口。失敗したら止まる
#
# .env.local に要るもの（値はログに出さない。無ければ空の行を足して止まるので、値を入れてもう一度実行する）:
#   DATABASE_URL                 アイテム一覧の取得と se_mappings の書き込み（dry-run でも要る）
#   NEXT_PUBLIC_SUPABASE_URL     Storage の URL（本実行で要る）
#   SUPABASE_SERVICE_ROLE_KEY    Storage へのアップロード（本実行で要る。Supabase ダッシュボード → Project Settings → API → service_role）
#   SE_PACK_USER_ID              登録先のユーザー id（本実行で要る。無ければ SE_DEFAULT_SOURCE_USER_ID か、引数の --user <uuid>）
# 仮の値（your_... など）は書かない: CLI がそれを本物として使い、分かりにくい失敗になるため。
set -euo pipefail
cd "$(dirname "$0")/../.."

SRC="${1:-./source_se}"
if [ $# -gt 0 ]; then shift; fi
ENV_FILE=".env.local"

echo "=== 1. 道具と環境変数の確認 ==="
case "$SRC" in
  -*)
    echo "× 1 つ目の引数がフォルダではなく引数に見えます: $SRC（pnpm se:pack に渡す引数は 2 つ目以降に書く。例: bash scripts/se/run-pack.sh ./source_se --max-clips 40）" >&2
    exit 1
    ;;
esac
for tool in pnpm ffmpeg ffprobe; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "× $tool が見つかりません。インストールして PATH を通してください" >&2
    exit 1
  fi
done
if [ -n "${PRE_SCRIPT:-}" ]; then
  echo "=== 0. 取り込み前の処理（$PRE_SCRIPT） ==="
  if [ ! -f "$PRE_SCRIPT" ]; then
    echo "× PRE_SCRIPT が見つかりません: $PRE_SCRIPT" >&2
    exit 1
  fi
  case "$PRE_SCRIPT" in
    *.py)
      if command -v python3 >/dev/null 2>&1; then PY=python3; else PY=python; fi
      "$PY" "$PRE_SCRIPT" || { echo "× 取り込み前の処理が失敗しました。音源の取り込みはしていません" >&2; exit 1; }
      ;;
    *)
      bash "$PRE_SCRIPT" || { echo "× 取り込み前の処理が失敗しました。音源の取り込みはしていません" >&2; exit 1; }
      ;;
  esac
fi
if [ ! -d "$SRC" ]; then
  echo "× ソースフォルダがありません: $SRC（音源を置くか、1 つ目の引数でフォルダを指定）" >&2
  exit 1
fi
file_count="$(find "$SRC" -type f | wc -l | tr -d ' ')"
echo "・ソース: $SRC（ファイル $file_count 件）"
if [ "$file_count" -eq 0 ]; then
  echo "× ソースフォルダに音源がありません: $SRC（取り込み前の処理が何も置いていないか、置き場が違う）" >&2
  exit 1
fi

[ -f "$ENV_FILE" ] || touch "$ENV_FILE"
# キーの行が無ければ空で追記する（値は社長が入れる）
ensure_line() {
  if ! grep -q "^$1=" "$ENV_FILE"; then
    printf '%s=\n' "$1" >> "$ENV_FILE"
    echo "・$1= の行を $ENV_FILE に追記しました（値は未設定）"
  fi
}
ensure_line DATABASE_URL
ensure_line NEXT_PUBLIC_SUPABASE_URL
ensure_line SUPABASE_SERVICE_ROLE_KEY
ensure_line SE_PACK_USER_ID

# .env.local の値（最後の行を採用。引用符は外す）。値そのものは表示しない
value_of() {
  grep "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}
is_set() {
  local v
  v="$(value_of "$1")"
  [ -n "$v" ] && [[ "$v" != your_* ]] && [[ "$v" != "<"* ]]
}

if ! is_set DATABASE_URL; then
  echo "× DATABASE_URL が $ENV_FILE に未設定です（dry-run でもアイテム一覧の取得に要る）。値を入れてもう一度実行してください" >&2
  exit 1
fi

echo "=== 2. 音源パック一括取り込みの dry-run（登録しない） ==="
pnpm se:pack --src "$SRC" --dry-run "$@"

echo "=== 3. 本実行の前の確認 ==="
missing=""
for key in NEXT_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY; do
  is_set "$key" || missing="$missing $key"
done
has_user=0
if is_set SE_PACK_USER_ID || is_set SE_DEFAULT_SOURCE_USER_ID; then has_user=1; fi
for arg in "$@"; do [ "$arg" = "--user" ] && has_user=1; done
if [ "$has_user" -eq 0 ]; then missing="$missing SE_PACK_USER_ID"; fi
if [ -n "$missing" ]; then
  echo "dry-run は終わりました。本実行には次の値が $ENV_FILE に要ります:$missing" >&2
  echo "値を入れてからもう一度このスクリプトを実行してください（切り出し済みの音源は使い回されるので速い）" >&2
  exit 1
fi

if [ "${YES:-}" != "1" ]; then
  read -r -p "dry-run の計画（.se-pack/out/pack-manifest.json）を確認しましたか？ 本番へ登録を実行しますか？ (y/N) " yn
  case "$yn" in
    [yY]*) ;;
    *) echo "キャンセルしました（何も登録していません）"; exit 0 ;;
  esac
fi

echo "=== 4. 本実行（Storage と se_mappings に登録） ==="
pnpm se:pack --src "$SRC" "$@"
echo "すべての取り込み処理が完了しました。戻すときは: pnpm se:pack --undo .se-pack/out/pack-manifest.json"
