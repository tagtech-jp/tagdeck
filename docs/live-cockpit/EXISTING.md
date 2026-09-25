# tagdeck-live Phase 0: 既存資産の棚卸し(2026-09-21・読み取りのみ)

前提: `D:\tagtech\docs\streaming\remote-studio-plan.md`(正本)と whowatch-feed の実測(`D:\tagtech\projects\whowatch-feed\README.md`)。
対象: `src/app/api/platforms/whowatch/{poll,items,events,profile,monitor}`、`whowatch_mcv_sync.pyw`、`test_sync.py`、`src/lib/db/schema.ts`、`src/lib/platforms/whowatch.ts`、`scripts/platforms/whowatch/sync_items_and_events.py`、`.github/workflows/daily-sync.yml`、`src/app/api/platforms/kick/event/route.ts`、`src/app/api/stream-activity/route.ts`。

## 0. 最重要の発見(Phase 1〜3 の前提が変わる)

| # | 発見 | 影響 |
|---|---|---|
| A | **AGENTS.md / CODEX_CLAUDE.md が「非公式 WebSocket・内部プロトコル解析の実装禁止」を明記**(法務・最重要)。ふわっちは「公開 API のポーリングのみ(ライブ5秒/ランキング300秒以上)」 | Phase 3(ブラウザ WS クライアント)は **この規約と正面衝突**。実装前に社長の決裁が必要(→ TODO.md Q1) |
| B | **価格は `GET /playitems/payments3` にある**(認証不要・121商品・`play_item_payment_product[].price`, `product_id`, `quantity`, `state`)。既に `sync_items_and_events.py` が日次で `item_point_mapping` に `price_jpy` を保存している | whowatch-feed の Phase 2(価格)は Cookie/Playwright 不要。`/playitems`(1969件・パターン有・価格無)と `payments3`(121件・価格有・パターン無)を **item.id で結合**すれば済む |
| C | アイテムマスタの日次同期は **GitHub Actions cron(JST 0:00)+ Python + Supabase REST** が既存の慣習。Cloudflare/Vercel cron は未使用 | Phase 1 は新規 cron を作らず、既存スクリプトに `/playitems` のパターン取得を足すのが筋 |
| D | 既存の live_id 取得は `lives2?category_id=152`(カテゴリ一覧)を総当たりして自ユーザーを探す方式。whowatch-feed の実測では `GET /users/{path}/profile` の `live[0].id` で直接取れる | Phase 2 の `/live` ルートは profile 方式の方が確実(カテゴリ 152 に載らない配信を取りこぼさない)。ただし既存 poll の挙動は変えない |
| E | `events` テーブルへの書き込み経路は **Kick の `/api/platforms/kick/event` のみ**。ふわっち・ニコ生からは一切書かれていない。`whowatch_mcv_sync.pyw` は DB を触らない | ギフト保存(Phase 5)は Kick ルートの流儀(listeners 検索→insert/update→events insert)をそのまま踏襲できる |

## 1. 何が既にあるか

### 1.1 API ルート(`src/app/api/platforms/whowatch/`)

| ルート | 認証 | やること | DB |
|---|---|---|---|
| `GET/POST profile` | 必須 | `streamer_profiles` の whowatch 列を返す/`whowatchUserId` を保存(`@name` か数値。`t:` 形式は正規化で剥がす) | streamer_profiles |
| `POST monitor` | 必須 | `{action:start\|stop}` で `whowatch_is_monitoring` を切替。stop 時は live_id/各カウントをリセット | streamer_profiles |
| `POST poll` | 必須 | `pollWhowatchStreamerState()` → live_id・視聴者数・ポイント等を `streamer_profiles` に保存。ランキング型イベントは25秒毎にランキング取得 | streamer_profiles, event_simulators |
| `GET items` | 必須 | `item_point_mapping`(platform=whowatch)を返す。空なら `item-mapping.ts` の7件ハードコードにフォールバック。`Cache-Control: public, max-age=86400` | item_point_mapping |
| `GET events` | 必須 | `whowatch_events`(イベント一覧)。6時間以上古ければ `event_lists` をオンデマンド再取得 | whowatch_events |

`GET /api/stream-activity` は `events` を読むが **platform='kick' 固定**。ふわっち行を入れても表示されない(要拡張)。

### 1.2 ライブラリ(`src/lib/platforms/whowatch.ts`)

- `fetchLatestLive(userId)`: `lives2?category_id=152` から `user.{id,account_name,user_path,name}` の一致で探索。見つからず userId が数値なら `users/{id}/lives_history?count=1`
- `fetchLiveDetail(liveId)`: `GET /lives/{id}` → `.live`
- `pollWhowatchStreamerState()`: 上記2つを合成。`total_point` をポイント、`view_num|view_count` を視聴者数に。`comment_count`/`item_count` は信頼性未確認のため意図的に未使用(2026-07-24 実機検証の注記あり)
- ヘッダ: `User-Agent: TagDeck/0.1`、`origin/referer: https://whowatch.tv`、`x-whowatch-device-id`(env `WHOWATCH_DEVICE_ID` か seed ハッシュ)
- **jwt / comment_server_url / polling_interval は読んでいない**(`/lives/{id}` の応答にはある。whowatch-feed 実測)

