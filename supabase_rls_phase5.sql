-- =============================================
-- TagDeck RLS Phase 5
-- 適用日: 未定 (社長手動実行時に記録)
-- 対象: public.users / public.event_simulators / public.event_history
-- 前提: supabase_rls_phase4a.sql 適用済み
-- 設計: パターンA(self-only CRUD)
-- ROLLBACK: supabase_rls_phase5_rollback.sql
-- =============================================

-- ① public.users (Drizzle ensureUserRow パターン対応)
-- id = auth.uid() で自己参照（user_id カラムではなく id 自体が識別子）
GRANT SELECT, INSERT, UPDATE, DELETE ON users TO authenticated;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users: own row only"
  ON users
  FOR ALL
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ② public.event_simulators (Drizzle CRUD + Realtime サブスクリプション対応)
-- useEventSimulator.ts の postgres_changes 購読に Realtime Publication 追加が必要
GRANT SELECT, INSERT, UPDATE, DELETE ON event_simulators TO authenticated;

ALTER TABLE event_simulators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event_simulators: own rows only"
  ON event_simulators
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

ALTER PUBLICATION supabase_realtime ADD TABLE event_simulators;

-- ③ public.event_history (Phase 5b 用、現時点アプリからのアクセスなし)
GRANT SELECT, INSERT, UPDATE, DELETE ON event_history TO authenticated;

ALTER TABLE event_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event_history: own rows only"
  ON event_history
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
