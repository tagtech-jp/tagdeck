# TagDeck 仕様書 v1 (2026-07-18)

> 作成: Claude Code（TagTech / モデル Fable 5・社長明示指示によるモデル選択原則 v1.0 原則2 例外・本セッション記述が承認証跡）
> 出典: `docs/inventory/tagdeck_inventory_20260718.md`（本セッション作成）の逆引き。コードから確認できない事項は断定せず「(要確認)」と明示する。
> 位置付け: TagDeck の現状を記述する仕様書 v1。将来計画そのものではなく「今何が存在するか」の記録。将来計画は §8 未確定事項の社長回答後に更新する。

---

## 1. プロダクト概要

TagDeck は配信者向けセカンドスクリーン SaaS。ふわっち（whowatch.tv）・ニコ生・Kick で配信する配信者が、配信中にサブ端末（タブレット等を想定・要確認）でリスナー CRM・AI 接客カンペ・イベント勝率シミュレーターを参照するために使う（出典: `AGENTS.md`）。

TagTech 社内では「第7事業」として位置付けられ、CPO（PF 開発本部）・CSO（事業検証）が担当（出典: `CLAUDE.md`）。メイン事業化判断は DAU・有料転換率・解約率・月商30万円ラインの4指標で半年後に行う予定（出典: `CLAUDE.md`、判断時期の起点日は要確認）。

本番URL: tagdeck.jp（Cloudflare Workers / OpenNext 経由）。関連プロジェクトとして裏キック団（urakick）・erupi v9 が存在するが別プロジェクトであり混同しない（出典: `CLAUDE.md`）。

---

## 2. 対象ユーザーとユースケース

**対象ユーザー**: ふわっち・ニコ生・Kick で配信する個人配信者（ライブ配信中に手元でリスナー情報を参照したい層）。

**主要ユースケース（コードから確認できる範囲）**:
1. 配信中に自分の配信状態（視聴者数・監視ON/OFF）をプラットフォーム横断で1画面確認する（`dashboard`）
2. リスナー（視聴者）の名前・支援履歴・メモを一元管理する（`crm`。現状はモックデータ、§3参照）
3. 配信中に読み上げる声かけ文をリスナー文脈から生成する（`ai-prompter`。現状はモックデータ、§3参照）
4. ランキング型・スコア型イベントの目標達成確率をモンテカルロシミュレーションで確認する（`events`。実DB連携済み）
5. YouTube アカウントとの OAuth 連携（DB基盤のみ存在、UIなし。§3参照）

(要確認) ユースケース1〜4がターゲットユーザーのどの利用シーン（配信前/中/後）を主眼に設計されているかの明文化されたペルソナ資料は本調査範囲内で確認できなかった。

---

## 3. 機能一覧

コードの実装状況を3区分（実装済み＝実DBないし実APIに接続し動作／実装中＝UIはあるがモックデータ or 部分実装／未実装＝スキーマ等の下地のみ）で分類する。

