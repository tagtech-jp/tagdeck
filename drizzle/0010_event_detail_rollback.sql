-- 0010_event_detail_rollback — 追加列とインデックスを取り消す（データ消失を伴うため実行前にバックアップ）
BEGIN;
DROP INDEX IF EXISTS "whowatch_events_event_key_idx";
ALTER TABLE "whowatch_events" DROP COLUMN IF EXISTS "detail_fetched_at";
ALTER TABLE "whowatch_events" DROP COLUMN IF EXISTS "rules_parsed";
ALTER TABLE "whowatch_events" DROP COLUMN IF EXISTS "rules_text";
ALTER TABLE "whowatch_events" DROP COLUMN IF EXISTS "rules_html";
ALTER TABLE "whowatch_events" DROP COLUMN IF EXISTS "struct";
ALTER TABLE "whowatch_events" DROP COLUMN IF EXISTS "ranking_prefix";
ALTER TABLE "whowatch_events" DROP COLUMN IF EXISTS "kind";
ALTER TABLE "whowatch_events" DROP COLUMN IF EXISTS "short_name";
ALTER TABLE "whowatch_events" DROP COLUMN IF EXISTS "name";
ALTER TABLE "event_simulators" DROP COLUMN IF EXISTS "ranking_type";
COMMIT;
