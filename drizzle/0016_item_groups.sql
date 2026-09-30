-- 0016_item_groups — SEタブのアイテム仕分け 第2弾（カテゴリ軸）
-- 目的: ふわっちのアイテムページの見出し（/playitems/payments3 のカテゴリ）を item_id に紐づけ、
--       SEタブのカテゴリープルダウンと cat:group: の一括割り当てを可能にする。
-- 実測（2026-09-22 公開APIの実応答）: 20 カテゴリ・distinct item_id 107 件。うち /playitems マスタに
--       存在するのは 87 件（1,973 件中）。残りは分類が付かない。
--       1 アイテムが複数カテゴリに同時所属する（例: item_id 11146 が event_ouen_sale /
--       autumncollection / wwboss / viewer_level_benefit の 4 つ）ため item_id 単体では一意にならない。
--       販売期間の日付は API に含まれない（badge_text「期間限定」は取れる）。
-- 適用: Supabase SQL Editor で drizzle/0016_item_groups_manual.sql を実行（docs/migration-runbook.md）。
-- ロールバック: drizzle/0016_item_groups_rollback.sql
-- 冪等: CREATE TABLE IF NOT EXISTS ＋ ADD COLUMN IF NOT EXISTS
--       CREATE TABLE IF NOT EXISTS だけでは、列を足して再提示しても既存テーブルには反映されない。
--       実際に 2026-09-23、5 列版を適用済みの DB に 8 列版を流して無反応となり、
--       /items/patterns が 500・カテゴリ 0 件になった。ALTER は将来の再適用のために必ず残す。
-- 書き込み: whowatch_item_patterns と同じく POST /api/platforms/whowatch/items/sync（DATABASE_URL 直結）。
--       この接続はテーブルのオーナーなので RLS の対象外。ブラウザからは authenticated の SELECT のみ。

CREATE TABLE IF NOT EXISTS "whowatch_item_groups" (
	"item_id" integer NOT NULL,
	"group_key" text NOT NULL,
	"group_title" text NOT NULL,
	"sub_group_title" text,
	"badge_text" text,
	"display_order" integer,
	"event_key" text,
	"synced_at" timestamptz DEFAULT now() NOT NULL,
	PRIMARY KEY ("item_id", "group_key")
);
--> statement-breakpoint
-- 5 列版を適用済みの DB を 8 列に揃える（新規作成時は何も起きない）
ALTER TABLE "whowatch_item_groups" ADD COLUMN IF NOT EXISTS "sub_group_title" text;
--> statement-breakpoint
ALTER TABLE "whowatch_item_groups" ADD COLUMN IF NOT EXISTS "badge_text" text;
--> statement-breakpoint
ALTER TABLE "whowatch_item_groups" ADD COLUMN IF NOT EXISTS "display_order" integer;
--> statement-breakpoint
-- 全ユーザー共有のマスタ。書き込みは同期ルート（DATABASE_URL 直結）のみ。ブラウザからは読み取りのみ
ALTER TABLE "whowatch_item_groups" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "whowatch_item_groups: read for authenticated" ON "whowatch_item_groups";
--> statement-breakpoint
CREATE POLICY "whowatch_item_groups: read for authenticated" ON "whowatch_item_groups" FOR SELECT TO authenticated USING (true);
--> statement-breakpoint
GRANT SELECT ON "whowatch_item_groups" TO authenticated;
