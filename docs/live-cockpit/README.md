# tagdeck-event / tagdeck-live 実装メモと動作確認手順

正本: `D:\tagtech\docs\streaming\remote-studio-plan.md`。既存資産の棚卸しは [EXISTING.md](EXISTING.md)、要確認は [TODO.md](TODO.md)。
表記ルール: コード・パス・識別子・API・テーブルは `whowatch`、日本語の文章・UI は「ふわっち」。

決裁(2026-09-20): ふわっちデータ取得は公開 API のポーリングのみ。WebSocket は実装しない。
決裁(2026-09-25): 上記を変更。SE のラグ解消のため、`/lives/{id}` の `comment_server_url` / `jwt` によるコメントサーバ(WebSocket)への **受信のみ** の接続を例外として許可(AGENTS.md 参照)。ポーリングは保存と予備経路として継続。

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

- WS のメッセージ形式・認証方式は未実測。形式が違っても落ちず、ポーリングで従来どおり鳴る設計
- 無料アイテムの設定が反映されない原因(a/b)は実データ待ち
- payments3 のバナー URL フィールド名は未確認

## 2026-09-25 本番稼働状況

- PR #1「feat(live): WebSocket 即時経路・SE タブのバナー付きカテゴリ表示・無料アイテムの既定音」(https://github.com/tagtech-jp/tagdeck/pull/1)は main にマージ済み(マージコミット `b863ae8`、2026-09-25T05:35Z 頃)。CI(`.github/workflows/ci.yml` の check)は head `80e5f5f` で success
- PR #2「fix(types): res.json() の戻り値に型を付け、CI の Type check を緑にする」(https://github.com/tagtech-jp/tagdeck/pull/2、コミット `26eb394`、15 ファイル・52 箇所)もマージ済み。CI は head `26eb394` で success。PR #1 は PR #2 の内容をマージで取り込んでいた
- main で CI の Type check が赤だった原因: lockfile の TypeScript 5.9.3 + @types/node 20.19.39 の組み合わせで `Response.json()` の戻り値が `Promise<unknown>` になるため(上記「2026-09-25 S1 拡張」動作確認手順 1 の「既存エラー 52 件」がこれ)。PR #2 で `res.json()` の戻り値に型を付けて解消
- 未確認(社長作業。本セッションでは確認していない):
  - Supabase での `drizzle/0017_item_group_banner_manual.sql` の適用
  - Actions「Whowatch item patterns sync (manual)」の実行(バナー列の充填)
  - `/live?debug=1` での WS 経路の実測(メッセージ形式・認証方式。TODO.md Q1b)
  - payments3 のバナー URL の有無(TODO.md Q3)
  - 無料アイテムの設定反映の原因(TODO.md Q2)
