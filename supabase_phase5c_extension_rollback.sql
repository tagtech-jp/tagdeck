-- =============================================
-- TagDeck Phase 5c Extension ROLLBACK
-- =============================================

DROP POLICY IF EXISTS "fuwacchi_events: public read" ON fuwacchi_events;
ALTER TABLE fuwacchi_events DISABLE ROW LEVEL SECURITY;
DROP TABLE IF EXISTS fuwacchi_events;

ALTER TABLE item_point_mapping
  DROP COLUMN IF EXISTS product_id,
  DROP COLUMN IF EXISTS price_jpy,
  DROP COLUMN IF EXISTS whowatch_id,
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS has_animation,
  DROP COLUMN IF EXISTS state;
