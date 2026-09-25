-- 0014_live_cockpit — S1（SE タブ・ふわっちギフト取得）
-- 目的: (a) /playitems のアイテムパターン（当たり判定に必須）を保存する whowatch_item_patterns
--       (b) ユーザーごとの SE 割り当て se_mappings
-- 適用: Supabase SQL Editor で drizzle/0014_live_cockpit_manual.sql を実行（docs/migration-runbook.md）。
-- ロールバック: drizzle/0014_live_cockpit_rollback.sql
-- 冪等: CREATE TABLE IF NOT EXISTS / DO $$ … duplicate_object

CREATE TABLE IF NOT EXISTS "whowatch_item_patterns" (
	"pattern_id" integer PRIMARY KEY NOT NULL,
	"item_id" integer NOT NULL,
	"item_name" text NOT NULL,
	"pattern_name" text NOT NULL,
	"quantity" integer,
	"is_hit" boolean DEFAULT false NOT NULL,
	"hit_grade" text,
	"is_variant" boolean DEFAULT false NOT NULL,
	"image_url" text,
	"animation_url" text,
	"sound_url" text,
	"synced_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whowatch_item_patterns_item_idx" ON "whowatch_item_patterns" ("item_id");
--> statement-breakpoint
ALTER TABLE "whowatch_item_patterns" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "whowatch_item_patterns: read for authenticated" ON "whowatch_item_patterns";
--> statement-breakpoint
CREATE POLICY "whowatch_item_patterns: read for authenticated" ON "whowatch_item_patterns" FOR SELECT TO authenticated USING (true);
--> statement-breakpoint
GRANT SELECT ON "whowatch_item_patterns" TO authenticated;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "se_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"url" text,
	"volume" integer DEFAULT 80 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"label" text,
	"updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "se_mappings" ADD CONSTRAINT "se_mappings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "se_mappings" ADD CONSTRAINT "se_mappings_user_key_unique" UNIQUE ("user_id", "key");
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
ALTER TABLE "se_mappings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "se_mappings: own rows" ON "se_mappings";
--> statement-breakpoint
CREATE POLICY "se_mappings: own rows" ON "se_mappings" FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "se_mappings" TO authenticated;
--> statement-breakpoint
-- Storage: SE 音源バケット（公開読み取り・本人のみ書き込み、パスは {user_id}/…）
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('se', 'se', true, 5242880, ARRAY['audio/mpeg','audio/mp3','audio/ogg','audio/wav','audio/x-wav','audio/wave'])
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
--> statement-breakpoint
DROP POLICY IF EXISTS "se: public read" ON storage.objects;
--> statement-breakpoint
CREATE POLICY "se: public read" ON storage.objects FOR SELECT USING (bucket_id = 'se');
--> statement-breakpoint
DROP POLICY IF EXISTS "se: own write" ON storage.objects;
--> statement-breakpoint
CREATE POLICY "se: own write" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'se' AND (storage.foldername(name))[1] = auth.uid()::text);
--> statement-breakpoint
DROP POLICY IF EXISTS "se: own update" ON storage.objects;
--> statement-breakpoint
CREATE POLICY "se: own update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'se' AND (storage.foldername(name))[1] = auth.uid()::text);
--> statement-breakpoint
DROP POLICY IF EXISTS "se: own delete" ON storage.objects;
--> statement-breakpoint
CREATE POLICY "se: own delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'se' AND (storage.foldername(name))[1] = auth.uid()::text);
