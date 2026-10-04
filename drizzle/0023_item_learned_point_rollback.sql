-- 0023_item_learned_point_rollback — 学習単価の 3 列を外し、表単位の公開読み取り（anon / authenticated）を元に戻す。
-- 学習結果は erupi-commentbot 側（data/bot.db の unit_obs と data/learned_item_points.json）にも残っているので、
-- 再適用後に書き込み直せる。コードを戻す（PR の revert）のが先
BEGIN;
ALTER TABLE "item_point_mapping" DROP COLUMN IF EXISTS "learned_at";
ALTER TABLE "item_point_mapping" DROP COLUMN IF EXISTS "learned_samples";
ALTER TABLE "item_point_mapping" DROP COLUMN IF EXISTS "learned_point";
GRANT SELECT ON public.item_point_mapping TO anon, authenticated;
COMMIT;

-- 列は残したまま、学習単価を公開の読み取りに戻すだけなら（社長が「公開してよい」と決めたとき）:
--   GRANT SELECT ON public.item_point_mapping TO anon, authenticated;
