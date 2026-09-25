-- ROLLBACK: drizzle/0008_whowatch_event_title.sql の巻き戻し (2026-07-19)
-- 適用方法: Supabase SQL Editor で手動実行（社長作業）
-- 注意: 適用後は feat/tagdeck-event-picker-ja-20260719 のコードを本番から外すこと
--       （コードが started_at / title_ja を参照するため）
-- 冪等: DROP COLUMN IF EXISTS

ALTER TABLE "whowatch_events" DROP COLUMN IF EXISTS "title_ja";
--> statement-breakpoint
ALTER TABLE "whowatch_events" DROP COLUMN IF EXISTS "started_at";
