# tagdeck-live TODO / 要確認

推測で実装せず、ここに「要確認」として残す(絶対ルール4)。社長への質問は1度に1つ。

## 要確認(社長)

- [x] **Q1(Phase 3 の前提・最優先)** `AGENTS.md` と `CODEX_CLAUDE.md` は「非公式 WebSocket・内部プロトコル解析の実装禁止」「ふわっちは公開 API のポーリングのみ」と定めている。tagdeck-live Phase 3(ブラウザ WS クライアント)はこれに反する。選択肢:
  1. 規約を改訂して WS を許可する(商用 SaaS としての規約リスクを社長が引き受ける)
  2. WS は個人ツール(whowatch-feed)に留め、TagDeck 側は `/lives/{id}` の `comments[]` を `polling_interval`(10秒)でポーリングしてギフトを取る(規約内)
  3. Phase 3 以降を保留
  → **決裁(2026-09-25): 1 を採用**(2026-09-20 の「ポーリングのみ」を変更)。SE のラグがポーリング間隔そのもの(静か=10 秒)で、ポーリングでは平均 2〜3 秒が下限だったため。AGENTS.md / CODEX_CLAUDE.md に例外条件を明記。実装は README「2026-09-25 S1 拡張」参照
- [x] **Q1b(WS のメッセージ形式・実測で確定)** コメントサーバのメッセージ形式と認証方式(URL そのまま / `?jwt=`)はリポジトリに実測が無い。`/live?debug=1` の「WebSocket 生ログ」に出た内容を社長から受け取り、`extractComments()` を実形に狭める。「即時経路: 接続済み」なのに WS 経由のギフトが 0 件なら形式不一致(ポーリングで従来どおり鳴る)
  → **確定(2026-09-25)**: 入口 `wss://ws.whowatch.tv/socket/websocket?vsn=2.0.0`、購読 `room:<配信ID>` + `{"p": jwt}`(phx_join → `{"status":"ok"}`)、heartbeat 30 秒、ギフトは `shout` の `payload.comment`。PR #9〜#13 で到達。本番で WS 経由のギフト 4 件、投げられた→SE 平均 957ms(補正済)。詳細は README「即時経路(WebSocket)の到達点」
- [ ] **Q2(無料アイテムの設定反映)** 「無料アイテムの SE 設定が反映されない」の原因は 2 通りあり実データでしか判別できない。(a) イベントカテゴリの一括 SE を付けたが無料アイテムはカテゴリに属さず既定音に落ちる (b) 無料アイテムの pattern_id がマスタに無く個別設定に到達できない。確認 SQL: `SELECT occurred_at, payload->>'item_name', payload->>'pattern_id', payload->>'item_id', payload->>'price_yen', payload->'groups' FROM events WHERE platform='whowatch' AND event_type='gift' ORDER BY occurred_at DESC LIMIT 20;`
- [ ] **Q3(payments3 のバナー URL)** カテゴリのバナー画像 URL が payments3 にあるかは未確認(この環境からふわっち API へ接続できなかった)。0017 適用・同期後に `SELECT group_key, banner_url FROM whowatch_item_groups` で確認。全て null なら `pickBannerUrl()` の候補キーを実応答に合わせて足す(SE タブは文字見出しで動作する)
- [x] **Q4(0017 適用と同期実行の状況・2026-09-25)** PR #1 / #2 は main にマージ済みだが、Supabase での `drizzle/0017_item_group_banner_manual.sql` の適用と、マージ後の Actions「Whowatch item patterns sync (manual)」の実行は本セッションでは未確認。0017 未適用のままデプロイされていると `GET /api/platforms/whowatch/items/patterns` が 500 になる(README「2026-09-25 S1 拡張」社長作業 1)。適用・実行済みかを確認し、済んでいれば Q3 の確認 SQL へ進む
  → **完了(2026-09-25)**: 0017 は社長が Supabase で適用済み(「Success. No rows returned」)。同期は 06:02Z に実行し成功(パターン inserted 8 / updated 4,420 / failed 0、カテゴリ 22 件・137 行 inserted)。`banner_url` の有無は Q3 で継続
