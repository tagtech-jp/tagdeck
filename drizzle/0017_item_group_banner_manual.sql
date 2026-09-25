-- 0017_item_group_banner_manual — Supabase SQL Editor 貼付用（本文は 0017_item_group_banner.sql と同一・トランザクション付き）
BEGIN;

ALTER TABLE "whowatch_item_groups" ADD COLUMN IF NOT EXISTS "banner_url" text;
ALTER TABLE "whowatch_item_groups" ADD COLUMN IF NOT EXISTS "description" text;

COMMIT;

-- 適用後の確認
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns
--  WHERE table_name = 'whowatch_item_groups' ORDER BY ordinal_position;  -- banner_url / description が増えている
-- 同期（Actions「Whowatch item patterns sync (manual)」）後:
-- SELECT group_key, group_title, banner_url IS NOT NULL AS has_banner, count(*) FROM whowatch_item_groups
--  GROUP BY 1,2,3 ORDER BY min(display_order);  -- has_banner が全て false なら payments3 にバナー URL が無い（文字見出しで動作）
