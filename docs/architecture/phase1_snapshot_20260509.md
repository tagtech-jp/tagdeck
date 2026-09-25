# TagDeck Phase 1 スナップショット (2026-05-09)

## 0. 棚卸し前提

| 項目 | 内容 |
|---|---|
| 実行日時 | 2026-05-09 |
| 実行者 | CTO 真鍋玲央 (Claude Code) |
| モード | **read-only** — 既存ファイルの変更・削除・リネーム禁止。git commit/push 禁止 |
| 出力物 | 本ファイル 1 件のみ新規作成 |
| 機密ファイル | .env.local (.env.local.example は権限ブロックで未読取。キー名はソースから抽出) |

---

## 1. ディレクトリ構造

```
D:\tagdeck\                          (ルート)
├── .github/workflows/
├── .open-next/.build/               (opennextjs-cloudflare ビルド出力)
├── .vercel/                         (Vercel プロジェクト設定)
├── data/
│   └── n8n_workflows/
│       └── tagdeck_fuwacchi_sync_daily.json
├── docs/
│   ├── architecture/
│   │   ├── fuwacchi_api_endpoints_v1.md
│   │   ├── phase5b-bayesian-design.md
│   │   └── phase5c-event-tracker-design.md
│   ├── features/
│   │   └── fuwacchi_sync_daily_ops_v1.md
│   └── legal/
│       └── scraping-compliance-2026-05-09.md
├── drizzle/                         (migration SQL + meta JSON)
├── logs/
│   └── fuwacchi_sync_20260509.log
├── public/                          (icons, manifest.json, SVG 群)
├── scripts/
│   └── platforms/fuwacchi/          (Python sync スクリプト + テスト)
├── src/
│   ├── app/
│   │   ├── (auth)/                  (login / signup / reset-password)
│   │   ├── (dashboard)/             (dashboard / events / crm / settings / ai-prompter)
│   │   ├── api/                     (Route Handlers — 後述)
│   │   └── auth/callback・confirm・signout
│   ├── components/
│   │   ├── auth/  dashboard/  events/  nav/  settings/  stats/  ui/
│   │   └── crm/  shared/             (フォルダのみ、tsx ファイル未確認)
│   ├── hooks/                       (6 カスタム hook)
│   ├── lib/
│   │   ├── db/  events/  mock/  platforms/  supabase/  validations/
│   │   └── utils.ts
│   ├── stores/                      (Zustand store 2 本)
│   └── types/                       (listener / platform / stats)
├── workers/
│   ├── fuwacchi-poller/
│   ├── kick-watcher/
│   └── niconico-watcher/            (フォルダのみ、実装ファイル未確認)
├── AGENTS.md  CLAUDE.md  README.md
├── drizzle.config.ts  next.config.ts  open-next.config.ts
├── wrangler.jsonc  tsconfig.json  pnpm-workspace.yaml
└── supabase_*.sql                   (RLS / Phase 5c 追加 SQL 群)
```

---

## 2. 依存関係・scripts

### scripts

| コマンド | 内容 |
|---|---|
| `dev` | `next dev --turbopack` |
| `build` | `next build --turbopack` |
| `start` | `next start` |
| `lint` | `next lint` |
| `preview` | `opennextjs-cloudflare build && preview` |
| `deploy` | `opennextjs-cloudflare build && deploy` |
| `db:generate` | `drizzle-kit generate` |
| `db:migrate` | `drizzle-kit migrate` |
| `db:studio` | `drizzle-kit studio` |
| `test` | `vitest run` |
| `test:watch` | `vitest` |

### dependencies (主要)

| パッケージ | バージョン | 用途 |
|---|---|---|
| next | 16.2.4 | フレームワーク |
| react / react-dom | 19.2.4 | UI |
| @supabase/supabase-js | ^2.105.3 | Auth + DB |
| @supabase/ssr | ^0.10.2 | SSR 対応 Supabase |
| drizzle-orm | ^0.45.2 | ORM |
| postgres | ^3.4.9 | Postgres クライアント |
| @tanstack/react-query | ^5.100.9 | サーバー状態管理 |
| zustand | ^5.0.13 | クライアント状態管理 |
| recharts | ^3.8.1 | グラフ |
| framer-motion | ^12.38.0 | アニメーション |
| pusher-js | ^8.5.0 | Kick WebSocket |
| @serwist/next | ^9.5.11 | PWA (Service Worker) |
| zod | ^4.4.3 | バリデーション |
| react-hook-form | ^7.75.0 | フォーム |
| sonner | ^2.0.7 | トースト通知 |
| lucide-react | ^1.14.0 | アイコン |
| shadcn | ^4.7.0 | UI コンポーネント生成 |
| date-fns | ^4.1.0 | 日付操作 |

