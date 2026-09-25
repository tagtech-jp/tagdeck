-- 0007_whowatch_rename — fuwacchi→whowatch 統一 (Drizzle 管理テーブルのみ)
-- 適用方法: Supabase SQL Editor で手動実行（社長作業 / docs/ops/whowatch_db_migration_20260718.md 参照）
-- ⚠️ 適用前バックアップ必須。本ファイルは feat/tagdeck-spec-impl-20260718 のコードと同時デプロイが前提
-- ⚠️ fuwacchi_events テーブル本体 / item_point_mapping のデータ更新は Drizzle 管理外のため
--    別ファイル supabase_whowatch_rename_manual.sql で実施（本ファイルには含まない）
-- ROLLBACK: supabase_whowatch_rename_0007_rollback.sql
-- 冪等: 各 RENAME は列存在チェック付き（再実行安全）

-- ① streamer_profiles: fuwacchi_* 8列 → whowatch_*
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'streamer_profiles' AND column_name = 'fuwacchi_user_id') THEN
    ALTER TABLE "streamer_profiles" RENAME COLUMN "fuwacchi_user_id" TO "whowatch_user_id";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'streamer_profiles' AND column_name = 'fuwacchi_live_id') THEN
    ALTER TABLE "streamer_profiles" RENAME COLUMN "fuwacchi_live_id" TO "whowatch_live_id";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'streamer_profiles' AND column_name = 'fuwacchi_is_monitoring') THEN
    ALTER TABLE "streamer_profiles" RENAME COLUMN "fuwacchi_is_monitoring" TO "whowatch_is_monitoring";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'streamer_profiles' AND column_name = 'fuwacchi_monitoring_started_at') THEN
    ALTER TABLE "streamer_profiles" RENAME COLUMN "fuwacchi_monitoring_started_at" TO "whowatch_monitoring_started_at";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'streamer_profiles' AND column_name = 'fuwacchi_last_polled_at') THEN
    ALTER TABLE "streamer_profiles" RENAME COLUMN "fuwacchi_last_polled_at" TO "whowatch_last_polled_at";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'streamer_profiles' AND column_name = 'fuwacchi_viewer_count') THEN
    ALTER TABLE "streamer_profiles" RENAME COLUMN "fuwacchi_viewer_count" TO "whowatch_viewer_count";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'streamer_profiles' AND column_name = 'fuwacchi_current_points') THEN
    ALTER TABLE "streamer_profiles" RENAME COLUMN "fuwacchi_current_points" TO "whowatch_current_points";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'streamer_profiles' AND column_name = 'fuwacchi_peak_viewer_count') THEN
    ALTER TABLE "streamer_profiles" RENAME COLUMN "fuwacchi_peak_viewer_count" TO "whowatch_peak_viewer_count";
  END IF;
END $$;
--> statement-breakpoint

-- ② event_simulators: fuwacchi_event_id → whowatch_event_id（FK は列 rename に自動追従）
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'event_simulators' AND column_name = 'fuwacchi_event_id') THEN
    ALTER TABLE "event_simulators" RENAME COLUMN "fuwacchi_event_id" TO "whowatch_event_id";
  END IF;
END $$;
--> statement-breakpoint

-- ③ event_simulators.platform の既定値を whowatch へ
ALTER TABLE "event_simulators" ALTER COLUMN "platform" SET DEFAULT 'whowatch';
--> statement-breakpoint

-- ④ 既存データの platform 値更新（Drizzle 管理テーブル分。item_point_mapping は別ファイル）
UPDATE "listeners"        SET "platform" = 'whowatch' WHERE "platform" = 'fuwacchi';
--> statement-breakpoint
UPDATE "events"           SET "platform" = 'whowatch' WHERE "platform" = 'fuwacchi';
--> statement-breakpoint
UPDATE "event_simulators" SET "platform" = 'whowatch' WHERE "platform" = 'fuwacchi';
--> statement-breakpoint
UPDATE "event_history"    SET "platform" = 'whowatch' WHERE "platform" = 'fuwacchi';
