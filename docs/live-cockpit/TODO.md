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

- [x] `/rankings/{type}` の `publisher_id` パラメータは未使用(自分の特定は user_path / 数値 id / 表示名で行う)。自分が limit 100 圏外の時に順位が取れない → publisher_id を付けると自分の行が返るかは実測で要確認
  → **2026-10-07 実測・対応済み（E8 追記）**: `publisher_id=<数値 ID>` を付けると、本人が一覧の外（570 位）でも応答に `publisher_ranking`（rank・point・next_rank・ranking_up_point）が返る。`/events/limited_item_rankings` も同じ。その順位表に本人の記録が無ければ `publisher_ranking` 自体が無い。WGP（`/wgp/ranking/*`）は非対応。数値 ID は公開プロフィール `GET /users/{path}/profile` の `user_id`（`src/lib/whowatch/profile.ts`）。5 分同期は publisher_id 付きで取得し、圏外でも my_rank / my_point を記録する
- [ ] `whowatch_events.event_key` に UNIQUE を付けるか(既存行に重複が無ければ 0012 で追加)
- [ ] `EventDashboard.tsx` 71 行目の `setState in effect` は既存コードの lint エラー(E2 では触っていない)
- [ ] GitHub Actions の 5 分 cron は数分遅延する。デイリーイベント終盤の精度が足りなければ Cloudflare Cron Trigger への移行を検討
- [ ] 社長作業: 0010/0011 の SQL 適用、`RANKING_SYNC_KEY` の投入(Cloudflare + GitHub Secrets)

## E1b/E3 で新たに出た要確認(2026-09-21)

- [ ] **pre 状態のランキング型イベント(rookie_2, toryumon_2 等)が「RANKING タブ無し」と判定される件**: 開始前は `/event_lists/{key}` の tabs に RANKING が無い可能性。開始後(9/23〜)に `event-detail-sync` を再実行して periods / ranking_prefix が入るか再確認する
- [ ] **gingiragin の `limited-item-2026_09_gingiragin` 型と whowatchgrandprix の `WGP_RANKING` 型への対応**: 前者は RANKING タブだが prefix にハイフンを含み `/resources/json/rankings/{prefix}` の形が未確認、後者はタブ type が `WGP_RANKING`(detail `202609overall`)で現状は「区分なし」扱い。取得 URL と構造を実測してから対応
  → **前者は 2026-10-07 に対応済み（E7）**: `limited-item-*` は構造 JSON が無く、ふわっち Web 版と同じ `GET /events/limited_item_rankings_init` / `GET /events/limited_item_rankings?period=YYYYMMDD&event_key=&group=` を使う（黄金発掘隊で実測）。デイリーは 0:00 JST 区切り
  → **後者も 2026-10-07 に対応済み（E8）**: `WGP_RANKING` タブ（2026-10 は detail 空）は擬似 prefix `wgp` にし、`GET /wgp/ranking/{YYYYMMDD}`（デイリー）/ `GET /wgp/ranking/overall/{YYYYMM}`（月間総合・21 日から公開）を使う。N-1 グランプリ（RANKING タブ detail `n1`・構造 JSON は Z-002）も `GET /rankings/nice_one_{1st|2nd|3rd}_{male|female|rookie}/{YYYYMM}` / `nice_one_total/{YYYYMM}` で対応。残る未対応は `WGP_AWARD`（デイリー受賞者の一覧・順位追跡には不要）
- [ ] E3 の基礎 pt(アイテム 1 個あたりのランキングポイント)は公式本文に無い → 手入力運用。S1 のギフト保存後に「実測から推定」で置換
- [ ] E3 の最終日係数 1.5 は仮置き。過去 closed イベントの伸び率係数(最終日 24h の pt 増分 ÷ 通常日平均)を求める処理を追加する
- [x] `event_item_points` は全ユーザー共有(認証ユーザーなら誰でも上書き可)。荒らし対策が必要なら user 別に分ける → 2026-10-08 社長決定(案 A・セキュリティ監査 §3-4): 書き込みは運営者(`EXPORT_OWNER_USER_ID`)だけ(他は 403 `OWNER_ONLY`)。他の利用者は読めるだけで、画面の入力・推定は自分の試算用(保存しない)。提案が増えたら `updated_by` + `source='proposed'`(案 B)を上に足す

## S1 で新たに出た要確認(2026-09-21)

