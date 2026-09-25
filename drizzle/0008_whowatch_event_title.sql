-- 0008_whowatch_event_title — whowatch_events に started_at / title_ja 列を追加
-- 適用方法: Supabase SQL Editor で手動実行（社長作業 / docs/ops/whowatch_event_title_migration_20260719.md 参照）
-- ⚠️ 本ファイルは feat/tagdeck-event-picker-ja-20260719 のコードと同時切替が前提。
--    コード（schema.ts / events route / sync）は started_at / title_ja 列を参照するため、
--    本 SQL 適用前のマージ・デプロイは禁止（7/19 順序逆転ヒヤリの再発防止）。
-- ROLLBACK: supabase_whowatch_event_title_0008_rollback.sql
-- 冪等: ADD COLUMN IF NOT EXISTS（再実行安全）

ALTER TABLE "whowatch_events" ADD COLUMN IF NOT EXISTS "started_at" timestamp;
--> statement-breakpoint
ALTER TABLE "whowatch_events" ADD COLUMN IF NOT EXISTS "title_ja" text;
