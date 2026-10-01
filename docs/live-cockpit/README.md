# tagdeck-event / tagdeck-live 実装メモと動作確認手順

正本: `D:\tagtech\docs\streaming\remote-studio-plan.md`。既存資産の棚卸しは [EXISTING.md](EXISTING.md)、要確認は [TODO.md](TODO.md)。
表記ルール: コード・パス・識別子・API・テーブルは `whowatch`、日本語の文章・UI は「ふわっち」。

決裁(2026-09-20): ふわっちデータ取得は公開 API のポーリングのみ。WebSocket は実装しない。
決裁(2026-09-25): 上記を変更。SE のラグ解消のため、`/lives/{id}` の `comment_server_url` / `jwt` によるコメントサーバ(WebSocket)への **受信のみ** の接続を例外として許可(AGENTS.md 参照)。ポーリングは保存と予備経路として継続。
決裁(2026-09-25・同日追記): 上記「受信のみ」を「送信も可」に変更。送るのは Phoenix の `phx_join`(購読)と `heartbeat` のみ(AGENTS.md / CODEX_CLAUDE.md は PR #11 で更新済み)。詳細は「即時経路(WebSocket)の到達点」。
確認(2026-09-30): 上記 2026-09-25 の WebSocket 例外(即時経路で `wss://ws.whowatch.tv` を使う)は、2026-09-30 社長が本人確認済み(外部の記録は Notion。公開リポのため URL は書かない)。

## E1: イベント取得(実装済み・2026-09-21)

### 追加・変更

| 種別 | パス | 内容 |
|---|---|---|
| lib | `src/lib/whowatch/events.ts` | `getEventLists()` `/event_lists`、`getEventDetail(key)` `/event_lists/{key}`、`getRankingStruct(prefix)` `/resources/json/rankings/{prefix}`、`getRules(id)` `/users/me/notifications/{id}`(HTML→テキスト化)。10 分キャッシュ。`flattenRankingChoices()` で区分プルダウン、`computeEventKind()`(36h 未満=daily)、`endTimeFromEndedAt()`(ended_at + 1 秒) |
| route | `GET /api/platforms/whowatch/events/list` | open / pre 一覧(認証必須・DB は触らない) |
| route | `GET /api/platforms/whowatch/events/{event_key}` | 詳細 + 区分選択肢 + ルール本文。`whowatch_events` の詳細列に保存し、10 分以内は DB を返す |
| schema | `whowatch_events` | 追加列: `name, short_name, kind, ranking_prefix, struct(jsonb), rules_html, rules_text, rules_parsed(jsonb), detail_fetched_at(timestamptz)` + `event_key` インデックス。既存列は変更なし |
| schema | `event_simulators` | 追加列: `ranking_type`(例 `autumncollection_1st_overall`) |
| migration | `drizzle/0010_event_detail.sql` / `_manual.sql` / `_rollback.sql` | Supabase SQL Editor で `_manual.sql` を実行(docs/migration-runbook.md の手順) |
| UI | `src/components/events/EventCreateForm.tsx` | イベントカード選択で詳細を取得し、正式名・終了時刻(翌日 0:00 JST)・ランキング区分プルダウンを自動入力。選んだ区分の `ranking_type` を保存 |
| API | `POST /api/events` | `rankingType`(任意)を受け付ける |

既存の `GET /api/platforms/whowatch/events`(DB 優先・open のみ)は変更していない。

### 動作確認手順

1. 単体テスト: `pnpm test`(`src/lib/whowatch/events.test.ts` を含む全件が通る)。型: `pnpm exec tsc --noEmit`
2. マイグレーション: Supabase SQL Editor で `drizzle/0010_event_detail_manual.sql` を実行し、末尾の確認 SQL で列が増えていること
3. `pnpm dev` → ログイン後、`/api/platforms/whowatch/events/list` を開くと `open[]` にイベントが並ぶ(`endTime` が `endedAt` + 1 秒、`kind` が daily/long)
4. `/api/platforms/whowatch/events/2026_09_autumncollection` を開くと `rankingChoices[]`(例 `autumncollection_1st_overall`「前半 › 前半総合（入賞 5/10/... 位）」)と `rulesText` が返る。2 回目は `source: "db"`
5. `/events` →「+ 新規イベント」→ カードをタップ → 「ランキング区分」プルダウンが出て、イベント名・終了日時が自動で埋まる → 作成後 `event_simulators.ranking_type` に値が入る

### 未確定(TODO.md 参照)

- `event_key` に UNIQUE は付けていない(既存行の重複有無が未確認のため通常インデックスのみ)
- 一覧に載らない closed イベントは `id` が分からないため DB に保存しない(取得結果のみ返す)

## E2: ランキング取得・スナップショット・自動ライバル(実装済み・2026-09-21)

### 追加・変更

| 種別 | パス | 内容 |
|---|---|---|
| lib | `src/lib/whowatch/rankings.ts` | `getRankings(rankingType, {limit, publisherId})` `/rankings/{type}?limit=&detail=true`。`findMyEntry()`(whowatchUserId → myEntryName の順で自分を特定)、`selectAutoRivals()`(目標順位の前後 3 名 + 自分の直上) |
| lib | `src/lib/whowatch/ranking-sync.ts` | `syncSimulatorRanking(db, event)`: API 取得(無ければ旧スクレイプにフォールバック)→ `event_simulators` 更新(currentRank/currentScore/paceHistory/rivalsSnapshot/rivalsHistory)→ `ranking_snapshots` 追記 |
| schema | `ranking_snapshots` | `id, simulator_id(FK event_simulators, cascade), ranking_type, captured_at(timestamptz), status(1=開催中/3=終了), entries(jsonb: rank/point/user_id/user_path/name/total_view_count), my_rank, my_point`。index(simulator_id, captured_at)。RLS: 自分の simulator の行のみ SELECT |
| migration | `drizzle/0011_ranking_snapshots.sql` / `_manual.sql` / `_rollback.sql` | Supabase SQL Editor で `_manual.sql` を実行 |
| route | `POST /api/events/[id]/refresh-ranking` | 共通処理に差し替え(旧スクレイプは `ranking_type` 無しの時のフォールバックとして残す) |
| route | `POST /api/platforms/whowatch/poll` | 25 秒毎のランキング更新ループも共通処理経由に(挙動・間隔は同じ) |
| route | `POST /api/platforms/whowatch/rankings/sync` | 5 分 cron 用。`X-Sync-Key` = env `RANKING_SYNC_KEY`。開催中(start_time ≤ now ≤ end_time)かつ `ranking_type` ありの active シミュレーターだけ同期 |
| cron | `.github/workflows/ranking-sync.yml` | `*/5 * * * *` で上記を呼ぶ(既存 daily-sync.yml と同じ GitHub Actions 方式)。Secrets: `RANKING_SYNC_KEY`、`TAGDECK_BASE_URL`(省略時 https://tagdeck.jp) |
| UI | `RivalsList` / `EventDashboard` | `ranking_type` があれば「ランキング更新」ボタンを表示、最終取得時刻とスナップショット保存メッセージを表示。manual-rivals は従来どおり |

### 社長作業(秘密は社長が投入)

1. Supabase SQL Editor で `drizzle/0010_event_detail_manual.sql` と `drizzle/0011_ranking_snapshots_manual.sql` を順に実行
2. `RANKING_SYNC_KEY` を発行し、Cloudflare Workers の環境変数(wrangler secret put RANKING_SYNC_KEY)と GitHub Secrets の両方に同じ値を入れる。GitHub Secrets には必要なら `TAGDECK_BASE_URL` も
3. 未設定の間は cron は `skipping` で終了し、ルートは 503 を返す(何も壊れない)

### 動作確認手順

1. `pnpm test`(rankings.test.ts 7 件を含む全 109 件)、`pnpm exec tsc --noEmit`
2. `/events` で E1 の手順どおりランキング区分付きのシミュレーターを作成
3. 「ライバル」タブ →「ランキング更新」→「公開 API から取得・スナップショット保存済み」と出て、ライバルが目標順位の前後 + 自分の直上に入れ替わる
4. Supabase で `SELECT captured_at, ranking_type, my_rank, my_point, jsonb_array_length(entries) FROM ranking_snapshots ORDER BY captured_at DESC LIMIT 5;` に行が増えている
5. GitHub Actions → 「Whowatch ranking sync (5min)」→ Run workflow → ログに `HTTP 200` と `targets: N`

## 本番反映(E1/E2)と 5 分 cron の初回確認

前提(社長作業・完了済み想定): 0010/0011 の SQL 適用、`RANKING_SYNC_KEY` を Cloudflare Workers(`wrangler secret put RANKING_SYNC_KEY`)と GitHub Secrets の両方に登録。`wrangler.jsonc` の `vars` にはキーを書かない(平文で git 追跡されるため)。

1. PR `feat/live-cockpit` → `main` をマージすると `deploy.yml` が tsc → vitest → OpenNext build → Workers deploy を実行する(Actions →「Deploy」が緑になるまで待つ)
2. マージ後、Actions の一覧に「Whowatch ranking sync (5min)」が現れる。初回は `*/5` の次の刻み(数分遅れることがある)で自動起動する。待たずに試す場合は Run workflow(workflow_dispatch)
3. 実行ログ「Call ranking sync endpoint」で確認する内容:
   - `HTTP 200` と `{"ok":true,"at":...,"targets":N,"results":[...]}` → 正常。`targets` は開催中かつ ranking_type ありの active シミュレーター数(0 でも正常)
   - `RANKING_SYNC_KEY is not set; skipping` → GitHub Secrets 未登録
   - `HTTP 401` `{"error":"RANKING_SYNC_KEY not configured"}` → Cloudflare 側の `RANKING_SYNC_KEY` 未登録(デプロイ後に `wrangler secret put` が必要)
   - `HTTP 401` `{"error":"invalid X-Sync-Key"}` → GitHub と Cloudflare でキーの値が不一致
   - `HTTP 307`(本文空) → middleware がログインへリダイレクトしている。`src/middleware.ts` の `AUTH_BYPASS_PATHS` と matcher の除外にこのパスが残っているか確認(2026-09-21 に本番で発生し修正済み)
4. DB 側: `SELECT captured_at, ranking_type, my_rank, my_point FROM ranking_snapshots ORDER BY captured_at DESC LIMIT 5;` が 5 分ごとに増える(開催中のシミュレーターがある場合)
5. 止めたい時は Actions →「Whowatch ranking sync (5min)」→ Disable workflow(コードの変更不要)

## E1b: 区分（前半/後半・グループ）ごとの期間の自動判別(実装済み・2026-09-21)

### 追加・変更

| 種別 | パス | 内容 |
|---|---|---|
| lib | `src/lib/whowatch/periods.ts` | `rules_text` の「ランキング＜前半＞」等（options[].value と一致するラベル）直後の日付範囲を抽出。`24:00` → 翌日 00:00 JST、年省略は直前の年を引き継ぐ。取れない区分は全体期間を options 数で等分し `source:'estimated'` |
| schema | `whowatch_events.periods` (jsonb) | `[{option_key, label, starts_at, ends_at, source:'rules'\|'estimated'}]`。migration `drizzle/0012_event_periods.sql`(`_manual.sql` を SQL Editor で実行) |
| route | `GET /api/platforms/whowatch/events/{event_key}` | 応答に `periods[]` を追加(DB 保存・10 分キャッシュは従来どおり) |
| route | `PATCH /api/events/[id]` | `score` を含まない body で `{rankingType, startTime, endTime, name}` の設定編集を受け付ける(既存の score 更新はそのまま) |
| UI | `EventCreateForm` | イベント選択 → 区分プルダウン(periods がある時のみ。推定は「（推定）」表示)→ 開始/終了を自動入力(手修正可)→ ランキング種別(既定「総合」= selectbox `overall`。複数ならプルダウン)→ `ranking_type` 確定 |
| UI | `EventSettingsEditor`(ダッシュボードの「区分・期間を編集」) | 作成済みシミュレーターの区分・種別・期間を後から変更 |
| fixture | `src/lib/whowatch/__fixtures__/autumncollection_rules_text.txt` | 2026-09-20 実応答の本文(テスト用) |

### 作成済みシミュレーターを「後半」に更新する

- UI: `/events` → 対象シミュレーター → 「区分・期間を編集」→ 区分「後半」→ 種別「後半総合」→ 保存。`ranking_type=autumncollection_2nd_overall`、期間 9/23 00:00 〜 9/28 00:00 JST が入る
- SQL(UI が使えない時。Supabase SQL Editor):

```sql
-- 対象を確認
SELECT id, name, ranking_type, start_time, end_time FROM event_simulators WHERE status = 'active' ORDER BY created_at DESC;
-- 後半総合へ補完（<id> を置き換え。時刻は UTC。9/23 00:00 JST = 09-22 15:00Z、9/28 00:00 JST = 09-27 15:00Z）
UPDATE event_simulators
   SET ranking_type = 'autumncollection_2nd_overall',
       start_time = '2026-09-22 15:00:00',
       end_time   = '2026-09-27 15:00:00',
       updated_at = now()
 WHERE id = '<id>';
```

### 動作確認手順

1. `pnpm test`(periods.test.ts 8 件を含む全 122 件)、`pnpm exec tsc --noEmit`、`pnpm exec next build --webpack`
2. `drizzle/0012_event_periods_manual.sql` を SQL Editor で適用
3. `/api/platforms/whowatch/events/2026_09_autumncollection` の `periods` が `[{1st 前半 9/17T15:00Z〜9/22T15:00Z rules}, {2nd 後半 9/22T15:00Z〜9/27T15:00Z rules}]`
4. `/events` → 新規イベント → オータムグッズを選ぶ → 区分プルダウンに「前半/後半」、開始/終了が自動で入り、ranking_type が `autumncollection_2nd_overall`(後半選択時)
5. 既存シミュレーターで「区分・期間を編集」→ 後半 → 保存 → ヘッダの ranking_type と期間が変わる

## イベント詳細同期(名前・区分・ランキング構造・ルール・periods)の恒久対応(2026-09-21)

### 本番で詳細列が NULL だった原因

詳細取得(`/event_lists/{key}` → `/resources/json/rankings/{prefix}` → 概要 notification → periods)は **フォームでイベントカードを選択した時だけ**(`GET /api/platforms/whowatch/events/{event_key}`)走る設計で、Daily whowatch sync(Python)には組み込まれていなかった。さらにフォームは取得失敗を握りつぶして何も表示しなかった。本番で誰もカードを選択していなければ `kind / ranking_prefix / periods / detail_fetched_at` は NULL のまま。

### 対応

| 経路 | 内容 |
|---|---|
| 共通処理 | `src/lib/whowatch/event-detail-sync.ts` の `syncEventDetail()` / `syncAllEventDetails()` に集約 |
| オンデマンド | 詳細ルートは `detail_fetched_at` が NULL または 24 時間以上前なら API から取り直して保存(`?refresh=1` で強制)。フォームは失敗時に警告を表示 |
| 日次 | `daily-sync.yml` の末尾に `POST /api/platforms/whowatch/events/sync?force=1` を追加(open/pre 全件) |
| 即時 | `event-detail-sync.yml`(workflow_dispatch)。同じルートを呼ぶ |
| 通知 | 失敗があれば notify-gw に WARN(Workers の env `NOTIFY_GW_KEY` / `NOTIFY_GW_URL`。未設定なら送らない) |
| 表示名 | `GET /api/platforms/whowatch/events` の `displayName` を詳細の `name`(例「オータムグッズ」)優先に変更 |

### 2026-09-21 本番実行で判明した 2 つの問題と対処

| 問題 | 対処 |
|---|---|
| 14 件を 1 リクエストで直列処理 → Cloudflare Workers のサブリクエスト上限(無料 50)に当たり得る | 1 リクエスト 3 件(`?limit=3`、1 件あたり外部 API 最大 4 + DB 3)。応答の `next_cursor` を `?cursor=` に渡してループ(workflow 側で自動) |
| ランキング型 9 件が `Failed query: insert into whowatch_events …` で保存失敗(取得は成功) | 例外の cause(code/message/detail)を `results[].error` とログに出す(SQL・params・HTML は出さない)。`rules_html` は `<style>`/`<script>`/インライン style/data:URI を除去し 200KB 上限。``・C0 制御文字を除去。保存を「小さい列(name/kind/ranking_prefix/periods/detail_fetched_at)の upsert」→「rules_text/struct の UPDATE」→「rules_html の UPDATE」の順に分け、大きい列が失敗しても小さい列は残す(`note` に警告) |

RANKING タブが無いイベント(collabo_program 等)は「区分なし」として正常終了(`periods=0`)。

### 即時実行手順(社長)

0. まず単体で確認: Run workflow で `event_key = 2026_09_autumncollection`(force=1)→ ログに `2026_09_autumncollection ok name=オータムグッズ prefix=autumncollection periods=2` が出れば OK。`FAILED[db]` なら `error` 列に PostgreSQL の code/message が出るので、それを共有してください
1. GitHub → Actions →「Whowatch event detail sync (manual)」→ Run workflow(force = 1、event_key 空)→ Run。3 件ずつ複数バッチで走り、最後に `=== total succeeded=N failed=0`
2. ログ「Call event detail sync endpoint」に `HTTP 200` と `targets=N succeeded=N failed=0`、各行に `name=オータムグッズ prefix=autumncollection periods=2` が出れば成功
3. Supabase で確認:

```sql
SELECT event_key, name, kind, ranking_prefix, jsonb_array_length(periods) AS periods, detail_fetched_at
  FROM whowatch_events WHERE status IN ('open','pre') ORDER BY event_key;
-- 想定: 2026_09_autumncollection | オータムグッズ | long | autumncollection | 2 | 2026-09-21 ...
--       2026_09_autumncollectionlite | ...ライト | long | autumncollectionlite | 2 | ...
SELECT event_key, jsonb_pretty(periods) FROM whowatch_events WHERE event_key = '2026_09_autumncollection';
-- 想定: [{option_key:"1st", label:"前半", starts_at:"2026-09-17T15:00:00.000Z", ends_at:"2026-09-22T15:00:00.000Z", source:"rules"},
--        {option_key:"2nd", label:"後半", starts_at:"2026-09-22T15:00:00.000Z", ends_at:"2026-09-27T15:00:00.000Z", source:"rules"}]
```

4. スクショ手順: tagdeck.jp → イベント勝率シミュレーター → 「+ 新規イベント」→ カード「オータムグッズ」(表示名が正式名になっている)をタップ → 「区分（期間を自動設定）」プルダウンで「後半 9/23 00:00 〜 9/28 00:00」を選ぶ → 開始/終了日時が自動で入り、`ranking_type: autumncollection_2nd_overall` と表示された画面を撮る

### 環境変数(Workers)

- `RANKING_SYNC_KEY`(登録済み)を events/sync でも使う
- `NOTIFY_GW_KEY`(任意)。社長が `wrangler secret put NOTIFY_GW_KEY` で投入すれば失敗時に WARN が飛ぶ

## E4: UI 簡素化(実装済み・2026-09-21)

- 作成フォームはイベントタイプ「ランキング目標」固定表示。目標順位は 1〜5 のプルダウン。score / nice / viewer の入力は非表示(既存データ・API はそのまま)
- 「攻略」セクション(テンプレ倍率ベースの提案)は既定で非表示。表示したい時は環境変数 `NEXT_PUBLIC_FEATURE_STRATEGY_PANEL=1`(コードは削除していない)

## E3: 逆算と確率(実装済み・2026-09-21)

### 追加・変更

| 種別 | パス | 内容 |
|---|---|---|
| lib | `src/lib/whowatch/rules-parser.ts` | `rules_text` から当たり倍率表(「1% → 20倍 … 85% 通常」)、ボーナス表(レギュラー/ビッグ/ギガ の pt・確率)、無料アイテム(1 日あたり配布数・当たり)を正規表現で抽出。期待倍率 = Σ(確率×倍率)。抽出できない項目は null |
| schema | `whowatch_events.rules_parsed` (jsonb) | 詳細同期時に保存(0010 で列は追加済み)。詳細ルートの応答 `rulesParsed` |
| lib | `src/lib/whowatch/rank-forecast.ts` | `estimateRivalPaces()`: ranking_snapshots の連続差分からライバル別の pt/時 分布。`forecastRank()`: 既存モンテカルロと同じ正規乱数モデルで 10,000 試行。最終日(終了前 24h)はライバルのペース × 係数(既定 1.5・仮置き)。出力: 目標順位の達成確率、必要追加 pt の中央値/90%タイル、必要個数 = ceil(必要pt ÷ (基礎pt × 期待倍率))、1 日あたり個数 |
| table | `event_item_points` | `event_key, item_id, base_point, source('manual'/'estimated'), updated_at`。UNIQUE(event_key, item_id)。migration `drizzle/0013_event_item_points*.sql` |
| route | `GET/PUT/DELETE /api/platforms/whowatch/events/{event_key}/item-points` | 基礎 pt の一覧・upsert・削除(認証必須、全ユーザー共有) |
| route | `POST …/item-points/estimate` | 「実測から推定」: 自分のスナップショット間の pt 増分 ÷ その間の events(gift) 個数。ギフト保存は S1 以降なので、それまでは insufficient を返す |
| route | `GET /api/events/[id]/snapshots?limit=` | 自分の ranking_snapshots(新しい順、既定 48・最大 288) |
| route | `PATCH /api/events/[id]` | 設定編集に `targetRank`(1〜5)を追加 |
| UI | `RankForecastPanel`(ダッシュボード「逆算と確率」) | 目標順位プルダウン(変えると即再計算 + 保存)、達成確率・必要 pt・必要個数・1 日あたりの 4 指標、期待倍率と無料アイテムの表示、アイテム選択 + 基礎 pt 手入力/実測推定/保存 |

### 社長作業

- Supabase SQL Editor で `drizzle/0013_event_item_points_manual.sql` を適用(未適用でも計算はできる。基礎 pt の保存だけが失敗する)

### 動作確認手順

1. `pnpm test`(rules-parser 6 件・rank-forecast 8 件を含む全 148 件)、`pnpm exec tsc --noEmit`
2. 5 分 cron でスナップショットが 2 枚以上たまった後、`/events` → 対象シミュレーター → 「逆算と確率」に確率・必要 pt・必要個数が出る。目標順位を変えると即座に数字が変わる
3. アイテムを選び基礎 pt を入力 → 保存 → `event_item_points` に行ができ、必要個数が計算される
4. 詳細ルート `/api/platforms/whowatch/events/2026_09_autumncollection` の `rulesParsed.expectedMultiplier` が 1.95(1%×20 + 4%×10 + 10%×5 + 85%×1)

### 未確定(TODO.md)

- 基礎 pt(アイテム 1 個あたりのランキングポイント)は公式本文に無い。手入力か、S1 のギフト保存後に「実測から推定」
- 最終日係数 1.5 は仮置き。過去 closed イベントの伸び率から求める処理は未実装

## E5: 順位予測の精度改善・攻略ページ廃止(実装済み・2026-09-25)

### 背景(本番で観測した症状)

- 7 位・33,050 pt なのに「目標 3 位以内の確率 100.0%・期待順位 1.0 位・現在スコア 0」と表示された。原因は 2 つ
  1. ランキング同期が止まっていた(GitHub Actions の課金停止で `ranking-sync.yml` が停止、Workers Cron 版は本番未反映)ため `ranking_snapshots` が 0 枚・`rivals_snapshot` が null
  2. `calculator.ts` の旧モデルはライバル 0 名で 1 万試行すると全試行 1 位 = 100% になる。さらにライバルを「目標順位の前後 + 直上」の数名に絞っていたため、順位表 13 名でも試算上は 5 名以下となり順位が実際より良く出る

### 追加・変更

| 種別 | パス | 内容 |
|---|---|---|
| lib | `src/lib/whowatch/rank-forecast.ts` | 順位表の**全員**(自分を含む)を同じ推定器で扱う。各人の pt/時 = 直近 36 組(3 時間)の増分平均と「現在 pt ÷ イベント開始からの経過時間」をサンプル数で重み付け(w = n/(n+12))。残り時間の獲得 = pace × 実効残り時間 × m、m は平均 1 の対数正規(σ はサンプル 0 で 0.7、288 で 0.36)。出力に期待順位・順位分布・現在順位・自分の最終 pt 分布を追加。開始時刻があればスナップショット 1 枚でも計算できる |
| lib | `src/lib/events/calculator.ts` | ライバル 0 名のとき `status: "no_data"` を返す(100% を出さない) |
| hook | `src/hooks/useRankingSnapshots.ts` | スナップショット取得・5 分毎再読込・**最新が 6 分より古い/無いときは画面側から `POST /api/events/[id]/refresh-ranking` を自動で呼ぶ**(cron 停止時の保険。5 分に 1 回まで) |
| route | `POST /api/events/[id]/refresh-ranking` | 直近 45 秒以内にスナップショットがあれば公開 API を叩かず `throttled: true` で返す(複数タブ対策) |
| UI | `EventDashboard` | ふわっち連携イベントのヒーロー(確率・期待順位・現在順位/スコア)を `ranking_snapshots` 由来に統一(逆算パネルと同じ数字になる)。「最終取得」と「ランキング更新」ボタンをヒーローに追加。未取得時は「未取得」バッジ + 「—」表示 |
| UI | `RankForecastPanel` | スナップショットは親から受け取る(二重取得をやめた)。開始時刻を渡して同じモデルで計算 |
| 廃止 | `src/app/(dashboard)/ai-prompter/page.tsx`、ナビの「攻略」 | 攻略(AI 接客カンペ)ページを削除。`/ai-prompter` は `/events` へ恒久リダイレクト(next.config.ts)。ダッシュボード内の攻略セクション(`NEXT_PUBLIC_FEATURE_STRATEGY_PANEL`)は既定非表示のまま残置 |

### 動作確認手順

1. `pnpm exec tsc --noEmit` / `pnpm test`(rank-forecast 13 件・calculator 2 件を含む) / `pnpm exec next build --webpack`
2. `/events` を開く → スナップショットが無ければ数秒で自動取得され、「現在 N 位 · 最終取得 …」が出る。確率は順位表全員との比較になる(7 位・33,050 pt・3 位が 170,710 pt・残り 51h なら目標 3 位は 15% 未満、期待順位は 5〜8 位程度)
3. 「ランキング更新」を 1 分以内に 2 回押すと 2 回目は「直前に取得済みです」
4. `/ai-prompter` にアクセスすると `/events` へ移る

### 未確定・運用

- 5 分毎のスナップショットは Workers Cron(`wrangler.jsonc` の `triggers.crons` → `src/worker.ts` の scheduled)が担う。**Cron Trigger は移行後の初回デプロイから本番に載っている**(tagtech-jp/tagdeck では `deploy.yml` が main push で動き、ログに「Deployed tagdeck triggers」が出る。旧 nikkun22 側の課金停止は新リポジトリには及んでいない)。PR #23 のマージで Deploy run が走った(2026-09-25T11:00Z)。画面側の自動取得は Cron が止まった時の保険
- Cron が実際に動いているかの確認: Cloudflare Dashboard → Workers & Pages → tagdeck → Logs(observability 有効)で `[ranking-sync/scheduled] targets=N ok=N failed=N` を探す。ターミナルなら `pnpm exec wrangler tail tagdeck --format pretty`(要 `wrangler login`)。DB は `SELECT captured_at, my_rank, my_point FROM ranking_snapshots ORDER BY captured_at DESC LIMIT 5;` が 5 分ごとに増える。`targets=0` なら対象シミュレーターの status/ranking_type/期間を確認、`failed` なら同行の例外メッセージを見る
- 最終日係数 1.5 は引き続き仮置き(TODO.md)

## 2026-09-30 修正: シミュレーターの削除を論理削除に(ランキング履歴を残す)

### 背景(本番で観測した症状)

- 2026-09-30、本番の `ranking_snapshots` が全体で 0 行だった。9/23・9/25 に同期で書き込んだ先のシミュレーターが削除されており、`ranking_snapshots.simulator_id` の外部キー(`ON DELETE cascade`・`drizzle/0011`)で履歴ごと消えていた。E3 の実データ検証に使う予定のデータで、消えた分は戻らない
- `DELETE /api/events/[id]` は行を物理削除しており、コメント「他テーブルからの参照も存在しない」は誤りだった

### 追加・変更

| 種別 | パス | 内容 |
|---|---|---|
| route | `DELETE /api/events/[id]` | 行を消さず、本人の行の `status` を `'deleted'` にして `updated_at` を更新する(論理削除)。該当なし・他人の行・削除済みは 404(PR #66) |
| lib | `src/lib/events/simulator-scope.ts` | `ownedSimulator(id, userId)` = id 一致・本人・`status <> 'deleted'`。シミュレーターを id で読み書きする API はすべてこれで絞る(Drizzle は RLS を通らないため本人条件は必須)(PR #66) |
| route | `PATCH /api/events/[id]`・`POST [id]/complete`・`POST [id]/manual-rivals`・`POST [id]/refresh-ranking`・`GET [id]/snapshots`・`POST /api/platforms/whowatch/events/[event_key]/item-points/estimate` | 削除済みは 404(PR #66)。`complete` は `completed` への更新にも同じ条件を付け、読み込み後に削除された行を戻さない |
| route | `GET /api/events/[id]/historical-pace` | 以前は id を使っておらず、削除済み・他人の id でも 200 を返していた。`ownedSimulator` で確かめて 404(PR #68) |
| schema | `src/lib/db/schema.ts` | `rankingSnapshots` のコメントを論理削除の説明に修正、`status` 列に値の一覧(`active` / `completed` / `deleted`)を記載(PR #68) |
| test | `src/lib/events/simulator-scope.test.ts`・`src/app/api/events/[id]/route.test.ts`(PR #66)、`src/app/api/events/[id]/soft-delete.test.ts`(PR #68・35 件) | 削除済みは id で読む 8 ルートすべてで 404、`active`・`completed` は 200、他人の行は 404、DELETE の後も `ranking_snapshots` が残る。soft-delete.test.ts は Drizzle の WHERE を PgDialect で SQL に描画して評価するインメモリ DB で実行 |

- 変更なし(確認のみ): 一覧 `GET /api/events`・Cron(`src/worker.ts`)・`rankings/sync`・`poll` は以前から `status = 'active'` で絞っているので、削除済みは自然に外れる。`completed` の扱いは変えていない
- migration なし(`status` は既存の text 列)。画面の削除確認「取り消せません」は、画面から元に戻す手段が無いので変えていない

### 動作確認手順

1. `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm exec next build --webpack`
2. 本番(読み取りのみ): ログインした状態で、存在しない id の `GET /api/events/<uuid>/historical-pace?eventType=ranking` が 404 になる(PR #68 より前は 200)
3. 本番(社長・DB への書き込みを伴う): 不要なシミュレーターを画面から削除 → 一覧から消える。DB では `SELECT id, status, updated_at FROM event_simulators WHERE status = 'deleted';` に残り、`SELECT count(*) FROM ranking_snapshots WHERE simulator_id = '<削除した id>';` も減らない

### 未確定・運用

- 削除した行と履歴は DB に残る。完全に消す必要が出たら(退会・削除依頼など)、`status = 'deleted'` の行を後から物理削除する仕組みを別途検討する(TODO.md)

## E6: ランキング区分の取り直しと自動設定(実装済み・2026-10-01)

社長報告「イベントでランキング区分が取れないので、今後自動で取ってくるようにして」への対応(オートモードで自走)。対象は ふわっちマジックファンタジーワールド(`2026_10_magicfantasy`・id 1523)。作成フォームに「このイベントにはランキング区分がありません(ランキング自動取得は使えません)」と出た。期間「前半 10/1 00:00 〜 10/7 00:00」は出ていた。区分が空のまま作ったシミュレーターには、ダッシュボードの警告(PR #65)が出ていた。

### 背景(本番で観測した症状と原因)

- **原因 1: 構造の保存失敗が 24 時間残った。** Daily whowatch sync(run 36767963495・2026-09-30T19:46:41Z)で `rules_text/struct の保存に失敗: Failed query ← Network connection lost.` が出た
  - 小さい列(`detail_fetched_at`・`periods` など)は先に保存済みだった。そのため 24 時間の鮮度判定(`DETAIL_STALE_MS`)が `struct` NULL の行をそのまま返し、区分の選択肢が 0 件になった
  - 期間が出ていたのは、`periods` を取得時のメモリ上の構造から計算して小さい列で保存していたため
- **原因 2: 構造 JSON の 4 つ目の形。** selectbox の直下に `chips[]` が並ぶ(`tabs` なし)形があった
  - 該当は doll(もりあげ魔法ねこさんぬいぐるみ)と deco(マジシャンデコレーション)
  - 従来は `magicfantasy_1st_doll` を作っていたが、公開 API ではこのキーが空配列になる
  - 2026-10-01 の実測: `/rankings/{type}` で `magicfantasy_1st_doll_free`〜`_bronzeplus`、`magicfantasy_1st_deco_free`〜`_bronze`、`magicfantasy_2nd_deco_*`、`magicfantasy_1st_overall`、`magicfantasy_2nd_overall` などが取れる。構造からは全 60 キーができる
- **予防: 未公開時の応答。** 未公開の構造 JSON は HTTP 200 で `{"error_code":"Z-002","error_message":"データが見つかりません"}` を返す。修正前はこれをそのまま構造として保存し、区分 0 件のまま「取得済み」になり得た
- **区分が空のまま作られる。** 作成フォームは区分が無くても作成できる。区分が空のシミュレーターは 5 分同期の対象外になり、書き込みが止まる(2026-09-30 のオオカミさんがやってくる！と同じ)

### 追加・変更

| 種別 | パス | 内容 |
|---|---|---|
| lib | `src/lib/whowatch/events.ts` | `RankingSelectbox.chips` を追加し、selectbox 直下のチップを `{prefix}_{option}_{selectbox}_{chip}` に平坦化する。チップの無いキーは作らない。`getRankingStruct` は `error_code` 付きの応答を 404(`WhowatchEventApiError`)として投げ、キャッシュしない |
| lib | `src/lib/whowatch/event-detail-sync.ts` | `isUsableStruct` を追加(NULL・配列・`error_code` 付きは使えない)。`isDetailFresh` は、RANKING タブがあるのに構造が使えない行を `STRUCT_RETRY_MS`(10 分)で古い扱いにする。それ以外は従来どおり 24 時間。大きい列(`rules_text`+`struct`、`rules_html`)の UPDATE は、一時的な切断に備えて 300ms 後に 1 回だけやり直す。やり直しも失敗した場合は警告にとどめ、取り直した構造はメモリ上で返す。先頭の読み込み(SELECT)の失敗は、SQL 全文と params を落とした `EventDetailSyncError`(stage `db`)で投げる(drizzle の `DrizzleQueryError` は message に SQL と params を含み、イベント詳細 API の 502 応答の `detail` にもそのまま出ていた) |
| lib(新規) | `src/lib/whowatch/ranking-choice.ts` | `choicesForOption`・`defaultChoice`(総合 → 先頭)・`periodKeyAt`・`pickDefaultRankingType`。作成フォーム、設定画面、5 分同期の 3 か所で同じ規則を使う(ブラウザでも読み込む) |
| lib(新規) | `src/lib/whowatch/auto-ranking-type.ts` | `autoAssignRankingTypes`: 詳細は下の「自動設定の規則」 |
| worker | `src/worker.ts` | 同期のトランザクションより前に `autoAssignRankingTypes` を呼ぶ。失敗しても順位の同期は続ける。ログは `auto ranking_type assigned=<id 先頭 8>:<区分> repaired=<event_key>`(入れた・取り直した回だけ)と `auto ranking_type skipped=<id>:<理由>`(warn)。順位の同期の失敗ログも `describeDbError` を通す(SQL 全文・params を出さない) |
| UI | `EventCreateForm`・`EventSettingsEditor` | RANKING タブがあるのに区分が 0 件のときの文言を「ランキング区分をまだ取得できていません。このまま作成すれば、期間中は 5 分ごとの同期が区分を取り直して自動で設定します」に変更。RANKING タブが無いときは従来の「区分がありません」。区分の絞り込みと既定は `ranking-choice.ts` を使う |
| UI | `EventDashboard` | 区分が空の警告: 紐付け済みなら「期間中は 5 分ごとの同期が区分(総合)を自動で設定して、順位の取得を始めます」、紐付けなしなら従来の文言 |
| test | `events.test.ts`(+2)・`ranking-choice.test.ts`(新規 7)・`auto-ranking-type.test.ts`(新規 14)・`event-detail-sync.test.ts`(+5)・`event-detail-sync.retry.test.ts`(新規 4)・`worker.test.ts`(+4) | マジックファンタジーの実応答を縮約したフィクスチャ、`error_code` 応答の 404 化、10 分での取り直し、保存のやり直し、自動設定の対象と上限、取り直す対象の選び方、トランザクションより前に呼ぶこと、ログに SQL 全文・params を出さないこと |

#### 自動設定の規則

- **対象**: ふわっち・`active`・ランキング型(ranking / nice / viewer)・`ranking_type` が空・期間内・イベント紐付けあり
- **除外**: 紐付け先が「詳細取得済みで RANKING タブ無し」のもの。毎回の上限枠を塞がないため
- **上限**: 1 回の同期で開始日時の早い順に最大 10 件
- **取り直し**: 詳細が未取得、または構造が使えないイベントは、先に `syncEventDetail` で取り直す
  - 1 回の同期で 1 イベントまで(外部 API 最大 5 回・DB 最大 6 本)
  - 10 分以内に取り直したイベントは呼ばない(`isDetailFresh`)
  - 取得が最も古いもの(未取得が先)から選ぶ。構造がずっと取れないイベントが、毎回の枠を使い続けないようにするため(`pickRepairTargets`)
  - 失敗ログは `describeDbError` を通す
- **入れる区分**: シミュレーターの開始日時を含む区分(前半/後半)の「総合」。どの区分にも入らなければ、それより前に始まった最後の区分。作成フォームの既定と同じ規則
- **書き込み**: `ranking_type IS NULL` の行だけを更新する(`updated_at` も更新)。利用者がその間に選んだ区分は上書きしない。入れた行は同じ回の同期から対象になる

### 動作確認手順

1. `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm exec next build --webpack`
2. デプロイ後、`pnpm exec wrangler tail tagdeck --format pretty` で 5 分の境目をまたいで見る
   - 区分が空のシミュレーターがあれば `auto ranking_type assigned=…`(構造を取り直した回は `repaired=<event_key>` も)が出る
   - 続けて `targets=N ok=N failed=0` が出る
3. DB(読み取り)
   - `SELECT id, ranking_type, updated_at FROM event_simulators WHERE whowatch_event_id = 1523;` で区分が入っている
   - `SELECT jsonb_typeof(struct), detail_fetched_at FROM whowatch_events WHERE id = 1523;` が `object`
   - `ranking_snapshots` が 5 分ごとに増える

### 未確定・運用

- 自動で入るのは「総合」。キャラ別やクラス別の順位で目標を立てる場合は、「区分・期間を編集」で選び直す(選んだ区分が優先され、自動設定は空の行にしか書かない)
- 後半(2nd)に入っても、前半に入れた区分は自動では切り替えない(区分が空の行だけが対象)。後半の順位を追う場合は、設定画面で後半を選ぶ

## S2: SE プリセット(保存・共有・取り込み)(実装済み・2026-09-25 → **2026-09-26 廃止**)

> 2026-09-26 社長指示「SE プリセットは不要。社長が SE を入れるたびに他の人にも同期する仕組みに」により、UI(SePresetPanel)・API(/api/se/presets*)・lib(presets*.ts)を削除した。同期は S4 の仕組み(運営アカウント = SE_DEFAULT_SOURCE_USER_ID の現在の割り当てを全員の既定にする)。読み直しは 開いたとき・5 分ごと・タブに戻ったとき(**2026-09-30 社長指示で同期状況のカードと「今すぐ同期」は外し、表示なしで自動同期**。S19)。se_presets テーブルは残置。以下は記録として残す。

社長指示「今の SE の状態を音を保存して他の人にも使い回せるようにしてほしい」への対応。SE タブの割り当て一式(価格帯の既定・種類・カテゴリ・アイテム・パターンの音源/音量/鳴らす)に名前を付けて保存し、8 文字の共有コード(または共有 URL)で他の配信者がそのまま取り込める。

### 追加・変更

| 種別 | パス | 内容 |
|---|---|---|
| table | `se_presets` | `owner_user_id, name, description, share_code(UNIQUE), is_public, mappings(jsonb スナップショット), mapping_count`。migration `drizzle/0018_se_presets*.sql`。RLS: 所有者は全操作、authenticated は公開行の SELECT |
| lib | `src/lib/se/presets.ts` | 純関数。共有コード生成(I/O/0/1 を除く 32 文字 × 8 桁)、コード/共有 URL の正規化、割り当ての検証(key 書式・Supabase Storage 以外の URL は既定音に落とす・volume 0〜100)、replace/merge の規則、内訳の集計 |
| lib | `src/lib/se/presets-db.ts` | スナップショット取得、一覧、コード検索、作成(コード衝突は再生成)、適用(1 トランザクション・1 INSERT の upsert。replace は先に自分の行を全削除) |
| route | `GET/POST /api/se/presets` | 自分のプリセット + 公開プリセット一覧 / 今の se_mappings を保存(0 件なら 400) |
| route | `GET/PATCH/DELETE /api/se/presets/[code]` | 内容と内訳(コードを知っていれば誰でも) / 名前・説明・公開・「今の設定で更新」(所有者のみ) / 削除(所有者のみ) |
| route | `POST /api/se/presets/[code]/apply` | `{mode: "replace" \| "merge"}` で自分の se_mappings へ取り込む |
| UI | `SePresetPanel`(SE タブ最上部) | 保存(名前・公開)、取り込み(コード or URL → 内容確認 → 追加取り込み/全部置き換え(2 段階確認))、自分のプリセット一覧(共有リンクコピー・今の設定で更新・公開切替・削除)、みんなのプリセット。`/live?sePreset=CODE` で開くと取り込み欄に自動入力 |
| provider | `LiveConnectionProvider.reloadMappings()` | 取り込み後に再生側の割り当てを即再読込(ページ更新不要) |

### 音源の扱い(重要)

- カスタム音源はファイルを複製せず、保存した人の Storage(バケット `se`・公開読み取り)の URL をそのまま指す。保存した人が音源を差し替える・消すと、取り込んだ側も変わる/鳴らなくなる(既定合成音にはならず、取得失敗時の挙動は engine.ts の loadBuffer に従う)
- 取り込み時に Supabase Storage 以外のホストの URL は既定音(null)に落とす(所有者側の `/api/se/mappings` でも同じ検査をしているため通常は発生しない)

### 社長作業

- Supabase SQL Editor で `drizzle/0018_se_presets_manual.sql` を適用(未適用だと保存・取り込みが 500 になる。SE タブの他の機能は影響なし)

### 動作確認手順

1. `pnpm exec tsc --noEmit` / `pnpm test`(presets 8 件を含む) / `pnpm exec next build --webpack`
2. `/live` → SE タブ最上部「SE プリセット」で名前を入れて「今の設定を保存」→ 共有コードが出る。「共有リンクをコピー」で `https://tagdeck.jp/live?sePreset=CODE`
3. 別アカウント(または同じアカウント)でそのコードを貼って「内容を確認」→ 件数と内訳が出る → 「追加で取り込む」で se_mappings が増え、ライブタブの試聴で同じ音が鳴る(ページ更新不要)
4. 「今の設定を全部置き換える」は 2 回押しで実行(1 回目は赤い確認ボタンになる)
5. 「公開する」にすると他のユーザーの「みんなのプリセット」に出る

## S3: スマホ用バックグラウンド再生「音楽プレイヤー扱い」(実験・2026-09-25)

社長指示「スマホでバックグラウンドでも再生できるようにしたい → 音楽プレイヤー扱いにして実験したい」への対応。ライブタブに実験スイッチを追加した。

### 仕組み

- `src/lib/se/background-keepalive.ts`: `<audio>` 要素で無音に近い音(25 Hz・振幅 0.4%・20 秒ループ・data URL の WAV)を再生し、OS に「音楽再生中」と見なさせる。Media Session で通知バー/ロック画面に再生カード(TagDeck ライブ SE 待機中)を出す。iOS 17+ は `navigator.audioSession.type = "playback"`。Wake Lock(画面ロック防止)は別スイッチ
- 既存の keep-alive(engine.ts・Web Audio の無音ループ)は PC 向けで、スマホの OS はこれを「音楽再生中」と見なさないため別経路にした
- 再生の開始は自動再生制限のためユーザー操作の中でだけ行う(スイッチ ON・接続・音を有効にする)。ページを開き直した直後はスイッチ ON でも「停止中」で、接続ボタンで再開する
- 再生カードの「一時停止/停止」はユーザーの意思としてスイッチごと OFF。電話などの OS 割り込みは「OS に一時停止された」と表示し、画面に戻ったら再開を試みる
- 計測: `document.hidden` 中に成功したポーリング回数と最終時刻を表示する(`bgAudio.hiddenPollCount`)。これが増えれば裏でも動いている

### 追加・変更

| 種別 | パス | 内容 |
|---|---|---|
| lib | `src/lib/se/background-keepalive.ts` | `BackgroundKeepAlive`(start/stop/setWakeLock)、`makeNearSilentWavDataUrl`、`detectBgAudioSupport`(テスト 4 件) |
| provider | `LiveConnectionProvider` | `bgAudio`(enabled/wakeLock/state/error/support/hiddenPollCount)・`setBgAudioEnabled`・`setBgWakeLock`。localStorage `tagdeck.live.bgAudio` / `tagdeck.live.bgWakeLock` |
| UI | `LiveCockpit` | カード「スマホでも裏で鳴らす(実験)」: スイッチ 2 つ・状態バッジ・対応状況・隠している間の取得回数・試し方 |

### 実験手順(社長・実機)

1. スマホで `/live` → 「接続」 → 「音楽プレイヤー扱いにする」ON → 通知バーに再生カードが出ることを確認
2. ホームに戻る(または画面を消す)→ 2〜3 分待つ → 戻って「画面を隠している間の取得: N 回」が増えていれば裏でも動いている。ギフトを投げてもらえば SE の実鳴りも分かる
3. 結果を Android / iPhone それぞれ「画面点灯・他アプリ」「画面ロック」の 2 条件で記録する。iPhone のロック後は OS 次第(README S3 冒頭の注意)
4. 「画面を消さない」は電池を使うが、点灯中は確実に鳴る(両 OS)

### 期待される結果と、外れた場合

- Android Chrome: 他アプリ・画面ロックとも取得回数が増える見込み。増えなければ Chrome の「バックグラウンドでの音声再生」や電池最適化の設定を確認
- iPhone Safari: 画面点灯中・他アプリは増える見込み。画面ロック後に増えなければ、現状のブラウザでは不可と判断し「画面を消さない」運用にする

## S4: 公式の既定 SE(運営のアップロードに同期・汎用既定は「きらきら輝く1」)(実装済み・2026-09-25)

社長指示「SE 欄で音源を変更したので、デフォルトに設定してほしい」→「音を自分のアップロードしているものに同期してほしい」→「デフォルトの音声を『きらきら輝く1』に変更してほしい」への対応。

### 既定の優先順(上が優先)

1. **同期元ユーザーの現在の割り当て**: `wrangler.jsonc` の `vars.SE_DEFAULT_SOURCE_USER_ID`(運営アカウントの users.id)の se_mappings のうち、音源あり・鳴らす ON の行。`GET /api/se/mappings` が `defaults` として返し、クライアントが合成する。**運営が SE タブでアップロードし直せば、次の読込(ライブ画面は 5 分ごと・SE タブは開いたとき)から全ユーザーの既定が変わる**。デプロイ不要
2. **同梱スナップショット**(`src/lib/se/default-mappings.ts` 37 件 + `public/se/defaults/*.mp3|wav` 21 ファイル・2026-09-26 に同期元の全件へ追従。廃止キー tier:combo のみ除く): 同期元が未設定・0 件のとき(ローカル開発など)。生成は scratchpad の build_defaults_full.py 相当(同期元の `/api/se/mappings` から key/ファイル/音量/ラベルを写す)
3. **汎用既定「きらきら輝く1」**(`public/se/defaults/kirakira.mp3`・効果音ラボ): 価格帯 tier:T0〜T4・hit のうち 1・2 に無いもの。Web Audio 合成音は音源が取れなかった時だけの保険になった

ユーザー側の規則: 自分の行がある key は自分の行。ただし url が null(音量・鳴らすだけ変えた)なら音源は既定のまま。「既定に戻す」= 自分の行を消して公式音源へ。SE タブは「既定 ♪ ラベル」と表示し、自分の行がある key だけ「上書き中」「既定に戻す」を出す。

### 追加・変更

| 種別 | パス | 内容 |
|---|---|---|
| route | `GET /api/se/mappings` | `defaults`(同期元の行)と `defaultsSource`("sync" / "bundled")を追加。`Cache-Control: private, no-store` |
| config | `wrangler.jsonc` `vars.SE_DEFAULT_SOURCE_USER_ID` | 同期元ユーザー ID(秘密ではない内部 ID)。空にすると同梱に落ちる |
| lib | `src/lib/se/merge-defaults.ts` | `mergeWithDefaults(userRows, liveDefaults)`: 同期元 > 同梱 > 汎用の順に既定を組み、ユーザー行を重ねる。テスト 10 件 |
| lib | `src/lib/se/default-mappings.ts` | 同梱スナップショット 18 件 + `GENERIC_DEFAULT_SOUND`(きらきら輝く1) |
| provider/UI | `LiveConnectionProvider`・`SeMappingTab` | 合成後の mappings を使う。ライブ画面は 5 分ごとに再読込。SE タブの説明に「運営の現在の設定に同期 / 同梱」を表示 |

### 権利について(社長判断・2026-09-26 確定)

同期方式では、運営アカウントにアップロードした音源が**そのまま全ユーザーに配られる**。当初は第三者の著作物と思われる音源(任天堂コイン音・牙狼保留音)を同梱スナップショットから除外していたが、2026-09-26 の社長指示「すべて社長のアカウントと同じように既定の SE に同期」により**除外をやめ、同期元の全件を同梱**した(現在の T2「【任天堂】コインの音」、item:13064「super-mario-bros … star-theme」を含む)。権利上の判断は社長が負う。外す場合は運営アカウントの SE タブで「既定に戻す」し、同梱スナップショットを作り直す。

> **2026-09-30 S23 で変更**: 正式リリースに向け、同期元がアップロードした音そのものは他の利用者に配らないことにした。同期元の行は CC0 の同種の音に置き換えて配り、同梱スナップショットも CC0 に差し替えた(`public/se/defaults/cc0/`)。上の「全件を同梱」は記録として残す。

### 動作確認手順

1. `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm exec next build --webpack`
2. デプロイ後、別アカウントで `/api/se/mappings` を開くと `defaultsSource: "sync"` と運営の行が `defaults` に入る
3. 運営アカウントの SE タブで音源を差し替える → 別アカウントで SE タブを開き直すと「既定 ♪ 新しいラベル」に変わる
4. 運営にも同梱にも無い価格帯(例: T2 を「既定に戻す」した状態)は「既定 ♪ きらきら輝く1.mp3」で鳴る
## S5: 無音が続くと SE が鳴らなくなる問題の修正(実装済み・2026-09-25)

社長報告「無音が続くとならなくなる」への対応。原因は 2 系統あり、両方に手を入れた。

| 原因 | 症状 | 対処 |
|---|---|---|
| AudioContext が suspended / interrupted / closed になる(しばらく音を出していない・画面を隠した・他アプリが音を出した・iOS の割り込み) | その後 start() しても音が出ない。keep-alive も止まる | `engine.ts`: 鳴らす直前に `ensureAudioRunning()`(resume を 1.5 秒で打ち切り)。closed なら作り直して keep-alive を鳴らし直す。画面復帰・ユーザー操作(pointerdown/keydown/touchend)で自動復帰(`installAudioAutoResume`)。接続中・待機中は 5 秒ごとに監視し、自動で戻せなければ「音を有効にする」ボタンを再表示、戻せたら「音声を再開しました」バッジ |
| ポーリングの fetch がぶら下がる(回線切替・スリープ復帰) | inFlight ガードで以後の取得が永久に止まる → ギフトが来ても鳴らない | `POST /live/poll` と待機確認 `GET /live` に `AbortSignal.timeout(15s)`。打ち切られれば従来の再試行に乗る |

### 動作確認手順

1. `pnpm test`(engine 5 件を含む)、`pnpm exec tsc --noEmit`、`pnpm exec next build --webpack`
2. 接続 → 10 分以上ギフト無しで放置 → テスト再生が鳴る。スマホでは画面を消して戻る → 状態バッジが「音声停止中」なら「音を有効にする」で復帰、自動で戻れば「音声を再開しました」
3. 機内モードを 30 秒 ON → OFF → 「取得エラー…再試行します」の後に最終取得が進む(fetch が 15 秒で打ち切られる)

## S6: 配信者ID欄の固定(実装済み・2026-09-26)

社長指示「一度打った ID を引き継いで固定できるようにしたい」への対応。ライブタブの配信者ID欄に「このIDを固定(次回も引き継ぐ)」のチェックを追加した。

- ON にすると入力中の ID を localStorage `tagdeck.live.targetId` に保存し、次に開いたときも入力済みで始まる。固定中に ID を書き換えれば保存値も追従する。OFF で保存値を消す(入力欄の文字は残る)
- 自分以外の ID を固定している間は、既存仕様どおり「配信開始時に自動接続」は待機しない(自分の配信を待つ機能のため)。固定中はその旨を欄の下に表示する
- 変更: `LiveConnectionProvider`(`targetIdPinned` / `setTargetIdPinned`)、`LiveCockpit`(チェックと注意書き)。DB 変更なし

## S7: SE タブに「WEBおまけ・無料アイテム」カテゴリと全アイテム検索(実装済み・2026-09-26)

社長指示「webおまけのねずみなども設定できるようにして」「メガホンも加えてほしい」への対応。

- 原因: ふわっちの `/playitems` には おまけ・無料 の区分が無く(価格が無いだけ)、価格なしアイテムは 1,787 件が「分類なし」に入り、既定 ON の「価格ありのみ」でも隠れるため、ネズミ(item 11243 / 金 12857)やメガホン 14 種(item 14, 10769, 10837, 10863, 11038, 11250, 11526, 11716, 11891, 11960, 12731, 12871, 13046, 13095)にたどり着けなかった
- 対応 1: 擬似カテゴリ「WEBおまけ・無料アイテム(ネズミ・メガホン・ハートなど)」をプルダウンに追加(`src/lib/se/web-bonus.ts` の名前判定 `/メガホン|ネズミさん|ハート|拍手|\(Web\)/` × 価格なし)。見出しに「全部にまとめて割り当て」を付けた(擬似カテゴリは cat:group: が使えないため、アイテムごとの行として保存する)
- 対応 2: 検索欄は「価格ありのみ」とカテゴリを無視して全アイテムから探し、検索結果を 1 つの一覧で出す
- 追加候補があれば `WEB_BONUS_RE` に名前を足す(テスト `web-bonus.test.ts`)

## S8: SE 音源アップロードの上限 20MB・m4a/aac 対応・行ごとのエラー表示(実装済み・2026-09-26)

社長報告「音源がアップロードできなくなった」への対応。社長アカウントで本番の API と画面操作を再現したところ PC では成功したため、原因は「5MB 超のファイル(WAV は 30 秒で超える)」「m4a/aac」「エラーが一覧の上にしか出ず気付けない」のいずれかと判断し、3 つとも直した。

- 上限 5MB → 20MB、拡張子に m4a / aac を追加(`/api/se/upload`・`SeMappingTab`)。Content-Type はブラウザ申告を使わず拡張子から正規の値にする(audio/x-wav・空文字・video/mp4 の揺れ対策)
- **バケット側の上限は SQL で合わせる必要がある**: `drizzle/0019_se_bucket_limits_manual.sql`(5MB → 20MB、MIME 9 種)。未適用のまま 5MB 超や m4a を上げると Supabase が拒否し、画面に「0019 を適用してください」と出る
- エラー・完了メッセージは操作した行の直下にも出す(ファイル名・サイズ・種類を含める)

## S9: 音源アップロードで「何も起きない」問題の根本修正(実装済み・2026-09-26)

社長報告「やはりここでアップロードできない」(どんぐりの行・エラー表示なし)への対応。S8 の上限拡大は別件で、真因はこちら。

- 原因: PR #25 で `SeMappingTab` が `useLiveConnection()` を購読するようになり、接続中のポーリング・監視(数秒ごと)のたびに SE タブ全体が再描画されるようになった。さらに `MappingControls` がコンポーネント内で定義されていたため、親の再描画のたびに別コンポーネントとして作り直され、`<input type="file">` ごと外れて付け直されていた。ファイル選択ダイアログを開いている数秒の間に再描画が起きると、ダイアログを開いた input は既に DOM から外れており、選択後の change イベントが React に届かない → 何も起きない。JS で files を直接セットして即 change を送る再現では通るため、当初は見つからなかった
- 対策: context を読むのは薄いラッパー `SeMappingTab` だけにし(`reloadMappings` は安定参照)、本体 `SeMappingTabInner` を `memo` で包む。`MappingControls` はモジュール直下の `memo` コンポーネントに移し、親が再描画されても同じ要素を使い続ける。ついでに同じファイルを続けて選んでも change が飛ぶよう、受け取ったら `input.value` を空にする
- 確認: 接続中(ポーリングが動いている状態)で SE タブを開き、ファイル選択ダイアログを 10 秒以上開いたまま選ぶ → 「… を割り当てました」が出る

## S10: 1 個ごとの単価とまとめ投げの合計判定(実装済み・2026-09-26)

社長指示「単価取得が曖昧になっているので、1 個ごとの単価を算出してほしい。1 回のコメントでまとめ投げしたときに合計金額で判定するようにすること」への対応。

### 何が曖昧だったか(2026-09-26 に payments3 の実応答で確認)

- 商品は 1 アイテムに複数ある(111 アイテム中 86 が複数商品。例: ぶたさん 1 個 ¥160 / 5 個 ¥800 / 10 個 ¥1,580 / … / 1,000 個 ¥145,000)。`item_point_mapping.price_jpy` は Python 日次同期が**最初の商品の価格**を入れており、たまたま 1 個入りが先頭なら合っていたが、「スター」のように最小商品が 3 個 ¥90 のアイテムは 1 個 ¥30 なのに ¥90 が単価になっていた
- 個数: コメントの `item_count` だけを見ており、「風船 × 10」のような束パターン(`quantity` 10。現在 2 パターン)を 1 個と数えていた

### 対応

| 種別 | パス | 内容 |
|---|---|---|
| table | `whowatch_item_prices`(0020) | `unit_price_jpy` = 最小個数の商品の price ÷ quantity(定価の単価)、`min_unit_price_jpy` = まとめ買いの最安単価、`products`(商品ごとの価格・個数)。RLS: authenticated は SELECT |
| lib | `src/lib/whowatch/item-prices.ts` | `unitPriceFromProducts`(純関数・テスト 5 件)、`flattenPrices`、`syncItemPrices`、`giftTotalYen` |
| route | `POST /api/platforms/whowatch/items/sync` | payments3 を 1 回取得してカテゴリと単価を同期(応答に `prices`)。0020 未適用なら `prices.error` に出てパターン同期は続く |
| route | `POST /live/poll`・`GET /items/patterns` | 単価は `whowatch_item_prices` を優先し、無ければ従来の `price_jpy` |
| lib | `gift-normalize.ts` | `count` = item_count × パターン quantity、`total_yen` = 単価 × count を追加。ティア判定(`tiers.ts`)は従来どおり 単価 × 個数 = 合計で行う |

### 社長作業

1. Supabase SQL Editor で `drizzle/0020_item_prices_manual.sql` を適用
2. GitHub → Actions →「Whowatch item patterns sync (manual)」を Run workflow(応答の `prices.rows` が 100 前後なら成功)。以後は daily-sync で毎日更新

### 確認

- SE タブの価格表示がぶたさん ¥160、スター ¥30 になる(以前はスター ¥90)
- ライブでぶたさんを 4 個まとめ投げ → 合計 ¥640 → T2「¥500〜1,999」で鳴る(1 個なら T1)

## S11: イベントの無料配布アイテムをイベントのカテゴリに分類(実装済み・2026-09-26)

社長指示「イベントの無料もカテゴリーに分類してほしい」への対応。

- 原因: `/playitems/payments3` のカテゴリには**買える**アイテムしか載らないため、どんぐり・どんぐり帽子・赤ずきんサイコロ・ルーキーフラッグ等の無料配布アイテムは「分類なし」に落ちていた
- 手がかり(2026-09-26 実応答): アイテム画像 URL のフォルダ `events/2026/09_autumncollection/…` がイベントキー `2026_09_autumncollection` に対応し、イベント詳細 `/event_lists/{key}` の ITEM タブ detail が payments3 のカテゴリ key と一致する(autumncollection と autumncollectionlite → "autumncollection"、2026_09_gingiragin → "gingiragin_2026"、2026_09_rookie_2 → "rookie_renewal2026")。RANKING タブの prefix とは別物
- 対応: `src/lib/whowatch/free-event-items.ts`(`eventKeyFromImageUrl` / `buildFreeItemGroupRows` 純関数・テスト 4 件 / `syncFreeEventItems`)。単価テーブルに無い(＝無料)× 画像がイベントフォルダ × そのイベントの ITEM タブ key がカテゴリにある → `whowatch_item_groups` に `is_free=true` で追加。ITEM タブ key は `whowatch_events.item_group_key`(0021)に保存し、未取得の open/pre イベントだけ同期時に取りに行く(上限 20 件/回)
- 効果: SE タブでそのイベントのカテゴリに無料アイテムが並び、「カテゴリ全部にまとめて割り当て」も効く(再生時の cat:group: 解決は whowatch_item_groups 由来)。有料化・イベント終了で作らなくなった無料行は同期時に掃除
- 表示(2026-09-26 追記): SE タブの「価格ありのみ」(既定 ON)がカテゴリ内の無料アイテムまで隠していたため「反映されていない」ように見えた。イベントのカテゴリに属する無料アイテムは ON でも表示し、価格欄は「無料(イベント配布)」と出す。「価格ありのみ」が隠すのは分類なしの無料アイテムだけ
- 社長作業: (1) `drizzle/0021_free_event_items_manual.sql` を適用 (2) Actions「Whowatch item patterns sync (manual)」を 1 回実行(応答 `freeItems.rows`)

## S25: ¥160 以上は 5 秒以上の豪華なミックス・イベントアイテムと花火は段階ごとにさらに長く(実装済み・2026-09-30)

社長指示: 「160円以上のアイテムの SE をもっと 5 秒以上で組み合わせて豪華にすること。これらの主要なイベントアイテムはまとめ投げごとにさらに長い豪華な音に修正してほしい。花火系ももっと花火らしい綺羅びやかな長い SE にしてほしい」(オオカミさんがやってくる！のイベント専用アイテム 6 種の画像つき)。

### 原因(実データ)

- 公式既定(S23)と社長の行(S24)は、アイテムごとに CC0 の単発音(0.4〜4 秒)を割り当てている。個別行は自動ライブラリより優先なので、¥160 のイベントアイテム 6 種(おばあさんたぬっち・ぶたさん・ゾウ・シカさん・ワンちゃんさん・もぐらさん)、花火(¥1,100〜2,000)、ギンギラギン(¥250〜5,000)は単発音だけが鳴っていた
- 段階付き(まとめ投げ)でも `item:{id}` の個別行が自動の段階セットより先に当たるため、ぶたさんをミラクル(500 個)投げても 0.7 秒の鳴き声だった
- 自動ライブラリのレベル 1 テーマ(風船・食べ物・ポップ等)と価格帯 T1 は 2.5〜4 秒

### 変更

| 対象 | 変更前 | 変更後 |
|---|---|---|
| 単価 ¥160 以上(`PREMIUM_MIN_YEN`) | 単発音・レベル 1 テーマは 3.5 秒・T1 は 3〜4 秒 | 公式既定の単発音の行を飛ばしてテーマのミックス。レベル 1 テーマは豪華版 `p-{テーマ}`(6.5 秒)、テーマなしは `tier-T2` 以上。有料のミックスは 5.3 秒以上(`MIN_SEC`) |
| まとめ投げの段階(有料) | `item:{id}` の単発音が先に当たる | 公式既定の単発音の行を飛ばして段階のミックス。`bulk-COOL` も 5 秒以上に |
| 主要なイベントアイテム(たぬき・ぶた・ゾウ・シカ・いぬ・もぐら) | 単発音 | 1 発 7 秒のテーマのミックス。段階は専用 `ev-{テーマ}-{段階}`: COOL 9 → GREAT 12 → FANTASTIC 15 → MIRACLE 20 秒 |
| 花火(有料は値段にかかわらず) | 単発音 4 秒 / パチンコ風ミックス | 花火ショー: 打ち上げのヒュ〜 → ドーン → パチパチを重ねて数発、歓声、連発のフィナーレ → 大玉 → 長いパチパチ → 拍手(1 発 10 秒・段階 12〜20 秒) |
| 新テーマ | かわいい(汎用) | たぬき(ぽんぽこの太鼓・ドロン)・もぐら(掘る音・土・ぴょこっ)・シカ(鳴き声・ひづめ・鈴) |
| ギンギラギンギャラクシーオーロラ(¥1,000) | 「きらめきのジングル」= Kenney の 8 ビットのジングル `jingles_NES00` 1 本(社長指摘「悲しい」) | 専用テーマ「オーロラ・銀河」(明るく上がるきらめき・ハープ・星のきらめきのミックス 9 秒)。既定の単発音も明るく上がる 3 音のきらめき(fs715067)に差し替え |

- 判定は `choose-sound.ts` `upgradesClearedSingles`: 有料で「単価 ¥160 以上 / 段階付き / 花火のテーマ」のどれかなら、公式既定の単発音(`/se/defaults/cc0/`)の行を飛ばす。音量はその行の音量を引き継ぐ。**自分でアップロードした音源の行は最優先のまま**、鳴らす OFF の行は鳴らさないまま
- 無料アイテムは変えない(控えめな単発音。新テーマは `lite-cute`)
- 再生側は単価(`unitPriceYen` = ギフトの `price_yen`)を渡す(`LiveConnectionProvider.tsx`)
- SE タブのアイテムカード: 「自動(¥160 以上・豪華版)」の表示と試聴、既定の単発音の代わりにミックスが鳴る旨、段階ごとの専用ミックスの試聴ボタン

### 悲しく聞こえたジングルの除外(2026-09-30 社長指示「ギンギラギンギャラクシーオーロラの音が悲しいので、アイテムに合うように SE を変更してほしい」)

- `jingles_NES00` は公式既定の「きらめきのジングル」と、共通プール win_small に入っていた。win_small から外し、これを使っていた安いアイテム向けの 4 セット(とり・食べ物・ポップ・こども)を作り直した。いまはどのミックスにも公式既定にも入っていない(`choose-sound.test.ts` で検査)
- オーロラの素材は、別の確認役が各ページで CC0・言葉なし・「悲しい/暗い/不気味/夢・回想」の説明やタグが無いことを確かめたものだけ(夢・回想用に低く引き伸ばした風鈴 fs419594 は外した)

### 音源(すべて CC0)

- 素材は S23 と同じく Freesound の CC0 フィルタと Kenney だけ。新しい素材は `scripts/se/cc0_picks.py` の POOL_PICKS(fw_* / tn_* / ml_* / dr_* / crowd_roar / orch_hit / victory / confetti / coin_shower)と THEME_PICKS(tanuki / mole / deer)
- 選び方: 役割ごとに Freesound の CC0 検索で候補を出し、別の確認役が各素材のページでライセンス(CC0)・言葉や作品名の有無・役割への合い方を確かめて、通ったものだけを使った
- 組み立ては `scripts/se/build_se_cc0.py`(`compose_fireworks` / `compose_event_bulk` / `derived_sets`)。作り直したセットと新しいセットのファイル名は `v8-*`(ブラウザや CDN に古い音が残らないように)。旧 v7 の同じセットのファイルはリポジトリ外へ退避
- 点検 `scripts/se/check_cc0_library.py` に「有料のミックスが 5 秒未満」「長すぎる(段階の専用は 20.5 秒・ほかは 15.5 秒まで)」を追加。段階の専用ミックスと花火ショーは、主役の鳴き声・打ち上げ・破裂を繰り返すのが演出なので素材の重複を許す
- 長さの下限は「最後の音が鳴り終わる時刻」で比べる(ミックスは一番遅く終わる素材で終わるため。最初は +0.3 秒の余白込みで比べていて、5 秒をわずかに下回るものが残った)

### レビューでの修正(2026-09-30・観点別の確認役 3 人 → 各指摘を別の確認役が反証)

- 音源の無い行(音量・「鳴らす」だけ変えた行)は合成音にせず、その音量でライブラリを鳴らす。以前は `bulk:MIRACLE` の音量を動かすだけで、ぶたさんのミラクルが専用ミックスではなく価格帯のミックスになっていた
- 音量だけ変えた価格帯の行は、合成済みの既定(きらきら 2 秒の単発音)を URL に持つため、¥160 以上のテーマなしアイテムで 2 秒の音が鳴っていた → ライブラリをその音量で
- カテゴリの行が公式既定の単発音でも、ミックスに上げる条件なら飛ばす
- 鳴らす ON の行を飛ばしたあとは、残りが OFF だけでも「鳴らさない」にしない(既定の単発音 ON ＋ OFF の変種で無音になっていた)
- SE タブ: アイテム行・段階の行の試聴は、自動に任されるときはライブで鳴るセットを鳴らす(以前は飛ばされる単発音や価格帯の予備を試聴していた)。¥160 以上のテーマなしは T2 で表示。段階ボタンはそのアイテムにある段階だけ。「鳴らさない」の表示は変種も見て判定
- 花火: 最初の破裂に打ち上げ(ヒュ〜)の録音を使わない。締めのきらめきを尺の中・最後のフェードより前に置く(尺の外で切られて聞こえていなかった)
- サービスワーカー: `/se/defaults/` だけネットワークを先に見る(既定は音源を最後に使ってから 24 時間キャッシュ優先で持つため、同じ URL で差し替えた「きらめきのジングル」の旧音が残りうる)

## S24: 社長の割り当ても CC0 の音だけに(実装済み・2026-09-30)

社長指示「社長の環境にも新音源を全て同期して著作権回避と商用利用可能なものだけにする」への対応。S23 では社長自身の割り当て(自分の行)を変えていなかったが、これも CC0 にする。

- **変換の処理**: `GET /api/se/mappings/convert-cc0` は計画だけ返し、`POST` で書き換える(対象は呼び出した本人の se_mappings だけ。計算は `src/lib/se/cleared-defaults.ts` の `planOwnCc0Conversion`)
  - アップロードした音(Storage の URL)の行は、ファイル名から CC0 の同種の音(`/se/defaults/cc0/`)に置き換える。他の利用者に配っている公式既定と同じ音。key と「鳴らす」はそのまま、音量は 80
  - 価格帯(tier:*)・廃止キー(tier:combo)・種類の分からない音の行は外す。外すと自動ライブラリ(CC0)の音が鳴る(音源なしの行を残すと合成音になるので残さない)
  - 音源なしの行(音量・鳴らすだけ)と、すでに同梱の音の行はそのまま
  - `POST` の応答の `before` が書き換える前の行(戻すときの控え)
- **公式既定の配り方**: 同期元の行がすでに CC0 の音なら、`toClearedDefaultRows` は URL から音の種類を決める(`clearedIdFromUrl`)。置き換え後も他の利用者に同じ音が配られる
- **Storage のファイル**: 社長がアップロードした元のファイルは消していない(もう鳴らないが、公開バケットに残っている)。消す場合は社長が Supabase の Storage 画面で行う
- **2026-09-30 の実行結果**: 社長のアカウントで実行(下の報告を参照)

## S23: 正式リリースの音源ルール — 利用者に配る音はすべて CC0(実装済み・2026-09-30)

社長指示「これを正式にリリースする手順にしたいので、著作権のあるものは弾いて別の音源に差し替えてほしい」への対応。

- **配っていた音(調査結果)**
  - 公式既定: 同期元(社長)の割り当て 81 件・21 種の音源を、音源ごと全員に配っていた(S4)。任天堂の音(マリオのコイン音・スターのテーマ)、パチスロ由来と思われる音(ジャグラーの「ガコッ」・先バレ風の告知音)、効果音ラボの音(ドラムロール・ゾウ・犬・花火など)、魔王魂の音(ねこ)、出典不明の音声(「出でよ、我がしもべよ！」)を含む。同梱スナップショット `public/se/defaults/*.mp3|wav` 21 ファイルも同じ
  - 自動ライブラリ v4〜v6: Mixkit・魔王魂・ニコニ・コモンズ・Freesound CC0 の素材の混合
- **出典ごとの判断**(2026-09-30 に各サイトの規約を確認)

| 出典 | 判断 | 理由 |
|---|---|---|
| Mixkit | 使わない | 素材そのものを第三者が使える形で配ることを禁じている。サイトの `public/` に置くと誰でも取り出せる |
| 魔王魂 | 使わない | ライバー(配信)系のアプリでの利用に条件がある |
| ニコニ・コモンズ | 使わない | 素材ごとに条件が違い、原作の権利まで確かめきれない |
| 効果音ラボ | 使わない | 効果音を鳴らすアプリなど、効果音が主役の形での配布を禁じている |
| 任天堂・パチスロ由来の音 | 使わない | 第三者の著作物 |
| Freesound の CC0 | 使う | 作者が著作権を放棄している(CC0 1.0)。ゲーム・アニメ・企業名入りや、他人の音の再アップロードと思われるものは除く |
| Kenney(kenney.nl) | 使う | パック同梱の License.txt が CC0 1.0 |

- **変更**
  - 自動ライブラリを CC0 だけで作り直した(v7: パチンコ風ミックス 56 セット 280 本・無料アイテムの単発音 49 セット 151 本)。組み立て方(ライザー → インパクト → テーマ音の連打 → 確定音 → ファンファーレ／歓声 ＋ コイン ＋ きらきら、3〜15 秒、-14 LUFS)と無料の単発音(1.5 秒まで・-19 LUFS)は v4〜v6 と同じ。素材は候補を見て 1 本ずつ選んだ表(`scripts/se/cc0_picks.py`)から
  - 公式既定: 同期元の行は「どんな音か」(ファイル名)で CC0 の同種の音 18 種(`public/se/defaults/cc0/`・出典は同じフォルダの `defaults.json`)に置き換えて配る(`src/lib/se/cleared-defaults.ts` の `toClearedDefaultRows` を `GET /api/se/mappings` が通す)。例: ドラムロール.mp3 → CC0 のドラムロール、スターのテーマ → 8 ビットのきらめきジングル。**同期元がアップロードした音そのもの(Storage の URL)は他の利用者に配らない**。置き換え先の無い音と価格帯(tier:*)の行も配らない(その場合は自動ライブラリの CC0 の音が鳴る)
  - 同梱スナップショット(`default-mappings.ts`)も同じアイテム 75 件を CC0 の音で持つ。汎用既定「きらきら輝く1」は CC0 のきらきらへ
  - SE タブの出典表示を CC0 の一覧(Freesound の音・Kenney のパック)に替えた
  - 旧音源(`public/se/defaults/` の 21 ファイル・自動ライブラリ v4〜v6 の 433 本)はリポジトリから外し、リポジトリ外(`%TEMP%\moved_se_release_cc0_20260930`)に退避
- **社長のアカウント**: 社長自身の割り当て(自分の行)は変えていない。社長の画面では今までどおり自分でアップロードした音が鳴り、他の利用者には CC0 の同種の音が鳴る(**2026-09-30 S24 で社長の割り当ても CC0 に置き換えた**)
- **検査(CI で止まる)**: `src/lib/se/sound-license.test.ts`
  - `public/se/` の音源ファイルはすべて `manifest.json` か `defaults.json` に出典の記録がある(記録の無いファイルを置くと落ちる)
  - 素材はすべて CC0 1.0(Freesound / Kenney)で、素材のページの URL がある
  - ゲーム・アニメ・パチンコ・企業名などが付いた素材を使っていない
  - コードが参照する音(自動ライブラリ・公式既定・同梱スナップショット・汎用既定)が記録済みのファイルだけ

### 音源を足す・差し替えるときの手順(正式リリース後)

道具はすべて `scripts/se/` にある(Python 3.11・ffmpeg / ffprobe が要る。リポジトリのフォルダで実行)。素材のキャッシュは `%TEMP%\tagdeck_se_cc0_cache`(環境変数 `TAGDECK_SE_CACHE` で変更)で、消えていても `cc0_catalog.json` から取り直す(Kenney のパックは kenney.nl のページから取り、同梱の License.txt が CC0 であることを確かめてから使う)。2026-09-30 に、空のキャッシュから公式既定 18 本を作り直してバイト単位で一致することを確認済み。

1. 素材は **Freesound の CC0**(検索フィルタ `license:"Creative Commons 0"`)か **Kenney の CC0 パック**から選ぶ。タイトル・作者名にゲーム・アニメ・映画・企業名が入るもの、他人の音の再アップロードと思われるもの(別の作者名・別サイトの番号が入った名前)、叫び・銃声は使わない。「Remix」などは元の音のライセンスも確かめる
2. `python scripts/se/cc0_candidates.py lite|theme|defaults [名前...]`(任意の検索は `q "検索語" 最大秒`)で候補を出し、`scripts/se/cc0_picks.py` の表(`POOL_PICKS` / `THEME_PICKS` / `LITE_PICKS` / `DEFAULT_PICKS`)に id を書く
3. `python scripts/se/build_se_cc0.py catalog` で取得先の一覧 `scripts/se/cc0_catalog.json` を作り直す
4. `python scripts/se/build_se_cc0.py mix|single|defaults [セット名...]` で作る(出力は `public/se/lib`・`public/se/defaults/cc0`。セット名を付けるとそのセットだけ作り直す)。出典は `manifest.json`・`defaults.json` に自動で書かれる
5. `python scripts/se/check_cc0_library.py` で点検する(音量・真のピーク・長さ・途中の無音・素材の重複)。`manifest.json` / `defaults.json` に無い古い音源ファイルはリポジトリの外へ移す
6. `python scripts/se/gen_auto_library_data_cc0.py` で `src/lib/se/auto-library-data.ts` を作り直す
7. 新しい種類の音を公式既定として配りたいときは、`src/lib/se/cleared-defaults.ts` の `CLEARED_SOUNDS` と `LABEL_RULES`(同期元のファイル名 → 音の種類)に 1 行ずつ足す
8. `pnpm test`(`sound-license.test.ts` が通ること)→ PR

SE タブで利用者が自分でアップロードした音は、その利用者本人の画面でだけ鳴る(他の利用者には配らない)ので、この手順の対象外。

## S22: パックにしか入っていないアイテムの単価(実装済み・2026-09-30)

社長指示「パックにしか入っていないアイテムも単価を計算して組み込んでほしい」への対応(例: ギンギラギンの 銀の通常アイテムパック・銀の文字アイテムパック)。

- **原因**: `/playitems/payments3` には買える商品しか載らず、パックの中身は商品説明の文字列(「・銀の風船 x 10個<br>…」)にしか無い。単品で売っていない 銀の風船・銀のいいね！・銀のKP・銀のハート・銀の神・銀のえ？・銀の草・銀のかわいい(13066〜13073)は単価が無く、S14 の無料配布の判定(マスタにあり payments3 に無い・イベントフォルダ)で **0 円の無料(state FREE)** になっていた。SE も無料の控えめな音で鳴っていた
- **単価の決め方**(`src/lib/whowatch/pack-prices.ts` と `scripts/platforms/whowatch/sync_items_and_events.py` の `pack_item_rows` で同じ計算): パック = 商品説明に「・名前 x N個」の行がある商品(2026-09-30 は 20 個・名前は全部「パック」)。割引前の価格 = Web の価格 + ラベルの割引額(「250円お得！」「アプリより100円お得！」。金額の無い「お得！」は 0)。中身のうち単品で売っているものは単品の定価のまま、単品で売っていない中身 = (割引前の価格 − 単品の定価の合計)÷ 限定の個数(全部限定なら 割引前の価格 ÷ 個数。残りが 0 以下なら ÷ 全個数)。複数のパックに入っていれば 1 個あたりの高い方。名前はマスタ(TS は `whowatch_item_patterns`・Python は `/playitems`)で NFKC 正規化して引き、同名が複数あればパックと同じイベントフォルダのもの。おまけ(※Web限定で「銀の貯金箱」のおまけ付き)は中身の行ではないので無料のまま
- **結果(実データ)**: 銀の通常アイテムパック Web ¥1,900・「アプリより100円お得！」→ 割引前 ¥2,000 ÷ 40 個 = **¥50**(Web の実際 ¥48)、銀の文字アイテムパック ¥2,100 → ¥2,200 ÷ 20 個 = **¥110**(¥105)。ギンギラギンのランキング説明のスコア表で、単品(隕石 ¥50 → 25 点・ダンスパーティ ¥5,000 → 2,500 点)も銀のアイテム(風船 25 点・神 55 点)も「スコア = 価格 ÷ 2」になり一致する。ミニ・デラックスは割引前 ¥2,150 / ¥12,250 = 単品の合計(告知の「単品で購入する場合は2,150円」と一致)
- **書き込み先**: `whowatch_item_prices`(`unit_price_jpy` 50/110・`min_unit_price_jpy` 48/105・`products` に `pack: {itemId, name, listPrice, pieces}` 付きの 1 件。列の追加なし)と `item_point_mapping`(`price_jpy` 50/110・`state` はパックの商品の state(OPEN)・`product_id` はパックの商品・`description` は「パック換算: …」)。パック限定アイテムはパックと同じカテゴリ(gingiragin_2026)に有料の行として入る(`packGroupRows`。無料の分類から外れてもカテゴリに残る)。同期の順番は items/sync で パックの解決 → カテゴリ → 単価 → 無料配布の分類(単価のある行は無料にしない)
- **効果**: SE のティア判定・自動の音(無料の控えめな音ではなく有料のミックス)・OBS の単価表(export の `purchasable: true`・`price_jpy` 50/110)。SE タブの価格の下に「パック換算: 銀の通常アイテムパック ¥2,000 ÷ 40 個」
- items/sync の応答に `packs: {packs, items, unresolved}`、Python の結果に `items_from_packs`。マスタで名前が見つからない中身は `unresolved` と stderr の WARN に出る(0 を推測で書かない)

## S21: SE の音量を全体で 3 倍に(実装済み・2026-09-30)

社長指示「音を全体的に3倍に上げてほしい」への対応。

- `src/lib/se/engine.ts` に共通の出口を追加: 各 SE の音量(0〜1) → **増幅 ×3(`MASTER_BOOST`・約 +9.5dB)** → **リミッター**(DynamicsCompressor: しきい値 -3dB・20:1・ニー 0・アタック 2ms・リリース 150ms)→ スピーカー。素材ライブラリのミックスはファイルの時点で上限近く(-15 LUFS 前後・真のピーク -0.7dB)まで作ってあり、ファイル側では 3 倍にできないため再生側で増幅し、上限を超える分をリミッターで抑えて音割れを防ぐ
- 対象: 自分で上げた音・公式既定・素材ライブラリ(有料のミックス・無料の単発音)・SE タブの試聴・非常用の合成音。**裏再生用の無音(keep-alive・音楽プレイヤー扱いの無音ファイル)は通さない**(聞こえないままにするため)
- ライブ画面の音量スライダー・各行の音量はそのまま(100% が従来の 3 倍)。大きすぎるときはスライダーで下げる
- テスト: `engine.test.ts` に配線(増幅 3 → リミッター → スピーカー、リミッターの無い環境は増幅だけ)

## S20: 無料アイテムは控えめな音(実装済み・2026-09-30)

社長指示「無料が派手すぎるので修正してほしい」への対応。従来は無料アイテムでも名前からテーマが決まると 6〜10 秒のパチンコ風ミックスが鳴り、無料のバスケット等で倍率の当たりが出ると最長 10 秒の当たりミックスが鳴っていた。

- **判定**: 単価が 0 または不明(`price_yen` null)なら無料(`LiveConnectionProvider.playGift` → `chooseSound` の `free`)。価格帯 T0 と同じ基準。当たり・まとめ投げでも無料なら控えめ
- **音**(scratchpad `build_se_lite.py`・150 本・約 2.2MB): ミックスではなく素材 1 つを短く切って小さめの音量にする。`lite-<テーマ>`(3 本ずつ・1.5 秒まで・-18 LUFS。ねこ → 鳴き声だけ、ハート → キス音)、`lite-hit`(無料の当たり・5 本・正解音/パパーン/テッテレー・2.2 秒まで・-16 LUFS)、`tier-T0`(テーマの無い無料の既定・5 本・ポン/キラン/決定音/呼び鈴・1.2 秒まで・-18 LUFS)。0.4 秒未満で積分ラウドネスが出ない音はピーク -6dBFS、切り出した区間が小さすぎる候補(打ち上げ花火の「ヒュー」だけ等)は捨てて次の素材
- **優先順**: 自分・公式既定の個別行 → 無料なら `liteSetFor`(当たり → lite-hit、テーマ → lite-{テーマ})→ カテゴリの行 → 価格帯の既定(tier-T0 も控えめ)。自分で割り当てた音は無料でもそのまま鳴る
- **イベントの無料アイテム(2026-09-30 社長指示「イベントの無料アイテムが派手すぎる」)**: 控えめな 1 音でも、石油王スロット・ジャックポットチャンス(パチスロのインパクト音)、赤ずきんサイコロ・バスケット(オオカミの遠吠え。バスケットはカテゴリ wolfcoming から)、オータムチャレンジカード・突入(ルーレット)が派手だった。無料アイテムのテーマは `freeThemeFor` で **名前だけ** から決め(カテゴリからは決めない)、最初に当たったテーマが派手なら名前に当たる具体的な物の落ち着いたテーマ(サイコロ・コイン・動物など。花・祭り・キラキラのような汎用テーマは部分一致しやすいので探さない)、無ければ `FREE_THEME_MAP` で置き換える(ジャックポット → コイン、カジノ・花火・ファンファーレ → キラキラ、歓声・爆発・乗り物 → ポップ、オオカミ・ライオン・くま → かわいい)。音量も一段小さく(`FREE_AUTO_VOLUME` 55。有料は 80)。控えめなポップ音から掛け声(イヨー)を外した。実データの結果: 赤ずきんサイコロ → サイコロ、石油王スロット・ジャックポットチャンス → コイン、突入・オータムチャレンジカード・11周年記念花火 → キラキラ、バスケット・銀のいいね！ → ポップ。**突入ボーナスは社長自身の割り当て(ポキューン！先バレ風激熱通知音)が優先されるので変わらない**(控えめにするなら SE タブで「既定に戻す」)
- **全件の見直し(2026-09-30 社長指示「無料がまだ派手な音があるので全てチェックして差し替えて」「割り当てているものはそのままにすること」)**: 自動選定の控えめな音 150 本を素材名と長さで全部見直すと、ジングル(パパーン・テッテレー)、小銭をぶちまける音、連続で吠える犬、ニワトリ、雷の攻撃音、クラッカー、ぶたの悲鳴、ゾウ・さる・うまの叫び、子どもの笑い声、大きな水しぶき、ギターのリフが混ざっていた。scratchpad `build_se_calm.py` で **セットごとに素材を 1 本ずつ手で選んだ単発の短い音** に作り直した(66 本・`v5-*.mp3`・1.0 秒まで[サイコロ・当たりは 1.2 秒]・-22 LUFS・0.4 秒未満はピーク -10dBFS・計 -27〜-22 LUFS・真のピーク -5.7dB 以下)。無料アイテムが使うテーマは 18 種(ポップ・かわいい・キラキラ・ハート・風船・コイン・ベル・花・食べ物・乾杯・サイコロ・ねこ・いぬ・ぶた・うし・とり・クリスマス・海)に絞り、ゾウ・さる・うま・子ども → かわいい、パーティー・音楽・魔法 → キラキラ、通知 → ポップ。当たりは正解音・ピンポン・キラン等(ジングルなし)。届かなくなった控えめな音(花火・ファンファーレ・オオカミ等 29 セット)はライブラリから外し、旧 150 本はリポジトリ外 `$TMP/moved_se_lib_lite_v1_20260930` へ退避。音源が取れないときの予備も、無料なら tier-T0(当たりミックスに落ちない)。**社長が割り当てた音(se_mappings・公式既定)は変更していない**
- **テーマに合わせ直し(2026-09-30 社長指示「無料が控え目すぎるのでもうすこしテーマに合わせてほしい」)**: 上の全件見直し(18 テーマに絞り込み・-22 LUFS・1.0 秒)では多くの無料アイテムがポップ／キラキラにまとまり控えめすぎた。scratchpad `build_se_theme_lite.py` で **全 49 セットに「そのテーマらしい単発の音」** を 2〜5 本ずつ手で選び直した(153 本・`v6-*.mp3`・1.5 秒まで・-19 LUFS[当たり -18]・計 -26〜-18 LUFS・真のピーク -4.2dB 以下。花火 → 小さな花火、スロット → リール・払い出し、カード・突入 → ルーレット、オオカミ → 漫画調の遠吠え、パーティー → パーティーホーン、勝利 → 8 ビットの短いファンファーレ、ゾウ → パオーン、当たり → 正解音・パパーン・テッテレー3 等。叫び・悲鳴・連続の爆発・小銭ぶちまけ・大歓声は使わない)。テーマは `freeThemeFor` で **アイテム名の最後に出てくる言葉**(赤ずきんサイコロ → サイコロ、11周年記念花火 → 花火、応援するゾウ → ゾウ)、名前で決まらなければカテゴリ key(バスケット → wolfcoming → オオカミ)。派手なテーマの置き換え(FREE_THEME_MAP)は廃止。`NAME_RULES` の乗り物を「バス(?!ケット)」に。無料の音量は 65(有料 80・v5 は 55)。v5 の 66 本は `$TMP/moved_se_lib_lite_v5_20260930` へ退避
- **画面**: SE タブの無料アイテムのカードは「自動(無料・控えめ): テーマ名」と控えめな音の試聴。自動ライブラリのカードに「無料の当たり(控えめ)」の試聴。ライブタブのテスト再生に「無料の当たり(控えめ)」を追加し、「当たり(ジングル)」は有料の当たり(¥160)で鳴らす

## S19: 公式既定 SE の同期を表示なしで自動に(実装済み・2026-09-30)

社長指示「自動同期は表記なしで自動的に同期してほしい」への対応。

- SE タブ最上部の「公式の既定 SE は運営の設定に自動同期」カード(同期件数・最終同期時刻・「今すぐ同期」ボタン)を外した。読み直しは従来どおり裏で自動(SE タブ: 開いたとき・5 分ごと・タブに戻ったとき / 再生側 LiveConnectionProvider: 接続中は 5 分ごと・タブに戻ったとき)
- 「価格帯ごとの既定 SE」の説明から同期の表記と古い説明(公式音源・「きらきら輝く1」)を外し、既定は素材ライブラリのミックス(5 本からランダム)と書き直した(S15 で既定は素材ライブラリに変わっている)

## S18: 自動ライブラリ v4 — ニコニ・コモンズの素材を加えたパチンコ風ミックス(実装済み・2026-09-30)

社長指示「ニコニ・コモンズも活用」への対応。内蔵ブラウザのログインは Cloudflare のボット判定で通らなかったため、社長の Chrome(ログイン済み)で候補をダウンロードした(社長の明示許可あり・素材ごとの利用条件に同意)。

- **候補の選び方**(scratchpad `nicommons_shortlist.py`): 公開検索 API(ログイン不要)でセットごとの検索語(大当たり・確定音・キュイン・フィーバー・ファンファーレ・歓声・コイン・猫 鳴き声 等)から、音声・15 秒以内・利用範囲がインターネット上/制限なし・個人の配信の収益化 OK のものをダウンロード数順に 259 件
- **利用条件の確認**(`nicommons_license.py` → `nicommons_license.json`・公開 API `v1/materials/{id}` の license): 親作品登録が必須(19 件)・個人のその他の収益化 NG(1 件)・楽曲の権利を含む(8 件)は除外。独自条件(ownCondition)と説明文を 1 件ずつ読み、「必ず親作品登録を」「ニコニコ外は購入が必要」は除外、「任意のお願い」「単体での再配布禁止」は可(ミックスは単体の再配布に当たらない)
- **権利と内容の確認**(`nicommons_review.json`): アニメ・ゲーム・テレビ・CM 由来(遊戯王・風来のシレン・Minecraft・ジャンケンマン・何が出るかな・ねるねるねるね等)、ネットミーム、性的な音声、祝いの場に合わない音(不正解ブザー・ガラスが割れる・赤ちゃんの泣き声・ゾンビの唸り等)を除外。**153 件**をダウンロードし、うち 152 件をミックスと控えめな音(S20)で使用(クレジットは使った分だけ)
- **ミックス v4**(`build_se_mix4.py`・出力 `public/se/lib/<セット>/v4-1..5.mp3`・280 本。無料の tier-T0 は S20 の控えめな音): テーマ音の連打の 1 発目をそのセット向けのニコニ・コモンズ素材にし(5 本で別の素材が主役)、レベル 3 以上と当たり・カジノ系は決めの直前にパチスロのインパクト音・当たりの効果音(確定音)、ミラクル・¥5,000〜・壮大系の決めはフィーバー/豪華ファンファーレを優先。ファンファーレ・歓声・コイン・きらきら等の共通プールにもニコニ・コモンズの同種素材を足して 6 割はそこから選ぶ。素材ごとに ebur128 で音量をそろえてから重ね、連打の間隔を音の長さに合わせて詰めて決めに時間を残す。v3(mix1..5.mp3)は _moved へ退避
- **音作りの修正(v4 で同時に)**: 素材ごとに鳴っている区間(先頭・末尾の -45dB 以下 0.12 秒以上を除く)だけを使う(末尾の無音まで長さに数えてミックスの途中に 0.7〜1.5 秒の穴が空いていた)。音量は 2 パス(合成 → 積分ラウドネスを測る → 一定の倍率で -14 LUFS)にし、仕上げのリミッターは自動で 0dB まで持ち上げる level を切って上限 -3.1dBFS(v3 と v4 初版は真のピークが最大 +0.8dB で音割れのおそれ)。リミッターで削られて目標より 1.5dB 以上小さくなったものは最大 +4dB ずつ持ち上げ直す。結果はミックス 280 本で -16.1〜-14.4 LUFS・真のピーク -0.7dB 以下・長さ 2.7〜15 秒。短い音ばかりで目標の長さの 8 割に満たないミックスは、きらきら・コイン・歓声などの仕上げの音を足して埋める。1 本の中で同じ素材は使い回さない
- **クレジット**: 使った素材の番号・タイトル・作者名(niconico のユーザー API・退会済みの作者は「退会済みのユーザー」)を `manifest.json` の `credits.nicommons` と `AUTO_LIBRARY_NICOMMONS_CREDITS` に出し、SE タブの「自動ライブラリ」カードに一覧(素材ページへのリンク付き)。作者が希望する表記(アイス芋P・小森平「無料効果音で遊ぼう！」)も併記
- 再生成の手順: Chrome で素材をダウンロード → `$TMP/nicommons_raw/` に展開 → `CATALOG=$TMP/mixkit_catalog.json OUT_DIR=<repo>/public/se/lib python build_se_mix4.py` → `python gen_auto_library_data.py` → vitest

## S17: 連携 ID を既定で固定・スマホの裏再生を既定 ON(実装済み・2026-09-30)

社長指示「プラットフォームの連携をした ID をすべてデフォルトで固定」「スマホの検証は成功しているので、固定でデフォルトで ON」への対応。

- **配信者ID欄**(`src/lib/live/target-id.ts`・テスト 8 件): 既定で「このIDを固定」が ON、欄には設定(プラットフォーム連携)のふわっち ID が入る(`/api/platforms/whowatch/profile` から取得)。自分で打った ID を固定していればそちらを優先、固定のチェックを自分で外したときだけ次回も外したまま(`tagdeck.live.targetIdPin` = "0")。連携 ID から入った値は設定の ID を変えると追従する(`tagdeck.live.targetIdSource`)
- 欄に自分の ID が入っていても「配信開始時に自動接続」は待機を続ける(従来は欄に何か入っていると他人扱いで待機しなかった)。判定は `isOwnWhowatchTarget`(w: / t: の候補の重なり・大文字小文字は区別)。記録するかどうかは従来どおりサーバ(`/api/platforms/whowatch/live` の isOther)が決める
- ID の正規化 `normalizeWhowatchUserPath` をサーバ専用の `live-feed.ts` から純関数の `src/lib/whowatch/user-path.ts` へ移した(ブラウザからも使うため。live-feed.ts は再エクスポート)
- 画面: 自分の ID のとき「自分のID」バッジ、他人の ID のとき「自分のID（xxx）に戻す」ボタン、未連携なら連携の案内
- Kick / ニコ生はライブ画面に ID 欄が無く、設定の ID をそのまま使う(もともと固定)
- **スマホでも裏で鳴らす**: 「(実験)」を外し、「音楽プレイヤー扱いにする」「画面を消さない」を既定 ON。保存キーを `tagdeck.live.bgAudio.v2` / `bgWakeLock.v2` に変え、検証中に OFF で保存された値を引き継がない。自分でチェックを外したときだけ OFF を保存。再生カードの「一時停止」はその画面を開いている間だけ OFF(保存しない)。再生の開始は従来どおり「接続」「音を有効にする」などのユーザー操作の中(自動再生制限)

## S16: ランキング区分が取れないイベント(selectboxes 型の構造 JSON)への対応(実装済み・2026-09-29)

社長報告「オオカミさんがやってくる！(2026_09_wolfcoming)でイベント作成フォームに『ランキング区分がありません』と出る。ふわっちの画面には総取り・チーム対抗・総合・各キャラ・レースの区分がある」への対応(オートモードで自走)。

- 原因: `/resources/json/rankings/{prefix}` の構造 JSON に **3 つ目の形** があった。従来は `options[] → selectboxes[] → tabs[] → chips[]`(期間 options あり)と `tabs[] → chips[]` だけを平坦化していたが、このイベントは **トップレベルが `selectboxes[]`**(期間の options 無し)で、`flattenRankingChoices` が 0 件を返していた。構造 JSON 自体は同期済み(200)だったので DB の再同期は不要
- 実測(`/rankings/{type}?limit=3&detail=true` で確認): `wolfcoming_across_goods_free`(総取り › グッズ › フリー)、`wolfcoming_teambattle`(chips も tabs も無い selectbox)、`wolfcoming_overall_whowatchchan`(tab のみ・chips 空)、`wolfcoming_side`(レース・border に rankingPoint 付き)。存在しない type は空配列が返る(404 にならない)
- 対応: `src/lib/whowatch/events.ts` `RankingStruct.selectboxes` を追加し、`flattenRankingChoices` を `walkSelectboxes` に共通化(options 型・selectboxes 型の両方から呼ぶ)。表示名の `<br>` 等のタグは空白にする(「赤ずきん<br>ふわっちちゃん」)。テスト 1 件追加(実応答の縮約フィクスチャ・7 区分)
- 期間(periods)は options 型だけが対象なので、このイベントは全体期間のまま(従来どおり手動)

## S15: 自動ライブラリ・まとめ投げ段階の音・1 キー最大 5 本のランダム再生(実装済み・2026-09-29)

社長指示(2026-09-29)「まとめ投げの COOL/GREAT/FANTASTIC/MIRACLE をそれぞれ個別のアイテムに割り振る」「まだ音源が入っていないアイテムに、様々なサイトから拾った似合う SE を自動で。元の音源はクオリティが低いので豪華な音を」「主要アイテムは 5 種類の SE をランダムで」「ニコニコモンズ・DOVA-SYNDROME・freebgm.jp・魔王魂・Jamendo・Freesound なども活用」への対応。「今後はオートモードで自走して完走」の指示により承認待ちなしで実装。

- **音源 v3「パチンコ風ミックス」(285 本・`public/se/lib/<セット>/mix1..5.mp3`)**: 社長追加指示(2026-09-29)「もっとパチンコの演出のように派手に。3 倍の長さ・最大 15 秒で組み合わせて MIX」。scratchpad `build_se_mix.py` がセットごとに素材プール(ライザー／インパクト／ドラムロール／きらきら／コイン／小・中の決め音／ファンファーレ／歓声／スロットのサイレン／花火／壮大オーケストラ)とテーマ音(Mixkit・Freesound CC0・魔王魂から上位 8 本)を用意し、乱数(セット名＋番号で固定)で 1 本 4〜15 素材を時間軸に置いて ffmpeg(adelay＋amix→loudnorm -14 LUFS→リミッター→mono 96k)で合成。派手さ LEVEL 1〜4 で長さ 3 / 6.5 / 9.5 / 14 秒(T0 3s・T4 15s・当たり 10s・COOL 6s・GREAT 9s・FANTASTIC 12s・MIRACLE 15s)。当たり・カジノ・ジャックポットにはスロットのサイレン、特大には花火＋歓声＋オーケストラを重ねる。各ファイルの素材・出典は `manifest.json` の components。v2(単発・128k・約 12MB)は _moved へ退避。engine の LRU は 24 本、先読みは価格帯・段階・当たり × 2 本
  - Mixkit(Sound Effects Free License・商用可・帰属不要): カテゴリページ(119 カテゴリ・2,477 本)からタイトル語・長さで選定
  - Freesound(検索フィルタ `license:"Creative Commons 0"`・帰属不要): 英語クエリ(pig oink / elephant trumpet / champagne cork pop 等)・ダウンロード数順・HQ プレビュー(128kbps)
  - 魔王魂(商用可・改変可・可能な限り「効果音：魔王魂」の著作表記 → SE タブと本節に記載)
  - 使わなかった出典と理由: ニコニコモンズ(ダウンロードにログインが要り、作品ごとに利用範囲が違う)、DOVA-SYNDROME / freebgm.jp(BGM 中心で SE の一覧を機械的に取れない)、Jamendo(楽曲の配信で SE ではない)。**権利の判断は S4 のとおり社長が負う**。CC0・商用可のみに絞ったのは、Supabase の公開バケットとサイト同梱で全ユーザーに配られるため
  - 収集スクリプトはリポジトリ外(scratchpad `build_se_library2.py` / `gen_auto_library_data.py`)。再生成するときは manifest.json → `src/lib/se/auto-library-data.ts` を作り直す
- **自動ライブラリ** `src/lib/se/auto-library.ts`(テスト 40 件): アイテム名(装飾語「ふわっち」「(復刻)」等を除く)を正規表現の順序表 NAME_RULES で約 45 テーマに分類(固有名詞→動物→物→汎用の順。「応援」は動物名より後、「船」は「風船」に当たらないよう除外)。名前で決まらなければカテゴリ key(GROUP_RULES)。1 テーマ最大 5 本から `pickVariant` がランダムに選び、同じセットで直前と同じ音は避ける
- **優先順** `src/lib/se/choose-sound.ts`(テスト 8 件): ①個別行 bulk:item → pattern → bulk → item(変種ランダム。全部 OFF なら鳴らさない) ②自動ライブラリ(段階 bulk-{COOL..MIRACLE} → 当たり hit → テーマ) ③一括行 cat:group → cat:kind → tier ④自動の価格帯既定 tier-T0..T4 ⑤合成音。**自動ライブラリはカテゴリ一括・価格帯の既定より優先**(そのアイテムらしい音を優先)。社長の個別行 84 件はそのまま優先される(「既定に戻す」で自動に戻る)
- **1 キー最大 5 本のランダム再生**: `se_mappings.key` の末尾 `#2`〜`#5` を同じ key の変種として扱う(KEY_RE に `(?:#[2-5])?`・スキーマ変更なし)。SE タブの各行に「＋ 別の音を追加(n/5)」と変種の一覧(試聴・外す)。再生時は鳴らす ON かつ音源ありの変種からランダム
- **まとめ投げの段階**: 個別行が無ければ自動の段階セット(COOL: 短い達成音 / GREAT: 歓声・拍手 / FANTASTIC: ファンファーレ・花火 / MIRACLE: 壮大なオーケストラ)。アイテムごとに変えたいときは従来どおり `bulk:item:{id}:{段階}` に上げる(変種も可)。TAMAYA 等の変種段階は FANTASTIC 相当
- **再生側**: `engine.ts` のデコード済みバッファに LRU 上限 96 本(自動ライブラリ全部を持つと数百 MB になるため)。価格帯・段階・当たりのセット(約 50 本)は接続時に先読み、テーマの音は鳴らす直前に取得。`next.config.ts` の Serwist は **public/ の事前キャッシュ一覧を自前で作って `additionalPrecacheEntries` に渡し、`se/**` を除外**(全ユーザーが初回に 14MB 落とさないため。鳴らした音は runtimeCaching の static-audio-assets に載る)。経緯: `globPublicPatterns` の `"!se/**"` は glob v10 が否定を解釈せず(PR #47 で本番 sw.js に音源 305 本)、`manifestTransforms` は additionalPrecacheEntries に掛からず(PR #48 でも残った)、一覧を渡す方式で解決(PR #51 相当)。確認は `curl -s https://tagdeck.jp/sw.js | grep -o '/se/lib/' | wc -l` が 0(CF のエッジキャッシュは数分残る)
- **既定 SE も素材から(2026-09-29 社長指示「既定の SE も Web Audio を使わず、素材から探して」)**: 価格帯(tier:T0〜T4・hit)は **自分で上げた行だけ** を優先し、公式既定の旧音源(クイズ正解・コイン・レジ等)と汎用の「きらきら輝く1」は使わず、素材ライブラリの価格帯セット(tier-T0〜T4・hit のパチンコ風ミックス 5 本ランダム)を鳴らす(`choose-sound.ts`)。音量・鳴らすだけ変えた自分の行(url null)はその音量でライブラリ。`engine.ts` の予備も合成音ではなくライブラリの価格帯セット(別の 1 本まで再試行)。Web Audio 合成は **素材が 1 本も取得できないとき(オフライン等)だけ** の非常用。SE タブの価格帯行は「既定 ♪ 素材ライブラリ」と表示し、試聴もライブラリ
- **UI**: SE タブに「自動ライブラリ」カード(価格帯・段階・当たりの試聴)、各アイテムのカードに「自動: テーマ名(n 本ランダム)▶試聴」。ライブタブのテスト再生に「自動: 花火」「自動: ねこ」
- 未対応: テーマ×段階の組み合わせ(花火の COOL だけ別音 等)は手動の `bulk:item` で。テーマ判定は名前ベースなので固有名詞(「ガラスの靴」「セバスチャン」等 約 800 件)は価格帯の既定に落ちる。魔王魂の SE はカタログ(約 90 本・システム音・戦闘・ボイス中心)からキーワード一致分だけ

## S14: item_point_mapping のイベント限定アイテム漏れ・単価の定義統一・OBS 向け JSON エクスポート(実装済み・2026-09-28)

社長指示「item_point_mapping にイベント限定アイテムが漏れている。漏れを完全になくす」への対応。

- 原因は 2 つ。(1) 13100 おばあさんたぬっち・有料 5 種は本番 DB には日次同期で入っていたが、tagtech-OBS の単価表が社長の手作業 CSV(9/25)のままで反映されていなかった。(2) 13097/13098/13099 の無料配布は取得元 `/playitems/payments3` が**買えるアイテムしか返さない**ため構造的に同期対象外だった
- `scripts/platforms/whowatch/sync_items_and_events.py`(GitHub Actions `daily-sync.yml`・毎日 JST 0:00)
  - **単価の定義を「1 個あたりの定価(まとめ買い割引前)」に統一**(社長決定 2026-09-28)。`price_jpy` = `base_point` = OPEN 商品のうち最小個数の商品の price ÷ quantity(四捨五入。SE 側 `whowatch_item_prices.unit_price_jpy` と同じ定義)。従来は「最初の商品の価格」で、3 個入り ¥90 のスターが 90、40 個入り ¥50 の風船が 50 になっていた(37 行が変わる。同期ログの `prices_changed` と stderr の明細で確認できる)
  - **無料配布アイテムを追加**: `/playitems`(マスタ・認証不要)のうち payments3 に無く、画像フォルダ `events/YYYY/MM_key/` が pre/open イベントの event_key に一致するものを `price_jpy=0, state=FREE, product_id=""` で入れる(`free-event-items.ts` と同じ規則)。過去イベント・販売終了は価格不明なので行を作らない(0 を推測で書かない。`price_jpy` は NOT NULL)
  - 列の意味: `price_jpy` 1 個あたりの定価(円)/ `base_point` 同値(互換)/ `product_id` 定価の元になった商品 / `state` OPEN・CLOSED(商品の state)・FREE(無料配布)/ `whowatch_id` 数値 item_id
  - `--dry-run --out rows.json` で DB に書かず行を確認できる。完了ログに `items_free` / `items_added` / `prices_changed`
  - pytest 29 件(`cd scripts/platforms/whowatch && python -m pytest test_sync_items_and_events.py`)。古い fixture 3 件(has_animation の位置・ended_at のエポック ms)も 2026-07 の実 API 形に直した
- **`GET /api/platforms/whowatch/items/export`(新規)**: tagtech-OBS の単価表用。認証は X-Sync-Key(`RANKING_SYNC_KEY`・`SYNC_ROUTES` に登録)またはログイン Cookie。`{item_id, item_name, price_jpy, purchasable, event_id, event_key, group_keys, state, on_sale, last_fetched_at}`。`purchasable` = FREE でなく商品あり、`event_key` = `whowatch_item_groups.event_key`(無料行)→ 無ければカテゴリ key を `whowatch_events.item_group_key` で逆引き(有料行の event_key が null のままになる `syncItemGroups` の既存不具合の回避。不具合自体は未修正・TODO)。純関数 `src/lib/whowatch/item-export.ts`
- `items/patterns` ルート: item_point_mapping 由来の価格が 0 / FREE のときは従来どおり `priceJpy=null`(SE タブの「無料(イベント配布)」表示と T0 判定を維持)
- スキーマ変更なし(社長決定)。ロールバック: PR を revert → `daily-sync` 再実行で 37 行は旧定義に戻る。無料行は `DELETE FROM item_point_mapping WHERE platform='whowatch' AND state='FREE';`
- 運用: イベント開始時に人手ですることは無い(翌 0:00 の同期で入る。急ぐなら Actions `daily-sync` を手動実行)。OBS 側は起動時にこのルートを取りに来る(tagtech-OBS AGENTS.md「単価の取り込み」)

## S13: まとめ投げの段階(クール / グレート / ファンタスティック / ミラクル)と倍率の当たりを個別に設定(実装済み・2026-09-28)

社長指示「イベントアイテムなどのまとめ投げしたときのクール・グレート・ファンタスティック・ミラクルも個別に設定できるようにしたい。解析と修正可能か?」への対応。

- 解析(2026-09-28・実データ):
  - ギフトコメントは**基本パターンの pattern_id + item_count** で届く(例: バスケット 10643 × item_count 3)。段階名は API のコメントに無い
  - 段階はふわっち本体(whowatch.tv `chunk-C4NMZPGA.js` の `setGradeImagePath`)が**アイテムごとのしきい値**から決める: `pattern_decorations`(`[{count, pattern_decoration: COOL|GREAT|FANTASTIC|MIRACLE|TAMAYA|NYANDERFUL|WONDERFUL|KP}]`)を count 降順に並べ、最初に `count <= 投げた個数` を満たすものが段階
  - しきい値は `GET /lives/{id}/playitems3`(**認証不要**)の `user_retain_items[].patterns[0].pattern_decorations` にある(`/playitems` には無い)。本番同期(2026-09-28): 88 アイテム中 86 にしきい値。実測: 釣り竿 25/50/100/200、花火 2/5/10、ぶたさん・ゾウ(イベント応援)15/45/100、投票券・サイコロ なし
  - 認証なしの playitems3 に載るのは**購入できるアイテム**だけ。イベントの無料配布(バスケット・どんぐり等)は載らないが、`/playitems/{id}` で `pattern_limit=3`(1 回 3 個まで)と確認でき、段階が付くことはない
  - `_x5` `_x10` `_x20` 画像の別パターン(バスケット 10644 等)は**まとめ投げではなく「5 倍・10 倍・20 倍」の当たり**(コメント本文「【10倍】バスケットを3個プレゼントしました」)。社長指摘どおり倍率の表記
- 対応:
  - `src/lib/se/bulk-grade.ts`(純関数・テスト 8 件): `parseDecorations` / `bulkGradeFor`(本体と同じ判定)/ key `bulk:{段階}`(全アイテム共通)・`bulk:item:{item_id}:{段階}`(アイテム別)
  - `src/lib/whowatch/item-decorations.ts`: `/lives2` で配信中の 1 本を選び `playitems3` を取って `whowatch_item_decorations`(0022)に upsert。`items/sync` の初回バッチで毎日同期(応答 `decorations`)
  - `gift-normalize.ts`: `item_count`(生の個数)と `bulk_grade` を持つ。段階判定は item_count(束パターンの quantity は掛けない=本体の presentCount と同じ)
  - `tiers.ts resolveMappingKey`: **bulk:item → pattern → bulk → item → cat:group → cat:kind → tier**。段階の音はアイテム個別より優先(100 個投げの盛り上がりをアイテムの通常音で潰さない)。当たり等のパターン個別は段階より優先
  - 倍率の当たり: `item-patterns-sync.ts estimateHit` が画像 `_xN` を `is_hit=true, hit_grade="N倍"` にする(束パターンには適用しない)。`pattern-rows.ts` は同名でも hit_grade が違えば別行にするので、SE タブに「バスケット(10倍)」「(5倍)」の行が出て倍率ごとに音を分けられる。**再同期が必要**(下記)
  - SE タブ: 新セクション「まとめ投げの段階ごとの SE」(4 段階)。各アイテムのカードに「まとめ投げ: クール 25個〜 / …」を表示し、「段階ごとに設定」でアイテム別の行を開ける。ライブタブのテスト再生に段階 4 本を追加
- 社長作業(2026-09-28 完了): (1) `drizzle/0022_item_decorations_manual.sql` を適用 (2) Actions「Whowatch item patterns sync (manual)」を実行 → 応答 `decorations: {liveId: 76430755, rows: 88, withGrades: 86}`。本番 `/api/platforms/whowatch/items/patterns` で 花火 2/5/10・ぶたさん 15/45/100・倍率の当たり行(バスケット 10倍、ぶたさん 2倍/20倍)を確認
- 未確定: 段階名の変種(TAMAYA / NYANDERFUL / WONDERFUL / KP)は現行アイテムに出ていないため行を出していない(key は受け付ける)。ふわっち側の custom_pattern_decorations(画像だけの段階)は名前が無いので落としている

## S12: 公式の既定 SE をコード無しで取り込む(実装済み・2026-09-26 → **同日廃止**、S2 の廃止に伴い削除)

社長指示「SE のプリセットを共有コード無しでデフォルトにしてください」への対応。

- 公式の既定 SE(運営アカウント = `SE_DEFAULT_SOURCE_USER_ID` の現在の割り当て)は S4 のとおり**何もしなくても全ユーザーの既定として鳴る**。この節は、それを「自分の設定」として取り込む入口を共有コード無しで用意したもの(取り込むと自分の行になるので、以後運営が差し替えても影響を受けない=固定したい人向け)
- route `GET/POST /api/se/presets/default`: GET は件数と内訳、POST `{mode: "merge" | "replace"}` は運営の行(音源あり・鳴らす ON)を自分の se_mappings へ upsert(replace は自分の行を全消し)
- UI `SePresetPanel` 最上部「公式の既定 SE(コード不要)」: 追加で取り込む / 全部置き換える(2 段階確認)。共有コードの仕組みはそのまま残す(他の配信者同士の共有用)

## S1: SE タブ・ふわっちギフト取得(実装済み・2026-09-21)

決裁どおり公開 API のポーリングのみ(WebSocket 不使用)。

### 追加・変更

| 種別 | パス | 内容 |
|---|---|---|
| lib | `src/lib/whowatch/live-feed.ts` | live_id は `GET /users/{path}/profile` の `live[0].id`。`GET /lives/{id}?last_updated_at=&v5_nomask=true` の `comments[]` から BY_PLAYITEM を `{comment_id, pattern_id, item_id, count, is_hit, user}` に正規化。jwt は保存も返却もしない |
| lib | `src/lib/whowatch/item-patterns-sync.ts` | `/playitems`(1969 件 / 4422 パターン)を `whowatch_item_patterns` に upsert(400 行ずつ)。当たりは名前ベース推定(要確認) |
| lib | `src/lib/se/tiers.ts` / `engine.ts` | ティア判定(無料=T0、〜¥499=T1、〜¥1,999=T2、〜¥4,999=T3、¥5,000〜=T4、当たり=hit、10 秒 3 件=combo)と Web Audio 合成(ポップ/チャイム/ファンファーレ/ジングル/連打)。カスタム音源 URL があればそれを再生 |
| table | `whowatch_item_patterns`、`se_mappings`(user_id, key, url, volume, enabled)、Storage バケット `se` | migration `drizzle/0014_live_cockpit*.sql` |
| route | `POST /api/platforms/whowatch/items/sync`(X-Sync-Key) | パターン同期。daily-sync.yml 末尾と `item-patterns-sync.yml`(手動)から呼ぶ |
| route | `GET /api/platforms/whowatch/items/patterns` | SE タブ用: パターン × item_point_mapping の価格 |
| route | `GET /api/platforms/whowatch/live` | 自分の配信中 live_id(profile.live[0].id) |
| route | `POST /api/platforms/whowatch/live/poll` | `{liveId, lastUpdatedAt}` → ギフト正規化 + `events`(event_type='gift', platform_comment_id=comment.id, stream_id=live_id, 重複は部分ユニークで弾く)+ `listeners`(Kick の流儀)。既存の `POST /api/platforms/whowatch/poll` は不変 |
| route | `GET/PUT/DELETE /api/se/mappings` | SE 割り当て(key: `pattern:{id}` / `item:{id}` / `tier:{T0..T4|hit|combo}`) |
| page | `/live`(ナビ「ライブ」) | ライブタブ: 接続(live_id 取得→サーバ指定間隔でポーリング)、直近ギフト、SE 自動再生 ON/OFF・音量、テストボタン(各ティア・当たり・コンボ)。`?debug=1` で受信コメント生データを画面に流す(学習モード)。SE タブ: 価格帯既定音 + アイテム/当たりパターンごとの試聴・アップロード(mp3/ogg/wav・5MB 以下)・音量・ON/OFF |

### 社長作業

1. Supabase SQL Editor で `drizzle/0014_live_cockpit_manual.sql` を適用(テーブル 2 つ + Storage バケット `se` とポリシー)
2. マージ後、Actions →「Whowatch item patterns sync (manual)」→ Run workflow(以後は daily-sync が毎日実行)
3. `/live` → まず「テスト再生」の 7 ボタンが全部鳴ることを確認(ダミー)→ 配信中に「接続」→ 無料アイテムを 1 つ投げてもらい、直近のギフトに出て SE が鳴ることを確認

### 動作確認手順

1. `pnpm test`(live-feed 4 件・tiers 3 件・item-patterns-sync 2 件を含む全件)、`pnpm exec tsc --noEmit`、`next build`
2. `/live` のテストボタン 7 種で音が鳴る(初回クリックで自動再生制限を解除)
3. SE タブでアイテムに mp3 を上げる → 「試聴」でその音が鳴る → ライブタブのテスト「〜¥499」は既定音のまま、実ギフト(そのアイテム)ではカスタム音
4. `SELECT occurred_at, payload->>'item_name', payload->>'count', payload->>'is_hit', platform_comment_id FROM events WHERE platform='whowatch' AND event_type='gift' ORDER BY occurred_at DESC LIMIT 10;`
5. `?debug=1` で生コメントを確認し、BY_PLAYITEM の実フィールド(play_item_pattern_id / item_count / anonymized)が想定どおりか Claude Cowork に渡す(docs/FIELDS.md 確定)

### 未確定(TODO.md)

- BY_PLAYITEM の実フィールド名は 2023 年ソース由来。実配信の `?debug=1` で確定するまで正規化は防御的
- 「視聴者に SE を届ける」経路(スピーカー→スマホマイク)は P4 で実配信検証

## 2026-09-21 本番稼働状況

- PR #24(S1 本体)はマージ済み(2026-09-21T13:51Z)。本番で item patterns sync 成功、`/live` のテスト再生(各ティア・当たり・コンボ)を社長が確認済み
- PR #25(X-Sync-Key ルートの sync-routes.ts 一元化、items/sync の本番307修正)は 2026-09-22 にマージ済み(main の `aad6f9e`)。本ドキュメントを含む PR #26 も `6a43cc7` でマージ済み
- migration 0014(whowatch_item_patterns・se_mappings・Storage バケット se)は適用済み
- `.claude/agents/` にサブエージェント3体(whowatch-verifier・whowatch-api-checker・docs-keeper)を導入。whowatch-api-checker は tools を Bash から WebFetch(GET のみ、ヘッダ制御不可)に変更。いずれも本セッション内では新規作成した回として認識されず(`Agent type not found`)、次回セッションから利用可能(未確認: 次回セッションでの実際の動作)

## 2026-09-22 修正: アイテムパターン同期のバッチ分割(本番 HTTP 502 の対処)

### 症状と推定原因

「Whowatch item patterns sync (manual)」が HTTP 502 で失敗。エラー本文は
`Failed query: insert into "whowatch_item_patterns" (...) values ($1..$12), ($13..$24), …` と
$4,400 以上続く巨大な単一 INSERT。認証・ルーティング(PR #25)は通過しており、ハンドラ本体まで到達していた。

- 旧実装は 400 行/チャンク × 12 列 = 最大 **4,800 bind パラメータ**の単一 INSERT
- PostgreSQL のバインドパラメータ上限は 65,535 なので **Postgres 側の上限ではない**
- Cloudflare Workers Free プランの **CPU 時間 10ms/リクエスト**(AGENTS.md)を、4,800 個の値を
  JS でシリアライズする処理が使い切った可能性が高い(**推定・要確認**)

### 変更

| 種別 | 内容 |
|---|---|
| `src/lib/whowatch/item-patterns-sync.ts` | 1 チャンクを **200 行**(2,400 bind パラメータ)に半減。`chunkRows()` / `planItemBatches()` を純関数として分離 |
| 同上 | event-detail-sync と同じ **cursor 方式**。1 リクエストで最大 5 チャンク(1,000 行)処理し `next_cursor`(pattern_id)を返す。cursor は配列 index ではなく pattern_id なので、/playitems の内容が変わっても取りこぼさない |
| 同上 | **1 チャンクの失敗は他チャンクを止めない**。`failed`(失敗チャンクの行数)・`error`(最初のエラー)・`results[]`(チャンクごとの結果)を返す |
| 同上 | `xmax = 0` trick で inserted / updated を判別して返す |
| `items/sync/route.ts` | `?cursor=` `?limit=` `?chunk_size=` を受け付け、応答に `{ok, inserted, updated, failed, next_cursor}` を含める。**エラーは `describeDbError()` で要約**(以前は生 SQL 全文をレスポンスに含めていた。whowatch-verifier のチェック項目6 違反を是正) |
| `item-patterns-sync.yml` / `daily-sync.yml` | `next_cursor` が空になるまでループ(最大 30 回)。チャンクごとの結果と累計 inserted/updated/failed をログ出力 |

### 動作確認手順

1. `pnpm test`(`item-patterns-sync.test.ts` の 13 件。2,050 行 → 11 バッチの分割検証、cursor 継続、1 チャンク失敗時の分離を含む)
2. Actions →「Whowatch item patterns sync (manual)」→ Run workflow(入力は空のままで既定値 200 行/5 チャンク)
3. ログに `=== batch 1..N HTTP 200`、各チャンクの `range ok rows=200 ins=.. upd=..`、最後に `=== total inserted=.. updated=.. failed=0`
4. `SELECT count(*), max(synced_at) FROM whowatch_item_patterns;` → 4,000 件超・同期時刻が更新されている

## 2026-09-25 S1 拡張: WebSocket 即時経路・カテゴリのバナー表示・無料アイテムの既定音

社長の選択: 1=B(WebSocket)/ 2=Y(既定音の見出し変更)/ 3=P(バナー付きセクション)。

### なぜ WebSocket か(計測)

`/live?debug=1` の計測(2026-09-25 社長提供): 実効ポーリング間隔 平均 4.2 秒・最大 8.5 秒、往復 0.56 秒(うち認証 0.14 秒)、投げられた→SE 平均 3.9 秒・最大 10.6 秒。
処理の遅さではなく「次のポーリングまでの待ち」が全てで、ポーリングを続ける限りゼロにならない(規約内の下限は平均 2〜3 秒)。

### 追加・変更

| 種別 | パス | 内容 |
|---|---|---|
| lib | `src/lib/live/ws-feed.ts` | 純関数: 接続候補(`wsUrlCandidates`: URL そのまま → `?jwt=` 付き)、再接続バックオフ(1→2→4…30 秒、受信ゼロのまま 5 回で諦める)、`extractComments`(JSON の入れ子から `comment_type` と `id` を持つオブジェクトを拾う防御的解析)、`isBacklogComment`(接続の 10 秒以上前の投稿は鳴らさない) |
| lib | `src/lib/whowatch/live-feed.ts` | `fetchLive()` が `ws: { url, jwt }` を別枠で返す(`raw` には jwt を含めない。従来どおり poll 応答・ログ・DB には出さない) |
| route | `GET /api/platforms/whowatch/live/ws?liveId=` | 認証必須・DB 不使用。`{url, jwt}` を本人のブラウザへ返す唯一の経路。`Cache-Control: no-store` |
| lib | `src/lib/live/polling.ts` | `pollIntervalFor()` に `wsDelivering`(WS でギフトを 1 件以上受け取れた実績)を追加。true の間はポーリングを idle(10 秒)に戻す(保存と予備経路のため止めない)。「開いているだけ」では短縮を止めない(形式不一致で解析できない場合に今より遅くならないように) |
| UI | `LiveConnectionProvider` | 接続時にポーリングと並行して WS を開く。WS のギフトもポーリングのギフトも `comment_id` で重複排除し、同じ SE キューへ。切断時は候補を切り替えつつ再接続。停止で閉じる |
| UI | `LiveCockpit` | 接続バッジ「即時経路: 接続済み(N 件受信)/再接続中/使えず」。`?debug=1` に WS 状態・経路別(WS/ポーリング)の遅延・ギフト表の「経路」列・**WebSocket 生ログ(直近 200 件)** を追加 |
| schema / migration | `whowatch_item_groups.banner_url` `description`、`drizzle/0017_item_group_banner*.sql` | カテゴリのバナー画像 URL と説明文(案P) |
| lib | `src/lib/whowatch/item-groups-sync.ts` | `pickBannerUrl()` / `pickDescription()`: payments3 のフィールド名が未確認のため候補キー(banner / banner_url / image_url 等)を総当たり。無ければ null |
| route | `GET /api/platforms/whowatch/items/patterns` | `groups[]` に `bannerUrl` / `description` を追加 |
| UI | `SeMappingTab` | アイテム欄を「カテゴリごとのバナー見出し → アイテム」の並び(アイテムページ順・1 アイテムが複数カテゴリなら各所に表示)。見出し内でカテゴリ一括 SE を割り当て。バナー URL が無ければ文字のカード。「分類なし(無料・販売終了・その他)」はプルダウンで選んだときだけ表示 |
| UI | `SeMappingTab` / `tiers.ts` | 案Y: 価格帯既定の T0 を「無料アイテム(ポップ)」に改名し、「無料アイテムはここに従う」と明記。カテゴリ新設はしない |

### 社長作業

1. Supabase SQL Editor で `drizzle/0017_item_group_banner_manual.sql` を適用(列追加のみ・冪等)。**0017 適用前に本 PR をデプロイすると items/patterns ルートが 500 になる**(SELECT する列が無い)ので、先に適用する
2. マージ後、Actions「Whowatch item patterns sync (manual)」を 1 回実行(バナー列を埋める)。`SELECT group_key, banner_url FROM whowatch_item_groups` で全て null なら TODO.md Q3
3. 配信中に `/live?debug=1` で接続 → 「即時経路: 接続済み」になるか、WS 経由のギフトが増えるかを確認。増えなければ「WebSocket 生ログ」の内容を渡す(TODO.md Q1b)

### 動作確認手順

1. `pnpm exec tsc --noEmit`(既存の `res.json()` 由来のエラー 52 件は TypeScript 5.9 の `Response.json(): Promise<unknown>` によるもので本 PR 以前から存在・件数増減なし)/ `pnpm test`(ws-feed 12 件・polling 1 件・item-groups-sync 5 件を追加、全 307 件)/ `pnpm exec next build --webpack`
2. `/live` 接続 → バッジに「即時経路」が出る。WS が使えない配信でも「使えず(ポーリングで動作中)」と出て従来どおり鳴る
3. `/live?debug=1` → ギフト表の「経路」が WS の行は投げられた→SE が 1 秒前後、ポーリングの行は従来どおり
4. SE タブ → カテゴリごとに見出しが並び、見出し内の「音源をアップロード」でカテゴリ一括の割り当てができる。プルダウン「分類なし」で無料アイテム等が出る(「価格ありのみ」OFF)

### 未確定(TODO.md Q1b / Q2 / Q3)

- WS のメッセージ形式・認証方式は未実測。形式が違っても落ちず、ポーリングで従来どおり鳴る設計 → 確定(同日)。詳細は「2026-09-25 本番稼働状況」内の「即時経路(WebSocket)の到達点」
- 無料アイテムの設定が反映されない原因(a/b)は実データ待ち
- payments3 のバナー URL フィールド名は未確認

## 2026-09-25 本番稼働状況

- PR #1「feat(live): WebSocket 即時経路・SE タブのバナー付きカテゴリ表示・無料アイテムの既定音」(https://github.com/tagtech-jp/tagdeck/pull/1)は main にマージ済み(マージコミット `b863ae8`、2026-09-25T05:35Z 頃)。CI(`.github/workflows/ci.yml` の check)は head `80e5f5f` で success
- PR #2「fix(types): res.json() の戻り値に型を付け、CI の Type check を緑にする」(https://github.com/tagtech-jp/tagdeck/pull/2、コミット `26eb394`、15 ファイル・52 箇所)もマージ済み。CI は head `26eb394` で success。PR #1 は PR #2 の内容をマージで取り込んでいた
- main で CI の Type check が赤だった原因: lockfile の TypeScript 5.9.3 + @types/node 20.19.39 の組み合わせで `Response.json()` の戻り値が `Promise<unknown>` になるため(上記「2026-09-25 S1 拡張」動作確認手順 1 の「既存エラー 52 件」がこれ)。PR #2 で `res.json()` の戻り値に型を付けて解消
- リポジトリ移行: `nikkun22/tagdeck` → `tagtech-jp/tagdeck`(初回コミット `a5e1508`「Initial public release」)。移行直後は GitHub Actions の Secrets が未投入で、`deploy.yml` が 3 回連続で失敗(run #1 は型エラー、#2/#3 は `CLOUDFLARE_API_TOKEN` 未設定)。その間、本番は旧ビルド `9d95f0b` のままだった
- Secrets 投入(社長作業・2026-09-25): `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` / `DISCORD_WEBHOOK_TASK` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_URL` / `RANKING_SYNC_KEY` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_URL` / `WHOWATCH_DEVICE_ID` の 9 個と `TAGDECK_BASE_URL` を新リポジトリに登録。以後 Deploy は成功(run #4〜#8)
- 追加マージ(いずれも CI 緑。社長の許可「マージも自動化を許可する」(2026-09-25)に基づき Claude がマージ):
  - PR #4: `deploy.yml` に `workflow_dispatch` を追加(手動再デプロイ用)
  - PR #5: アイテムごとの代表画像 `imageUrl` を `GET /api/platforms/whowatch/items/patterns` の応答と SE タブに追加(`src/lib/se/item-image.ts` の `pickItemImage()`)
  - PR #6: SE タブのアイテム欄を「バナー見出し → 3 列グリッド(画像・名前・価格)」に変更
- migration 0017(`whowatch_item_groups.banner_url` / `description`)は社長が Supabase SQL Editor で適用済み(「Success. No rows returned」を確認)
- Actions「Whowatch item patterns sync (manual)」を 06:02Z に実行し成功: パターン 4,428 件(inserted 8 / updated 4,420 / failed 0)、カテゴリ 22 件・137 行を新規登録(inserted 137 / updated 0 → 移行後は未同期だった)。`banner_url` が埋まったかは未確認(TODO.md Q3 のまま)
- ログイン障害と対処: 再デプロイ後にログインすると Supabase の 404 ページに飛んだ。原因は GitHub Secrets の `NEXT_PUBLIC_SUPABASE_URL` に管理画面の URL(`https://supabase.com/dashboard/project/<ref>/...`)が入っていたこと。正しくは `https://<ref>.supabase.co`。修正後に Deploy を再実行(run #9)。**run #9 の結果と修正後のログイン成否は本セッション時点で未確認**
- Service Worker の注意: serwist(`skipWaiting` / `clientsClaim`)がデプロイ後も古い JS を配るため、本番の動作確認は Ctrl+Shift+R(キャッシュ無視の再読み込み)で行う
- Supabase の課金警告: ダッシュボード上部に「Grace period is over … projects will not be able to serve requests when you use up your quota」が表示されていた(無料枠の猶予期間終了)。Billing の確認が必要(TODO.md Q5)
- 未確認(本セッションでは確認していない):
  - `/live?debug=1` での WS 経路の実測(メッセージ形式・認証方式。TODO.md Q1b)→ 同日中に確定。下記「即時経路(WebSocket)の到達点」
  - payments3 のバナー URL の有無(`SELECT group_key, banner_url FROM whowatch_item_groups`。TODO.md Q3)
  - 無料アイテムの設定反映の原因(TODO.md Q2)

### 運用メモ(リポジトリ移行・デプロイ)

- リポジトリを移行(transfer / 再作成)したら GitHub Secrets は引き継がれない。上記 9 個 + `TAGDECK_BASE_URL` を新リポジトリに登録し直すまで Deploy と cron は失敗する
- `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_URL` は `https://<ref>.supabase.co` 形式(API の URL)。ダッシュボードの URL(`https://supabase.com/dashboard/...`)を入れるとログインが Supabase の 404 に飛ぶ
- Deploy は Actions →「Deploy」→ Run workflow で手動再実行できる(PR #4 で `workflow_dispatch` を追加)。Secrets を直した後はコードを変えずにこれで再デプロイする
- デプロイ後の確認は Ctrl+Shift+R で行う(Service Worker が古い JS を配るため)

### 即時経路(WebSocket)の到達点(2026-09-25・UTC)

上記「未確認」のうち Q1b(WS のメッセージ形式・認証方式)は同日中に確定し、本番で即時経路が動いた。

#### 計測(社長の実機計測・ビルド `0557519`)

- 即時経路バッジ「接続済み / 購読 room:76348066{p}」。WS 経由のギフト 4 件
- 投げられた→SE(時計ズレ補正済み): 平均 957ms / 最大 2202ms(4 件)。生の値は平均 -439ms(`posted_at` が秒単位のため負になる)。時計ズレ補正 1411ms
- ポーリングは「WS がギフトを届けているので保存用の通常間隔(10 秒)」に自動で戻った(`pollIntervalFor()` の `wsDelivering` が期待どおり動作)
- 出発点(同日朝のポーリングのみの計測): 平均 3862ms / 最大 10629ms

#### 確定した接続仕様(社長が whowatch.tv の自分の配信ページで F12 → Network → WS を確認)

- 入口: `wss://ws.whowatch.tv/socket/websocket?vsn=2.0.0`(Phoenix Channels v2)。Origin 制限なし(診断 v2 で 101)
- 購読: `["1","1","room:<配信ID>","phx_join",{"p":"<jwt>"}]` → `{"status":"ok"}`。jwt は `/lives/{id}` の `jwt`
- heartbeat: `[null,"2","phoenix","heartbeat",{}]`(30 秒)
- ギフト: event `"shout"` の `payload.comment` にコメント本体(`comment_type` `"BY_PLAYITEM"` 等。`/lives/{id}` の `comments[]` と同じフィールド)

#### 経緯(PR 番号。いずれも CI 緑・社長の自動マージ許可に基づき Claude がマージ)

- PR #9 診断 v1: `comment_server_url` の `/socket` にそのまま接続 → 全候補 404
- PR #10 診断 v2: `/socket/websocket?vsn=2.0.0` で 101 を確認
- PR #11 Phoenix 購読(phx_join / heartbeat の送信)。決裁の変更: 2026-09-25「送信も可」。送るのは phx_join / heartbeat のみ(AGENTS.md / CODEX_CLAUDE.md をこの PR で更新済み)
- PR #12 連続ギフトの SE 修正 + 参加データ総当たり。購読候補 `live:<id>` 等は `unmatched topic`、`room:<id>` に `token` キーでは `unauthorized invalid param`
- PR #13 `room:<id>` + `{"p": jwt}` で確定(公式サイトの通信で確認)

#### 連続ギフトの SE(PR #12)

200ms ずらしで重ねる方式は長い音源で 2 発目以降が埋もれたため、前の音が鳴り終わってから次を鳴らす方式に変更(待ち上限 4 秒)。

#### 残課題

- 残り約 1 秒の内訳は「`posted_at` が秒単位の誤差」「時計ズレ補正の精度」「連投時の SE キュー待ち」に分かれる。キュー待ちの計測列を `?debug=1` に追加中(ブランチ `claude/ws-metrics`。実測は未取得)。ふわっち内部の遅れは手が出せない(TODO.md Q6)→ 同日中に切り分け完了。下記「2026-09-25 SE ラグの切り分けと解消」
- 未確認のまま: payments3 のバナー URL の有無(Q3)、無料アイテムの設定反映(Q2)、Supabase 課金警告(Q5)

## 2026-09-25 SE ラグの切り分けと解消(PR #18 / PR #20)

上記「残課題」の Q6(残り約 1 秒の内訳)を計測パネルの指標追加とカスタム音源の先読みで切り分け、解消した。いずれも main にマージ・本番反映済み。

### PR #18(main `628d9bf`): 計測パネルに「到着ゆらぎ」を追加

- 対象: `src/components/live/LiveCockpit.tsx` のみ(表示のみ。取り込み・再生・キューは無変更)
- 背景: 計測パネル(`?debug=1`)の「投げられた→SE」は、ふわっちの `posted_at`(秒単位)・Worker の `serverNow`・手元の時計の 3 つを混ぜた値で、値が大きくても時計ズレか実遅延か区別できなかった。実測でふわっちと手元の時計差は約 1.5 秒(パネルの「ズレ」列 1540〜1561ms)。生の値がマイナス(-900〜-1300ms)になるのも同じ理由
- 追加した指標: 「到着ゆらぎ(時計ズレ除去・最速比)」= 経路(WS / ポーリング)ごとに最速の到着 `arrivalMs` を 0 とした遅れ幅。時計ズレの定数分が打ち消される。サマリ行・明細表の列・注意書きを追加し、「最速の到着(基準)」も表示する
- 読み方: ゆらぎが小さい = 実遅延ではない(時計ズレ)/ 大きい = 本当に配信が詰まっている

### PR #20(main `e2e9183`): カスタム音源のプリデコード〔先読み展開〕

| 種別 | パス | 内容 |
|---|---|---|
| lib | `src/lib/se/engine.ts` | `loadBuffer()` で取得・デコード〔音声データの展開〕・キャッシュを共通化。同一 URL の同時取得は `inflight` で 1 回にまとめる。`preloadSe(urls)` を追加。`playUrl()` は `loadBuffer()` を使う |
| UI | `src/components/live/LiveConnectionProvider.tsx` | `audioReady` が true になった時点と `mappings` 変更時に、有効なマッピングの `url` を `preloadSe()` する effect を 1 つ追加 |

- 背景: SE キュー待ちは 1ms まで詰まっていたが、アップロード音源は「その種類が初めて鳴る瞬間」に `fetch` + `decodeAudioData` が走り、初回だけ数百 ms 余分にかかっていた
- 取れなかった URL は無視し、鳴らす時点で再試行 → だめなら合成音(従来どおり)

### 実測値の推移(計測パネル。ふわっち他人配信 `room:76349332` を閲覧、WS 経由)

| 時点 | 件数 | 投げられた→SE(補正済) | 到着ゆらぎ | キュー待ち | 備考 |
|---|---|---|---|---|---|
| PR #16 時点(混雑配信 `room:76346663`) | 17 | 平均 8720ms / 最大 21412ms | — | — | 時計ズレと混雑サンプルが混ざっていた |
| `628d9bf`(PR #18 反映後) | 4 | 平均 765ms / 最大 1114ms | 平均 496ms / 最大 844ms | 平均 1ms | |
| `628d9bf` 連投テスト | 8 | 平均 552ms / 最大 1050ms | 平均 260ms / 最大 759ms | 平均 0ms / 最大 1ms | 連投でも SE キューは詰まらない |
| `e2e9183`(PR #20 反映後) | 2 | 平均 379ms / 最大 432ms | 平均 54ms / 最大 107ms | 0ms | 最速の到着 325ms |

- 視聴者コメント(`BY_PUBLIC`)に「鳴るまでのラグがなくなったね」が残っている(第三者の体感)

### 結論

- コード側(SE キュー待ち)は 0〜1ms で限界。残る約 300ms は「ふわっち→手元の配信時間 + `posted_at` の秒丸め(±500ms)」で、TagDeck 側では削れない
- SE キュー詰まり対策(連打のまとめ・待ち上限短縮など)は**不要と判断**(連投 8 件でもキュー待ち 0ms)。連続再生(前の音が鳴り終わってから次)の挙動は維持

### 品質ゲート

- 3 点とも緑: `pnpm exec tsc --noEmit` 0 件 / `pnpm test` 36 ファイル 323 件 / `pnpm exec next build --webpack` 0 件

### 既知・未対応(TODO.md 参照)

- `src/components/live/LiveConnectionProvider.tsx` に eslint の既存 2 件(`useMemo(() => createSeQueue(...))` の「Cannot access refs during render」エラー、`retryCountdownSec` 未使用 import 警告)。main 時点から存在し、今回のスコープ外で未修正。品質ゲート(tsc / test / build)には含まれない
- 正本 `D:\tagtech\docs\streaming\remote-studio-plan.md` の到達点節と Notion タスクは、この環境(Linux コンテナ)から届かないため未更新。社長が転記する(TODO.md「社長が転記する」)
