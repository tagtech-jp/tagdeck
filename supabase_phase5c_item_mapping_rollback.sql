-- =============================================
-- TagDeck Phase 5c item_point_mapping ROLLBACK
-- 適用前に必ず supabase_phase5c_item_mapping.sql が適用済みであることを確認
-- =============================================

DROP POLICY IF EXISTS "item_point_mapping: public read" ON item_point_mapping;
ALTER TABLE item_point_mapping DISABLE ROW LEVEL SECURITY;
DROP TABLE IF EXISTS item_point_mapping;