| 機能 | ページ/コンポーネント | 状態 | 根拠 |
|---|---|---|---|
| プラットフォーム監視ダッシュボード | `(dashboard)/dashboard`, `MonitorButton`/`Kick`/`NiconicoMonitorButton`, `useFuwacchiMonitor`/`useKickMonitor`/`useNiconicoMonitor` | **実装済み** | `/api/platforms/{fuwacchi,kick,niconico}/monitor` 等が実DB(`streamer_profiles`)を更新 |
| イベント勝率シミュレーター | `(dashboard)/events`, `useEventSimulatorList`, `EventDashboard` | **実装済み** | `/api/events` が Supabase認証+Drizzle実クエリ（`route.ts`確認済み）。モンテカルロ計算は `src/lib/events/monte-carlo.ts`、経験ベイズ推定は `bayesian.ts`（テスト有） |
| リスナー CRM | `(dashboard)/crm`, `ListenerList` | **実装中** | `crm/page.tsx` が `generateMockListeners()` を直接呼び出し。実DBの `listeners` テーブルへの読み書きAPIは `/api/listeners` に存在するが、CRM画面から呼ばれているかは未確認(要確認) |
| AI接客カンペ | `(dashboard)/ai-prompter` | **実装中** | 同じく `generateMockListeners()` 使用。プロンプト生成ロジックはクライアント内蔵のテンプレートで、外部LLM呼び出しは本調査範囲では未確認(要確認・"AI"接客カンペという名称だが実装はルールベーステンプレートの可能性) |
| ふわっちイベント一覧・アイテムポイント同期 | `scripts/platforms/fuwacchi/sync_items_and_events.py`, `data/n8n_workflows/tagdeck_fuwacchi_sync_daily.json`, `fuwacchi_events`/`item_point_mapping` テーブル | **実装済み**（n8n日次バッチ運用中・`logs/fuwacchi_sync_*.log` が2026-05-09〜07-06まで継続記録） | ログ実在確認済み |
| YouTube Live 連携 | `youtube_oauth_tokens` テーブル、`workers/youtube-relay`（26行）、`auth/callback` | **未実装**（DB+OAuth callback の下地のみ） | UI・型定義（`Platform`型）・専用APIルートが存在しない |
| 設定画面（プラットフォーム別） | `settings/platforms`, `FuwacchiSettings`/`KickSettings`/`NiconicoSettings` | **実装済み** | ページ・コンポーネント実在確認済み（DB連携の深度は要確認） |
| 通知設定 | `settings/notifications` | (要確認) | ページ存在確認のみ、実装深度未調査 |
| 認証（サインアップ・ログイン・パスワードリセット） | `(auth)/{login,signup,reset-password}`, `OAuthButtons` | **実装済み** | Supabase Auth 連携（`src/lib/supabase/*`） |
| 法務ページ（プライバシー・利用規約） | `(legal)/{privacy,terms}` | (要確認) | ページ存在確認のみ、内容の最新性は未調査 |

---

## 4. 対応プラットフォーム

| プラットフォーム | 実データ取得方式 | 監視間隔等の制約 | 状態 |
|---|---|---|---|
| ふわっち (whowatch.tv) | 公開API `api.whowatch.tv`（ポーリング） | ライブ5秒/ランキング300秒以上（`AGENTS.md`）、法務調査では25秒以上を推奨（`docs/legal/scraping-compliance-2026-05-09.md`）※2値の関係は要確認 | 実装済み・最多機能 |
| Kick | 公式 Pusher WebSocket | — | 実装済み（`kick-watcher`ワーカーは空、API route側で完結の可能性・要確認） |
| ニコ生 | 公式 NDGR | 法務調査では30秒以上推奨 | 実装済み（Phase 4c MVP） |
| YouTube Live | 未定（OAuth基盤のみ） | — | 未実装 |

**法務方針（必須遵守・`AGENTS.md`より）**: 非公式WebSocket・内部プロトコル解析・リバースエンジニアリングは実装禁止。各プラットフォーム利用規約違反となるコードは書かない。

---

## 5. データモデル概要

Drizzle管理下の9テーブル（`src/lib/db/schema.ts`）:

| テーブル | 主な役割 | Drizzle migration追跡 |
|---|---|---|
| `users` | アプリユーザー | ✅ 0000 |
| `streamer_profiles` | 配信者のプラットフォーム別監視状態（fuwacchi_*/kick_*/niconico_* 列） | ✅ 0000 |
| `listeners` | リスナー（視聴者）CRM情報 | ✅ 0000 |
| `events` | プラットフォームイベント（コメント・ギフト等）ログ | ✅ 0000, 0004（3列追加） |
| `event_simulators` | イベント勝率シミュレーター本体 | ✅ 0000系, 0006（FK列追加） |
| `event_history` | 過去イベント履歴（ベイズ推定用） | ✅ 0000系 |
| `item_point_mapping` | ギフトアイテム→ポイント換算マスタ | ❌ Drizzle管理外（手動SQL `supabase_phase5c_item_mapping.sql`） |
| `fuwacchi_events` | ふわっちイベント一覧（n8n日次同期） | ❌ Drizzle管理外（手動SQL `supabase_phase5c_extension.sql`。0006はFK列追加のみ担当） |
| `youtube_oauth_tokens` | YouTube OAuth トークン | ✅ 0005 |

詳細なテーブル一覧・Drizzle/手動SQLの経路差分・snapshot欠落問題は `docs/inventory/tagdeck_inventory_20260718.md` §6、および `docs/architecture/tagdeck_architecture_v1.md`（Step 2で作成）を参照。