### devDependencies (主要)

| パッケージ | バージョン | 用途 |
|---|---|---|
| @opennextjs/cloudflare | ^1.19.6 | CF Workers デプロイ |
| wrangler | ^4.88.0 | CF CLI |
| drizzle-kit | ^0.31.10 | migration CLI |
| vitest | ^4.1.5 | テストランナー |
| typescript | ^5 | 型システム |
| tailwindcss | ^4 | CSS |
| eslint | ^9 | Lint |

---

## 3. データベース migration

| ファイル | 先頭 5 行サマリー |
|---|---|
| `0000_curious_golden_guardian.sql` | `CREATE TABLE "events"` — uuid PK / streamer_id / listener_id / platform text 等 |
| `0001_bumpy_talos.sql` | `ALTER TABLE "listeners"` に total_comment_count 追加 / `streamer_profiles` に kick_channel_id・kick_chatroom_id・kick_is_monitoring・kick_is_live 等追加 |
| `0002_deep_wrecking_crew.sql` | `ALTER TABLE "streamer_profiles"` に niconico_program_id・niconico_community_id・niconico_is_monitoring・niconico_is_live・niconico_monitoring_started_at 追加 |
| `0003_funny_kate_bishop.sql` | `CREATE TABLE "event_history"` — uuid PK / user_id / event_id / name text 等 |

**meta/_journal.json** にマイグレーション順序・ハッシュを管理。

---

## 4. src/lib/ モジュール

| ファイル | 先頭コメント/説明 |
|---|---|
| `lib/utils.ts` | (コメントなし) — clsx ユーティリティ等 |
| `lib/db/client.ts` | Cloudflare Workers の I/O 制約：グローバルに保持禁止 / Route Handler・Server Action 内で都度呼び出すこと |
| `lib/db/schema.ts` | (コメントなし) — Drizzle テーブル定義群 (users / streamer_profiles / listeners / events / event_history 等) |
| `lib/events/bayesian.ts` | 経験ベイズ (案A) によるペース事後推定 — Normal-Normal 共役更新 / 設計書: docs/architecture/phase5b-bayesian-design.md |
| `lib/events/calculator.ts` | イベント勝率計算ロジック（拡張版） / イベントタイプ別（score / ranking / nice / viewer）に分岐する |
| `lib/events/monte-carlo.ts` | モンテカルロシミュレーションによる順位達成確率計算 / 10,000 試行で目標順位以内に入る確率を算出 / クライアント側で実行（サーバー負荷削減） |
| `lib/mock/listeners.ts` | SSR/クライアント間で Date が一致するよう固定時刻を使用 |
| `lib/mock/stats.ts` | SSR/クライアント間で Date が一致するよう固定時刻を使用 |
| `lib/platforms/fuwacchi.ts` | ふわっち公式 REST API クライアント（5 秒ポーリング専用） / フィールド名は api.whowatch.tv の実レスポンスに準拠 |
| `lib/platforms/fuwacchi-ranking.ts` | ふわっちイベントランキング HTML パース / 法務制約: whowatch.tv 公開ページのみ・認証情報不使用・25 秒以上間隔・User-Agent 必須 |
| `lib/platforms/kick.ts` | Kick プラットフォームアダプター / 法務制約: 公開 REST API (kick.com/api/v2) のみ・公開 Pusher 読み取り専用・書き込み API 不使用 |
| `lib/platforms/niconico.ts` | (コメントなし) — NicoLiveProgram 型定義・API 呼び出し |
| `lib/platforms/fuwacchi/event-list.ts` | ふわっちイベント一覧取得（DB 優先・スクレイパーは DB 失敗時フォールバック） / 利用規約条件: User-Agent 明示・device-id 環境変数経由・25 秒以上間隔 |
| `lib/platforms/fuwacchi/item-mapping.ts` | ふわっちイベント応援アイテム (HAR 解析確定値 / 2026-05) / DB 同期後は Supabase から取得するため DB 失敗時フォールバック専用 |
| `lib/supabase/client.ts` | (コメントなし) — ブラウザ用 Supabase クライアント |
| `lib/supabase/server.ts` | (コメントなし) — Server Component 用 Supabase クライアント |
| `lib/supabase/middleware.ts` | (コメントなし) — Edge/Middleware 用 Supabase クライアント |
| `lib/validations/auth.ts` | (コメントなし) — Zod スキーマ: メール・パスワード等 |

