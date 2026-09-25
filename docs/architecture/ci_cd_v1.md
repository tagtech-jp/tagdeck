# TagDeck CI/CD 運用手順書 v1

> 作成: 2026-05-22 / CTO 真鍋玲央 + インフラ部長 宮本隆一

## 1. 概要

`.github/workflows/deploy.yml` が TagDeck の自動デプロイを担う。`main` ブランチへの push を検知し、以下の順に自動実行する:

1. 依存関係インストール (pnpm)
2. 型チェック (`tsc --noEmit`)
3. ユニットテスト (vitest)
4. opennextjs-cloudflare ビルド
5. Cloudflare Workers へデプロイ (`wrangler deploy`)

ステップ 2・3 が失敗した場合はデプロイを実行しない (fail-fast)。

## 2. 必要な Secrets

**GitHub Actions Secrets** (リポジトリ Settings → Secrets and variables → Actions):

| 名前 | 用途 |
|------|------|
| `CLOUDFLARE_API_TOKEN` | wrangler deploy 認証 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare アカウント特定 |
| `NEXT_PUBLIC_SUPABASE_URL` | ビルド時 Next.js インライン化 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ビルド時 Next.js インライン化 |

**Cloudflare Secrets** (`wrangler secret put` で設定・値はコード外で管理):

| 名前 | 用途 |
|------|------|
| `DATABASE_URL` | Supabase DB 接続 (ランタイム) |
| `WHOWATCH_DEVICE_ID` | ふわっち API device-id（旧名 `FUWACCHI_DEVICE_ID`・切替手順は docs/ops/whowatch_env_migration_20260718.md） |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase URL (ランタイム) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (ランタイム) |

## 3. 通常デプロイ手順

main ブランチに push するだけで自動デプロイが起動する。

```bash
git push origin main
# → GitHub Actions が起動 → 5〜8 分で tagdeck.jp に反映
```

進捗は GitHub Actions タブで確認できる。緑チェックが付いたら反映完了。

## 4. 緊急 rollback 手順

デプロイ後に障害が発生した場合:

```bash
# 直前のコミットに戻す revert を作成して push
git revert <戻したいcommit-hash>
git push origin main
# → CI が再起動し、revert 済みコードがデプロイされる
```

`git revert` は履歴を保持する安全な操作。`git reset --hard` + force push は禁止。

## 5. トラブルシューティング

| 症状 | 対処 |
|------|------|
| CI が起動しない | `.github/workflows/deploy.yml` の YAML 構文を確認 (インデント崩れ等) |
| Type check 失敗 | ローカルで `pnpm exec tsc --noEmit` を実行して型エラーを修正してから push |
| Unit tests 失敗 | ローカルで `pnpm test` を実行してテストを修正してから push |
| Build 失敗 | GitHub Secrets の `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` の値を確認 |
| Deploy 失敗 | `CLOUDFLARE_API_TOKEN` の期限・権限 (Edit Cloudflare Workers) を Cloudflare Dashboard で確認 |