---

## 6. 非機能要件（判明範囲のみ）

| 区分 | 内容 | 出典 |
|---|---|---|
| バンドルサイズ | Cloudflare Workers 上限25MiB。重量ライブラリ（framer-motion, recharts等）は`next/dynamic`で遅延ロード必須 | `AGENTS.md` |
| CPU時間 | 10ms/request（Freeプラン想定の記述。現行プランは要確認） | `AGENTS.md` |
| DBクライアント | グローバル保持禁止、Route Handler/Server Action内で都度インスタンス化 | `AGENTS.md` |
| ランタイム | Node.js Runtime（Edge Runtimeではない）、nodejs_compatフラグ前提 | `AGENTS.md` |
| CI/CD | main push→ pnpm install→tsc --noEmit→vitest→opennextjs-cloudflareビルド→wrangler deploy。型/テスト失敗でfail-fast | `docs/architecture/ci_cd_v1.md` |
| スクレイピング系アクセス制限 | ふわっち25秒以上・ニコ生30秒以上、User-Agent固定、Disallowパス回避、イベント期間外自動停止 | `docs/legal/scraping-compliance-2026-05-09.md` |
| セキュリティ | RLS（行レベルセキュリティ）を主要テーブルに設定（`supabase_rls_phase4a.sql`, `supabase_rls_phase5.sql`） | 該当SQLファイル |
| PWA対応 | `@serwist/next`導入・`manifest.json`/`sw.ts`存在 | package.json, ファイル存在確認 |

(要確認) 可用性目標・レスポンスタイム目標・同時接続数想定など定量的SLA/SLO文書は本調査範囲内で確認できなかった。

---

## 7. 用語集

| 用語 | 定義 |
|---|---|
| ストリーマー | 配信者 |
| リスナー | 視聴者 |
| ギフト | 投げ銭・アイテム |
| プラットフォーム | ふわっち / Kick / ニコ生（現状コード上、YouTube未包含） |
| ふわっち | 日本語UI表示名。TagDeck内部ではプラットフォーム識別子として英字ローマ字 `fuwacchi` を使用（型定義・DB列・ファイル名・関数名など） |
| whowatch | ふわっちの実サービスドメイン名（`whowatch.tv` / `api.whowatch.tv`）。コード中では外部API・URL文字列としてのみ登場し、内部識別子には使われていない |

### fuwacchi → whowatch 統一方針（草案・確定は §8 参照）

`docs/inventory/tagdeck_inventory_20260718.md` §7 の調査により、TagDeck内部では「外部実名=whowatch」「内部識別子=fuwacchi」が混在していることを確認した（ファイル名・ディレクトリ名58件、`src/`内識別子332件/31ファイル、`workers/`内68件/8ファイル、環境変数1種類`FUWACCHI_DEVICE_ID`、DB列8+1列＋テーブル1件、docs言及138件）。

CC推奨案: **内部識別子（型リテラル・変数名・関数名・ファイル名・DB列名・環境変数名）のみ `whowatch` に統一し、UI表示ラベル「ふわっち」（`PLATFORM_LABELS.fuwacchi`）は日本語のまま変更しない**。理由: ユーザー向け表示は日本語ブランド名が自然であり変更の実益がない一方、内部識別子は実際の外部API名（`api.whowatch.tv`）と揃えることでコードの可読性・保守性が向上するため。この方針の可否は §8-1 で社長判断を仰ぐ。

---

## 8. 未確定事項【社長判断待ち】

各項目は「質問 / 選択肢 / CC推奨案と根拠」の3点セットで記載。回答は選択肢の記号のみで可。

### 8-1. whowatch統一の対象範囲

**質問**: fuwacchi→whowatch識別子統一（Step 3 P2〜P4）の対象範囲をどこまでとするか。

**選択肢**:
- A. 内部識別子（型・変数・関数・ファイル名・DB列・env変数名）のみ統一。UI表示「ふわっち」は変更しない
- B. UI表示ラベルも含め、社内外の呼称を全て「whowatch」に統一（「ふわっち」表記を廃止）
- C. 今回は見送り、現状（内部fuwacchi/外部whowatch混在）を維持

