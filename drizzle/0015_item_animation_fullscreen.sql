-- 0015_item_animation_fullscreen — SE タブの種類軸（通常 / 当たり / 演出付き）
-- 目的: /playitems の animation_fullscreen を保存する。animation_url2 が無くても全画面演出のパターンが
--       334 件中 286 件あり（2026-09-22 実 API 集計）、animation_url だけでは演出付きを 62% 取りこぼすため。
-- 適用: Supabase SQL Editor で drizzle/0015_item_animation_fullscreen_manual.sql を実行（docs/migration-runbook.md）。
-- ロールバック: drizzle/0015_item_animation_fullscreen_rollback.sql
-- 冪等: ADD COLUMN IF NOT EXISTS

ALTER TABLE "whowatch_item_patterns" ADD COLUMN IF NOT EXISTS "animation_fullscreen" boolean DEFAULT false NOT NULL;
