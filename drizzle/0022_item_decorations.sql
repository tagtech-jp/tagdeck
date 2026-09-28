-- 0022_item_decorations — まとめ投げの段階しきい値（クール / グレート / ファンタスティック / ミラクル）（2026-09-28）
-- 背景: ふわっちはアイテムごとの pattern_decorations（{count, COOL|GREAT|FANTASTIC|MIRACLE…}）で段階を決める。
--       GET /lives/{id}/playitems3（認証不要）から取って別テーブルに持ち、SE の「まとめ投げ段階ごとの音」に使う。
-- 適用: Supabase SQL Editor で drizzle/0022_item_decorations_manual.sql を実行（docs/migration-runbook.md）
-- ロールバック: drizzle/0022_item_decorations_rollback.sql
-- 冪等: CREATE TABLE IF NOT EXISTS
-- 書き込み: POST /api/platforms/whowatch/items/sync（DATABASE_URL 直結・RLS 対象外）。ブラウザからは authenticated の SELECT のみ
CREATE TABLE IF NOT EXISTS "whowatch_item_decorations" (
	"item_id" integer PRIMARY KEY NOT NULL,
	"item_name" text DEFAULT '' NOT NULL,
	"decorations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pattern_limit" integer,
	"synced_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whowatch_item_decorations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "whowatch_item_decorations: read for authenticated" ON "whowatch_item_decorations";
--> statement-breakpoint
CREATE POLICY "whowatch_item_decorations: read for authenticated" ON "whowatch_item_decorations" FOR SELECT TO authenticated USING (true);
--> statement-breakpoint
GRANT SELECT ON "whowatch_item_decorations" TO authenticated;
