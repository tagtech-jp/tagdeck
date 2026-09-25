-- 0012_event_periods — イベント勝率シミュレーター E1b
-- 目的: whowatch_events に区分（前半/後半・グループ）ごとの期間 periods(jsonb) を追加する（追加のみ）。
-- 適用: Supabase SQL Editor で drizzle/0012_event_periods_manual.sql を実行（docs/migration-runbook.md）。
-- ロールバック: drizzle/0012_event_periods_rollback.sql
-- 冪等: ADD COLUMN IF NOT EXISTS

ALTER TABLE "whowatch_events" ADD COLUMN IF NOT EXISTS "periods" jsonb DEFAULT NULL;
