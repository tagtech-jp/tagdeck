-- 0009_users_auth_sync ロールバック
-- 適用: Supabase SQL Editor で全文を実行。
-- 注意:
--   * バックフィルで作られた public.users 行は削除しない（他テーブルから参照され得るため）。
--   * (3) の NOT NULL / UNIQUE 復元は、email が NULL の行や重複行が存在すると失敗する。
--     その場合は先に該当行を確認し、社長判断で email を埋めるか行を残すか決めてから実行する。

-- (1) トリガーと関数を除去（サインアップは影響なく継続する）
DROP TRIGGER IF EXISTS "on_auth_user_created" ON "auth"."users";
--> statement-breakpoint
DROP FUNCTION IF EXISTS "public"."handle_new_auth_user"();
--> statement-breakpoint

-- (2) 部分一意インデックスを除去
DROP INDEX IF EXISTS "public"."users_email_unique";
--> statement-breakpoint

-- (3) 旧制約を復元（NULL / 重複が無い場合のみ成功する）
--   事前確認: SELECT count(*) FROM public.users WHERE email IS NULL;   -- 0 であること
--             SELECT email, count(*) FROM public.users GROUP BY email HAVING count(*) > 1;  -- 0 行であること
ALTER TABLE "public"."users" ADD CONSTRAINT "users_email_unique" UNIQUE ("email");
--> statement-breakpoint
ALTER TABLE "public"."users" ALTER COLUMN "email" SET NOT NULL;
