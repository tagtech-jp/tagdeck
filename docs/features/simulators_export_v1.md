# イベント目標の書き出し API（simulators/export）v1（2026-10-02）

運営者の配信分析ツール（stream-insight）が、TagDeck のイベント勝率シミュレーターで設定した目標と進捗を読むための、読み取り専用 API。

## エンドポイント

`GET /api/platforms/whowatch/simulators/export`（POST も同じ処理）

| 認証 | 返す対象 |
|---|---|
| `X-Sync-Key`（`RANKING_SYNC_KEY`・`SYNC_ROUTES` に登録） | 環境変数 `EXPORT_OWNER_USER_ID`（`users.id`）の利用者 1 人分だけ。未設定なら `configured: false` と空配列 |
| ヘッダ無し＋ログイン Cookie | ログイン中の本人の分（ブラウザでの確認用） |
| どちらも無い | 401 |

- 共有キーで任意の利用者のデータを読めないよう、**利用者の指定はリクエストから受け付けない**（クエリ・ヘッダは見ない）。キーが漏れても読めるのは運営者 1 人分の目標と進捗だけ
- 返すのは本人の目標・期間・進捗だけ。**ライバル（他の配信者）のデータは返さない**（`rivals_snapshot` 等は含めない）
- 論理削除（`status = 'deleted'`）は除く。`Cache-Control: private, no-store`

## 応答

```json
{
  "exported_at": "2026-10-02T09:00:00.000Z",
  "source": "event_simulators",
  "configured": true,
  "count": 1,
  "simulators": [{
    "id": "…", "name": "…", "platform": "whowatch", "event_type": "ranking",
    "event_key": "2026_10_magicfantasy", "whowatch_event_id": 1523,
    "start_time": "…", "end_time": "…", "status": "active",
    "target_score": 30000, "target_rank": 10,
    "current_score": 1200, "current_score_source": "auto", "current_rank": 35,
    "updated_at": "…"
  }]
}
```

- `event_key`: `whowatch_event_id` を `whowatch_events` で引いたもの。紐付けが無い（手動入力の）シミュレーターは `null`
- `current_score`: 手入力（`manual_score`）があればそれ、無ければ自動取得（`current_score`）。どちらかは `current_score_source`

### 予測と自分の点数の推移（2026-10-03 追加・stream-insight の「イベントの追い上げ計画」用）

ランキング型（`ranking_type` あり）のふわっち連携イベントで、目標順位があり、終了から 7 日以内のシミュレーターに付く。

```json
{
  "ranking_type": "magicfantasy_1st_doll_gold",
  "forecast": {
    "computed_at": "…", "target_rank": 3, "rank_probability": 0.1, "expected_rank": 13.8,
    "current_rank": 19, "current_point": 18425,
    "required_points": { "p50": 191622, "p90": 229681 },
    "target_border_points": { "p50": 0, "p90": 0 }, "my_final_points": { "p10": 0, "p50": 0, "p90": 0 },
    "remaining_hours": 78, "remaining_days": 3.3, "snapshot_count": 96, "final_day_coefficient": 1.5, "note": "…"
  },
  "forecast_error": null,
  "score_history": [{ "at": "…", "score": 18425 }]
}
```

- `forecast`: 画面（`EventDashboard` の `snapshotForecast`）と**同じ入力・同じ関数**（`ranking_snapshots` の最新 96 件 → `forecastRank`）で出す。画面と同じ数字になる（試行の乱数による小さな揺れはある）
- **ライバルの名前と点数は返さない**（`forecastRank` の `rivals` は含めない）。返すのは集計した数字だけ
- `score_history`: 自分の点数の推移（`ranking_snapshots.my_point`・5 分ごと・最大 6,000 件）
- 予測の計算に失敗しても目標そのものは返す（`forecast: null`・`forecast_error` に理由）

## 設定（社長の作業）

1. 本番の Worker に**秘密（Secret）**として `EXPORT_OWNER_USER_ID` を登録する（値は運営者の `users.id`。公開リポなので値はコード・文書に書かない）
   - **Text（平文の変数）で登録しないこと。** `wrangler.jsonc` に `vars` があるため、平文の変数は次のデプロイで消える（2026-10-03 に実際に消えた疑い）。Secret はデプロイで消えない
   - 確認: `npx wrangler secret list` の一覧に `EXPORT_OWNER_USER_ID` が出ること
2. 呼び出し側（stream-insight）に `RANKING_SYNC_KEY` と同じ値を置く

## 実装

- `src/app/api/platforms/whowatch/simulators/export/route.ts`（テスト: 同じ場所の `route.test.ts`、共通ループ: `src/lib/sync-routes.test.ts`）
- スキーマ変更なし。ロールバックは PR の revert
