-- 0024_se_storage_list_own — SE 音源バケット（se）の「一覧」を本人の分だけに絞る（2026-10-08 セキュリティ監査）
-- 背景: 0014 の "se: public read" は storage.objects の SELECT を bucket_id = 'se' の全行に（TO 句なし＝anon を含む全ロールへ）許していた。
--       公開バケットの「ダウンロード」（/storage/v1/object/public/se/...）はこの SELECT ポリシーに関係なく誰でもできるが、
--       SELECT ポリシーは「一覧」（POST /storage/v1/object/list/se）に効くため、ブラウザのバンドルに入っている匿名キーだけで
--       全利用者のアップロード済み音源のパス（{user_id}/{key}_{時刻}.{拡張子}。利用者の auth.users.id と SE 割り当てのキーが分かる）を
--       列挙できる状態だった。TagDeck は一覧の API を使っていない（src/app/api/se/upload/route.ts は upload と getPublicUrl だけ）。
-- 変更: 一覧できるのはログイン中の本人の階層（先頭フォルダ = auth.uid()）だけにする。アップロード（INSERT・upsert の UPDATE）と
--       公開 URL でのダウンロードはこれまでどおり
-- 適用: Supabase SQL Editor で drizzle/0024_se_storage_list_own_manual.sql を実行（docs/migration-runbook.md）
-- ロールバック: drizzle/0024_se_storage_list_own_rollback.sql
-- 冪等: DROP POLICY IF EXISTS → CREATE POLICY
DROP POLICY IF EXISTS "se: public read" ON storage.objects;
--> statement-breakpoint
DROP POLICY IF EXISTS "se: own read" ON storage.objects;
--> statement-breakpoint
CREATE POLICY "se: own read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'se' AND (storage.foldername(name))[1] = auth.uid()::text);