---

## 5. API エンドポイント

| メソッド推定 | パス |
|---|---|
| /api/events | `src/app/api/events/route.ts` |
| /api/events/[id]/complete | `src/app/api/events/[id]/complete/route.ts` |
| /api/events/[id]/historical-pace | `src/app/api/events/[id]/historical-pace/route.ts` |
| /api/events/[id]/manual-rivals | `src/app/api/events/[id]/manual-rivals/route.ts` |
| /api/events/[id]/refresh-ranking | `src/app/api/events/[id]/refresh-ranking/route.ts` |
| /api/platforms/fuwacchi/events | `src/app/api/platforms/fuwacchi/events/route.ts` |
| /api/platforms/fuwacchi/items | `src/app/api/platforms/fuwacchi/items/route.ts` |
| /api/platforms/fuwacchi/monitor | `src/app/api/platforms/fuwacchi/monitor/route.ts` |
| /api/platforms/fuwacchi/poll | `src/app/api/platforms/fuwacchi/poll/route.ts` |
| /api/platforms/fuwacchi/profile | `src/app/api/platforms/fuwacchi/profile/route.ts` |
| /api/platforms/kick/event | `src/app/api/platforms/kick/event/route.ts` |
| /api/platforms/kick/monitor | `src/app/api/platforms/kick/monitor/route.ts` |
| /api/platforms/kick/profile | `src/app/api/platforms/kick/profile/route.ts` |
| /api/platforms/niconico/monitor | `src/app/api/platforms/niconico/monitor/route.ts` |
| /api/platforms/niconico/poll | `src/app/api/platforms/niconico/poll/route.ts` |
| /api/platforms/niconico/profile | `src/app/api/platforms/niconico/profile/route.ts` |
| /auth/callback | `src/app/auth/callback/route.ts` |
| /auth/confirm | `src/app/auth/confirm/route.ts` |
| /auth/signout | `src/app/auth/signout/route.ts` |

計 **19 route.ts**。

---

## 6. UI コンポーネント

### src/components/events/

| ファイル |
|---|
| EventCreateForm.tsx |
| EventDashboard.tsx |
| RankDistributionChart.tsx |
| RankDistributionChartInner.tsx |
| RivalsList.tsx |

### その他主要コンポーネント (参考)

| フォルダ | ファイル |
|---|---|
| components/dashboard/ | KickMonitorButton.tsx / ListenerCard.tsx / ListenerList.tsx / MonitorButton.tsx / NiconicoMonitorButton.tsx / PlatformSwitcher.tsx / StatsPanel.tsx |
| components/stats/ | EventTicker.tsx / GoalProgressBar.tsx / HourlyRateChart.tsx / HourlyRateChartInner.tsx / ViewerCounter.tsx |
| components/settings/ | FuwacchiSettings.tsx / KickSettings.tsx / NiconicoSettings.tsx |
| components/nav/ | BottomTabBar.tsx / Sidebar.tsx |
| components/auth/ | OAuthButtons.tsx |
| components/crm/ | (フォルダのみ・tsx ファイル未確認) |
| components/shared/ | (フォルダのみ・tsx ファイル未確認) |
| components/ui/ | alert / avatar / badge / button / card / dropdown-menu / input / label / scroll-area / separator / skeleton / sonner / table / tabs / toggle-group / toggle / tooltip (17 コンポーネント) |

---

## 7. カスタム hook

| ファイル | 推定用途 |
|---|---|
| useEventSimulator.ts | イベントシミュレーション状態管理 |
| useFuwacchiMonitor.ts | ふわっちポーリング監視 |
| useHistoricalPace.ts | 過去ペースデータ取得 |
| useKickMonitor.ts | Kick Pusher WebSocket 接続管理 |
| useNiconicoMonitor.ts | ニコニコライブポーリング監視 |
| useResponsive.ts | レスポンシブブレークポイント判定 |

---

## 8. ドキュメント

