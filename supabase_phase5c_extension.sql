-- =============================================
-- TagDeck Phase 5c Extension
-- 適用日: 未定 (社長手動実行時に記録)
-- 前提: supabase_phase5c_item_mapping.sql 適用済み
-- User-Agent: TagDeck/0.1 (+https://tagdeck.jp)
-- ROLLBACK: supabase_phase5c_extension_rollback.sql
-- =============================================

-- ① item_point_mapping へのカラム追加（HAR 解析判明フィールド）
ALTER TABLE item_point_mapping
  ADD COLUMN IF NOT EXISTS product_id   text    NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS price_jpy    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS whowatch_id  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS description  text,
  ADD COLUMN IF NOT EXISTS has_animation boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS state        text    NOT NULL DEFAULT 'OPEN';

-- ② fuwacchi_events テーブル新設（n8n 毎日 0:00 JST 同期）
CREATE TABLE IF NOT EXISTS fuwacchi_events (
  id             integer     PRIMARY KEY,
  event_key      text        NOT NULL UNIQUE,
  banner_url     text        NOT NULL DEFAULT '',
  status         text        NOT NULL DEFAULT 'open'
                             CHECK (status IN ('pre', 'open', 'closed')),
  badge_text     text,
  badge_color    text,
  badge_animation boolean    DEFAULT false,
  ended_at       timestamptz,
  participants   text,
  last_synced_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON fuwacchi_events TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON fuwacchi_events TO service_role;

ALTER TABLE fuwacchi_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fuwacchi_events: public read"
  ON fuwacchi_events
  FOR SELECT
  USING (true);