- [ ] BY_PLAYITEM の実フィールド(play_item_pattern_id / item_count / anonymized / posted_at)は 2023 年 MCV ソース由来。`/live?debug=1` の生データで確定し docs/FIELDS.md に記録
- [ ] `/lives/{id}?last_updated_at=N` が増分だけ返すか(重複は platform_comment_id で弾くので保存は安全だが、表示側 seen 管理に依存)
- [ ] 当たり判定(whowatch_item_patterns.is_hit)は名前ベース推定。実ギフトの pattern_id と当たり表示を突き合わせて確定
- [ ] Storage バケット `se` の作成は 0014 の SQL に含めたが、storage スキーマへの INSERT/POLICY 権限で失敗する場合は Dashboard から手動作成(公開・5MB・audio/*)
- [ ] SE を視聴者に届ける経路(スピーカー→スマホマイク)は P4 で実配信検証

## SE ラグの切り分けと解消で新たに出た要確認(2026-09-25)

- [ ] `src/components/live/LiveConnectionProvider.tsx` の eslint 既存 2 件: `useMemo(() => createSeQueue(...))` の「Cannot access refs during render」エラー、`retryCountdownSec` 未使用 import 警告。main 時点から存在し PR #18 / #20 のスコープ外で未修正。品質ゲート(tsc / test / build)には含まれないため CI は緑。直すなら別 PR
- [ ] `e2e9183` 反映後の実測は 2 件のみ(他人配信 `room:76349332` の閲覧)。自分の配信・混雑配信・連投での再計測は未取得。到着ゆらぎが大きく出る配信があれば、その「WebSocket 生ログ」を渡す

## シミュレーター削除の論理削除化で新たに出た要確認(2026-09-30)

- [ ] 本番で画面から削除したときの動作(`status = 'deleted'` になり、行と `ranking_snapshots` が残る)は未確認(要確認)。DB への書き込みを伴うので社長操作。手順は README「2026-09-30 修正: シミュレーターの削除を論理削除に」の動作確認手順 3
- [ ] 削除済み(`status = 'deleted'`)の行と履歴は DB に残り続ける。退会・削除依頼などで完全に消す必要が出たら、後から物理削除する仕組み(保存期間を決めて消す等)を検討する

## 社長が転記する(2026-09-25 完了)

- [x] **正本 `D:\tagtech\docs\streaming\remote-studio-plan.md`** に「## 2026-09-25 到達点：SE ラグの切り分けと解消」節を**追記のみ**で足す(既存行は書き換えない)。内容は README「2026-09-25 SE ラグの切り分けと解消」の要約: PR #18(`628d9bf`)到着ゆらぎ指標 / PR #20(`e2e9183`)カスタム音源の先読み / 実測 平均 379ms・最大 432ms・到着ゆらぎ 平均 54ms・キュー待ち 0ms / 残り約 300ms はふわっち側で TagDeck では削れない / キュー詰まり対策は不要と判断
  → **完了(2026-09-25)**: 社長が正本末尾に追記済み
- [x] **Notion タスク管理(`[tagdeck-live]` 接頭辞)** の該当タスクの `ステータス` を完了にし、`メモ` に「2026-09-25 / PR #18・#20 / 上記の実測値と結論」を記入
  → **完了(2026-09-25)**: `[tagdeck-live] P3: ブラウザ内イベントバス＋SEエンジン` を完了に更新、メモに実測値と結論を追記

## S26 で新たに出た要確認(2026-10-17)

- [ ] **本番での実登録の結果は未確認**: `pnpm se:pack` の本番 Storage(バケット `se`)/ `se_mappings` への登録は、本番の鍵が要るため Claude は実行していない。社長が `--dry-run` で `pack-manifest.json` の計画を見てから本実行し、SE タブに `item:{id}` / `#2〜#5` の行が増えたか・鳴るかを確認する。戻すときは `pnpm se:pack --undo <manifest>`(`--purge` で Storage の音源も)。手順は README「S26」の使い方
- [x] **`.env.local` への `SUPABASE_SERVICE_ROLE_KEY` の投入は社長作業**: バケット `se` の書き込みポリシーは `auth.uid()` 配下だけなので CLI からは service role が要る(Supabase ダッシュボード → Project Settings → API → service_role)。値はチャットに貼らない。CLI は値をログに出さない
  → **完了(2026-10-17)**: `.env.local` に `DATABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` の行があり、値が空でも仮の値でもないことを run-pack と同じ判定で確認(キー名と有無だけ。値は表示していない。有効性は本実行で分かる)
- [ ] **実音源での無音しきい値の妥当性は未確認**: 切り出しは `silencedetect=noise=-35dB:d=0.3` で、合成音源(無音を挟んだ wav・ずっと鳴っている mp4)でしか確かめていない。実音源(パチンコ・パチスロの効果音など)で切れすぎ・切れなさすぎが出たら、まず `--noise`(-45〜-30)/ `--min-silence` と `--min` / `--max` で調整し、合う値が決まれば既定を見直す(引数は 2026-10-17 に追加)
- [x] **run-pack.ps1 で `--` の後の引数が `-Src` に入る**: 2026-10-17 の社長の実行ログ `.\scripts\se\run-pack.ps1 -PreScript .\auto_fetch.py -Yes -- --max-clips 40` が「ソースフォルダがありません: --max-clips」で止まった(PowerShell 既定の位置束縛)
  → **完了(2026-10-17・PR #113)**: `[CmdletBinding(PositionalBinding = $false)]` で名前の無い引数をすべて `pnpm se:pack` へ。`-Src` が `-` で始まる / ソースフォルダのファイルが 0 件 はその場で停止(bash 版も同じ 2 検査)。Windows PowerShell 5.1 と pwsh 7.6 で実機確認。品質ゲート 3 点緑・verifier 8 項目 PASS・CI 成功
- [ ] **`.env.local` に `SE_PACK_USER_ID` が無い**(2026-10-17 時点・行ごと無し): 本実行で登録先ユーザーの uuid として要る(dry-run には不要)。社長が値を入れるか、`-- --user <uuid>` で渡す。run-pack を実行すると空の行 `SE_PACK_USER_ID=` が自動で追記されるので、そこに入れる。値はチャットに貼らない
- [ ] **前段 `auto_fetch.py`(社長担当・リポジトリ外・`.git/info/exclude` 済み)が音源を `source_se` に置けていない**: 2026-10-17 の実行で全件 WinError 2。Claude は中身を直さない。直ったら `.\scripts\se\run-pack.ps1 -Src .\source_se -- --max-clips 40`(-Yes 無し)で dry-run の分類と本数を見てから本実行。切れ目が合わなければ `-- --noise -40 --min-silence 0.2`。本実行後は SE タブで `item:{id}` の行が増えて鳴るかを確認、戻すときは `pnpm se:pack --undo .se-pack\out\pack-manifest.json`
- [x] **事故(2026-10-17 21:51 JST): run-pack.ps1 の確認が非対話で素通りし、本番へ本実行された**: Claude のツールの shell(stdin なし)から `-Yes` 無しで連結テストを走らせたところ、Read-Host が空の列挙を返して `-notmatch` が偽になり、合成音 4 本が Storage に、se_mappings 1011 行(item:N 259・#2〜#5 752)が公式既定の同期元アカウントに upsert された(既存 24 行を上書き)
  → **対処(同日 22:0x・社長承認)**: `pnpm se:pack --undo .se-pack\out\pack-manifest.json --purge`(1011 行・4 本削除)→ 同梱スナップショット(`src/lib/se/default-mappings.ts`・9/30 時点)から消えた 24 行を `ON CONFLICT DO NOTHING` で INSERT(24 行挿入・0 行既存)。残り 235 行はパックが新規に入れたもの。9/30 以降に SE タブで手で変えた item の行があれば戻らない(社長が SE タブで確認)。再発防止: run-pack の非対話ガード(本 PR)・本番に書く手順の連結テストは本実行の経路を物理的に塞いでから行う
- [x] **元メディアの自動切り出し(2026-10-17 社長指示「音源の自動取得・切り出しも含めて全部」)**: 手元の元動画・音声から、タイムスタンプ(cuts.csv / cuts.json)と言葉(名前・map.json)で切り出し、分類に掛かる名前とフォルダで `source_se/` に置く `pnpm se:prep` と、run-pack の `-PreScript` / `PRE_SCRIPT` につなぐ入口(ps1 / sh)
  → **完了(2026-10-17)**: README「S26」の「元メディアの下ごしらえ」。YouTube 等からの自動取得は書いていない(権利のない配信元からの取得は Claude が担当しない)。元メディアを `source_raw/` に置き、`cuts.csv` と `map.json` を添えれば、`.\scripts\se\run-pack.ps1 -PreScript .\scripts\se\prep-source.ps1 -- --max-clips 40` で下ごしらえ → dry-run → 確認 → 本実行まで 1 コマンド。実音源での切り出しと分類の出来は未確認(dry-run の計画を見て名前・map.json を調整する)

## 社長が転記する(2026-09-30)

- [ ] **正本 `D:\tagtech\docs\streaming\remote-studio-plan.md`** に「## 2026-09-30 到達点：シミュレーター削除の論理削除化」節を**追記のみ**で足す(既存行は書き換えない。2026-09-30 は D ドライブの統合作業中のため Claude は触っていない)。内容は README「2026-09-30 修正: シミュレーターの削除を論理削除に」の要約: 本番の `ranking_snapshots` がシミュレーター削除の CASCADE で全 0 行になっていた / PR #66 で DELETE を論理削除(`status = 'deleted'`)にし、id 指定の API を `ownedSimulator` で絞った / PR #68 で historical-pace の 404・schema.ts のコメント・テスト 35 件を追加 / 9/23・9/25 に消えた履歴は戻らない

## 社長が転記する(2026-10-17)

- [ ] **正本 `D:\tagtech\docs\streaming\remote-studio-plan.md`** に「## 2026-10-17 到達点：音源パックの一括取り込み CLI」節を**追記のみ**で足す(既存行は書き換えない。2026-10-17 の作業環境からは正本に触れないため Claude は書いていない)。内容は README「S26」の要約: 社長指示「手元のソースディレクトリ(音声・動画)を読み込み、ffmpeg で切り出し・ノーマライズし、ファイル名・フォルダ名でテーマ分類して、全アイテムに Supabase へ一括登録する、ローカル専用の自動化パイプライン」/ PR #106(`45f8fb3` の SE タブのカード + `/api/se/mappings/batch` は取り下げ、`c7c563c` で CLI に置き換え。merge commit `cf5fbfe`)/ `scripts/se/pack-pipeline.ts`(`pnpm se:pack --src <dir>`)と純関数 `src/lib/se/pack-clip.ts` / `pack-import.ts` / 切り出しは silencedetect(-35dB・0.3 秒)→ `loudnorm` -14 LUFS・mono 44.1kHz・mp3 96k・既定 2〜5 秒 / 分類はフォルダ名 → ファイル名(パチンコ・パチスロ用語は近いテーマへ)/ 割り当てはアイテムごとに同じ分類の音を最大 5 本(`item:{id}`・`#2〜#5`)、当たりは `pattern:{id}`、段階は `bulk:{段階}` / 登録は Storage `se` の `{user}/pack/{sha1 先頭 12 桁}_{名前}.mp3` と `se_mappings` の 500 行ずつ upsert、`--undo` で取り消し / 品質ゲート 3 点 + `--frozen-lockfile` + verifier 8 項目 PASS + CI 成功 / 本番の実登録と実音源でのしきい値は未確認 / URL からの取得は範囲外
- [x] **Notion タスク管理(`[tagdeck-live]` 接頭辞)** に S26 のタスクを作る
  → **完了(2026-10-17)**: 既存に S26 相当のタスクが無かったため、`[tagdeck-live] S26: 音源パックの一括取り込み CLI(切り出し・テーマ分類・全アイテムへ一括登録)` を `ステータス` 完了・完了日時 2026-10-17 09:42Z で新規作成し、`メモ` に PR #106 / #107・CLI の中身・品質ゲート・未確認事項を記入した(社長指示「全て許可するので自走して」による)

## 次の作業

- [x] ~~E1/E1b/E2/E3/E4/S1~~ 実装済み(2026-09-21)。次は P4(既定 SE パックの実配信検証)・P5(ギフト蓄積の分析)・P6(他配信者向け公開)
- [ ] **要確認(2026-09-22)**: PR #25(X-Sync-Key ルート一元化)のマージ状況。社長からは「マージ済み」と申告があったが、GitHub API 確認時点(2026-09-22)では open。マージ済みか、まだの場合はマージが必要
- [ ] Phase 1(whowatch-feed 側): `sync_items_and_events.py` に `/playitems` パターン同期 + 差分検知 + notify-gw を追加(新テーブルは Drizzle migration)
- [ ] Phase 2: `GET /api/platforms/whowatch/live?handle=` (認証・10秒キャッシュ・毎分6回)
