-- 0013_event_item_points_rollback — テーブルごと削除（手入力値は消える。実行前にバックアップ）
BEGIN;
DROP POLICY IF EXISTS "event_item_points: read for authenticated" ON "event_item_points";
DROP TABLE IF EXISTS "event_item_points";
COMMIT;
