-- 0010_event_detail_manual — Supabase SQL Editor 貼付用（本文は 0010_event_detail.sql と同一・トランザクション付き）
BEGIN;

ALTER TABLE "whowatch_events" ADD COLUMN IF NOT EXISTS "name" text;
ALTER TABLE "whowatch_events" ADD COLUMN IF NOT EXISTS "short_name" text;
ALTER TABLE "whowatch_events" ADD COLUMN IF NOT EXISTS "kind" text;
ALTER TABLE "whowatch_events" ADD COLUMN IF NOT EXISTS "ranking_prefix" text;
ALTER TABLE "whowatch_events" ADD COLUMN IF NOT EXISTS "struct" jsonb DEFAULT NULL;
ALTER TABLE "whowatch_events" ADD COLUMN IF NOT EXISTS "rules_html" text;
ALTER TABLE "whowatch_events" ADD COLUMN IF NOT EXISTS "rules_text" text;
ALTER TABLE "whowatch_events" ADD COLUMN IF NOT EXISTS "rules_parsed" jsonb DEFAULT NULL;
ALTER TABLE "whowatch_events" ADD COLUMN IF NOT EXISTS "detail_fetched_at" timestamptz;
CREATE INDEX IF NOT EXISTS "whowatch_events_event_key_idx" ON "whowatch_events" ("event_key");
ALTER TABLE "event_simulators" ADD COLUMN IF NOT EXISTS "ranking_type" text;

COMMIT;

-- 適用後の確認
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name = 'whowatch_events' AND column_name IN ('name','kind','ranking_prefix','struct','rules_text','detail_fetched_at');
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'event_simulators' AND column_name = 'ranking_type';
