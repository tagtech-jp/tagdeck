-- event_simulators テーブルに fuwacchi_event_id カラムを追加
-- 適用方法: Supabase SQL Editor で手動実行（社長作業 / Phase 4 手順書参照）
-- 前提: supabase_phase5c_extension.sql 適用済み（fuwacchi_events テーブル存在）
-- ROLLBACK: ALTER TABLE "event_simulators" DROP COLUMN IF EXISTS "fuwacchi_event_id";
ALTER TABLE "event_simulators"
  ADD COLUMN IF NOT EXISTS "fuwacchi_event_id" integer
  REFERENCES "fuwacchi_events"("id") ON DELETE SET NULL;
