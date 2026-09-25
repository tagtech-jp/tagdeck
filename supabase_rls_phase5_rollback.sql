-- =============================================
-- TagDeck RLS Phase 5 ROLLBACK
-- 用途: phase5 適用後に既存機能(特に Realtime)が壊れた場合の即時切り戻し
-- 実行方法: Supabase Dashboard > SQL Editor で全文 Run
-- =============================================

-- ② event_simulators (Realtime DROP を先に実行)
DROP POLICY IF EXISTS "event_simulators: own rows only" ON event_simulators;
ALTER PUBLICATION supabase_realtime DROP TABLE event_simulators;
ALTER TABLE event_simulators DISABLE ROW LEVEL SECURITY;

-- ① users
DROP POLICY IF EXISTS "users: own row only" ON users;
ALTER TABLE users DISABLE ROW LEVEL SECURITY;

-- ③ event_history
DROP POLICY IF EXISTS "event_history: own rows only" ON event_history;
ALTER TABLE event_history DISABLE ROW LEVEL SECURITY;

-- GRANT は無害なため切り戻し不要
