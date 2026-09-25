-- =============================================
-- TagDeck Phase 5c item_point_mapping
-- 適用日: 未定 (社長手動実行時に記録)
-- 対象: public.item_point_mapping
-- 前提: supabase_rls_phase5.sql + supabase_phase5c_extension.sql 適用済み
-- User-Agent: TagDeck/0.1 (+https://tagdeck.jp)
-- ROLLBACK: supabase_phase5c_item_mapping_rollback.sql
-- =============================================

CREATE TABLE IF NOT EXISTS item_point_mapping (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  platform        text        NOT NULL,
  item_id         text        NOT NULL,
  item_name       text        NOT NULL,
  base_point      integer     NOT NULL,
  product_id      text        NOT NULL DEFAULT '',
  price_jpy       integer     NOT NULL DEFAULT 0,
  whowatch_id     integer     NOT NULL DEFAULT 0,
  description     text,
  has_animation   boolean     NOT NULL DEFAULT false,
  state           text        NOT NULL DEFAULT 'OPEN',
  last_fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, item_id)
);

GRANT SELECT ON item_point_mapping TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON item_point_mapping TO service_role;

ALTER TABLE item_point_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "item_point_mapping: public read"
  ON item_point_mapping
  FOR SELECT
  USING (true);

-- ふわっちイベント応援アイテム (HAR 解析確定値 / 2026-05)
-- ON CONFLICT で冪等化 (再実行時に上書き)
INSERT INTO item_point_mapping
  (platform, item_id, item_name, base_point, product_id, price_jpy, whowatch_id, last_fetched_at)
VALUES
  ('fuwacchi','ouen_pig',    'トンでもない応援をするぶたさん',               160,'web.ranking.ouen_pig.1.sale',   160,10842, now()),
  ('fuwacchi','ouen_zou',    'イベント応援するゾウ!',                        160,'web.ranking.ouen_zou.1.sale',   160,10773, now()),
  ('fuwacchi','ouen_deer',   'たしかな応援をするシカさん',                   160,'web.ranking.ouen-deer.1',       160,12131, now()),
  ('fuwacchi','ouen_wanchan','ワンチャン33倍の応援をするワンちゃんさん',    160,'web.ranking.ouen_wanchan.1.sale',160,11146, now()),
  ('fuwacchi','ouen_mogura', 'もぐりながら応援するもぐらさん',               160,'web.ranking.ouen_mogura.1',     160,12132, now()),
  ('fuwacchi','weekend_1',   'シンデレラ',                                   160,'web.ranking.weekend_1.1',       160,10997, now()),
  ('fuwacchi','baseball2026','ピッチャーもりあげねこさん',                   160,'web.ranking.baseball2026.1',    160,12727, now())
ON CONFLICT (platform, item_id) DO UPDATE
  SET item_name       = EXCLUDED.item_name,
      base_point      = EXCLUDED.base_point,
      product_id      = EXCLUDED.product_id,
      price_jpy       = EXCLUDED.price_jpy,
      whowatch_id     = EXCLUDED.whowatch_id,
      last_fetched_at = now();
