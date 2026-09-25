-- 0017_item_group_banner — SEタブのカテゴリ表示をバナー付きにする（決裁 2026-09-25: 案P）
-- 目的: whowatch_item_groups にアイテムページのバナー画像 URL と説明文を持たせ、SE タブの
--       アイテム欄をふわっちのアイテムページと同じ「バナー見出し＋アイテム」の並びにする。
-- 注意: payments3 にバナー画像のフィールドがあるかは未確認（この環境からふわっち API へ接続できなかった）。
--       同期側（item-groups-sync.ts の pickBannerUrl）は banner / banner_url / image_url 等の候補から
--       http(s) の URL を拾い、無ければ null のまま。SE タブは null なら文字の見出しで表示する。
-- 適用: Supabase SQL Editor で drizzle/0017_item_group_banner_manual.sql を実行（docs/migration-runbook.md）。
-- ロールバック: drizzle/0017_item_group_banner_rollback.sql
-- 冪等: ADD COLUMN IF NOT EXISTS

ALTER TABLE "whowatch_item_groups" ADD COLUMN IF NOT EXISTS "banner_url" text;
--> statement-breakpoint
ALTER TABLE "whowatch_item_groups" ADD COLUMN IF NOT EXISTS "description" text;