### 1.3 スクリプト

- `whowatch_mcv_sync.pyw`(+ `test_sync.py`): 15秒毎に lives2 を叩いて自分の配信 URL をクリップボードにコピーするだけ(MultiCommentViewer 用の補助)。**DB・API ルートには一切書かない**。ログは `mcv_debug.log` / `error_mcv.log`
- `scripts/platforms/whowatch/sync_items_and_events.py`: `playitems/payments3` → `item_point_mapping`(UPSERT on `platform,item_id`)、`event_lists` → `whowatch_events`。Supabase REST + service role key。Discord 通知は `DISCORD_WEBHOOK_TASK`。テストは同ディレクトリの pytest
- `.github/workflows/daily-sync.yml`: 上記を毎日 UTC 15:00(JST 0:00)に実行。Secrets: `WHOWATCH_DEVICE_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DISCORD_WEBHOOK_TASK`

### 1.4 テーブル(`src/lib/db/schema.ts`)

| テーブル | 要点 |
|---|---|
| `users` | id = auth.users.id。`ensureUserRow()` で保証 |
| `streamer_profiles` | user_id FK。whowatch_* 列(user_id, live_id, is_monitoring, viewer/points/peak, last_polled_at)。**1ユーザー1行**(コードは `limit(1)` 前提、UNIQUE 制約は未確認) |
| `listeners` | streamer_id FK、platform、platform_user_id、display_name、nickname、notes、total_gift_amount、total_comment_count、last_seen_at。**UNIQUE(streamer_id, platform, platform_user_id) は無い**(Kick ルートは select→insert で重複回避) |
| `events` | streamer_id FK(NOT NULL)、listener_id FK(NULL可)、platform、event_type('comment'\|'gift'\|'enter'\|'leave')、payload jsonb、occurred_at、stream_id、platform_comment_id(部分UNIQUE (platform, platform_comment_id) WHERE NOT NULL)、moderated。RLS「own streamer rows only」 |
| `item_point_mapping` | platform, item_id(文字列。whowatch は数値IDの文字列化), item_name, base_point(=price), product_id, price_jpy, whowatch_id, description, has_animation, state, last_fetched_at。UNIQUE(platform, item_id) |
| `whowatch_events` | ふわっちイベント一覧(id, event_key, status, badge, started/ended_at, participants, title_ja) |

### 1.5 Kick のギフト/コメント保存経路(流用元)

`POST /api/platforms/kick/event`: zod で `{type, payload}` → `kick_is_monitoring` 確認 → comment は listeners を (streamer_id, platform, platform_user_id) で検索し insert/update(total_comment_count++) → `events` insert(payload は生 Pusher ペイロードそのまま)。gift は `events` に listener_id=null で insert してから listeners を更新。`platform_comment_id` / `stream_id` は **未使用**(重複排除していない)。

## 2. 何を流用するか

| Phase | 流用 |
|---|---|
| 1 アイテムマスタ | `sync_items_and_events.py` + `daily-sync.yml`(cron)。`item_point_mapping` はそのまま。`/playitems` のパターンを入れる新テーブル(`whowatch_item_patterns` 相当)だけ追加。差分検知と notify-gw 送信を同スクリプトに追記 |
| 2 中継 API | `profile` ルートの認証パターン、`whowatch.ts` の `fetchJson`/ヘッダ。`/lives/{id}` は既存 `fetchLiveDetail` を拡張して `jwt` 等を返す(`.live` しか返していない) |
| 3 WS | 流用元なし(規約上の可否を先に決裁) |
| 5 ギフト保存 | Kick event ルートの listeners/events 書き込みパターン。`platform_comment_id` の部分ユニークで重複排除(`onConflictDoNothing`) |
| UI | `DESIGN.md`(Huly): コントロールは 9999px ピル、カードは 12px、base unit 4px |

## 3. 何が無いか

- ふわっちのコメント/ギフトを **取得する経路が皆無**(poll は集計値のみ。`/lives/{id}` の `comments` 配列も未使用)
- `/lives/{id}` の `jwt`・`comment_server_url`・`polling_interval` を返すルート
- `/playitems`(パターン付き・当たり判定に必須)の同期。`item_point_mapping` は購入商品 121 件のみで、当たりパターン ID(例 10365)を持たない
- `events` に whowatch 行を書く経路、`stream-activity` の whowatch 対応
- `listeners` の一意制約(重複挿入は競合時に起こり得る)
- SE(効果音)関連: テーブル・Storage・Web Audio いずれも無し
- `docs/live-cockpit/`(本ドキュメントで新設)

## 4. 補足(規約との整合)

- 既存コードは `/lives/{id}` を「公開 REST」として 5 秒ポーリングしており、whowatch-feed 実測ではその応答に `comments[]`(comment_type 付き)が含まれる。**WS を使わずポーリングだけでギフトを取る**設計は既存規約の範囲内で成立する可能性が高い(サーバ指定 `polling_interval` は 10 秒)。WS 可否の決裁が下りるまでの代替案として TODO.md に記載。
