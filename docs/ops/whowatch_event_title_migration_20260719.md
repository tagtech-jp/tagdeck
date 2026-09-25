# 【社長作業】whowatch_events 列追加（started_at / title_ja）適用手順書 (2026-07-19)

> 作成: Claude Code（TagTech）／ブランチ: `feat/tagdeck-event-picker-ja-20260719`
> **SQL は生成・検証済みだが未適用。適用は社長のみ（CC は本番 Supabase 非接触）。**

## ⚠️ 順序厳守（7/19 順序逆転ヒヤリの再発防止）

本ブランチのコード（`schema.ts` / events route / sync）は `whowatch_events.started_at` と `title_ja` 列を参照する。**SQL 適用前に本ブランチをマージ／デプロイしてはならない**。順序は下記チェックリストの通り。

## 対象

| 列 | 型 | 用途 |
|---|---|---|
| `started_at` | `timestamp` | イベント開始時刻（event_lists の epoch ms を変換して格納） |
| `title_ja` | `text` | events/{event_key} ページから抽出した日本語イベント名のキャッシュ（null 可） |

## 手順

### 1. バックアップ（任意・列追加のみのため低リスク）
```sql
SELECT count(*) FROM whowatch_events;   -- 行数を記録
```
`ADD COLUMN` は既存データを破壊しないため、Supabase の自動バックアップ確認で十分。

### 2. SQL 適用
`drizzle/0008_whowatch_event_title.sql` の全文を Supabase SQL Editor で実行（冪等・再実行安全）。

### 3. 確認クエリ（**期待結果と一致するまで次工程に進まない**）
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'whowatch_events'
  AND column_name IN ('started_at', 'title_ja')
ORDER BY column_name;
```
**期待結果: 2 行**
| column_name | data_type |
|---|---|
| started_at | timestamp without time zone |
| title_ja | text |

2 行が返らない場合は SQL 適用が未完。**この時点で停止し、マージに進まない。**

### 4. ロールバック（必要時のみ）
`supabase_whowatch_event_title_0008_rollback.sql` を実行 → コードを本番から外す。

## 補足
- `_journal.json` に idx 8 として `0008_whowatch_event_title` を登録済み。snapshot JSON は既存方針（`docs/decisions/drizzle_snapshot_reconcile_postponed_20260526.md` 案δ）に従い未生成
- 検証状況: SQL 構造チェック（ALTER 文法・冪等）済み。**実 DB 実行検証は未実施**（本番接続禁止規律のため）
