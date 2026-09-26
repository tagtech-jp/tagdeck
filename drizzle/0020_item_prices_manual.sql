-- 0020_item_prices_manual — Supabase SQL Editor 貼付用（本文は 0020_item_prices.sql と同一・トランザクション付き）
BEGIN;

CREATE TABLE IF NOT EXISTS "whowatch_item_prices" (
	"item_id" integer PRIMARY KEY NOT NULL,
	"item_name" text DEFAULT '' NOT NULL,
	"unit_price_jpy" integer NOT NULL,
	"min_unit_price_jpy" integer NOT NULL,
	"on_sale" boolean DEFAULT true NOT NULL,
	"products" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"synced_at" timestamptz DEFAULT now() NOT NULL
);
ALTER TABLE "whowatch_item_prices" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "whowatch_item_prices: read for authenticated" ON "whowatch_item_prices";
CREATE POLICY "whowatch_item_prices: read for authenticated" ON "whowatch_item_prices" FOR SELECT TO authenticated USING (true);
GRANT SELECT ON "whowatch_item_prices" TO authenticated;

COMMIT;

-- 適用後: GitHub Actions「Whowatch item patterns sync (manual)」を 1 回実行すると行が入る
-- 確認: SELECT item_id, item_name, unit_price_jpy, min_unit_price_jpy, on_sale FROM whowatch_item_prices ORDER BY unit_price_jpy DESC LIMIT 20;