- [ ] **Q5(Supabase 無料枠の課金警告・2026-09-25)** Supabase ダッシュボード上部に「Grace period is over … projects will not be able to serve requests when you use up your quota」が表示されていた(無料枠の猶予期間終了)。quota を使い切ると本番がリクエストを受け付けなくなる。Billing 画面で現在の使用量と超過している項目を確認し、有料プランへの移行か使用量削減かを決める。どの quota(DB 容量 / Egress / MAU 等)が対象かは未確認
- [x] **Q6(即時経路の残り遅延の内訳・2026-09-25)** WS 経路の投げられた→SE は平均 957ms / 最大 2202ms(4 件・補正済)。残り約 1 秒の内訳は「`posted_at` が秒単位の誤差」「時計ズレ補正(1411ms)の精度」「連投時の SE キュー待ち(前の音が鳴り終わるまで最大 4 秒)」に分かれるが、どれがどれだけかは未計測。キュー待ちの計測列を `?debug=1` に追加中(ブランチ `claude/ws-metrics`)。追加後に配信中の実測値を社長から受け取り、内訳を確定する。ふわっち内部の遅れは手が出せない
  → **完了(2026-09-25)**: PR #18(`628d9bf`)で「到着ゆらぎ(時計ズレ除去・最速比)」を計測パネルに追加し、時計ズレ(約 1.5 秒)と実遅延を分離。SE キュー待ちは連投 8 件でも 0〜1ms で、キュー詰まり対策は不要と判断。PR #20(`e2e9183`)でカスタム音源の先読み(プリデコード〔音声データの事前展開〕)を入れ、`e2e9183` 時点で投げられた→SE 平均 379ms / 最大 432ms(2 件)・到着ゆらぎ 平均 54ms。残る約 300ms は「ふわっち→手元の配信時間 + `posted_at` の秒丸め(±500ms)」で TagDeck 側では削れない。詳細は README「2026-09-25 SE ラグの切り分けと解消」

## 要確認(Claude Cowork / 実測で確定)

- [ ] `/lives/{id}?last_updated_at=N` の `comments[]` が増分だけ返るか(ポーリング方式でギフトを取り切れるか)。whowatch-feed の poll ログで確認可能
- [ ] `payments3` の `play_item[].id` と `/playitems` の `id` が同一ID空間か(ぶたさん 10842 は両方に存在。全件突合は Phase 1 で機械的に検証)
- [ ] `listeners` に UNIQUE(streamer_id, platform, platform_user_id) が無い。Phase 5 で追加するか(既存 Kick 行に重複があると失敗する)
- [ ] `streamer_profiles` の user_id に UNIQUE があるか(コードは 1 行前提)
- [ ] `stream-activity` を whowatch 対応に広げるか(現在 platform='kick' 固定)

## E1/E2 で新たに出た要確認

- [ ] `/rankings/{type}` の `publisher_id` パラメータは未使用(自分の特定は user_path / 数値 id / 表示名で行う)。自分が limit 100 圏外の時に順位が取れない → publisher_id を付けると自分の行が返るかは実測で要確認
- [ ] `whowatch_events.event_key` に UNIQUE を付けるか(既存行に重複が無ければ 0012 で追加)
- [ ] `EventDashboard.tsx` 71 行目の `setState in effect` は既存コードの lint エラー(E2 では触っていない)
- [ ] GitHub Actions の 5 分 cron は数分遅延する。デイリーイベント終盤の精度が足りなければ Cloudflare Cron Trigger への移行を検討
- [ ] 社長作業: 0010/0011 の SQL 適用、`RANKING_SYNC_KEY` の投入(Cloudflare + GitHub Secrets)

## E1b/E3 で新たに出た要確認(2026-09-21)

