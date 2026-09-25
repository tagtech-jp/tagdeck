# TagDeck 現状棚卸しレポート v1 (2026-05-10)

> 作成目的: マルチPFコメントビューア化の判断材料。実装提案は含まない。

---

## (a) メタ情報

| 項目 | 内容 |
|---|---|
| 作成日 | 2026-05-10 |
| 作成者 | CTO 真鍋玲央 (Claude Code) |
| ブランチ名 | `feature/phase2-beta` |
| 対象コミットハッシュ | `5289f0b` |
| コミット日時 | 2026-05-09 18:18:37 +0900 |
| コミットメッセージ | `docs(phase2): 棚卸しレポート + 計画書 v1.0 (作業 ④/②/① 根拠)` |
| 前回棚卸し | `D:\tagdeck\docs\architecture\phase2_inventory_20260509.md` |
| 棚卸しモード | **read-only** — 既存ファイル変更ゼロ |

---

## (b) 技術スタックサマリー

| カテゴリ | 採用技術 | バージョン | 備考 |
|---|---|---|---|
| フレームワーク | Next.js | 16.2.4 | **App Router** 使用 |
| UI ライブラリ | React / React DOM | 19.2.4 | Strict Mode 有効 |
| デプロイターゲット | Cloudflare Workers | — | @opennextjs/cloudflare + wrangler v4 |
| ビルドツール | Turbopack | — | `next dev --turbopack` / `next build --turbopack` |
| 言語 | TypeScript | ^5 | strict モード |
| DB ORM | Drizzle ORM | ^0.45.2 | Drizzle-Kit でマイグレーション管理 |
| DB / Auth / Realtime | Supabase | @supabase/supabase-js ^2.105 | PostgreSQL + RLS + Realtime Subscriptions |
| DB クライアント（直接） | postgres | ^3.4.9 | Drizzle 用ドライバ |
| 状態管理（グローバル） | Zustand | ^5.0.13 | `platform-store` / `crm-filter-store` |
| 状態管理（サーバー） | TanStack Query | ^5.100 | キャッシュ・ミューテーション |
| フォーム | React Hook Form + Zod | ^7.75 / ^4.4.3 | バリデーション統合 |
| スタイリング | Tailwind CSS v4 | ^4 | `postcss.config.mjs` 経由 (tailwind.config.* なし) |
| UIコンポーネント | shadcn/ui (base-nova) | ^4.7.0 | Base UI ベース (Radix UI ではない) |
| アニメーション | framer-motion | ^12.38 | `next/dynamic` 遅延ロード必須 |
| チャート | recharts | ^3.8.1 | `next/dynamic` 遅延ロード必須 |
| PWA | Serwist | ^9.5.11 | production のみ有効 (dev 無効化) |
| テスト | Vitest | ^4.1.5 | unit test + 実 API テスト |
| リアルタイム通信（Kick） | pusher-js | ^8.5.0 | 公式 Pusher WebSocket |
| トースト通知 | sonner | ^2.0.7 | — |

### ルーター判定

`src/app/` 配下に `page.tsx` / `route.ts` が存在 → **App Router** 確定。  
`pages/` ディレクトリは存在しない。

### Next.js 16.2 特記事項

- `middleware.ts` は Next.js 16 で deprecated → `src/proxy.ts` に移行済み（ただし現時点で `src/proxy.ts` ファイルは未作成。`src/lib/supabase/middleware.ts` に auth ロジックは分離済み）
- `params` / `searchParams` は Promise → 各 route で `await` 必須
- デフォルト dynamic レンダリング / `use cache` ディレクティブで明示キャッシュ

---

## (c) ディレクトリ構造（深さ3）

