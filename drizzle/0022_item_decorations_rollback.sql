-- 0022_item_decorations_rollback — テーブルごと削除（同期で作り直せる）。無い間はまとめ投げの段階が判定されず、bulk: の SE は鳴らない
BEGIN;
DROP POLICY IF EXISTS "whowatch_item_decorations: read for authenticated" ON "whowatch_item_decorations";
DROP TABLE IF EXISTS "whowatch_item_decorations";
COMMIT;
