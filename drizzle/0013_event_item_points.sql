-- 0013_event_item_points — イベント勝率シミュレーター E3
-- 目的: イベント別のアイテム基礎ランキングポイント（手入力 / 実測推定）を保存する event_item_points を作成する。
-- 適用: Supabase SQL Editor で drizzle/0013_event_item_points_manual.sql を実行（docs/migration-runbook.md）。
-- ロールバック: drizzle/0013_event_item_points_rollback.sql
-- 冪等: CREATE TABLE IF NOT EXISTS / DO $$ … duplicate_object

CREATE TABLE IF NOT EXISTS "event_item_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" text NOT NULL,
	"item_id" text NOT NULL,
	"base_point" integer NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "event_item_points" ADD CONSTRAINT "event_item_points_event_item_unique" UNIQUE ("event_key", "item_id");
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
-- 全ユーザー共有の基準値。書き込みは Drizzle(postgres ロール)経由の認証必須ルートのみ。ブラウザからは読み取りのみ
ALTER TABLE "event_item_points" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "event_item_points: read for authenticated" ON "event_item_points";
--> statement-breakpoint
CREATE POLICY "event_item_points: read for authenticated" ON "event_item_points" FOR SELECT TO authenticated USING (true);
--> statement-breakpoint
GRANT SELECT ON "event_item_points" TO authenticated;