| ファイル | H1 見出し |
|---|---|
| README.md | (create-next-app 標準 README — プロジェクト固有説明なし) |
| docs/architecture/fuwacchi_api_endpoints_v1.md | ふわっち API エンドポイント仕様 v1 |
| docs/architecture/phase5b-bayesian-design.md | TagDeck Phase 5b ベイズ推定 設計書 |
| docs/architecture/phase5c-event-tracker-design.md | TagDeck Phase 5c イベント目標トラッカー 設計書 |
| docs/features/fuwacchi_sync_daily_ops_v1.md | ふわっち daily sync 運用ガイド v1 |
| docs/legal/scraping-compliance-2026-05-09.md | Phase 5c スクレイピング適合性調査レポート |

---

## 9. コミット履歴 (直近 20 件)

```
4bc6323 chore(ops): TagDeck fuwacchi daily sync via schtasks (interim)
3c7be15 fix(sync): Phase 5c-beta extension bugs
052218c feat(platforms): Phase 5c-beta extension - fuwacchi auto sync via n8n daily
b259b78 feat(platforms): Phase 5c-β fuwacchi events list API + item mapping
65dfe38 chore: add test scripts for vitest
65d0c25 chore: add vitest for Phase 5b unit tests
dbab374 feat(events): Phase 5b empirical Bayes for historical pace learning
7cd9605 feat(security): add RLS Phase 5 SQL for users / event_simulators / event_history
6b68979 feat(auth): enhance callback error logging for X OAuth debug
b0afb91 fix: sw.ts TypeScript ビルドエラー修正・AGENTS.md + モックデータ更新
3c0fa0d feat: フェーズ 5a — モンテカルロ + ランキング順位シミュレーション実装
4942a5c feat: Phase 4c MVP — ニコ生ライブポーリング連携
21d1e76 feat: implement Kick official Pusher WebSocket integration (Phase 4b)
66ba213 refactor: middleware.ts → proxy.ts (Next.js 16.2 deprecated 対応)
aec2edd fix: Realtime チャンネル setup-after-subscribe エラーを修正
ee5cd57 feat: implement fuwacchi polling integration (phase 4a)
80db6f6 feat: implement dashboard UI phase 3 (CRM + stats panel)
99c7c9a feat: implement authentication phase 2 (email + OAuth)
45c30c5 fix: move reactCompiler out of experimental, disable serwist in dev
7f9bf54 chore: initial commit - TagDeck project skeleton
```

---

## 10. 現在の git 状態

```
## main...origin/main
?? dev.log
?? scripts/platforms/fuwacchi/__pycache__/
```

- ブランチ: **main**（origin/main と同期済み）
- 未コミット変更: `dev.log`（untracked）、`scripts/platforms/fuwacchi/__pycache__/`（untracked）
- 未 push コミット: なし

---

## 11. 環境変数 (キー名のみ・値ゼロ)

| キー名 | 参照箇所 | 種別 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | src/lib/supabase/{client,server,middleware}.ts | Supabase プロジェクト URL (フロント公開可) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | src/lib/supabase/{client,server,middleware}.ts | Supabase 匿名キー (フロント公開可) |
| `DATABASE_URL` | src/lib/db/client.ts | Postgres 接続文字列 (サーバーサイドのみ) |
| `FUWACCHI_DEVICE_ID` | src/lib/platforms/fuwacchi/event-list.ts, scripts/sync_items_and_events.py | ふわっち device-id |
| `SUPABASE_URL` | scripts/platforms/fuwacchi/sync_items_and_events.py | Supabase URL (Python スクリプト用) |
| `SUPABASE_SERVICE_ROLE_KEY` | scripts/platforms/fuwacchi/sync_items_and_events.py | Supabase サービスロールキー (管理権限) |
| `NODE_ENV` | next.config.ts | 標準 Node.js 環境変数 |

備考: `.env.local.example` は権限ブロックにより未読取。上記はソースコード参照から抽出。

---

## 12. テスト構成

### test scripts (package.json)

| コマンド | 内容 |
|---|---|
| `test` | `vitest run` (CI 向け 1 回実行) |
| `test:watch` | `vitest` (ウォッチモード) |

### テストファイル一覧 (*.test.ts)

| ファイル |
|---|
| src/lib/events/bayesian.test.ts |
| src/lib/platforms/fuwacchi/event-list.test.ts |
| src/lib/platforms/fuwacchi/item-mapping.test.ts |

