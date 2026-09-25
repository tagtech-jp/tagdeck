-- 0009_users_auth_sync — Supabase SQL Editor 貼付用（トランザクション付き）
-- 元ファイル: drizzle/0009_users_auth_sync.sql（drizzle-kit 管理用。内容は同一で breakpoint 区切りのみ異なる）
-- ロールバック: drizzle/0009_users_auth_sync_rollback.sql
-- 適用前バックアップ: docs/backup/users_before_0009.sql
--
-- 途中でエラーになった場合は全体がロールバックされ、何も適用されない。
-- 特に auth.users へのトリガー作成が権限エラーになった場合は、エラー全文を控えて停止すること。

BEGIN;

-- (a) users.email を NULL 許容化し、UNIQUE 制約を部分一意インデックスに置き換える。
--     メール無しの OAuth ユーザー（X ログイン等）を空文字で登録して衝突するのを防ぐ。
ALTER TABLE "public"."users" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "public"."users" DROP CONSTRAINT IF EXISTS "users_email_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_unique"
  ON "public"."users" ("email")
  WHERE "email" IS NOT NULL;

-- (b) auth.users への INSERT をトリガーに public.users へ行を作成する。
--     失敗してもサインアップ自体を止めないため、例外は握って WARNING のみ出す。
CREATE OR REPLACE FUNCTION "public"."handle_new_auth_user"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  BEGIN
    INSERT INTO "public"."users" ("id", "email", "display_name")
    VALUES (
      NEW.id,
      NULLIF(NEW.email, ''),
      NULLIF(NEW.raw_user_meta_data ->> 'display_name', '')
    )
    ON CONFLICT ("id") DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    -- 例: email の部分一意インデックス衝突。サインアップは通し、アプリ側の ensureUserRow に委ねる
    RAISE WARNING 'handle_new_auth_user: user % skipped: % (SQLSTATE %)', NEW.id, SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION "public"."handle_new_auth_user"() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS "on_auth_user_created" ON "auth"."users";
CREATE TRIGGER "on_auth_user_created"
  AFTER INSERT ON "auth"."users"
  FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_auth_user"();

-- (c) バックフィル: auth.users にあって public.users に無いユーザーを作成する。
--     既存の public.users 行は一切変更しない。
INSERT INTO "public"."users" ("id", "email", "display_name", "created_at")
SELECT
  a.id,
  NULLIF(a.email, ''),
  NULLIF(a.raw_user_meta_data ->> 'display_name', ''),
  a.created_at
FROM "auth"."users" a
WHERE NOT EXISTS (SELECT 1 FROM "public"."users" u WHERE u.id = a.id)
ON CONFLICT ("id") DO NOTHING;

COMMIT;
