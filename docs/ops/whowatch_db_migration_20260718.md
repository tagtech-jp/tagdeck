# 【社長作業】whowatch 統一 — DB rename migration 適用手順書 (2026-07-18)

> 作成: Claude Code（TagTech / Fable 5 セッション 20260718・P4 成果物）
> **本手順書の SQL は生成・検証済みだが未適用。適用は社長のみが実施する（CC は本番 Supabase に接続しない）。**

---

## ⚠️ 最重要警告

1. **適用前バックアップ必須**（手順1）。RENAME 自体は可逆だが、platform 値の UPDATE は適用前状態の記録がないと巻き戻し確認ができない
2. **本 SQL と本ブランチのコードは同時切替が前提**。SQL だけ先に適用すると現行 main のコード（旧列名参照）が壊れ、コードだけ先にデプロイすると新列名参照で壊れる。推奨順序は下記「全体の流れ」
3. `whowatch_events`（旧 fuwacchi_events）と `item_point_mapping` は **Drizzle 管理外**のため、`supabase_whowatch_rename_manual.sql` は drizzle-kit の検知対象外。0007 とセットで必ず両方適用する

## 全体の流れ（env 手順書と合わせた推奨シーケンス）

```
1. Secrets 並存追加（docs/ops/whowatch_env_migration_20260718.md 手順1）
2. メンテナンス時間帯を選ぶ（配信中を避ける）
3. 本手順書 手順1: バックアップ
4. 本手順書 手順2: SQL 適用（0007 → manual の順）
5. 本手順書 手順3: 確認クエリ
6. PR マージ → 自動デプロイ（コード切替）
7. tagdeck.jp 動作確認 → env 手順書 手順3（旧名 Secrets 削除）
```

手順4〜6 の間は旧コード（旧列名参照）が新スキーマに当たるため、ふわっち関連機能が一時的にエラーになる。短時間で 6 まで進めること（目安: 30分以内）。

---

## 手順1: バックアップ（Supabase SQL Editor で実行し、結果を CSV エクスポート）

```sql
-- 対象テーブルの適用前スナップショット
SELECT * FROM streamer_profiles;
SELECT * FROM event_simulators;
SELECT * FROM listeners;
SELECT * FROM events;
SELECT * FROM event_history;
SELECT * FROM fuwacchi_events;
SELECT * FROM item_point_mapping;

-- 加えて件数を記録（適用後の突合に使用）
SELECT
  (SELECT count(*) FROM listeners        WHERE platform = 'fuwacchi') AS listeners_fuwacchi,
  (SELECT count(*) FROM events           WHERE platform = 'fuwacchi') AS events_fuwacchi,
  (SELECT count(*) FROM event_simulators WHERE platform = 'fuwacchi') AS simulators_fuwacchi,
  (SELECT count(*) FROM event_history    WHERE platform = 'fuwacchi') AS history_fuwacchi,
  (SELECT count(*) FROM item_point_mapping WHERE platform = 'fuwacchi') AS items_fuwacchi,
  (SELECT count(*) FROM fuwacchi_events) AS fuwacchi_events_rows;
```

Supabase ダッシュボードの Database → Backups で直近の自動バックアップが存在することも確認する。

## 手順2: SQL 適用（この順で2ファイル）

1. `drizzle/0007_whowatch_rename.sql` の全文を Supabase SQL Editor に貼り付けて実行
   （Drizzle 管理テーブル: streamer_profiles 8列 rename / event_simulators 列 rename + default 変更 / platform 値 UPDATE 4テーブル）
2. `supabase_whowatch_rename_manual.sql` の全文を実行
   （fuwacchi_events → whowatch_events テーブル rename / RLS ポリシー名 rename / item_point_mapping の platform 値 UPDATE）

両ファイルとも冪等（存在チェック付き）のため、エラー中断後の再実行は安全。

## 手順3: 適用後の確認クエリ

```sql
-- ① 新列名の存在確認（8行返れば OK）
SELECT column_name FROM information_schema.columns
WHERE table_name = 'streamer_profiles' AND column_name LIKE 'whowatch%' ORDER BY column_name;

-- ② 旧列名の残存ゼロ確認（0行なら OK）
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema = 'public' AND column_name LIKE 'fuwacchi%';

-- ③ テーブル rename 確認（whowatch_events が存在し fuwacchi_events が無いこと）
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('fuwacchi_events', 'whowatch_events');

-- ④ platform 値の移行確認（fuwacchi が全テーブルで 0、whowatch が手順1の記録件数と一致すれば OK）
SELECT
  (SELECT count(*) FROM listeners        WHERE platform = 'fuwacchi') AS listeners_old,
  (SELECT count(*) FROM listeners        WHERE platform = 'whowatch') AS listeners_new,
  (SELECT count(*) FROM events           WHERE platform = 'fuwacchi') AS events_old,
  (SELECT count(*) FROM events           WHERE platform = 'whowatch') AS events_new,
  (SELECT count(*) FROM event_simulators WHERE platform = 'fuwacchi') AS sim_old,
  (SELECT count(*) FROM event_simulators WHERE platform = 'whowatch') AS sim_new,
  (SELECT count(*) FROM item_point_mapping WHERE platform = 'fuwacchi') AS item_old,
  (SELECT count(*) FROM item_point_mapping WHERE platform = 'whowatch') AS item_new;

-- ⑤ FK の追従確認（event_simulators.whowatch_event_id → whowatch_events.id）
SELECT conname, conrelid::regclass AS table_from, confrelid::regclass AS table_to
FROM pg_constraint WHERE confrelid = 'whowatch_events'::regclass;

-- ⑥ RLS ポリシー確認
SELECT policyname FROM pg_policies WHERE tablename = 'whowatch_events';
```

## ロールバック（必要時のみ）

逆順で2ファイルを実行:
1. `supabase_whowatch_rename_manual_rollback.sql`
2. `supabase_whowatch_rename_0007_rollback.sql`

その後、コードを旧構成（main の whowatch 統一前）に戻す。

## 補足

- `_journal.json` には idx 7 として `0007_whowatch_rename` を登録済み。snapshot JSON は既存方針（`docs/decisions/drizzle_snapshot_reconcile_postponed_20260526.md` 案δ）に従い drizzle-kit 1.0 stable 待ちで未生成（0004〜0006 と同じ状態）
- 検証状況: 4 SQL ファイルとも構造検証（DO/END・IF/END IF・クォート・括弧バランス）PASS。**実 DB での実行検証は未実施**（本番接続禁止規律のため）。Supabase SQL Editor はトランザクション単位実行のため、エラー時はその文で停止し以降は未適用となる（冪等設計により再実行で継続可能）
- n8n 日次同期スクリプト（`scripts/platforms/whowatch/sync_items_and_events.py`）は新テーブル名 `whowatch_events` を参照するよう変更済み。**本 SQL 適用前に旧構成のまま実行されると失敗する**（n8n 廃止方向のため影響は限定的だが、スケジュール実行が残っている場合は適用まで停止推奨）

## 改訂履歴

| 版 | 日付 | 改訂内容 |
|---|---|---|
| 1.0 | 2026-07-18 | 初版（P4 成果物・SQL 生成/構造検証まで。適用は社長判断） |
