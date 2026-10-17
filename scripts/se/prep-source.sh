#!/usr/bin/env bash
# 元メディアの下ごしらえ（pnpm se:prep）を呼ぶ入口（bash 版・2026-10-17）。
#   PRE_SCRIPT=scripts/se/prep-source.sh bash scripts/se/run-pack.sh ./source_se --max-clips 40   # source_raw → source_se → dry-run → 確認 → 本実行
#   bash scripts/se/prep-source.sh --dry-run                                                      # 単体でも使える（引数は pnpm se:prep にそのまま渡る）
set -euo pipefail
cd "$(dirname "$0")/../.."
if ! command -v pnpm >/dev/null 2>&1; then
  echo "× pnpm が見つかりません。インストールして PATH を通してください" >&2
  exit 1
fi
exec pnpm se:prep "$@"
