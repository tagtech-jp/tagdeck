#!/usr/bin/env bash
# Phase CF-2 切替前後検証スクリプト
# 作成: CTO 真鍋玲央 / 2026-05-12
# 対応: WSL / Git Bash 両対応
# 使い方:
#   切替前ベースライン: bash phase_cf2_verify.sh baseline
#   切替後検証:         bash phase_cf2_verify.sh post
#   SSL 証明書確認:     bash phase_cf2_verify.sh ssl
#   全ステップ実行:     bash phase_cf2_verify.sh all

DOMAIN="tagdeck.jp"
WORKERS_URL="tagdeck.bb25xp.workers.dev"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; }
info() { echo -e "${YELLOW}[INFO]${NC} $1"; }

# -----------------------------------------------
# 共通: ヘッダー取得してキーヘッダーを表示
# -----------------------------------------------
check_headers() {
  local url="$1"
  local label="$2"
  echo ""
  info "=== $label ($url) ==="

  local headers
  headers=$(curl -sI --max-time 10 "$url" 2>&1)
  if [ $? -ne 0 ]; then
    fail "curl 失敗: $url"
    return 1
  fi

  echo "$headers"

  echo ""
  info "--- キーヘッダー判定 ---"

  # CF-RAY: Cloudflare 経由か判定
  if echo "$headers" | grep -qi "^CF-RAY:"; then
    pass "CF-RAY ヘッダーあり → Cloudflare Workers 経由"
  else
    info "CF-RAY ヘッダーなし → Cloudflare 非経由（Vercel または直接）"
  fi

  # x-vercel-id: Vercel 経由か判定
  if echo "$headers" | grep -qi "^X-Vercel-Id:"; then
    info "X-Vercel-Id ヘッダーあり → Vercel 経由"
  else
    pass "X-Vercel-Id ヘッダーなし → Vercel 非経由"
  fi

  # Server ヘッダー
  local server
  server=$(echo "$headers" | grep -i "^Server:" | head -1)
  info "Server: $server"

  # HTTP ステータス
  local status
  status=$(echo "$headers" | head -1)
  if echo "$status" | grep -q "200"; then
    pass "HTTP ステータス: $status"
  else
    fail "HTTP ステータス異常: $status"
  fi
}

# -----------------------------------------------
# HTTP → HTTPS リダイレクト確認
# -----------------------------------------------
check_http_redirect() {
  local domain="$1"
  echo ""
  info "=== HTTP → HTTPS リダイレクト確認 ($domain) ==="

  local headers
  headers=$(curl -sI --max-time 10 "http://$domain" 2>&1)
  local location
  location=$(echo "$headers" | grep -i "^Location:" | head -1)
  local status
  status=$(echo "$headers" | head -1)

  info "Status: $status"
  info "Location: $location"

  if echo "$status" | grep -qE "301|302|307|308"; then
    if echo "$location" | grep -qi "https://"; then
      pass "HTTP → HTTPS リダイレクト正常"
    else
      fail "リダイレクト先が HTTPS でない: $location"
    fi
  else
    info "リダイレクトなし（200 直接応答 or エラー）"
  fi
}

