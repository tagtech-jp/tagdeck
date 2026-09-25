-- 0016_item_groups_rollback — テーブルごと削除（同期で作り直せるので手入力値の損失は無い）
-- 注意: この列を消すと SE タブのカテゴリープルダウンは「販売終了・その他」だけになる。
--       se_mappings の cat:group: の行は参照されないまま残る（動作に影響は無い）
BEGIN;
DROP POLICY IF EXISTS "whowatch_item_groups: read for authenticated" ON "whowatch_item_groups";
DROP TABLE IF EXISTS "whowatch_item_groups";
COMMIT;