```
D:\tagdeck\
├── .github/
│   └── workflows/
├── data/
│   └── n8n_workflows/          # fuwacchi 日次同期ワークフロー格納
├── docs/
│   ├── architecture/           # フェーズ別設計書・棚卸し
│   ├── features/               # 機能運用手順書
│   └── legal/                  # スクレイピング法務調査
├── drizzle/
│   └── meta/                   # Drizzle マイグレーション履歴
├── logs/                       # (空) 運用ログ予定
├── public/
│   └── icons/                  # PWA アイコン等
├── scripts/
│   └── platforms/
│       └── fuwacchi/           # Python 日次同期スクリプト (schtasks 経由)
│           ├── sync_items_and_events.py
│           ├── run_sync_wrapper.py
│           ├── run_sync.bat
│           └── test_sync_items_and_events.py
├── src/
│   ├── app/
│   │   ├── (auth)/             # ログイン / 登録 / パスワードリセット
│   │   │   ├── login/
│   │   │   ├── reset-password/
│   │   │   └── signup/
│   │   ├── (dashboard)/        # 認証要求エリア
│   │   │   ├── ai-prompter/    # ディレクトリのみ存在・page.tsx なし (未実装スタブ)
│   │   │   ├── crm/
│   │   │   ├── dashboard/
│   │   │   ├── events/
│   │   │   └── settings/
│   │   │       ├── notifications/
│   │   │       └── platforms/
│   │   ├── (legal)/            # 公開法務ページ
│   │   │   ├── privacy/
│   │   │   └── terms/
│   │   ├── api/
│   │   │   ├── events/         # イベントシミュレーター CRUD + 計算
│   │   │   │   └── [id]/       # complete / historical-pace / manual-rivals / refresh-ranking
│   │   │   └── platforms/
│   │   │       ├── fuwacchi/   # events / items / monitor / poll / profile
│   │   │       ├── kick/       # event / monitor / profile
│   │   │       └── niconico/   # monitor / poll / profile
│   │   └── auth/
│   │       ├── callback/
│   │       ├── confirm/
│   │       └── signout/
│   ├── components/
│   │   ├── auth/               # OAuthButtons
│   │   ├── crm/                # ディレクトリのみ・ファイルなし (未実装)
│   │   ├── dashboard/          # ListenerCard/List・StatsPanel・MonitorButton×3・PlatformSwitcher
│   │   ├── events/             # EventCreateForm・EventDashboard・RankDistributionChart・RivalsList
│   │   ├── layout/             # BetaBanner・Footer
│   │   ├── nav/                # BottomTabBar・Sidebar
│   │   ├── settings/           # FuwacchiSettings・KickSettings・NiconicoSettings
│   │   ├── shared/             # (空ディレクトリ)
│   │   ├── stats/              # EventTicker・GoalProgressBar・HourlyRateChart・ViewerCounter
│   │   └── ui/                 # shadcn/ui プリミティブ 13 種
│   ├── hooks/
│   │   ├── useEventSimulator.ts
│   │   ├── useFuwacchiMonitor.ts
│   │   ├── useHistoricalPace.ts
│   │   ├── useKickMonitor.ts
│   │   └── useNiconicoMonitor.ts
│   │   └── useResponsive.ts
│   ├── lib/
│   │   ├── db/                 # Drizzle クライアント + スキーマ
│   │   ├── events/             # bayesian.ts / calculator.ts / monte-carlo.ts
│   │   ├── mock/               # listeners.ts / stats.ts (モックデータ)
│   │   ├── platforms/
│   │   │   ├── fuwacchi.ts     # ふわっち REST API クライアント
│   │   │   ├── fuwacchi-ranking.ts # ランキング HTML パース
│   │   │   ├── fuwacchi/       # event-list.ts / item-mapping.ts (+ unit tests)
│   │   │   ├── kick.ts         # Kick REST API + Pusher 設定
│   │   │   └── niconico.ts     # ニコ生 REST API クライアント
│   │   ├── supabase/           # client.ts / server.ts / middleware.ts
│   │   ├── utils.ts
│   │   └── validations/        # auth.ts (Zod スキーマ)
│   ├── stores/
│   │   ├── crm-filter-store.ts
│   │   └── platform-store.ts
│   └── types/
│       ├── listener.ts
│       ├── platform.ts
│       └── stats.ts
└── workers/
    ├── fuwacchi-poller/        # ディレクトリのみ・ファイルなし (未実装)
    ├── kick-watcher/           # ディレクトリのみ・ファイルなし (未実装)
    └── niconico-watcher/       # ディレクトリのみ・ファイルなし (未実装)
```

---

## (d) 機能マップ

### ページ一覧（13 ページ）

