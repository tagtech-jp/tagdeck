-- =============================================
-- ROLLBACK: drizzle/0007_whowatch_rename.sql の巻き戻し (2026-07-18)
-- 適用方法: Supabase SQL Editor で手動実行（社長作業）
-- 注意: 本ロールバック適用後は旧コード（main の whowatch 統一前）に戻すこと
-- 冪等: 列存在チェック付き
-- =============================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'streamer_profiles' AND column_name = 'whowatch_user_id') THEN
    ALTER TABLE "streamer_profiles" RENAME COLUMN "whowatch_user_id" TO "fuwacchi_user_id";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'streamer_profiles' AND column_name = 'whowatch_live_id') THEN
    ALTER TABLE "streamer_profiles" RENAME COLUMN "whowatch_live_id" TO "fuwacchi_live_id";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'streamer_profiles' AND column_name = 'whowatch_is_monitoring') THEN
    ALTER TABLE "streamer_profiles" RENAME COLUMN "whowatch_is_monitoring" TO "fuwacchi_is_monitoring";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'streamer_profiles' AND column_name = 'whowatch_monitoring_started_at') THEN
    ALTER TABLE "streamer_profiles" RENAME COLUMN "whowatch_monitoring_started_at" TO "fuwacchi_monitoring_started_at";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'streamer_profiles' AND column_name = 'whowatch_last_polled_at') THEN
    ALTER TABLE "streamer_profiles" RENAME COLUMN "whowatch_last_polled_at" TO "fuwacchi_last_polled_at";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'streamer_profiles' AND column_name = 'whowatch_viewer_count') THEN
    ALTER TABLE "streamer_profiles" RENAME COLUMN "whowatch_viewer_count" TO "fuwacchi_viewer_count";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'streamer_profiles' AND column_name = 'whowatch_current_points') THEN
    ALTER TABLE "streamer_profiles" RENAME COLUMN "whowatch_current_points" TO "fuwacchi_current_points";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'streamer_profiles' AND column_name = 'whowatch_peak_viewer_count') THEN
    ALTER TABLE "streamer_profiles" RENAME COLUMN "whowatch_peak_viewer_count" TO "fuwacchi_peak_viewer_count";
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'event_simulators' AND column_name = 'whowatch_event_id') THEN
    ALTER TABLE "event_simulators" RENAME COLUMN "whowatch_event_id" TO "fuwacchi_event_id";
  END IF;
END $$;

ALTER TABLE "event_simulators" ALTER COLUMN "platform" SET DEFAULT 'fuwacchi';

UPDATE "listeners"        SET "platform" = 'fuwacchi' WHERE "platform" = 'whowatch';
UPDATE "events"           SET "platform" = 'fuwacchi' WHERE "platform" = 'whowatch';
UPDATE "event_simulators" SET "platform" = 'fuwacchi' WHERE "platform" = 'whowatch';
UPDATE "event_history"    SET "platform" = 'fuwacchi' WHERE "platform" = 'whowatch';
