# TagDeck

配信者向けセカンドスクリーン SaaS。ふわっち（whowatch.tv）・ニコ生・Kick で配信する配信者が、配信中にサブ端末でリスナー CRM・AI 接客カンペ・イベント勝率シミュレーターを参照するためのアプリです。

- 本番: https://tagdeck.jp （Cloudflare Workers / OpenNext）
- 詳細仕様: [docs/spec/tagdeck_spec_v1.md](docs/spec/tagdeck_spec_v1.md)
- 構成設計: [docs/architecture/tagdeck_architecture_v1.md](docs/architecture/tagdeck_architecture_v1.md)
- AI エージェント向け指示: [AGENTS.md](AGENTS.md) / [CLAUDE.md](CLAUDE.md) / [CODEX_CLAUDE.md](CODEX_CLAUDE.md)

## 技術スタック

| 区分 | 採用技術 |
|---|---|
| フレームワーク | Next.js 16.2 (App Router) / React 19.2 |
| ホスティング | Cloudflare Workers（@opennextjs/cloudflare） |
| DB / 認証 | Supabase Postgres + Supabase Auth / Drizzle ORM |
| UI | Tailwind CSS 4 / shadcn/ui (Base UI) / Recharts |
| 状態管理 | Zustand / TanStack Query |
| テスト | Vitest（TS）+ pytest（同期スクリプト） |
| CI/CD | GitHub Actions（main push → 型チェック → テスト → ビルド → wrangler deploy） |

## 開発

```bash
pnpm install
pnpm dev          # 開発サーバー（Turbopack）
pnpm test         # Vitest
pnpm exec tsc --noEmit  # 型チェック
pnpm run build    # 本番ビルド（webpack）
```

環境変数は `.env.local` に設定する（`.env.local.example` 参照・書式は AGENTS.md「環境変数の書式」に従う）。

## 主要機能

| 機能 | パス | 状態 |
|---|---|---|
| プラットフォーム監視ダッシュボード | `/dashboard` | 稼働中（ふわっち・Kick・ニコ生） |
| イベント勝率シミュレーター | `/events` | 稼働中（モンテカルロ + 経験ベイズ） |
| ライブコックピット（ギフト SE） | `/live` | 稼働中（`?debug=1` で遅延の計測パネル） |
| リスナー CRM | `/crm` | UI のみ（モックデータ・実データ連携は今後） |
| AI 接客カンペ | `/ai-prompter` | UI のみ（モックデータ） |
| YouTube Live 連携 | — | 未実装（OAuth 基盤のみ） |

## 運用時の確認

- `/live` の接続中はタブのタイマー間引きを防ぐため極小音（約 -60dBFS）を鳴らし続けている。配信に乗らないことを確認するには、OBS の当該デスクトップ音声ソースのレベルメーターを接続中に見て、無音時に振れないことを確かめる
- 「配信開始時に自動接続」が ON でも、**音声を許可していない状態では待機中のポーリングがブラウザに間引かれ、配信開始の検知が最大 1 分程度遅れる**。画面上部の「🔊 音を有効にする」を押すと解消する（ブラウザの自動再生制限のため、一度は操作が要る）
- 接続したまま他のページへ移動しても SE は鳴り続ける（停止を押すまで）。**ただしブラウザのタブを閉じると止まる**。タブを閉じても鳴らし続けることは技術的にできない
- `/live?debug=1` の計測パネルで遅延を見るときは「投げられた→SE」だけでなく「到着ゆらぎ（時計ズレ除去・最速比）」を見る。ふわっちと手元の時計差（実測 約 1.5 秒）が「投げられた→SE」に混ざるため、ゆらぎが小さければ実遅延ではない（2026-09-25 実測: WS 経由で投げられた→SE 平均 379ms・到着ゆらぎ 平均 54ms・SE キュー待ち 0ms。残りはふわっち側の配信時間と `posted_at` の秒丸めで TagDeck 側では削れない）
- SE タブでアップロードしたカスタム音源は、音を有効にした時点と設定変更時に先読み（取得とデコード〔音声データの展開〕）される。初回に鳴るときの数百 ms の遅れは 2026-09-25 に解消済み
- コンボ機能（連投の重ね鳴らし）は廃止済み。廃止前に保存された `se_mappings` の `tier:combo` の行は参照されないまま残るため、気になる場合のみ手動で削除する（残しておいても動作に影響はない）

## 用語

内部識別子は `whowatch`（実サービスドメイン whowatch.tv に準拠）で統一。UI 表示は「ふわっち」（2026-07-18 統一方針・docs/spec/tagdeck_spec_v1.md §7）。

## 法務制約（最重要）

- ふわっちは公開 API のポーリングのみ。非公式 WebSocket・リバースエンジニアリング禁止
- Kick は公式 Pusher WebSocket、ニコ生は公式 NDGR のみ
- 詳細: [docs/legal/scraping-compliance-2026-05-09.md](docs/legal/scraping-compliance-2026-05-09.md)