| ルート | ファイル | 機能概要 | 主要依存 |
|---|---|---|---|
| `/` | `src/app/page.tsx` | LP。ログイン状態に応じてダッシュボード or ログインへ誘導 | Supabase server client |
| `/login` | `(auth)/login/page.tsx` | メール + OAuth（X）ログイン | OAuthButtons, react-hook-form, Zod |
| `/signup` | `(auth)/signup/page.tsx` | メール新規登録 | react-hook-form, Zod |
| `/reset-password` | `(auth)/reset-password/page.tsx` | パスワードリセット申請 | react-hook-form |
| `/(dashboard)` | `(dashboard)/page.tsx` | `/dashboard` へリダイレクト | — |
| `/dashboard` | `(dashboard)/dashboard/page.tsx` | メインダッシュボード。3PF 監視・視聴者数・統計 | useFuwacchiMonitor / useKickMonitor / useNiconicoMonitor / StatsPanel / ListenerList |
| `/crm` | `(dashboard)/crm/page.tsx` | リスナー CRM 一覧（フィルタ・検索）| crm-filter-store / TanStack Query |
| `/events` | `(dashboard)/events/page.tsx` | イベント勝率シミュレーター | EventCreateForm / EventDashboard / RankDistributionChart / RivalsList |
| `/settings` | `(dashboard)/settings/page.tsx` | 設定ハブ（notifications / platforms サブリンク）| — |
| `/settings/notifications` | settings/notifications/page.tsx | 通知設定（実装状況不明） | — |
| `/settings/platforms` | settings/platforms/page.tsx | 3PF 接続設定 | FuwacchiSettings / KickSettings / NiconicoSettings |
| `/privacy` | `(legal)/privacy/page.tsx` | プライバシーポリシー（静的） | — |
| `/terms` | `(legal)/terms/page.tsx` | 利用規約（静的） | — |

**未実装スタブ**: `(dashboard)/ai-prompter/` — ディレクトリのみ、`page.tsx` なし

### API エンドポイント一覧（19 ルート）

#### イベントシミュレーター（5 エンドポイント）

| メソッド | パス | 役割 |
|---|---|---|
| GET / POST | `/api/events` | イベント一覧取得 / 新規作成 |
| POST | `/api/events/[id]/complete` | イベント完了・eventHistory 保存 |
| GET | `/api/events/[id]/historical-pace` | ベイズ学習用過去ペース取得 |
| PUT | `/api/events/[id]/manual-rivals` | 手動ライバル上書き |
| POST | `/api/events/[id]/refresh-ranking` | ランキングデータ再取得 |

#### ふわっちプラットフォーム（5 エンドポイント）

| メソッド | パス | 役割 |
|---|---|---|
| GET | `/api/platforms/fuwacchi/events` | fuwacchi_events テーブル取得 |
| GET | `/api/platforms/fuwacchi/items` | item_point_mapping テーブル取得 |
| GET | `/api/platforms/fuwacchi/monitor` | 監視状態取得 |
| POST | `/api/platforms/fuwacchi/poll` | 5 秒ポーリング（視聴者数・ポイント・ランキング取得） |
| GET | `/api/platforms/fuwacchi/profile` | プロフィール取得 |

#### Kick プラットフォーム（3 エンドポイント）

| メソッド | パス | 役割 |
|---|---|---|
| POST | `/api/platforms/kick/event` | Pusher 受信イベントの DB 書き込み |
| GET | `/api/platforms/kick/monitor` | 監視状態取得 |
| GET | `/api/platforms/kick/profile` | Kick REST API プロフィール取得 |

#### ニコ生プラットフォーム（3 エンドポイント）

| メソッド | パス | 役割 |
|---|---|---|
| GET | `/api/platforms/niconico/monitor` | 監視状態取得 |
| POST | `/api/platforms/niconico/poll` | ライブポーリング（視聴者数・コメント数取得） |
| GET | `/api/platforms/niconico/profile` | ニコ生プロフィール取得 |

#### 認証（3 エンドポイント）

| メソッド | パス | 役割 |
|---|---|---|
| GET | `/auth/callback` | OAuth コールバック受信 |
| GET | `/auth/confirm` | メール確認リンク処理 |
| POST | `/auth/signout` | セッション破棄 |

### カスタムフック・責務一覧

| フック | 接続先 | 取得内容 |
|---|---|---|
| `useFuwacchiMonitor` | `/api/platforms/fuwacchi/poll` (5 秒 setInterval) | 視聴者数・ポイント・監視状態 |
| `useKickMonitor` | Pusher WebSocket (公式) | chat_message / GIFTED_SUBSCRIPTIONS / SUBSCRIPTION / STREAMER_IS_LIVE / STOP_STREAM |
| `useNiconicoMonitor` | `/api/platforms/niconico/poll` (setInterval) | 視聴者数・コメント数 |
| `useEventSimulator` | `/api/events/*` | Monte Carlo 計算結果・ランキング |
| `useHistoricalPace` | `/api/events/[id]/historical-pace` | ベイズ事前分布データ |
| `useResponsive` | window.matchMedia | ブレークポイント判定 |

