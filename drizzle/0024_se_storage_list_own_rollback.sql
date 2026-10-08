-- 0024_se_storage_list_own_rollback — se バケットの一覧を 0014 のとおり全ロールに戻す（匿名キーで全利用者の音源パスを列挙できる状態に戻る）
BEGIN;
DROP POLICY IF EXISTS "se: own read" ON storage.objects;
DROP POLICY IF EXISTS "se: public read" ON storage.objects;
CREATE POLICY "se: public read" ON storage.objects FOR SELECT USING (bucket_id = 'se');
COMMIT;
