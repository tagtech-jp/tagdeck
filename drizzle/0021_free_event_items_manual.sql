-- 0021_free_event_items_manual — Supabase SQL Editor 貼付用（本文は 0021_free_event_items.sql と同一・トランザクション付き）
BEGIN;

ALTER TABLE "whowatch_events" ADD COLUMN IF NOT EXISTS "item_group_key" text;
ALTER TABLE "whowatch_item_groups" ADD COLUMN IF NOT EXISTS "is_free" boolean DEFAULT false NOT NULL;

COMMIT;

-- 適用後: GitHub Actions「Whowatch item patterns sync (manual)」を 1 回実行（応答の freeItems.rows が無料アイテムの行数）
-- 確認: SELECT g.item_id, p.item_name, g.group_key, g.event_key FROM whowatch_item_groups g
--        JOIN (SELECT DISTINCT item_id, item_name FROM whowatch_item_patterns) p ON p.item_id = g.item_id
--        WHERE g.is_free ORDER BY g.group_key, g.item_id;