### DB スキーマ要約（6 テーブル）

| テーブル | 主な目的 |
|---|---|
| `users` | 認証ユーザー（UUID・email） |
| `streamer_profiles` | 3PF の接続情報・監視状態（fuwacchi / kick / niconico 各カラム） |
| `listeners` | リスナー CRM（totalGiftAmount / totalCommentCount / platform / lastSeenAt） |
| `events` | プラットフォームイベントログ（comment / gift / enter / leave） |
| `event_simulators` | イベント勝率シミュレーター設定・進捗・Monte Carlo 結果キャッシュ |
| `event_history` | 完了イベント履歴（ベイズ学習用 fullPaceHistory） |
| `item_point_mapping` | ふわっちアイテム単価マスター（n8n 日次同期） |
| `fuwacchi_events` | ふわっちイベント一覧（n8n 日次同期） |

---

## (e) Phase 2-β 追加変更要約（git log 由来）

`feature/phase2-beta` ブランチが `main` に対して追加したコミット（4 件）:

| コミット | タイトル | 主要変更 |
|---|---|---|
| `ff783da` | `feat(beta): BetaBanner + 利用規約 + プライバシーポリシー` | BetaBanner コンポーネント追加、`/(legal)/privacy`・`/(legal)/terms` ルート新規作成 |
| `8ab4e49` | `feat(seo): metadata 拡充 + sitemap + robots + OG動的生成 + JSON-LD` | `generateMetadata` 対応・`public/sitemap.xml`・`public/robots.txt` 追加・JSON-LD 構造化データ |
| `e76181f` | `feat(lp): LP 刷新 + Footer + マルチプラットフォーム方針反映` | LP (`src/app/page.tsx`) の訴求コピー追加・Footer コンポーネント追加・マルチPF明示 |
| `5289f0b` | `docs(phase2): 棚卸しレポート + 計画書 v1.0` | `phase1_snapshot_20260509.md`・`phase2_inventory_20260509.md`・`phase2_plan_v1.md` 追加（1,102 行） |

> **Phase 命名の補足**: git log 上の Phase 4a/4b/4c（PF統合）・Phase 5a/5b/5c（シミュレーター）は main ブランチのコミット。`feature/phase2-beta` は「ベータ運用フェーズ」として再定義された LP / SEO / 法務ページ群を main に追加する予定のブランチ。

---

## (f) 外部連携・依存表

### 配信プラットフォーム

| プラットフォーム | 接続方式 | エンドポイント / SDK | 取得データ | 法務制約 |
|---|---|---|---|---|
| ふわっち | HTTP REST ポーリング (5 秒) | `api.whowatch.tv` (公開) | 視聴者数・ポイント・ライブID・ランキング | robots.txt 準拠・x-whowatch-device-id ヘッダ必須・25 秒以上間隔（ランキング HTML）|
| Kick | Pusher WebSocket (公式) | appKey=公開固定値 / cluster=us2 | chat_message / ギフトサブ / LIVE 状態 | 公式 API のみ・リバースエンジニアリング禁止 |
| ニコ生 | HTTP REST ポーリング | `live.nicovideo.jp` (公開) | 視聴者数・コメント数・放送ID | 公式エンドポイントのみ |

### インフラ・SaaS

| サービス | 用途 | SDK / ツール |
|---|---|---|
| Supabase | PostgreSQL + Auth (email/OAuth) + Realtime Subscriptions + RLS | @supabase/supabase-js / @supabase/ssr |
| Cloudflare Workers | デプロイターゲット (nodejs_compat) | @opennextjs/cloudflare / wrangler |
| n8n | ふわっちアイテム・イベント日次同期ワークフロー | n8n_workflows/ (ローカル定義) |

### 環境変数（キー名のみ・値は記載しない）

| キー名 | 用途 |
|---|---|
| `DATABASE_URL` | Drizzle ORM → Supabase Transaction Pooler |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase クライアント初期化 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase クライアント初期化 |
| `FUWACCHI_DEVICE_ID` | `x-whowatch-device-id` ヘッダ値（event-list API 認証） |

