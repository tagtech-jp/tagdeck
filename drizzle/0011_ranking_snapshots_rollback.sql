-- 0011_ranking_snapshots_rollback — テーブルごと削除（スナップショットは消える。実行前にバックアップ）
BEGIN;
DROP POLICY IF EXISTS "ranking_snapshots: own simulator rows only" ON "ranking_snapshots";
DROP INDEX IF EXISTS "ranking_snapshots_simulator_captured_idx";
DROP TABLE IF EXISTS "ranking_snapshots";
COMMIT;
