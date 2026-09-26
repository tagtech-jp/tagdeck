-- 0020_item_prices — ふわっちアイテムの「1 個あたりの単価」（2026-09-26）
-- 背景: item_point_mapping.price_jpy は最初の商品の価格で、複数商品（1 個/5 個/10 個…）のアイテムで曖昧だった。
--       /playitems/payments3 の商品ごとの price ÷ quantity から単価を求めて別テーブルに持つ。
-- 適用: Supabase SQL Editor で drizzle/0020_item_prices_manual.sql を実行（docs/migration-runbook.md）
-- ロールバック: drizzle/0020_item_prices_rollback.sql
-- 冪等: CREATE TABLE IF NOT EXISTS
-- 書き込み: POST /api/platforms/whowatch/items/sync（DATABASE_URL 直結・RLS 対象外）。ブラウザからは authenticated の SELECT のみ
CREATE TABLE IF NOT EXISTS "whowatch_item_prices" (
	"item_id" integer PRIMARY KEY NOT NULL,
	"item_name" text DEFAULT '' NOT NULL,
	"unit_price_jpy" integer NOT NULL,
	"min_unit_price_jpy" integer NOT NULL,
	"on_sale" boolean DEFAULT true NOT NULL,
	"products" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"synced_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whowatch_item_prices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "whowatch_item_prices: read for authenticated" ON "whowatch_item_prices";
--> statement-breakpoint
CREATE POLICY "whowatch_item_prices: read for authenticated" ON "whowatch_item_prices" FOR SELECT TO authenticated USING (true);
--> statement-breakpoint
GRANT SELECT ON "whowatch_item_prices" TO authenticated;
