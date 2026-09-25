-- 0018_se_presets_rollback — テーブルごと削除
-- 注意: 保存済みプリセット（名前・共有コード・割り当てのスナップショット）は消える。取り込み済みの se_mappings には影響しない
--       （取り込みは se_mappings への upsert で完結しており、プリセットを参照し続けない）
BEGIN;
DROP POLICY IF EXISTS "se_presets: public read" ON "se_presets";
DROP POLICY IF EXISTS "se_presets: own rows" ON "se_presets";
DROP TABLE IF EXISTS "se_presets";
COMMIT;
