-- 0010_event_detail — イベント勝率シミュレーター E1
-- 目的: whowatch_events にイベント詳細（名前・区分・ランキング構造・ルール本文）のキャッシュ列を追加し、
--       event_simulators にランキング区分キー ranking_type を追加する。列の削除・変更は無し（追加のみ）。
-- 適用: Supabase SQL Editor で drizzle/0010_event_detail_manual.sql（BEGIN/COMMIT 付き）を実行（docs/migration-runbook.md）。
-- ロールバック: drizzle/0010_event_detail_rollback.sql
-- 冪等: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS

ALTER TABLE "whowatch_events" ADD COLUMN IF NOT EXISTS "name" text;
--> statement-breakpoint
ALTER TABLE "whowatch_events" ADD COLUMN IF NOT EXISTS "short_name" text;
--> statement-breakpoint
ALTER TABLE "whowatch_events" ADD COLUMN IF NOT EXISTS "kind" text;
--> statement-breakpoint
ALTER TABLE "whowatch_events" ADD COLUMN IF NOT EXISTS "ranking_prefix" text;
--> statement-breakpoint
ALTER TABLE "whowatch_events" ADD COLUMN IF NOT EXISTS "struct" jsonb DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE "whowatch_events" ADD COLUMN IF NOT EXISTS "rules_html" text;
--> statement-breakpoint
ALTER TABLE "whowatch_events" ADD COLUMN IF NOT EXISTS "rules_text" text;
--> statement-breakpoint
ALTER TABLE "whowatch_events" ADD COLUMN IF NOT EXISTS "rules_parsed" jsonb DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE "whowatch_events" ADD COLUMN IF NOT EXISTS "detail_fetched_at" timestamptz;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whowatch_events_event_key_idx" ON "whowatch_events" ("event_key");
--> statement-breakpoint
ALTER TABLE "event_simulators" ADD COLUMN IF NOT EXISTS "ranking_type" text;
