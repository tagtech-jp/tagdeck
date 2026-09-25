-- 0018_se_presets — SE プリセット（S2・2026-09-25）
-- 目的: SE タブの割り当て一式（se_mappings）に名前を付けて保存し、8 文字の共有コードで他ユーザーが取り込めるようにする。
-- 設計:
--   - mappings は保存時点のスナップショット（jsonb）。取り込み時は取り込む側の se_mappings へ upsert する
--   - 音源 URL は所有者の Storage（バケット se・公開読み取り）をそのまま指す。ファイルは複製しない
--   - is_public=true は「みんなのプリセット」一覧に出すだけ。false でもコードを知っていれば取り込める
-- 適用: Supabase SQL Editor で drizzle/0018_se_presets_manual.sql を実行（docs/migration-runbook.md）
-- ロールバック: drizzle/0018_se_presets_rollback.sql
-- 冪等: CREATE TABLE IF NOT EXISTS / DO $$ ... EXCEPTION / DROP POLICY IF EXISTS
-- 書き込み: API ルート（DATABASE_URL 直結・RLS 対象外）。ブラウザからの直接アクセスは想定しないが、authenticated には自分の行と公開行の SELECT を許す

CREATE TABLE IF NOT EXISTS "se_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"share_code" text NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"mappings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mapping_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "se_presets" ADD CONSTRAINT "se_presets_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "se_presets" ADD CONSTRAINT "se_presets_share_code_unique" UNIQUE ("share_code");
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "se_presets_owner_idx" ON "se_presets" ("owner_user_id");
--> statement-breakpoint
ALTER TABLE "se_presets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "se_presets: own rows" ON "se_presets";
--> statement-breakpoint
CREATE POLICY "se_presets: own rows" ON "se_presets" FOR ALL TO authenticated USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());
--> statement-breakpoint
DROP POLICY IF EXISTS "se_presets: public read" ON "se_presets";
--> statement-breakpoint
CREATE POLICY "se_presets: public read" ON "se_presets" FOR SELECT TO authenticated USING (is_public = true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "se_presets" TO authenticated;
