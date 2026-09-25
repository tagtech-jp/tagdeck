-- 0016_item_groups_manual — Supabase SQL Editor 貼付用（本文は 0016_item_groups.sql と同一・トランザクション付き）
BEGIN;

CREATE TABLE IF NOT EXISTS "whowatch_item_groups" (
	"item_id" integer NOT NULL,
	"group_key" text NOT NULL,
	"group_title" text NOT NULL,
	"sub_group_title" text,
	"badge_text" text,
	"display_order" integer,
	"event_key" text,
	"synced_at" timestamptz DEFAULT now() NOT NULL,
	PRIMARY KEY ("item_id", "group_key")
);
ALTER TABLE "whowatch_item_groups" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "whowatch_item_groups: read for authenticated" ON "whowatch_item_groups";
CREATE POLICY "whowatch_item_groups: read for authenticated" ON "whowatch_item_groups" FOR SELECT TO authenticated USING (true);
GRANT SELECT ON "whowatch_item_groups" TO authenticated;

COMMIT;

-- 適用後の確認
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns
--  WHERE table_name = 'whowatch_item_groups' ORDER BY ordinal_position;
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conrelid = 'public.whowatch_item_groups'::regclass;  -- (item_id, group_key) の複合主キー
-- SELECT count(*) FROM whowatch_item_groups;  -- 適用直後は 0 件。同期後の目安: 87 件前後（日次で変動）
