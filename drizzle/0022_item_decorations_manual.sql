-- 0022_item_decorations_manual — Supabase SQL Editor 貼付用（本文は 0022_item_decorations.sql と同一・トランザクション付き）
BEGIN;

CREATE TABLE IF NOT EXISTS "whowatch_item_decorations" (
	"item_id" integer PRIMARY KEY NOT NULL,
	"item_name" text DEFAULT '' NOT NULL,
	"decorations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pattern_limit" integer,
	"synced_at" timestamptz DEFAULT now() NOT NULL
);
ALTER TABLE "whowatch_item_decorations" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "whowatch_item_decorations: read for authenticated" ON "whowatch_item_decorations";
CREATE POLICY "whowatch_item_decorations: read for authenticated" ON "whowatch_item_decorations" FOR SELECT TO authenticated USING (true);
GRANT SELECT ON "whowatch_item_decorations" TO authenticated;

COMMIT;

-- 適用後: GitHub Actions「Whowatch item patterns sync (manual)」を 1 回実行（応答の decorations.rows がアイテム数、withGrades がしきい値ありの数）
-- 確認: SELECT item_id, item_name, decorations FROM whowatch_item_decorations ORDER BY item_id LIMIT 20;
