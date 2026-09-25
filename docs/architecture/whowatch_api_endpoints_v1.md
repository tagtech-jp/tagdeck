# ふわっち API エンドポイント仕様 v1

> 作成: 2026-05-09 / HAR キャプチャ確認済み

## 認証

すべてのリクエストに以下のヘッダーが必要:

| ヘッダー | 値 |
|---|---|
| `x-whowatch-device-id` | 環境変数 `FUWACCHI_DEVICE_ID` の値 |
| `User-Agent` | `TagDeck/0.1 (+https://tagdeck.jp)` |
| `origin` | `https://whowatch.tv` |
| `referer` | `https://whowatch.tv/` |

device-id はブラウザ初回アクセス時に生成される識別子。ローテーションは行わない（30 日超で無効化の可能性あり、要監視）。

## エンドポイント一覧

### 1. アイテム一覧

```
GET https://api.whowatch.tv/playitems/payments3
```

**レスポンス形式 (抜粋):**
```json
[
  {
    "category_name": "イベント",
    "play_item": [
      {
        "id": 10842,
        "name": "トンでもない応援をするぶたさん",
        "description": "応援アイテム",
        "has_animation": true,
        "state": "OPEN",
        "play_item_payment_product": [
          { "price": 160, "product_id": "web.ranking.ouen_pig.1.sale" }
        ]
      }
    ]
  }
]
```

**同期先テーブル:** `item_point_mapping`  
**主キーマッピング:** `id` → `whowatch_id`, `item_id` は string(id)

HAR 確認済みアイテム (2026-05-09 時点):

| item_id | whowatch_id | name | price_jpy |
|---|---|---|---|
| ouen_pig | 10842 | トンでもない応援をするぶたさん | 160 |
| ouen_zou | 10773 | イベント応援するゾウ! | 160 |
| ouen_deer | 12131 | たしかな応援をするシカさん | 160 |
| ouen_wanchan | 11146 | ワンチャン33倍の応援をするワンちゃんさん | 160 |
| ouen_mogura | 12132 | もぐりながら応援するもぐらさん | 160 |
| weekend_1 | 10997 | シンデレラ | 160 |
| baseball2026 | 12727 | ピッチャーもりあげねこさん | 160 |

### 2. イベント一覧

```
GET https://api.whowatch.tv/event_lists
```

**レスポンス形式 (2026-07 実測):**
```json
{
  "pre":  [ { "id": 200, "event_key": "upcoming_event", "banner": "https://.../b.png",
             "badge": { "text": "エントリー受付中", "color": "#FF0000", "animation": false },
             "can_entry": true, "text": "参加人数: 0人",
             "started_at": 1780000000000, "ended_at": 1782000000000 } ],
  "open": [ { "id": 101, "event_key": "monthly_2026_05",
             "started_at": 1777000000000, "ended_at": 1780531199000 } ],
  "closed": []
}
```

- `started_at` / `ended_at` は **エポックミリ秒 (int)**。ISO 文字列ではない。取得側で Date へ変換する。
- `banner` は文字列 (バナー画像 URL)。`badge.text` は「NEW」「最終日」「エントリー受付中」等の**ステータスバッジ**であり**イベント名ではない**。
- `text` は「参加人数: N人」形式の文字列。
- **日本語イベント名フィールドは存在しない**。日本語名は `https://whowatch.tv/events/{event_key}` ページ（title / og:title / 埋め込みデータ）から抽出し `whowatch_events.title_ja` にキャッシュする。

**同期先テーブル:** `whowatch_events`  
**ステータス:** `pre` / `open` / `closed` をそのまま `status` カラムに格納  
**同期方式:** events route のオンデマンド同期（`last_synced_at` 鮮度チェック）。旧 n8n 日次同期は 2026-07 廃止済み。

## 倍率仕様

HAR 実測値 (旧 3, 5, 10 は誤情報):

```
[1, 2, 20, 33]
```

33 倍はワンちゃんさん (`ouen_wanchan`) 専用の最大倍率。

## robots.txt 適合

`whowatch.tv/robots.txt` の Disallow パスに `/event_lists` は含まれない。  
クロール間隔: n8n Cron で 1 日 1 回 (JST 0:00)。  
`/playitems/payments3` も同様に Disallow 対象外であることを確認済み。

## 注意事項

- `/events` エンドポイントは 404 を返す (SPA ルーティング)。代わりに `event_lists` を使用。
- `whowatch.tv/events` の HTML embedded-data は SPA 切替後に存在しない — フォールバック経由では events 0 件になる場合がある。DB-first アーキテクチャで回避済み。
- レスポンスサイズ: `/playitems/payments3` 約 430 KB、`/event_lists` 約 1.8 KB。
