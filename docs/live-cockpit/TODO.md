# tagdeck-live TODO / 要確認

推測で実装せず、ここに「要確認」として残す(絶対ルール4)。社長への質問は1度に1つ。

## 要確認(社長)

- [ ] **Q1(Phase 3 の前提・最優先)** `AGENTS.md` と `CODEX_CLAUDE.md` は「非公式 WebSocket・内部プロトコル解析の実装禁止」「ふわっちは公開 API のポーリングのみ」と定めている。tagdeck-live Phase 3(ブラウザ WS クライアント)はこれに反する。選択肢:
  1. 規約を改訂して WS を許可する(商用 SaaS としての規約リスクを社長が引き受ける)
  2. WS は個人ツール(whowatch-feed)に留め、TagDeck 側は `/lives/{id}` の `comments[]` を `polling_interval`(10秒)でポーリングしてギフトを取る(規約内)
  3. Phase 3 以降を保留
  → 決裁が下りるまで Phase 3 には着手しない。Phase 1・2 は規約内なので進められる。

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

## 次の作業

- [x] ~~E1/E1b/E2/E3/E4/S1~~ 実装済み(2026-09-21)。次は P4(既定 SE パックの実配信検証)・P5(ギフト蓄積の分析)・P6(他配信者向け公開)
- [ ] **要確認(2026-09-22)**: PR #25(X-Sync-Key ルート一元化)のマージ状況。社長からは「マージ済み」と申告があったが、GitHub API 確認時点(2026-09-22)では open。マージ済みか、まだの場合はマージが必要
- [ ] Phase 1(whowatch-feed 側): `sync_items_and_events.py` に `/playitems` パターン同期 + 差分検知 + notify-gw を追加(新テーブルは Drizzle migration)
- [ ] Phase 2: `GET /api/platforms/whowatch/live?handle=` (認証・10秒キャッシュ・毎分6回)
