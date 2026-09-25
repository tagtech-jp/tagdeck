-- 0014_live_cockpit_rollback — テーブル・バケットポリシーを取り消す（SE 設定は消える。実行前にバックアップ）
BEGIN;
DROP POLICY IF EXISTS "se: public read" ON storage.objects;
DROP POLICY IF EXISTS "se: own write" ON storage.objects;
DROP POLICY IF EXISTS "se: own update" ON storage.objects;
DROP POLICY IF EXISTS "se: own delete" ON storage.objects;
-- バケット内のオブジェクトは残す（削除は手動）
DROP TABLE IF EXISTS "se_mappings";
DROP TABLE IF EXISTS "whowatch_item_patterns";
COMMIT;
