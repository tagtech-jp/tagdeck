-- 0020_item_prices_rollback — テーブルごと削除（同期で作り直せる）。無い間は item_point_mapping.price_jpy（最初の商品の価格）に戻る
BEGIN;
DROP POLICY IF EXISTS "whowatch_item_prices: read for authenticated" ON "whowatch_item_prices";
DROP TABLE IF EXISTS "whowatch_item_prices";
COMMIT;
