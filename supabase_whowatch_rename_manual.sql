-- =============================================
-- TagDeck whowatch 統一 — 手動SQL管理テーブル分 (2026-07-18)
-- ⚠️ 適用前バックアップ必須（fuwacchi_events / item_point_mapping の全行エクスポート）
-- ⚠️ 本ファイルの対象は Drizzle 管理外テーブルのため drizzle-kit の検知対象外。
--    drizzle/0007_whowatch_rename.sql とセットで適用すること（適用順は 0007 → 本ファイルを推奨）
-- 適用方法: Supabase SQL Editor で手動実行（社長作業 / docs/ops/whowatch_db_migration_20260718.md 参照）
-- ROLLBACK: supabase_whowatch_rename_manual_rollback.sql
-- 冪等: テーブル存在チェック付き（再実行安全）
-- =============================================

-- ① fuwacchi_events → whowatch_events（RLS・GRANT・FK は RENAME に自動追従）
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'fuwacchi_events') THEN
    ALTER TABLE "fuwacchi_events" RENAME TO "whowatch_events";
  END IF;
END $$;

-- ② RLS ポリシー名の追従 rename（機能上は旧名のままでも動作するが名前を整合させる）
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies
             WHERE schemaname = 'public' AND tablename = 'whowatch_events'
               AND policyname = 'fuwacchi_events: public read') THEN
    ALTER POLICY "fuwacchi_events: public read" ON "whowatch_events"
      RENAME TO "whowatch_events: public read";
  END IF;
END $$;

-- ③ item_point_mapping の既存データ platform 値更新（テーブル名は変更なし）
UPDATE "item_point_mapping" SET "platform" = 'whowatch' WHERE "platform" = 'fuwacchi';
