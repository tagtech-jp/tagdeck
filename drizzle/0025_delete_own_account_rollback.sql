-- 0025_delete_own_account_rollback — 退会の関数を落とす（消したデータは戻らない。復元は Supabase のバックアップから）。
-- コードを戻す（PR の revert）のが先。関数だけ落とすと POST /api/account/delete は 503（準備中）になり、画面に「準備中」と出る
BEGIN;
DROP FUNCTION IF EXISTS public.delete_own_account();
NOTIFY pgrst, 'reload schema';
COMMIT;

-- 確認（コメントアウトしない）: 0 が返れば落ちている
SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'delete_own_account';
