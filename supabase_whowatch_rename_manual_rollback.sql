-- =============================================
-- ROLLBACK: supabase_whowatch_rename_manual.sql の巻き戻し (2026-07-18)
-- 適用方法: Supabase SQL Editor で手動実行（社長作業）
-- 冪等: 存在チェック付き
-- =============================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies
             WHERE schemaname = 'public' AND tablename = 'whowatch_events'
               AND policyname = 'whowatch_events: public read') THEN
    ALTER POLICY "whowatch_events: public read" ON "whowatch_events"
      RENAME TO "fuwacchi_events: public read";
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'whowatch_events') THEN
    ALTER TABLE "whowatch_events" RENAME TO "fuwacchi_events";
  END IF;
END $$;

UPDATE "item_point_mapping" SET "platform" = 'fuwacchi' WHERE "platform" = 'whowatch';