計 **3 ファイル**。vitest v4.1.5 使用。

### Python テスト

| ファイル |
|---|
| scripts/platforms/fuwacchi/test_sync_items_and_events.py |

pytest.ini あり (`scripts/platforms/fuwacchi/pytest.ini`)。

---

## 13. TODO / FIXME

`src/` 配下全ファイルを対象に `TODO|FIXME|XXX|HACK` パターンで grep 実施。

**マッチ件数: 0 件**

コードベースに明示的な未解決タグは現時点で存在しない。

---

## 14. CTO 真鍋玲央コメント

### Phase 1 完了範囲の所感

Phase 1（初期スケルトン）〜 Phase 5c-beta（ふわっち自動同期）まで、認証・3 プラットフォームリアルタイム監視・イベント勝率計算（モンテカルロ + 経験ベイズ）・DB スキーマ・RLS が一気通貫で実装されている。技術的完成度は高く、法務文書・設計書も整備されている点は好評価。一方で `src/components/crm/`・`src/components/shared/`・`workers/` の 3 領域がフォルダのみで実装が未確認。`src/app/(dashboard)/ai-prompter/` もページファイルが存在しない。Cloudflare Workers へのデプロイ設定（open-next + wrangler）は存在するが本番稼働の確認は別途必要。

### Phase 2 スコープ候補 (3 案)

---

#### 案 A: CRM + リスナー管理 本格実装

| | 内容 |
|---|---|
| 目的 | `src/components/crm/`（現状スタブ）を実装し、リスナーのタグ付け・応援履歴・メモ機能を提供 |
| 主な変更領域 | src/components/crm/ / src/app/(dashboard)/crm/page.tsx 拡張 / src/app/api/crm/ 新規 / DB: listeners テーブル拡張またはリスナーメモテーブル追加 |
| 概算工数 | 3〜5 日 (DB スキーマ変更含む) |
| リスク | listeners テーブルへのカラム追加は新規 drizzle migration 必要。RLS 更新も伴う |

---

#### 案 B: AI-Prompter 実装（配信支援 LLM 連携）

| | 内容 |
|---|---|
| 目的 | `src/app/(dashboard)/ai-prompter/`（現状空フォルダ）に配信中のコメント分析・返答案生成 UI を実装 |
| 主な変更領域 | src/app/(dashboard)/ai-prompter/page.tsx 新規 / src/app/api/ai-prompter/ 新規 / Anthropic/Gemini API 連携 |
| 概算工数 | 4〜7 日 (LLM API 選定・プロンプト設計含む) |
| リスク | API コスト発生。Cloudflare Workers の CPU 時間制限（50ms/request）との相性要検証 |

---

#### 案 C: Cloudflare Workers 本番デプロイ + PWA 完成

| | 内容 |
|---|---|
| 目的 | open-next + wrangler 設定済みの本番デプロイを完遂し、オフライン対応・プッシュ通知を有効化 |
| 主な変更領域 | wrangler.jsonc 調整 / src/sw.ts (Service Worker) 拡張 / Supabase Realtime → Cloudflare Durable Objects 移行検討 |
| 概算工数 | 2〜4 日 (デプロイ環境変数設定含む) |
| リスク | Cloudflare Workers のエッジランタイムは Node.js API 非互換多数。drizzle-orm の postgres クライアントが Edge 非対応の可能性あり → Supabase REST API へのフォールバック設計が必要 |

---

### 社長への確認事項

- **`workers/` ディレクトリ**（fuwacchi-poller / kick-watcher / niconico-watcher）はフォルダのみ。今後実装予定か、または現在の hooks (useFuwacchiMonitor 等) で代替完了の判断か？
- **`src/components/crm/`・`src/components/shared/`** は案 A の通り未着手と認識してよいか？
- **`ai-prompter`** は Phase 2 スコープに含める意向か（案 B）、それとも後回しか？
- **Cloudflare Workers へのデプロイ**は現在どの状態か（案 C）？Vercel と CF どちらを本番にする予定か？
- **Python 同期スクリプト**（scripts/platforms/fuwacchi/）は schtasks 経由で稼働中（4bc6323）だが、n8n 移行は継続するか中断か？

---

*本ファイルは棚卸し専用スナップショット。実装変更は Phase 2 着手フェーズから行う。*
