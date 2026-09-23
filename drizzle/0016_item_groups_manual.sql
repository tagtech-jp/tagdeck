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

-- CREATE TABLE IF NOT EXISTS は既存テーブルに列を足さない。5 列版を適用済みの DB を 8 列に揃える
ALTER TABLE "whowatch_item_groups" ADD COLUMN IF NOT EXISTS "sub_group_title" text;
ALTER TABLE "whowatch_item_groups" ADD COLUMN IF NOT EXISTS "badge_text" text;
ALTER TABLE "whowatch_item_groups" ADD COLUMN IF NOT EXISTS "display_order" integer;

ALTER TABLE "whowatch_item_groups" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "whowatch_item_groups: read for authenticated" ON "whowatch_item_groups";
CREATE POLICY "whowatch_item_groups: read for authenticated" ON "whowatch_item_groups" FOR SELECT TO authenticated USING (true);
GRANT SELECT ON "whowatch_item_groups" TO authenticated;

COMMIT;

-- 適用結果の確認（コメントアウトしない。列が揃ったことを必ず目視する）
-- 期待: 8 行（item_id / group_key / group_title / sub_group_title / badge_text / display_order / event_key / synced_at）
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_name = 'whowatch_item_groups'
 ORDER BY ordinal_position;
