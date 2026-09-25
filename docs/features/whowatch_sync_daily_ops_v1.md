# ふわっち daily sync 運用ガイド v1

> 作成: 2026-05-09

## 概要

毎日 JST 0:00 (UTC 15:00) に n8n Cron が Python スクリプトを起動し、ふわっちアイテム・イベント一覧を Supabase に同期する。

```
n8n Cron (UTC 15:00)
  → Code(JS) spawn  sync_items_and_events.py
    → api.whowatch.tv/playitems/payments3 → item_point_mapping
    → api.whowatch.tv/event_lists         → fuwacchi_events
    → Discord DISCORD_WEBHOOK_TASK 通知
  → IF node: 成功/失敗で Discord 通知 (二重保証)
```

## 必須環境変数

n8n の Credentials → Variables で設定する:

| 変数名 | 説明 |
|---|---|
| `FUWACCHI_DEVICE_ID` | ふわっち device-id (例: `tagdeck-1778297341715-55361068`) |
| `SUPABASE_URL` | Supabase プロジェクト URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase サービスロールキー |
| `DISCORD_WEBHOOK_TASK` | Discord 通知 Webhook URL |

## n8n ワークフロー登録手順

1. n8n UI → Workflows → Import from file
2. `D:\tagdeck\data\n8n_workflows\tagdeck_fuwacchi_sync_daily.json` を選択
3. Credentials で上記環境変数が参照可能か確認
4. Activate

### n8n v2 の注意事項

n8n v2 では `Execute Command` ノードがデフォルト無効。本ワークフローは `Code(JS) + child_process.spawn` を使用しているため影響なし。

`NODES_INCLUDE` 環境変数は不要。

## Python スクリプト単体実行

```powershell
$env:FUWACCHI_DEVICE_ID = "tagdeck-xxxx"
$env:SUPABASE_URL = "https://xxxx.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "eyJxxx"
python D:\tagdeck\scripts\platforms\fuwacchi\sync_items_and_events.py
```

成功時の出力例:
```json
{"items_synced": 7, "events_synced": 2, "duration_ms": 1234}
```

## テスト実行

```powershell
cd D:\tagdeck\scripts\platforms\fuwacchi
pytest sync_items_and_events.test.py -v
```

期待: 全テストケース PASS (13 件以上)

## 監視

| アラート | 条件 | 対処 |
|---|---|---|
| Discord に FAILED 通知 | スクリプト exit code != 0 | エラーメッセージ確認 → device-id 期限切れ疑いで再取得 |
| `events_synced: 0` | イベント期間外 | 正常。ふわっちイベント開催中のみ非ゼロ |
| `items_synced: 0` | API 構造変更の可能性 | HAR 再取得して item-mapping.ts と SQL を更新 |

## device-id 更新手順

1. ブラウザの DevTools → Network → `whowatch.tv` への任意リクエストの `x-whowatch-device-id` ヘッダーを取得
2. n8n 環境変数 `FUWACCHI_DEVICE_ID` を更新
3. n8n ワークフローを手動実行して `items_synced > 0` を確認