- [ ] **pre 状態のランキング型イベント(rookie_2, toryumon_2 等)が「RANKING タブ無し」と判定される件**: 開始前は `/event_lists/{key}` の tabs に RANKING が無い可能性。開始後(9/23〜)に `event-detail-sync` を再実行して periods / ranking_prefix が入るか再確認する
- [ ] **gingiragin の `limited-item-2026_09_gingiragin` 型と whowatchgrandprix の `WGP_RANKING` 型への対応**: 前者は RANKING タブだが prefix にハイフンを含み `/resources/json/rankings/{prefix}` の形が未確認、後者はタブ type が `WGP_RANKING`(detail `202609overall`)で現状は「区分なし」扱い。取得 URL と構造を実測してから対応
- [ ] E3 の基礎 pt(アイテム 1 個あたりのランキングポイント)は公式本文に無い → 手入力運用。S1 のギフト保存後に「実測から推定」で置換
- [ ] E3 の最終日係数 1.5 は仮置き。過去 closed イベントの伸び率係数(最終日 24h の pt 増分 ÷ 通常日平均)を求める処理を追加する
- [ ] `event_item_points` は全ユーザー共有(認証ユーザーなら誰でも上書き可)。荒らし対策が必要なら user 別に分ける

## S1 で新たに出た要確認(2026-09-21)

- [ ] BY_PLAYITEM の実フィールド(play_item_pattern_id / item_count / anonymized / posted_at)は 2023 年 MCV ソース由来。`/live?debug=1` の生データで確定し docs/FIELDS.md に記録
- [ ] `/lives/{id}?last_updated_at=N` が増分だけ返すか(重複は platform_comment_id で弾くので保存は安全だが、表示側 seen 管理に依存)
- [ ] 当たり判定(whowatch_item_patterns.is_hit)は名前ベース推定。実ギフトの pattern_id と当たり表示を突き合わせて確定
- [ ] Storage バケット `se` の作成は 0014 の SQL に含めたが、storage スキーマへの INSERT/POLICY 権限で失敗する場合は Dashboard から手動作成(公開・5MB・audio/*)
- [ ] SE を視聴者に届ける経路(スピーカー→スマホマイク)は P4 で実配信検証

## SE ラグの切り分けと解消で新たに出た要確認(2026-09-25)

- [ ] `src/components/live/LiveConnectionProvider.tsx` の eslint 既存 2 件: `useMemo(() => createSeQueue(...))` の「Cannot access refs during render」エラー、`retryCountdownSec` 未使用 import 警告。main 時点から存在し PR #18 / #20 のスコープ外で未修正。品質ゲート(tsc / test / build)には含まれないため CI は緑。直すなら別 PR
- [ ] `e2e9183` 反映後の実測は 2 件のみ(他人配信 `room:76349332` の閲覧)。自分の配信・混雑配信・連投での再計測は未取得。到着ゆらぎが大きく出る配信があれば、その「WebSocket 生ログ」を渡す

## 社長が転記する(この環境から届かないため未更新・2026-09-25)

- [ ] **正本 `D:\tagtech\docs\streaming\remote-studio-plan.md`** に「## 2026-09-25 到達点：SE ラグの切り分けと解消」節を**追記のみ**で足す(既存行は書き換えない)。内容は README「2026-09-25 SE ラグの切り分けと解消」の要約: PR #18(`628d9bf`)到着ゆらぎ指標 / PR #20(`e2e9183`)カスタム音源の先読み / 実測 平均 379ms・最大 432ms・到着ゆらぎ 平均 54ms・キュー待ち 0ms / 残り約 300ms はふわっち側で TagDeck では削れない / キュー詰まり対策は不要と判断
- [ ] **Notion タスク管理(`[tagdeck-live]` 接頭辞)** の該当タスクの `ステータス` を完了にし、`メモ` に「2026-09-25 / PR #18・#20 / 上記の実測値と結論」を記入

## 次の作業

- [x] ~~E1/E1b/E2/E3/E4/S1~~ 実装済み(2026-09-21)。次は P4(既定 SE パックの実配信検証)・P5(ギフト蓄積の分析)・P6(他配信者向け公開)
- [ ] **要確認(2026-09-22)**: PR #25(X-Sync-Key ルート一元化)のマージ状況。社長からは「マージ済み」と申告があったが、GitHub API 確認時点(2026-09-22)では open。マージ済みか、まだの場合はマージが必要
- [ ] Phase 1(whowatch-feed 側): `sync_items_and_events.py` に `/playitems` パターン同期 + 差分検知 + notify-gw を追加(新テーブルは Drizzle migration)
- [ ] Phase 2: `GET /api/platforms/whowatch/live?handle=` (認証・10秒キャッシュ・毎分6回)