# -----------------------------------------------
# SSL 証明書発行者確認
# -----------------------------------------------
check_ssl() {
  local domain="$1"
  echo ""
  info "=== SSL 証明書確認 ($domain) ==="

  # curl -v で証明書情報を取得
  local ssl_info
  ssl_info=$(curl -sv --max-time 15 "https://$domain" 2>&1 | grep -E "subject|issuer|expire|SSL|TLS|certificate")
  if [ -n "$ssl_info" ]; then
    echo "$ssl_info"
  else
    info "curl -v からの証明書情報なし。openssl で試みます..."
  fi

  # openssl s_client で発行者確認
  if command -v openssl &>/dev/null; then
    local openssl_out
    openssl_out=$(echo | openssl s_client -connect "${domain}:443" -servername "$domain" 2>&1 | openssl x509 -noout -issuer -subject -dates 2>/dev/null)
    if [ $? -eq 0 ] && [ -n "$openssl_out" ]; then
      echo "$openssl_out"
      if echo "$openssl_out" | grep -qi "cloudflare"; then
        pass "発行者: Cloudflare（Workers Custom Domain SSL）"
      elif echo "$openssl_out" | grep -qi "Let's Encrypt\|E1\|R3\|R10\|R11"; then
        info "発行者: Let's Encrypt（Vercel または旧 SSL）"
      else
        info "発行者: その他（上記参照）"
      fi
    else
      info "openssl x509 解析失敗（まだ証明書が発行されていない可能性あり）"
    fi
  else
    info "openssl コマンドが見つかりません。curl -v の結果のみ参照してください"
  fi
}

# -----------------------------------------------
# DNS A レコード確認（切替前後の変化を記録）
# -----------------------------------------------
check_dns() {
  local domain="$1"
  echo ""
  info "=== DNS A レコード ($domain) ==="

  if command -v dig &>/dev/null; then
    dig A "$domain" +short
  else
    nslookup -type=A "$domain" 2>/dev/null | grep "Address:" | grep -v "#"
  fi
}

# -----------------------------------------------
# 切替前ベースライン
# -----------------------------------------------
baseline() {
  echo "================================================"
  echo " Phase CF-2 切替前ベースライン取得"
  echo " $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  echo "================================================"

  check_dns "$DOMAIN"
  check_headers "https://$DOMAIN" "本番ドメイン (Vercel 経由想定)"
  check_headers "https://$WORKERS_URL" "Workers dev URL"
  check_http_redirect "$DOMAIN"
  check_ssl "$DOMAIN"
}

# -----------------------------------------------
# 切替後検証
# -----------------------------------------------
post() {
  echo "================================================"
  echo " Phase CF-2 切替後検証"
  echo " $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  echo "================================================"
  echo ""
  info "切替後検証を開始します。DNS TTL=300 秒のため、切替直後はキャッシュが残る場合があります。"

  check_dns "$DOMAIN"
  check_headers "https://$DOMAIN" "本番ドメイン (Workers 経由期待)"
  check_http_redirect "$DOMAIN"
  check_ssl "$DOMAIN"

  echo ""
  info "=== 切替後チェックリスト ==="
  echo ""
  echo "以下をブラウザでも手動確認してください:"
  echo "  [ ] https://$DOMAIN が表示される"
  echo "  [ ] ログイン（Supabase Auth）が機能する"
  echo "  [ ] イベント一覧が取得できる（Supabase DB 疎通）"
  echo "  [ ] ふわっちイベントランキングが更新される"
  echo "  [ ] Kick モニターが動作する"
  echo "  [ ] ニコ生データが取得される"
  echo "  [ ] ブラウザコンソールに重大エラーなし"
}

# -----------------------------------------------
# SSL のみ
# -----------------------------------------------
ssl() {
  check_ssl "$DOMAIN"
}

# -----------------------------------------------
# all
# -----------------------------------------------
all() {
  baseline
  echo ""
  echo "================================================"
  echo " 切替後検証は DNS 切替完了後に実行してください"
  echo " コマンド: bash phase_cf2_verify.sh post"
  echo "================================================"
}

# -----------------------------------------------
# エントリポイント
# -----------------------------------------------
case "${1:-all}" in
  baseline) baseline ;;
  post)     post ;;
  ssl)      ssl ;;
  all)      all ;;
  *)
    echo "使い方: $0 {baseline|post|ssl|all}"
    echo "  baseline: 切替前ベースライン取得"
    echo "  post:     切替後検証"
    echo "  ssl:      SSL 証明書確認のみ"
    echo "  all:      baseline を実行"
    exit 1
    ;;
esac
