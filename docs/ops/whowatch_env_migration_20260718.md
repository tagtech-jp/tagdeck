# 【社長作業】whowatch 統一 — Secrets/環境変数 切替手順書 (2026-07-18)

> 作成: Claude Code（TagTech / Fable 5 セッション 20260718・P3 成果物）
> 対象: `FUWACCHI_DEVICE_ID` → `WHOWATCH_DEVICE_ID` の実環境切替（コード側は本ブランチで変更済み）

---

## ⚠️ 最重要警告

**切替（下記 手順1）完了前に、本ブランチ `feat/tagdeck-spec-impl-20260718` を main へマージ／デプロイしてはならない。**

理由: 本ブランチのコードは環境変数 `WHOWATCH_DEVICE_ID` のみを参照する。旧名 `FUWACCHI_DEVICE_ID` しか存在しない環境にデプロイすると、ふわっち関連の全 API 呼び出しで device-id が空になり、ポーリング・イベント一覧取得が機能停止する。

さらに本ブランチは **P4 の DB rename migration（別手順書 `docs/ops/whowatch_db_migration_20260718.md`）の適用も前提**とする。マージ/デプロイの前提条件は「手順1完了 **かつ** P4 SQL適用完了」の両方である。

---

## 切替対象の一覧

| 環境 | 変数/Secret 名 | 切替方法 |
|---|---|---|
| Cloudflare Workers Secrets（メインアプリ） | `FUWACCHI_DEVICE_ID` → `WHOWATCH_DEVICE_ID` | 手順1-A |
| ローカル開発 `.env.local` | 同上 | 手順1-B（社長手動・CC は .env 非接触） |
| Render.com（whowatch-poller、旧 fuwacchi-poller） | 同上 + サービス名/rootDir 変更 | 手順1-C |
| n8n 環境変数（日次同期。※n8n 廃止方向のため任意） | 同上 | 手順1-D（任意） |
| GitHub Actions Secrets | 対象なし（`FUWACCHI_DEVICE_ID` は GitHub Secrets に存在しない。`docs/architecture/ci_cd_v1.md` §2 参照） | — |

---

## 手順1: 新名 Secrets を旧名と並存で追加（デプロイ前・いつでも安全に実行可）

旧名を残したまま新名を追加する。旧名参照の現行 main デプロイと新名参照の本ブランチのどちらが動いていても壊れない状態を作る。

### 1-A. Cloudflare Workers Secrets

```powershell
# 実値はパスワードマネージャー等から取得し、対話プロンプトに貼り付ける（コマンドラインに直書きしない）
cd D:\tagdeck
npx wrangler secret put WHOWATCH_DEVICE_ID
# → プロンプトに旧 FUWACCHI_DEVICE_ID と同じ値を入力

# 登録確認（値は表示されない・名前のみ）
npx wrangler secret list
```

`wrangler secret list` の出力に `WHOWATCH_DEVICE_ID` と `FUWACCHI_DEVICE_ID` が**両方**並んでいれば手順1-A 完了。

### 1-B. ローカル `.env.local`（社長手動）

`D:\tagdeck\.env.local` をエディタで開き、既存の `FUWACCHI_DEVICE_ID=<値>` の行の**下に**同じ値で1行追加する（旧行はまだ消さない）:

```
FUWACCHI_DEVICE_ID=<既存の値そのまま>
WHOWATCH_DEVICE_ID=<同じ値をコピー>
```

- 書式注意（`AGENTS.md` 準拠）: `KEY=VALUE` 形式・`=` 前後に空白なし・クォート不要
- 変更後、ローカル開発サーバーを再起動（HMR では反映されない）
- **`.env.local.example` の更新も社長作業**（CC は権限設定により .env 系ファイル非接触）: `FUWACCHI_DEVICE_ID=` の行を `WHOWATCH_DEVICE_ID=` に書き換え、本ブランチに commit する（`git add .env.local.example`）。※example はプレースホルダーのみで実値を含まないことを確認してから commit すること

### 1-C. Render.com（whowatch-poller）

本ブランチで `render.yaml` のサービス名が `tagdeck-fuwacchi-poller` → `tagdeck-whowatch-poller`、rootDir が `workers/whowatch-poller` に変更されている。Render は名前でサービスを対応付けるため、マージ後の初回同期で**新サービスとして再作成**される可能性が高い（(要確認) Render の Blueprint 同期挙動）。

1. Render ダッシュボード → 現行 `tagdeck-fuwacchi-poller` → Environment に `WHOWATCH_DEVICE_ID` を追加（値は旧と同じ）
2. マージ後、新サービス `tagdeck-whowatch-poller` が作成された場合は `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `WHOWATCH_DEVICE_ID` の3件を新サービス側に設定
3. 新サービスの `/health` が 200 を返すことを確認後、旧サービスを Suspend → 削除

### 1-D. n8n（任意・廃止方向）

n8n の日次同期 `tagdeck_fuwacchi_sync_daily` は廃止方向のため必須ではない。継続する場合のみ: n8n の環境変数に `WHOWATCH_DEVICE_ID` を追加し、ワークフローを本リポジトリの `data/n8n_workflows/tagdeck_whowatch_sync_daily.json`（更新済み・スクリプトパス `scripts/platforms/whowatch/` / 環境変数新名参照）で再インポートする。

---

## 手順2: 本ブランチのマージ／デプロイ

前提条件（**両方**必須）:
- [ ] 手順1-A（Cloudflare 並存追加）完了
- [ ] P4 DB migration 適用完了（`docs/ops/whowatch_db_migration_20260718.md`）

を満たしたうえで、PR 作成 → main マージ → GitHub Actions 自動デプロイ。

> 注意: 現在 main には未 push commit（`ce0c880`・`0041579`）が滞留している。PR 作成前に main の push が必要（別途社長判断）。

---

## 手順3: 動作確認後に旧名 Secrets を削除

デプロイ後、以下を確認してから旧名を削除する:

1. tagdeck.jp にログインし、設定→プラットフォーム→ふわっち連携で監視開始→視聴者数が取得できる（`WHOWATCH_DEVICE_ID` が実際に使われている証跡）
2. イベント作成画面でふわっちイベント一覧が表示される

確認後:

```powershell
cd D:\tagdeck
npx wrangler secret delete FUWACCHI_DEVICE_ID
```

- `.env.local` の旧行 `FUWACCHI_DEVICE_ID=...` を削除（社長手動）
- Render 旧サービス側は 1-C の手順内で削除済みのはず（残っていればここで削除）

---

## ロールバック

手順3実施前なら、main を revert して再デプロイするだけで旧構成（旧名Secrets参照）に戻る。旧名 Secrets は手順3まで削除しないこと自体がロールバック保証である。

---

## 改訂履歴

| 版 | 日付 | 改訂内容 |
|---|---|---|
| 1.0 | 2026-07-18 | 初版（P3 成果物） |
