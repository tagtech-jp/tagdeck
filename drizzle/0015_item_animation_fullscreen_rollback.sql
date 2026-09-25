-- 0015_item_animation_fullscreen_rollback — 追加した列を取り消す（SE 割り当て自体は消えない）
-- 注意: この列を消すと種類軸の「演出付き」は animation_url のみの判定に戻る
BEGIN;
ALTER TABLE "whowatch_item_patterns" DROP COLUMN IF EXISTS "animation_fullscreen";
COMMIT;
