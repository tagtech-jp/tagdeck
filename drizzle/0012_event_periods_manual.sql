-- 0012_event_periods_manual — Supabase SQL Editor 貼付用（本文は 0012_event_periods.sql と同一・トランザクション付き）
BEGIN;
ALTER TABLE "whowatch_events" ADD COLUMN IF NOT EXISTS "periods" jsonb DEFAULT NULL;
COMMIT;

-- 適用後の確認
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'whowatch_events' AND column_name = 'periods';
