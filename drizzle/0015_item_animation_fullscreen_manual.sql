-- 0015_item_animation_fullscreen_manual — Supabase SQL Editor 貼付用（本文は 0015_item_animation_fullscreen.sql と同一・トランザクション付き）
BEGIN;
ALTER TABLE "whowatch_item_patterns" ADD COLUMN IF NOT EXISTS "animation_fullscreen" boolean DEFAULT false NOT NULL;
COMMIT;

-- 適用後の確認
-- SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--  WHERE table_name = 'whowatch_item_patterns' AND column_name = 'animation_fullscreen';
-- 既存行は false で埋まる。値は次回のパターン同期（/api/platforms/whowatch/items/sync）で入る
-- SELECT count(*) FILTER (WHERE animation_fullscreen) AS fullscreen,
--        count(*) FILTER (WHERE animation_url IS NOT NULL) AS has_url
--   FROM whowatch_item_patterns;  -- 同期後の目安: fullscreen 334 / has_url 179
