-- 0024_se_storage_list_own_manual — Supabase SQL Editor 貼付用（本文は 0024_se_storage_list_own.sql と同一・トランザクション付き）
BEGIN;

DROP POLICY IF EXISTS "se: public read" ON storage.objects;
DROP POLICY IF EXISTS "se: own read" ON storage.objects;
CREATE POLICY "se: own read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'se' AND (storage.foldername(name))[1] = auth.uid()::text);

COMMIT;

-- 確認（コメントアウトしない）: se バケットの SELECT ポリシーが "se: own read" の 1 行だけで、roles が {authenticated} なら適用済み。
-- "se: public read" が残っている、または roles が {public} なら、PR をマージせずにこの結果をそのまま報告する
SELECT policyname, roles, cmd, qual
  FROM pg_policies
 WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd = 'SELECT' AND qual LIKE '%''se''%'
 ORDER BY policyname;

-- 適用後の動作確認（ブラウザで）: /live の SE タブで音源を 1 本アップロードし、鳴ること（公開 URL のダウンロード）と
-- 「既定に戻す」で消えることを確かめる。匿名キーでの一覧（POST /storage/v1/object/list/se）が [] になることも確認