**CC推奨案**: A。理由は §7 に記載の通り、ユーザー体験上「ふわっち」の日本語表示に変更の実益がなく、リスナー・配信者にとって馴染みのある呼称を保持すべきため。

**2026-07-18 社長決定: A採用。** 内部識別子（型・変数・関数・ファイル名・DB列・env変数名）のみ `whowatch` に統一し、UI表示ラベル「ふわっち」は変更しない。Step 3 P2〜P4はこの方針で実施する。

### 8-2. Drizzle snapshot欠落問題への対応方針

**質問**: `docs/decisions/drizzle_snapshot_reconcile_postponed_20260526.md`（案δ=現状維持・社長承認済み）から状況が変わっていないため、Step 3 P1（journal整合性）の実施要否をどうするか。

**選択肢**:
- A. journal自体は既に整合済み(0000-0006全登録)と判明したため、P1は「現状維持の再確認・記録更新のみ」とし、snapshot補完はdrizzle-kit 1.0 stable待ちで引き続き保留
- B. drizzle-kit のバージョンを実際に確認し、1.0 stableがリリース済みなら本セッションでsnapshot補完を試行
- C. snapshotなしでも実害がないため、この決定文書自体をクローズしP1をスコープから外す

**CC推奨案**: A。決定文書の案δが既に社長承認済みであり覆す新情報がないため、蒸し返さず現状追認が最小リスク。

**2026-07-18 社長決定: A採用。** P1は現状維持の再確認・記録更新のみとし、snapshot補完はdrizzle-kit 1.0 stableリリース待ちで引き続き保留する。

### 8-3. CRM・AI接客カンペのモックデータ→実データ移行の優先度

**質問**: `crm`・`ai-prompter`が`generateMockListeners()`のモックデータで動作している状態（§3）について、実データ（`listeners`テーブル）連携をどう位置付けるか。

**選択肢**:
- A. 優先度高。次期実装候補として本セッションStep 3のP5(小粒実装)候補に追加検討する
- B. 優先度中。今回のスコープ外とし、別セッションで扱う
- C. 現状のモック運用を意図的仕様として維持（デモ用途等）

**CC推奨案**: B。今回のセッションはwhowatch統一とDrizzle整合が主眼であり、機能実装（モック→実データ）はスコープを広げすぎるため別セッション推奨。

**2026-07-18 社長決定: B採用。** CRM・AI接客カンペのモック→実データ移行は本セッションのスコープ外とし、別セッションで扱う。

### 8-4. YouTube Live連携の扱い

**質問**: `youtube_oauth_tokens`テーブル・`workers/youtube-relay`スタブのみ存在しUI未実装の状態について、今後の扱いは。

**選択肢**:
- A. Phase未定のまま現状維持（本仕様書には「未実装」と記録するのみ）
- B. 次の開発フェーズの優先候補として正式にロードマップ化する
- C. 着手見送りが確定しており、DB基盤ごと撤去する

**CC推奨案**: A。判断材料（工数・優先度）が本セッションの調査範囲外のため、現状記録に留め社長の事業判断を待つ。

**2026-07-18 社長決定: A採用。** YouTube Live連携はPhase未定のまま現状維持。本仕様書には「未実装」と記録するのみとし、今回は着手しない。

### 8-5. README.md未編集の扱い

**質問**: `README.md`がcreate-next-app既定文言のまま（`docs/inventory/tagdeck_inventory_20260718.md` §11-2）。

**選択肢**:
- A. Step 3のP5候補として、本仕様書の内容を反映したREADME書き換えを実施
- B. 対応不要（開発用リポジトリで外部公開前提がないため）
- C. 別タスクとして後日対応

**CC推奨案**: A。低リスク・低工数のドキュメント整備であり、本セッションの成果物（仕様書・構成設計書）を要約転記するだけで済むため。

**2026-07-18 社長決定: A採用。** Step 3 P5として、本仕様書・構成設計書の内容を反映したREADME.md書き換えを実施する。

---

## 改訂履歴

| 版 | 日付 | 改訂内容 |
|---|---|---|
| 1.0 | 2026-07-18 | 初版作成（棚卸しレポート20260718の逆引き） |
| 1.1 | 2026-07-18 | §8-1〜8-5 社長決定を追記（全項目CC推奨案採用、§8-1はA採用・A/B差分は本文参照） |
