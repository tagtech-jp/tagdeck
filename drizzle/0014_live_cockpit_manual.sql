-- 0014_live_cockpit_manual — Supabase SQL Editor 貼付用（本文は 0014_live_cockpit.sql と同一・トランザクション付き）
BEGIN;
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
CREATE INDEX IF NOT EXISTS "whowatch_item_patterns_item_idx" ON "whowatch_item_patterns" ("item_id");
ALTER TABLE "whowatch_item_patterns" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "whowatch_item_patterns: read for authenticated" ON "whowatch_item_patterns";
CREATE POLICY "whowatch_item_patterns: read for authenticated" ON "whowatch_item_patterns" FOR SELECT TO authenticated USING (true);
GRANT SELECT ON "whowatch_item_patterns" TO authenticated;
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
DO $$ BEGIN
  ALTER TABLE "se_mappings" ADD CONSTRAINT "se_mappings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "se_mappings" ADD CONSTRAINT "se_mappings_user_key_unique" UNIQUE ("user_id", "key");
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE "se_mappings" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "se_mappings: own rows" ON "se_mappings";
CREATE POLICY "se_mappings: own rows" ON "se_mappings" FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
GRANT SELECT, INSERT, UPDATE, DELETE ON "se_mappings" TO authenticated;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('se', 'se', true, 5242880, ARRAY['audio/mpeg','audio/mp3','audio/ogg','audio/wav','audio/x-wav','audio/wave'])
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
DROP POLICY IF EXISTS "se: public read" ON storage.objects;
CREATE POLICY "se: public read" ON storage.objects FOR SELECT USING (bucket_id = 'se');
DROP POLICY IF EXISTS "se: own write" ON storage.objects;
CREATE POLICY "se: own write" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'se' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "se: own update" ON storage.objects;
CREATE POLICY "se: own update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'se' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "se: own delete" ON storage.objects;
CREATE POLICY "se: own delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'se' AND (storage.foldername(name))[1] = auth.uid()::text);

COMMIT;

-- 適用後の確認
-- SELECT count(*) FROM whowatch_item_patterns;  -- 同期後 4000 件超
-- SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'se';
