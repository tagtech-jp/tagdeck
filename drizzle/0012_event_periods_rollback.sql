-- 0012_event_periods_rollback
BEGIN;
ALTER TABLE "whowatch_events" DROP COLUMN IF EXISTS "periods";
COMMIT;
