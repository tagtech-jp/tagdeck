-- 0018_se_presets_manual — Supabase SQL Editor 貼付用（本文は 0018_se_presets.sql と同一・トランザクション付き）
BEGIN;

CREATE TABLE IF NOT EXISTS "se_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"share_code" text NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"mappings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mapping_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL
);
DO $$ BEGIN
  ALTER TABLE "se_presets" ADD CONSTRAINT "se_presets_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "se_presets" ADD CONSTRAINT "se_presets_share_code_unique" UNIQUE ("share_code");
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "se_presets_owner_idx" ON "se_presets" ("owner_user_id");
ALTER TABLE "se_presets" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "se_presets: own rows" ON "se_presets";
CREATE POLICY "se_presets: own rows" ON "se_presets" FOR ALL TO authenticated USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());
DROP POLICY IF EXISTS "se_presets: public read" ON "se_presets";
CREATE POLICY "se_presets: public read" ON "se_presets" FOR SELECT TO authenticated USING (is_public = true);
GRANT SELECT, INSERT, UPDATE, DELETE ON "se_presets" TO authenticated;

COMMIT;

-- 適用後の確認
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'se_presets' ORDER BY ordinal_position;  -- 10 列
-- SELECT policyname FROM pg_policies WHERE tablename = 'se_presets';  -- "se_presets: own rows" / "se_presets: public read"
-- 画面で保存後: SELECT name, share_code, is_public, mapping_count, updated_at FROM se_presets ORDER BY updated_at DESC LIMIT 5;
