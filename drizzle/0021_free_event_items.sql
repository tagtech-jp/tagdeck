-- 0021_free_event_items — イベントの無料配布アイテムをイベントのカテゴリに分類する（2026-09-26）
-- 背景: payments3 のカテゴリには買えるアイテムしか載らず、どんぐり・赤ずきんサイコロ等の無料アイテムは「分類なし」だった。
--       アイテム画像の events/YYYY/MM_key/ フォルダ → イベント → 詳細の ITEM タブ key（= カテゴリ key）で紐づける。
-- 適用: Supabase SQL Editor で drizzle/0021_free_event_items_manual.sql を実行（docs/migration-runbook.md）
-- ロールバック: drizzle/0021_free_event_items_rollback.sql
-- 冪等: ADD COLUMN IF NOT EXISTS
ALTER TABLE "whowatch_events" ADD COLUMN IF NOT EXISTS "item_group_key" text;
--> statement-breakpoint
ALTER TABLE "whowatch_item_groups" ADD COLUMN IF NOT EXISTS "is_free" boolean DEFAULT false NOT NULL;
