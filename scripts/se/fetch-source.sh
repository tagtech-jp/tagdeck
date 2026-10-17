#!/usr/bin/env bash
# 音源の自動取得 + 下ごしらえ（pnpm se:fetch）を呼ぶ入口（bash 版・2026-10-17）。
#   PRE_SCRIPT=scripts/se/fetch-source.sh bash scripts/se/run-pack.sh ./source_se --max-clips 40   # sources.csv → 取得 → source_se → dry-run → 確認 → 本実行
#   bash scripts/se/fetch-source.sh --dry-run                                                      # 単体でも使える（引数は pnpm se:fetch にそのまま渡る）
set -euo pipefail
cd "$(dirname "$0")/../.."
for tool in pnpm yt-dlp ffmpeg; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "× $tool が見つかりません。インストールして PATH を通してください（yt-dlp は python -m pip install --user yt-dlp）" >&2
    exit 1
  fi
done
exec pnpm se:fetch "$@"
