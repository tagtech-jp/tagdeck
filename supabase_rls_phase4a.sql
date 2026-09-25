-- ① authenticated ロールに GRANT（Supabase クライアント経由アクセスに必要）
GRANT SELECT, INSERT, UPDATE, DELETE ON streamer_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON listeners TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON events TO authenticated;

-- ② streamer_profiles RLS
ALTER TABLE streamer_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "streamer_profiles: own rows only"
  ON streamer_profiles
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ③ listeners RLS
ALTER TABLE listeners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "listeners: own streamer rows only"
  ON listeners
  FOR ALL
  USING (
    streamer_id IN (
      SELECT id FROM streamer_profiles WHERE user_id = auth.uid()
    )
  );

-- ④ events RLS
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "events: own streamer rows only"
  ON events
  FOR ALL
  USING (
    streamer_id IN (
      SELECT id FROM streamer_profiles WHERE user_id = auth.uid()
    )
  );

-- ⑤ Realtime 有効化（filter 付き postgres_changes 購読に必要）
ALTER PUBLICATION supabase_realtime ADD TABLE streamer_profiles;