### Cloudflare Workers 制約（AGENTS.md より）

| 制約 | 内容 |
|---|---|
| バンドルサイズ | 25 MiB 上限 → framer-motion / recharts は `next/dynamic` 遅延ロード必須 |
| CPU time | 10 ms / request (Free プラン) → 重い処理は Durable Objects が必要 |
| DB クライアント | グローバル保持禁止 → Route Handler 内で都度インスタンス化 |
| ランタイム | Edge Runtime ではなく Node.js Runtime (nodejs_compat) |

---

## (g) コメントビューア化に向けた論点

以下は棚卸し結果から導出した技術的観察。提案・実装案は含まない。

### 論点 1: コメント取得能力のプラットフォーム間ギャップ

現状のコメント関連実装は PF によって大きく異なる。

| プラットフォーム | コメント本文取得 | 取得方式 | DB 格納 |
|---|---|---|---|
| Kick | **取得中** (`chat_message` イベント) | Pusher WebSocket（公式） | `events` テーブル (`eventType='comment'`) |
| ニコ生 | **カウントのみ** (`niconicoCommentCount`) | HTTP ポーリング | コメント本文は未保存 |
| ふわっち | **未取得** | 5 秒ポーリング（視聴者数・ポイント中心） | `totalCommentCount` カラムはあるが本文なし |

マルチ PF コメント統合ビューを実現するには、各 PF の取得層を「本文取得」まで揃える必要がある。ふわっちはコメント取得の公開 API が確認されておらず（AGENTS.md に非公式 WebSocket 禁止の明示制約あり）、ニコ生はコメント本文取得の別エンドポイントが未実装。

### 論点 2: Cloudflare Workers の常時接続制約

現状の Kick 監視は**クライアントサイドで Pusher WebSocket を直接接続**している（`useKickMonitor.ts`）。コメントビューアを「サーバーがチャットを受信し DB に格納・クライアントは Supabase Realtime で購読」に切り替える場合、サーバー側で長時間 WebSocket を維持する必要が生じる。

Cloudflare Workers (Free プラン) は **CPU time 10 ms / request**・Durable Objects はデフォルト未使用。`workers/kick-watcher/` ディレクトリは存在するがファイルが 1 件もない。長時間接続ワーカーを Cloudflare で動かすには Durable Objects (Paid) か、別ホスト（Vercel Functions / Fly.io 等）への分離が前提となる。

### 論点 3: コメント表示 UI コンポーネントが存在しない

現在の `src/components/` には視聴者統計・イベントシミュレーター・CRM 系のコンポーネントのみ存在し、**コメントを一覧表示する UI コンポーネントは 1 件もない**。  

`src/components/shared/` ディレクトリは空。`src/components/crm/` も空。コメントビューア UI（スクロール表示・スタック・吹き出し・プラットフォームアイコン等）はゼロからの新規実装になる。

### 論点 4: わんコメ / Social Stream Ninja との統合経路がない

コードベース全体を grep した結果、`localhost:11180`・`Social Stream Ninja`・`わんコメ` に関する実装は **0 件**。  

外部コメント集約ツール（わんコメ）はローカルプロセスが `ws://localhost:11180` で WebSocket を提供するが、TagDeck は SaaS（Cloudflare Workers / Vercel ホスト）であり、ブラウザのセキュリティ制約（Mixed Content / CORS）からサーバーサイドでのブリッジは困難。ブラウザ拡張・ローカルプロキシ・ユーザーのブラウザから直接接続する構成いずれかが必要だが、現状は設計・実装ともに存在しない。

### 論点 5: SSE / EventSource の未採用

PF 監視の通知手段は現状 (a) クライアント側 `setInterval` + fetch ポーリング（ふわっち・ニコ生）、(b) Pusher WebSocket クライアント直結（Kick）、(c) Supabase Realtime Subscriptions（profile 変更監視）の 3 パターン。  

SSE (Server-Sent Events) / `EventSource` の実装は **0 件**。コメントビューア化の際にサーバープッシュをどの方式（SSE / Supabase Realtime / Pusher チャンネル）で統一するかは未決定。Cloudflare Workers のストリーミング対応制約（CPU time 10 ms）も考慮が必要。

---

*以上。棚卸しレポート v1 終了。*
