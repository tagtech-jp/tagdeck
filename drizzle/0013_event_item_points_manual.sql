-- 0013_event_item_points_manual — Supabase SQL Editor 貼付用（本文は 0013_event_item_points.sql と同一・トランザクション付き）
BEGIN;

CREATE TABLE IF NOT EXISTS "event_item_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" text NOT NULL,
	"item_id" text NOT NULL,
	"base_point" integer NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL
);
DO $$ BEGIN
  ALTER TABLE "event_item_points" ADD CONSTRAINT "event_item_points_event_item_unique" UNIQUE ("event_key", "item_id");
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE "event_item_points" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "event_item_points: read for authenticated" ON "event_item_points";
CREATE POLICY "event_item_points: read for authenticated" ON "event_item_points" FOR SELECT TO authenticated USING (true);
GRANT SELECT ON "event_item_points" TO authenticated;

COMMIT;

-- 適用後の確認
-- SELECT conname FROM pg_constraint WHERE conrelid = 'public.event_item_points'::regclass;
